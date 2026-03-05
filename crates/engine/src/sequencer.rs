use crate::arpeggiator::{generate_arp_pattern, ArpDirection};
use crate::clock_divider::{get_effective_step, TICKS_PER_STEP};
use crate::lfo::compute_lfo_value;
use crate::mutator::{is_mutate_active, mutate_track};
use crate::randomizer::{
    randomize_gate_length, randomize_gates, randomize_mod, randomize_pitch, randomize_ratchets,
    randomize_slides, randomize_ties, randomize_track, randomize_velocity, SubtrackLengths,
};
use crate::routing::resolve_outputs;
use crate::types::{
    GateStep, ModStep, MutateConfig, NoteEvent, PitchStep, SequencerState, Subtrack,
};
use crate::variation::advance_variation_bar;
use crate::MAX_STEPS;

const MAX_LENGTH: usize = 16;

// ── Tick ─────────────────────────────────────────────────────────────

/// Advance the sequencer by one tick. Mutates state in-place and returns output events.
/// Events are `None` for outputs that are between step boundaries.
pub fn tick(state: &mut SequencerState) -> [Option<NoteEvent>; 4] {
    let master_tick = state.transport.master_tick;
    let next_tick = master_tick + 1;

    // Compute current step positions for event resolution
    for track in state.tracks.iter_mut() {
        let td = track.clock_divider;
        track.gate.current_step =
            get_effective_step(master_tick, td, track.gate.clock_divider, track.gate.length as usize) as u8;
        track.pitch.current_step =
            get_effective_step(master_tick, td, track.pitch.clock_divider, track.pitch.length as usize)
                as u8;
        track.velocity.current_step = get_effective_step(
            master_tick,
            td,
            track.velocity.clock_divider,
            track.velocity.length as usize,
        ) as u8;
        track.modulation.current_step = get_effective_step(
            master_tick,
            td,
            track.modulation.clock_divider,
            track.modulation.length as usize,
        ) as u8;
    }

    // Update mute positions
    for mute in state.mute_patterns.iter_mut() {
        mute.current_step = get_effective_step(master_tick, 1, mute.clock_divider, mute.length as usize) as u8;
    }

    // Compute LFO values at current tick
    let mut lfo_values = [0.0_f32; 4];
    for (idx, lfo_val) in lfo_values.iter_mut().enumerate() {
        let track_div = state.tracks[idx].clock_divider;
        let (value, _runtime) = compute_lfo_value(
            &state.lfo_configs[idx],
            &state.lfo_runtimes[idx],
            master_tick,
            track_div,
            state.transport.bpm,
        );
        *lfo_val = value;
        // Compute runtime for next tick
        let (_, next_runtime) = compute_lfo_value(
            &state.lfo_configs[idx],
            &state.lfo_runtimes[idx],
            next_tick,
            track_div,
            state.transport.bpm,
        );
        state.lfo_runtimes[idx] = next_runtime;
    }

    // Resolve routing to produce output events
    let raw_events = resolve_outputs(
        &state.tracks,
        &state.routing,
        &state.mute_patterns,
        &state.transpose_configs,
        &state.variation_patterns,
        &lfo_values,
    );

    // Only emit events at per-output step boundaries
    let events: [Option<NoteEvent>; 4] = core::array::from_fn(|i| {
        let route = &state.routing[i];
        let gate_track = &state.tracks[route.gate as usize];
        let combined =
            TICKS_PER_STEP as u64 * gate_track.clock_divider as u64 * gate_track.gate.clock_divider as u64;
        if master_tick == 0 || master_tick.is_multiple_of(combined) {
            Some(raw_events[i].clone())
        } else {
            None
        }
    });

    // --- Mutation (Turing Machine drift) ---
    for idx in 0..4 {
        if !is_mutate_active(&state.mutate_configs[idx]) {
            continue;
        }
        let track_div = state.tracks[idx].clock_divider;
        let trigger = state.mutate_configs[idx].trigger;

        if trigger == crate::types::MutateTrigger::Bars {
            let bars = state.mutate_configs[idx].bars;
            let interval = bars as u64 * 16 * TICKS_PER_STEP as u64;
            if interval > 0 && master_tick > 0 && master_tick.is_multiple_of(interval) {
                let mc = state.mutate_configs[idx].clone();
                let rc = state.random_configs[idx].clone();
                mutate_track(
                    &mut state.tracks[idx],
                    &rc,
                    &mc,
                    master_tick as u32,
                );
            }
        } else {
            // Loop mode: mutate each subtrack independently at its own loop boundary
            let looped_gate = looped_on_nth(
                master_tick,
                next_tick,
                track_div,
                state.tracks[idx].gate.clock_divider,
                state.tracks[idx].gate.length,
                state.mutate_configs[idx].bars,
            );
            let looped_pitch = looped_on_nth(
                master_tick,
                next_tick,
                track_div,
                state.tracks[idx].pitch.clock_divider,
                state.tracks[idx].pitch.length,
                state.mutate_configs[idx].bars,
            );
            let looped_vel = looped_on_nth(
                master_tick,
                next_tick,
                track_div,
                state.tracks[idx].velocity.clock_divider,
                state.tracks[idx].velocity.length,
                state.mutate_configs[idx].bars,
            );
            let looped_mod = looped_on_nth(
                master_tick,
                next_tick,
                track_div,
                state.tracks[idx].modulation.clock_divider,
                state.tracks[idx].modulation.length,
                state.mutate_configs[idx].bars,
            );

            let mc = &state.mutate_configs[idx];
            let loop_config = MutateConfig {
                trigger: mc.trigger,
                bars: mc.bars,
                gate: if looped_gate { mc.gate } else { 0.0 },
                pitch: if looped_pitch { mc.pitch } else { 0.0 },
                velocity: if looped_vel { mc.velocity } else { 0.0 },
                modulation: if looped_mod { mc.modulation } else { 0.0 },
            };

            if is_mutate_active(&loop_config) {
                let rc = state.random_configs[idx].clone();
                mutate_track(
                    &mut state.tracks[idx],
                    &rc,
                    &loop_config,
                    master_tick as u32,
                );
            }
        }
    }

    // --- Variation bar counter advancement ---
    for idx in 0..4 {
        if !state.variation_patterns[idx].enabled {
            continue;
        }
        let track_div = state.tracks[idx].clock_divider;
        let cur_gate = get_effective_step(
            master_tick,
            track_div,
            state.tracks[idx].gate.clock_divider,
            state.tracks[idx].gate.length as usize,
        );
        let nxt_gate = get_effective_step(
            next_tick,
            track_div,
            state.tracks[idx].gate.clock_divider,
            state.tracks[idx].gate.length as usize,
        );
        if cur_gate > 0 && nxt_gate == 0 {
            advance_variation_bar(&mut state.variation_patterns[idx]);
        }
    }

    // Advance steps to next tick
    for track in state.tracks.iter_mut() {
        let td = track.clock_divider;
        track.gate.current_step =
            get_effective_step(next_tick, td, track.gate.clock_divider, track.gate.length as usize) as u8;
        track.pitch.current_step =
            get_effective_step(next_tick, td, track.pitch.clock_divider, track.pitch.length as usize) as u8;
        track.velocity.current_step = get_effective_step(
            next_tick,
            td,
            track.velocity.clock_divider,
            track.velocity.length as usize,
        ) as u8;
        track.modulation.current_step = get_effective_step(
            next_tick,
            td,
            track.modulation.clock_divider,
            track.modulation.length as usize,
        ) as u8;
    }

    for mute in state.mute_patterns.iter_mut() {
        mute.current_step = get_effective_step(next_tick, 1, mute.clock_divider, mute.length as usize) as u8;
    }

    state.transport.master_tick = next_tick;

    events
}

fn looped_on_nth(
    master_tick: u64,
    next_tick: u64,
    track_div: u8,
    sub_div: u8,
    length: u8,
    bars: u8,
) -> bool {
    let cur = get_effective_step(master_tick, track_div, sub_div, length as usize);
    let nxt = get_effective_step(next_tick, track_div, sub_div, length as usize);
    if !(cur > 0 && nxt == 0) {
        return false;
    }
    let combined = TICKS_PER_STEP as u64 * track_div as u64 * sub_div as u64;
    let loop_num = next_tick / combined / length as u64;
    bars <= 1 || loop_num.is_multiple_of(bars as u64)
}

// ── State setters ────────────────────────────────────────────────────

impl SequencerState {
    pub fn set_gate_on(&mut self, track: usize, step: usize, value: bool) {
        if let Some(s) = self.tracks[track].gate.steps.get_mut(step) {
            s.on = value;
        }
    }

    pub fn set_gate_length(&mut self, track: usize, step: usize, value: f32) {
        if let Some(s) = self.tracks[track].gate.steps.get_mut(step) {
            s.length = value;
        }
    }

    pub fn set_gate_ratchet(&mut self, track: usize, step: usize, value: u8) {
        if let Some(s) = self.tracks[track].gate.steps.get_mut(step) {
            s.ratchet = value;
        }
    }

    pub fn set_gate_tie(&mut self, track: usize, step: usize, value: bool) {
        if let Some(s) = self.tracks[track].gate.steps.get_mut(step) {
            s.tie = value;
        }
    }

    pub fn set_tie_range(&mut self, track: usize, from_step: usize, to_step: usize) {
        if from_step >= to_step {
            return;
        }
        self.set_gate_on(track, from_step, true);
        for i in (from_step + 1)..=to_step {
            self.set_gate_on(track, i, false);
            self.set_gate_tie(track, i, true);
        }
    }

    pub fn set_pitch_note(&mut self, track: usize, step: usize, value: u8) {
        if let Some(s) = self.tracks[track].pitch.steps.get_mut(step) {
            s.note = value;
        }
    }

    pub fn set_slide(&mut self, track: usize, step: usize, value: f32) {
        if let Some(s) = self.tracks[track].pitch.steps.get_mut(step) {
            s.slide = value;
        }
    }

    pub fn set_velocity(&mut self, track: usize, step: usize, value: u8) {
        if let Some(s) = self.tracks[track].velocity.steps.get_mut(step) {
            *s = value;
        }
    }

    pub fn set_mod_step(&mut self, track: usize, step: usize, value: f32, slew: f32) {
        if let Some(s) = self.tracks[track].modulation.steps.get_mut(step) {
            s.value = value;
            s.slew = slew;
        }
    }

    pub fn set_subtrack_length(
        &mut self,
        track: usize,
        subtrack: SubtrackId,
        new_length: u8,
    ) {
        let length = (new_length.max(1)).min(MAX_STEPS as u8);
        match subtrack {
            SubtrackId::Gate => {
                resize_subtrack(&mut self.tracks[track].gate, length, GateStep::default());
            }
            SubtrackId::Pitch => {
                resize_subtrack(&mut self.tracks[track].pitch, length, PitchStep::default());
            }
            SubtrackId::Velocity => {
                resize_subtrack(&mut self.tracks[track].velocity, length, 100u8);
            }
            SubtrackId::Mod => {
                resize_subtrack(&mut self.tracks[track].modulation, length, ModStep::default());
            }
        }
    }

    pub fn set_subtrack_clock_divider(
        &mut self,
        track: usize,
        subtrack: SubtrackId,
        divider: u8,
    ) {
        let div = divider.clamp(1, 32);
        match subtrack {
            SubtrackId::Gate => self.tracks[track].gate.clock_divider = div,
            SubtrackId::Pitch => self.tracks[track].pitch.clock_divider = div,
            SubtrackId::Velocity => self.tracks[track].velocity.clock_divider = div,
            SubtrackId::Mod => self.tracks[track].modulation.clock_divider = div,
        }
    }

    pub fn set_track_clock_divider(&mut self, track: usize, divider: u8) {
        self.tracks[track].clock_divider = divider.clamp(1, 32);
    }

    pub fn set_routing(&mut self, routing: [crate::types::OutputRouting; 4]) {
        self.routing = routing;
    }

    pub fn set_output_source(
        &mut self,
        output: usize,
        param: SubtrackId,
        source_track: u8,
    ) {
        let clamped = source_track.min(3);
        match param {
            SubtrackId::Gate => self.routing[output].gate = clamped,
            SubtrackId::Pitch => self.routing[output].pitch = clamped,
            SubtrackId::Velocity => self.routing[output].velocity = clamped,
            SubtrackId::Mod => self.routing[output].modulation = clamped,
        }
    }

    pub fn set_mod_source(&mut self, output: usize, source: crate::types::ModSource) {
        self.routing[output].mod_source = source;
    }

    pub fn reset_playheads(&mut self) {
        self.transport.master_tick = 0;
        for track in self.tracks.iter_mut() {
            track.gate.current_step = 0;
            track.pitch.current_step = 0;
            track.velocity.current_step = 0;
            track.modulation.current_step = 0;
        }
        for mute in self.mute_patterns.iter_mut() {
            mute.current_step = 0;
        }
    }

    /// Randomize all subtracks of a track using its random config.
    pub fn randomize_full_track(&mut self, track_index: usize, seed: u32) {
        let config = &self.random_configs[track_index];
        let lengths = SubtrackLengths {
            gate: MAX_LENGTH,
            pitch: MAX_LENGTH,
            velocity: MAX_LENGTH,
            modulation: MAX_LENGTH,
        };
        let generated = randomize_track(config, &lengths, seed);

        let track = &mut self.tracks[track_index];

        // Compose GateSteps from generated data
        for i in 0..MAX_LENGTH {
            track.gate.steps[i] = GateStep {
                on: generated.gate[i] && !generated.tie[i],
                tie: generated.tie[i],
                length: generated.gate_length[i],
                ratchet: if generated.tie[i] {
                    1
                } else {
                    generated.ratchet[i]
                },
            };
        }
        for i in 0..MAX_LENGTH {
            track.pitch.steps[i] = PitchStep {
                note: generated.pitch[i],
                slide: generated.slide[i],
            };
        }
        for i in 0..MAX_LENGTH {
            track.velocity.steps[i] = generated.velocity[i];
        }
        for i in 0..MAX_LENGTH {
            track.modulation.steps[i] = generated.modulation[i].clone();
        }
    }

    /// Randomize only the gate subtrack.
    pub fn randomize_gate(&mut self, track_index: usize, seed: u32) {
        let config = &self.random_configs[track_index];
        let new_gates = randomize_gates(&config.gate, MAX_LENGTH, seed);
        let new_lengths = randomize_gate_length(&config.gate_length, MAX_LENGTH, seed + 3);
        let new_ratchets = randomize_ratchets(&config.ratchet, MAX_LENGTH, seed + 4);
        let new_ties = randomize_ties(
            config.tie.probability,
            config.tie.max_length,
            &new_gates,
            MAX_LENGTH,
            seed + 7,
        );

        let track = &mut self.tracks[track_index];
        for i in 0..MAX_LENGTH {
            track.gate.steps[i] = GateStep {
                on: new_gates[i] && !new_ties[i],
                tie: new_ties[i],
                length: new_lengths[i],
                ratchet: if new_ties[i] { 1 } else { new_ratchets[i] },
            };
        }
    }

    /// Randomize only the pitch subtrack.
    pub fn randomize_pitch(&mut self, track_index: usize, seed: u32) {
        let config = &self.random_configs[track_index];
        let arp = &self.arp_configs[track_index];

        let new_notes = if arp.enabled {
            let dir = match arp.direction {
                crate::types::ArpDirection::Up => ArpDirection::Up,
                crate::types::ArpDirection::Down => ArpDirection::Down,
                crate::types::ArpDirection::Triangle => ArpDirection::Triangle,
                crate::types::ArpDirection::Random => ArpDirection::Random,
            };
            generate_arp_pattern(
                config.pitch.root,
                &config.pitch.scale,
                dir,
                arp.octave_range,
                MAX_LENGTH,
                seed,
            )
        } else {
            randomize_pitch(&config.pitch, MAX_LENGTH, seed)
        };

        let new_slides = randomize_slides(config.slide.probability, MAX_LENGTH, seed + 5);

        let track = &mut self.tracks[track_index];
        for i in 0..MAX_LENGTH {
            track.pitch.steps[i] = PitchStep {
                note: new_notes[i],
                slide: new_slides[i],
            };
        }
    }

    /// Randomize only the velocity subtrack.
    pub fn randomize_velocity(&mut self, track_index: usize, seed: u32) {
        let config = &self.random_configs[track_index];
        let new_vel = randomize_velocity(&config.velocity, MAX_LENGTH, seed);
        let track = &mut self.tracks[track_index];
        for i in 0..MAX_LENGTH {
            track.velocity.steps[i] = new_vel[i];
        }
    }

    /// Randomize only the mod subtrack.
    pub fn randomize_mod(&mut self, track_index: usize, seed: u32) {
        let config = &self.random_configs[track_index];
        let new_mod = randomize_mod(&config.modulation, MAX_LENGTH, seed);
        let track = &mut self.tracks[track_index];
        for i in 0..MAX_LENGTH {
            track.modulation.steps[i] = new_mod[i].clone();
        }
    }

    /// Clear all steps in a track to defaults.
    pub fn clear_track_to_defaults(&mut self, track_index: usize) {
        let track = &mut self.tracks[track_index];
        for step in track.gate.steps.iter_mut() {
            *step = GateStep::default();
        }
        for step in track.pitch.steps.iter_mut() {
            *step = PitchStep::default();
        }
        for step in track.velocity.steps.iter_mut() {
            *step = 100;
        }
        for step in track.modulation.steps.iter_mut() {
            *step = ModStep::default();
        }
        for step in self.mute_patterns[track_index].steps.iter_mut() {
            *step = false;
        }
    }
}

/// Identifier for subtrack selection.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SubtrackId {
    Gate,
    Pitch,
    Velocity,
    Mod,
}

fn resize_subtrack<T: Clone>(subtrack: &mut Subtrack<T>, new_length: u8, default: T) {
    subtrack.length = new_length;
    let target = new_length as usize;
    // Pad if needed
    while subtrack.steps.len() < target {
        let _ = subtrack.steps.push(default.clone());
    }
    // Don't truncate — keep data for potential re-expansion (matches TS behavior)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::SequencerState;

    fn default_state() -> SequencerState {
        SequencerState::new()
    }

    #[test]
    fn tick_advances_master_tick() {
        let mut state = default_state();
        assert_eq!(state.transport.master_tick, 0);
        tick(&mut state);
        assert_eq!(state.transport.master_tick, 1);
        tick(&mut state);
        assert_eq!(state.transport.master_tick, 2);
    }

    #[test]
    fn tick_zero_emits_events() {
        let mut state = default_state();
        let events = tick(&mut state);
        // At tick 0, all outputs should emit (even if gate is off)
        for event in &events {
            assert!(event.is_some());
        }
    }

    #[test]
    fn tick_between_steps_emits_none() {
        let mut state = default_state();
        // Tick 0 → events
        let _ = tick(&mut state);
        // Ticks 1-5 are between steps (TICKS_PER_STEP = 6)
        let events = tick(&mut state);
        for event in &events {
            assert!(event.is_none());
        }
    }

    #[test]
    fn tick_step_boundary_emits() {
        let mut state = default_state();
        // Advance 6 ticks (TICKS_PER_STEP = 6)
        for _ in 0..6 {
            tick(&mut state);
        }
        // Tick 6 should be a step boundary
        let events = tick(&mut state);
        for event in &events {
            assert!(event.is_some());
        }
    }

    #[test]
    fn gate_on_produces_event() {
        let mut state = default_state();
        state.tracks[0].gate.steps[0].on = true;
        let events = tick(&mut state);
        assert!(events[0].as_ref().unwrap().gate);
    }

    #[test]
    fn set_gate_on_works() {
        let mut state = default_state();
        state.set_gate_on(0, 3, true);
        assert!(state.tracks[0].gate.steps[3].on);
    }

    #[test]
    fn set_pitch_note_works() {
        let mut state = default_state();
        state.set_pitch_note(0, 5, 72);
        assert_eq!(state.tracks[0].pitch.steps[5].note, 72);
    }

    #[test]
    fn set_velocity_works() {
        let mut state = default_state();
        state.set_velocity(0, 0, 127);
        assert_eq!(state.tracks[0].velocity.steps[0], 127);
    }

    #[test]
    fn set_tie_range_works() {
        let mut state = default_state();
        state.set_tie_range(0, 2, 4);
        assert!(state.tracks[0].gate.steps[2].on);
        assert!(state.tracks[0].gate.steps[3].tie);
        assert!(state.tracks[0].gate.steps[4].tie);
        assert!(!state.tracks[0].gate.steps[3].on);
    }

    #[test]
    fn reset_playheads() {
        let mut state = default_state();
        // Advance a few ticks
        for _ in 0..20 {
            tick(&mut state);
        }
        assert!(state.transport.master_tick > 0);

        state.reset_playheads();
        assert_eq!(state.transport.master_tick, 0);
        for track in &state.tracks {
            assert_eq!(track.gate.current_step, 0);
        }
    }

    #[test]
    fn set_track_clock_divider_clamps() {
        let mut state = default_state();
        state.set_track_clock_divider(0, 0);
        assert_eq!(state.tracks[0].clock_divider, 1);
        state.set_track_clock_divider(0, 100);
        assert_eq!(state.tracks[0].clock_divider, 32);
    }

    #[test]
    fn clear_track_to_defaults() {
        let mut state = default_state();
        state.set_gate_on(0, 0, true);
        state.set_pitch_note(0, 0, 72);
        state.set_velocity(0, 0, 127);

        state.clear_track_to_defaults(0);
        assert!(!state.tracks[0].gate.steps[0].on);
        assert_eq!(state.tracks[0].pitch.steps[0].note, 60);
        assert_eq!(state.tracks[0].velocity.steps[0], 100);
    }

    #[test]
    fn polyrhythm_different_lengths() {
        let mut state = default_state();
        // Track 0: gate length 4, pitch length 3
        state.tracks[0].gate.length = 4;
        state.tracks[0].pitch.length = 3;
        state.tracks[0].gate.steps[0].on = true;

        // Run 24 ticks (4 full gate cycles = 4 * 6 ticks)
        for _ in 0..24 {
            tick(&mut state);
        }

        // Gate should have cycled 6 times (24 / 4 = 6)
        // Pitch should have cycled 8 times (24 / 3 = 8)
        // Master tick should be at 24
        assert_eq!(state.transport.master_tick, 24);
    }

    #[test]
    fn randomize_full_track_populates_steps() {
        let mut state = default_state();
        state.randomize_full_track(0, 42);

        // After randomization, not all gates should be default
        let has_active = state.tracks[0]
            .gate
            .steps
            .iter()
            .any(|s| s.on || s.tie);
        assert!(has_active);
    }
}
