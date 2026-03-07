//! CV output processor — interpolates discrete NoteEvents into continuous DAC values.
//!
//! The sequencer engine ticks at step rate (BPM-driven), producing `NoteEvent`
//! structs at step boundaries. This module runs at a higher rate (~4kHz) to:
//!
//! - **Gate length**: Turn gate off after `gate_length` fraction of step window
//! - **Ratchets**: Subdivide gate into `ratchet_count` sub-pulses per step
//! - **Pitch slide**: Smooth glide between consecutive pitch values
//! - **Mod slew**: Smooth interpolation of modulation CV
//!
//! All logic is pure (no hardware deps), testable on host via `cargo test --lib`.

use crate::dac;

/// Number of hardware outputs (4 tracks).
const NUM_OUTPUTS: usize = 4;

/// State for a single CV output channel.
#[derive(Clone, Debug)]
pub struct ChannelState {
    // Current output values (16-bit DAC)
    pub gate_dac: u16,
    pub pitch_dac: u16,
    pub velocity_dac: u16,
    pub mod_dac: u16,

    // Gate timing
    gate_on: bool,
    gate_length: f32,      // 0.0-1.0 fraction of step window
    ratchet_count: u8,     // 1-4 sub-pulses per step
    step_samples: u32,     // total render samples in current step window
    sample_in_step: u32,   // current sample position within step

    // Pitch slide state
    pitch_current: f32,    // current pitch in fractional MIDI notes
    pitch_target: f32,     // target pitch (from latest NoteEvent)
    slide_samples: u32,    // total samples for slide duration (0 = instant)
    slide_progress: u32,   // samples elapsed in current slide

    // Mod slew state
    mod_current: f32,      // current mod value (0.0-1.0 normalized)
    mod_target: f32,       // target mod value
    slew_samples: u32,     // total samples for slew (0 = instant)
    slew_progress: u32,    // samples elapsed in current slew

    // Retrigger: brief gate-off before gate-on for consecutive notes
    retrigger_pending: bool,
    retrigger_samples: u32, // samples remaining in retrigger gap
}

impl Default for ChannelState {
    fn default() -> Self {
        Self {
            gate_dac: 0,
            pitch_dac: dac::note_to_dac(60),
            velocity_dac: dac::velocity_to_dac(100),
            mod_dac: dac::mod_to_dac(0),
            gate_on: false,
            gate_length: 0.5,
            ratchet_count: 1,
            step_samples: 0,
            sample_in_step: 0,
            pitch_current: 60.0,
            pitch_target: 60.0,
            slide_samples: 0,
            slide_progress: 0,
            mod_current: 0.0,
            mod_target: 0.0,
            slew_samples: 0,
            slew_progress: 0,
            retrigger_pending: false,
            retrigger_samples: 0,
        }
    }
}

/// CV output processor for all 4 outputs.
#[derive(Clone, Debug)]
pub struct CvOutputProcessor {
    pub channels: [ChannelState; NUM_OUTPUTS],
    /// Render rate in Hz (e.g. 4000 for 4kHz).
    render_rate: u32,
}

impl CvOutputProcessor {
    pub fn new(render_rate: u32) -> Self {
        Self {
            channels: core::array::from_fn(|_| ChannelState::default()),
            render_rate,
        }
    }

    /// Called at each step boundary when the engine produces a new NoteEvent.
    /// `step_duration_us` is the step window length in microseconds.
    pub fn note_on(&mut self, output: usize, event: &requencer_engine::types::NoteEvent, step_duration_us: u64) {
        if output >= NUM_OUTPUTS {
            return;
        }
        let ch = &mut self.channels[output];

        // Calculate samples in this step window
        ch.step_samples = (step_duration_us as u64 * self.render_rate as u64 / 1_000_000) as u32;
        if ch.step_samples == 0 {
            ch.step_samples = 1;
        }
        ch.sample_in_step = 0;

        // Gate
        let was_on = ch.gate_on;
        ch.gate_on = event.gate;
        ch.gate_length = event.gate_length.clamp(0.01, 1.0);
        ch.ratchet_count = event.ratchet_count.clamp(1, 4);

        // Retrigger: if gate was on and new note also has gate on, insert brief gap
        if event.retrigger && was_on && event.gate {
            ch.retrigger_pending = true;
            // ~2ms retrigger gap
            ch.retrigger_samples = (self.render_rate / 500).max(1);
        } else {
            ch.retrigger_pending = false;
            ch.retrigger_samples = 0;
        }

        // Velocity (instant, no interpolation)
        ch.velocity_dac = dac::velocity_to_dac(event.velocity);

        // Pitch slide
        ch.pitch_target = event.pitch as f32;
        if event.slide > 0.0 {
            // slide is in seconds
            ch.slide_samples = (event.slide * self.render_rate as f32) as u32;
            if ch.slide_samples == 0 {
                ch.slide_samples = 1;
            }
            ch.slide_progress = 0;
            // pitch_current stays at previous value, will glide to target
        } else {
            // Instant pitch change
            ch.pitch_current = ch.pitch_target;
            ch.slide_samples = 0;
            ch.slide_progress = 0;
        }

        // Mod slew
        ch.mod_target = event.modulation as f32 / 127.0;
        if event.mod_slew > 0.0 {
            // mod_slew is 0.0-1.0 as fraction of step window
            ch.slew_samples = (event.mod_slew * ch.step_samples as f32) as u32;
            if ch.slew_samples == 0 {
                ch.slew_samples = 1;
            }
            ch.slew_progress = 0;
        } else {
            ch.mod_current = ch.mod_target;
            ch.slew_samples = 0;
            ch.slew_progress = 0;
        }

        // Update DAC values immediately
        ch.pitch_dac = dac::note_to_dac(ch.pitch_current as u8);
        ch.mod_dac = dac::mod_to_dac((ch.mod_current * 127.0) as u8);
        if ch.retrigger_pending {
            ch.gate_dac = 0; // Gate off during retrigger gap
        } else {
            update_gate_dac(ch);
        }
    }

    /// Called at the render rate (~4kHz). Advances all interpolations and
    /// updates DAC values. Returns true if any output changed.
    pub fn render_tick(&mut self) -> bool {
        let mut changed = false;
        for ch in self.channels.iter_mut() {
            if ch.step_samples == 0 {
                continue; // No active step
            }

            ch.sample_in_step += 1;

            // --- Retrigger gap ---
            if ch.retrigger_pending {
                ch.gate_dac = 0;
                if ch.retrigger_samples > 0 {
                    ch.retrigger_samples -= 1;
                } else {
                    ch.retrigger_pending = false;
                }
                changed = true;
                // Still advance pitch/mod even during retrigger
            }

            // --- Gate timing with ratchets ---
            if !ch.retrigger_pending {
                let prev_gate = ch.gate_dac;
                update_gate_dac(ch);
                if ch.gate_dac != prev_gate {
                    changed = true;
                }
            }

            // --- Pitch slide ---
            if ch.slide_samples > 0 && ch.slide_progress < ch.slide_samples {
                ch.slide_progress += 1;
                let t = ch.slide_progress as f32 / ch.slide_samples as f32;
                let start = ch.pitch_current;
                // Linear interpolation toward target
                let new_pitch = start + (ch.pitch_target - start) * t;
                let new_dac = dac::note_to_dac(new_pitch as u8);
                if new_dac != ch.pitch_dac {
                    ch.pitch_dac = new_dac;
                    changed = true;
                }
                if ch.slide_progress >= ch.slide_samples {
                    ch.pitch_current = ch.pitch_target;
                }
            }

            // --- Mod slew ---
            if ch.slew_samples > 0 && ch.slew_progress < ch.slew_samples {
                ch.slew_progress += 1;
                let t = ch.slew_progress as f32 / ch.slew_samples as f32;
                let start = ch.mod_current;
                let new_mod = start + (ch.mod_target - start) * t;
                let new_dac = dac::mod_to_dac((new_mod * 127.0) as u8);
                if new_dac != ch.mod_dac {
                    ch.mod_dac = new_dac;
                    changed = true;
                }
                if ch.slew_progress >= ch.slew_samples {
                    ch.mod_current = ch.mod_target;
                }
            }
        }
        changed
    }

    /// Stop all outputs (transport stopped).
    pub fn all_off(&mut self) {
        for ch in self.channels.iter_mut() {
            ch.gate_on = false;
            ch.gate_dac = 0;
            ch.step_samples = 0;
            ch.sample_in_step = 0;
            ch.retrigger_pending = false;
        }
    }
}

/// Compute gate DAC value based on position within step, gate length, and ratchets.
fn update_gate_dac(ch: &mut ChannelState) {
    if !ch.gate_on || ch.step_samples == 0 || ch.sample_in_step >= ch.step_samples {
        ch.gate_dac = 0;
        return;
    }

    let pos = ch.sample_in_step as f32 / ch.step_samples as f32; // 0.0 - <1.0

    if ch.ratchet_count <= 1 {
        // Simple gate: on for gate_length fraction, then off
        ch.gate_dac = if pos < ch.gate_length { 65535 } else { 0 };
    } else {
        // Ratchet: divide step into N equal sub-windows, gate on for gate_length of each
        let sub_window = 1.0 / ch.ratchet_count as f32;
        let pos_in_sub = (pos % sub_window) / sub_window; // 0.0-1.0 within sub-window
        ch.gate_dac = if pos_in_sub < ch.gate_length { 65535 } else { 0 };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use requencer_engine::types::NoteEvent;

    fn make_event(gate: bool, pitch: u8, velocity: u8, gate_length: f32) -> NoteEvent {
        NoteEvent {
            output: 0,
            gate,
            pitch,
            velocity,
            modulation: 0,
            mod_slew: 0.0,
            gate_length,
            ratchet_count: 1,
            slide: 0.0,
            retrigger: false,
            sustain: false,
        }
    }

    // Step duration at 120 BPM with TICKS_PER_STEP=6:
    // tick_interval = 60_000_000 / (120 * 6) = 83333 µs per tick
    // step = 6 ticks * 83333 = 500000 µs = 500ms
    const STEP_US: u64 = 500_000;
    const RENDER_RATE: u32 = 4000; // 4kHz

    // ── Gate length ────────────────────────────────────────────────

    #[test]
    fn gate_turns_off_after_gate_length() {
        let mut proc = CvOutputProcessor::new(RENDER_RATE);
        let ev = make_event(true, 60, 100, 0.5);
        proc.note_on(0, &ev, STEP_US);

        // At 4kHz, 500ms step = 2000 samples. gate_length=0.5 → gate off at sample 1000
        let ch = &proc.channels[0];
        assert_eq!(ch.step_samples, 2000);
        assert_eq!(ch.gate_dac, 65535); // Gate on at start

        // Advance to just before 50%
        for _ in 0..999 {
            proc.render_tick();
        }
        assert_eq!(proc.channels[0].gate_dac, 65535);

        // One more tick → 50%, gate off
        proc.render_tick();
        assert_eq!(proc.channels[0].gate_dac, 0);
    }

    #[test]
    fn gate_off_event_produces_no_gate() {
        let mut proc = CvOutputProcessor::new(RENDER_RATE);
        let ev = make_event(false, 60, 100, 0.5);
        proc.note_on(0, &ev, STEP_US);
        assert_eq!(proc.channels[0].gate_dac, 0);

        for _ in 0..100 {
            proc.render_tick();
        }
        assert_eq!(proc.channels[0].gate_dac, 0);
    }

    #[test]
    fn full_gate_length_stays_on() {
        let mut proc = CvOutputProcessor::new(RENDER_RATE);
        let ev = make_event(true, 60, 100, 1.0);
        proc.note_on(0, &ev, STEP_US);

        for _ in 0..1999 {
            proc.render_tick();
        }
        assert_eq!(proc.channels[0].gate_dac, 65535);
    }

    #[test]
    fn short_gate_length() {
        let mut proc = CvOutputProcessor::new(RENDER_RATE);
        let ev = make_event(true, 60, 100, 0.1); // 10% gate
        proc.note_on(0, &ev, STEP_US);

        // 2000 * 0.1 = 200 samples on
        for _ in 0..199 {
            proc.render_tick();
        }
        assert_eq!(proc.channels[0].gate_dac, 65535);

        proc.render_tick(); // sample 200 → 10%, gate off
        assert_eq!(proc.channels[0].gate_dac, 0);
    }

    // ── Ratchets ───────────────────────────────────────────────────

    #[test]
    fn ratchet_2_produces_two_pulses() {
        let mut proc = CvOutputProcessor::new(RENDER_RATE);
        let mut ev = make_event(true, 60, 100, 0.5);
        ev.ratchet_count = 2;
        proc.note_on(0, &ev, STEP_US);

        // 2000 samples total, 2 ratchets → 1000 samples per sub-window
        // gate_length=0.5 → gate on for 500 samples per sub-window
        let mut transitions = 0u32;
        let mut prev = proc.channels[0].gate_dac;
        for _ in 0..2000 {
            proc.render_tick();
            let cur = proc.channels[0].gate_dac;
            if cur != prev {
                transitions += 1;
            }
            prev = cur;
        }
        // Two on→off transitions (one per ratchet pulse)
        assert!(transitions >= 2, "Expected at least 2 transitions, got {}", transitions);
    }

    #[test]
    fn ratchet_4_produces_four_pulses() {
        let mut proc = CvOutputProcessor::new(RENDER_RATE);
        let mut ev = make_event(true, 60, 100, 0.5);
        ev.ratchet_count = 4;
        proc.note_on(0, &ev, STEP_US);

        // Count distinct gate-on regions
        let mut pulses = 0u32;
        let mut was_on = false;
        for _ in 0..2000 {
            proc.render_tick();
            let on = proc.channels[0].gate_dac > 0;
            if on && !was_on {
                pulses += 1;
            }
            was_on = on;
        }
        assert_eq!(pulses, 4);
    }

    // ── Pitch slide ────────────────────────────────────────────────

    #[test]
    fn pitch_slide_interpolates() {
        let mut proc = CvOutputProcessor::new(RENDER_RATE);
        // First note at C3 (48)
        let ev1 = make_event(true, 48, 100, 0.5);
        proc.note_on(0, &ev1, STEP_US);
        assert_eq!(proc.channels[0].pitch_current, 48.0);

        // Second note at C4 (60) with 0.25s slide
        let mut ev2 = make_event(true, 60, 100, 0.5);
        ev2.slide = 0.25; // 250ms slide
        proc.note_on(0, &ev2, STEP_US);

        let start_dac = proc.channels[0].pitch_dac;

        // Advance halfway through slide (0.125s = 500 samples at 4kHz)
        for _ in 0..500 {
            proc.render_tick();
        }
        let mid_dac = proc.channels[0].pitch_dac;
        assert!(mid_dac > start_dac, "Pitch should be rising during slide");

        // Advance to end of slide (500 more samples)
        for _ in 0..500 {
            proc.render_tick();
        }
        let end_dac = proc.channels[0].pitch_dac;
        assert!(end_dac >= mid_dac, "Pitch should reach target");
        assert_eq!(end_dac, dac::note_to_dac(60));
    }

    #[test]
    fn no_slide_instant_pitch() {
        let mut proc = CvOutputProcessor::new(RENDER_RATE);
        let ev1 = make_event(true, 48, 100, 0.5);
        proc.note_on(0, &ev1, STEP_US);

        let ev2 = make_event(true, 72, 100, 0.5);
        proc.note_on(0, &ev2, STEP_US);

        assert_eq!(proc.channels[0].pitch_dac, dac::note_to_dac(72));
    }

    // ── Mod slew ───────────────────────────────────────────────────

    #[test]
    fn mod_slew_interpolates() {
        let mut proc = CvOutputProcessor::new(RENDER_RATE);
        let ev1 = make_event(true, 60, 100, 0.5);
        proc.note_on(0, &ev1, STEP_US);

        // New event with mod=127 and slew=0.5 (50% of step window)
        let ev2 = NoteEvent {
            output: 0, gate: true, pitch: 60, velocity: 100,
            modulation: 127, mod_slew: 0.5,
            gate_length: 0.5, ratchet_count: 1, slide: 0.0,
            retrigger: false, sustain: false,
        };
        proc.note_on(0, &ev2, STEP_US);

        let start_dac = proc.channels[0].mod_dac;

        // Advance halfway through slew (500 samples = 0.25 of step)
        for _ in 0..500 {
            proc.render_tick();
        }
        let mid_dac = proc.channels[0].mod_dac;
        // Mod DAC is inverted, so moving toward 127 means DAC value decreases
        assert!(mid_dac < start_dac || mid_dac != start_dac,
                "Mod should be changing during slew");

        // After full slew (1000 samples = 0.5 of step)
        for _ in 0..500 {
            proc.render_tick();
        }
        assert_eq!(proc.channels[0].mod_dac, dac::mod_to_dac(127));
    }

    #[test]
    fn no_slew_instant_mod() {
        let mut proc = CvOutputProcessor::new(RENDER_RATE);
        let ev = NoteEvent {
            output: 0, gate: true, pitch: 60, velocity: 100,
            modulation: 100, mod_slew: 0.0,
            gate_length: 0.5, ratchet_count: 1, slide: 0.0,
            retrigger: false, sustain: false,
        };
        proc.note_on(0, &ev, STEP_US);
        assert_eq!(proc.channels[0].mod_dac, dac::mod_to_dac(100));
    }

    // ── Retrigger ──────────────────────────────────────────────────

    #[test]
    fn retrigger_inserts_gap() {
        let mut proc = CvOutputProcessor::new(RENDER_RATE);

        // First note
        let ev1 = make_event(true, 60, 100, 0.5);
        proc.note_on(0, &ev1, STEP_US);

        // Advance a bit
        for _ in 0..100 {
            proc.render_tick();
        }
        assert_eq!(proc.channels[0].gate_dac, 65535);

        // Second note with retrigger
        let mut ev2 = make_event(true, 64, 100, 0.5);
        ev2.retrigger = true;
        proc.note_on(0, &ev2, STEP_US);

        // Gate should be off during retrigger gap
        assert_eq!(proc.channels[0].gate_dac, 0);

        // After gap (~2ms = 8 samples at 4kHz), gate should come back on
        for _ in 0..10 {
            proc.render_tick();
        }
        assert_eq!(proc.channels[0].gate_dac, 65535);
    }

    // ── All off ────────────────────────────────────────────────────

    #[test]
    fn all_off_clears_gates() {
        let mut proc = CvOutputProcessor::new(RENDER_RATE);
        let ev = make_event(true, 60, 100, 0.5);
        for i in 0..4 {
            proc.note_on(i, &ev, STEP_US);
        }

        proc.all_off();
        for ch in &proc.channels {
            assert_eq!(ch.gate_dac, 0);
        }
    }

    // ── DAC value correctness ──────────────────────────────────────

    #[test]
    fn pitch_dac_correct_for_note() {
        let mut proc = CvOutputProcessor::new(RENDER_RATE);
        let ev = make_event(true, 72, 100, 0.5);
        proc.note_on(0, &ev, STEP_US);
        assert_eq!(proc.channels[0].pitch_dac, dac::note_to_dac(72));
    }

    #[test]
    fn velocity_dac_correct() {
        let mut proc = CvOutputProcessor::new(RENDER_RATE);
        let ev = make_event(true, 60, 80, 0.5);
        proc.note_on(0, &ev, STEP_US);
        assert_eq!(proc.channels[0].velocity_dac, dac::velocity_to_dac(80));
    }

    // ── Edge cases ─────────────────────────────────────────────────

    #[test]
    fn out_of_range_output_ignored() {
        let mut proc = CvOutputProcessor::new(RENDER_RATE);
        let ev = make_event(true, 60, 100, 0.5);
        proc.note_on(5, &ev, STEP_US); // out of range
        // Should not panic
    }

    #[test]
    fn zero_step_duration_handled() {
        let mut proc = CvOutputProcessor::new(RENDER_RATE);
        let ev = make_event(true, 60, 100, 0.5);
        proc.note_on(0, &ev, 0); // zero duration
        assert_eq!(proc.channels[0].step_samples, 1); // clamped to 1
    }

    #[test]
    fn multiple_outputs_independent() {
        let mut proc = CvOutputProcessor::new(RENDER_RATE);
        let ev0 = make_event(true, 48, 100, 0.5);
        let ev1 = make_event(true, 72, 50, 0.8);
        proc.note_on(0, &ev0, STEP_US);
        proc.note_on(1, &ev1, STEP_US);

        assert_eq!(proc.channels[0].pitch_dac, dac::note_to_dac(48));
        assert_eq!(proc.channels[1].pitch_dac, dac::note_to_dac(72));
        assert_eq!(proc.channels[0].velocity_dac, dac::velocity_to_dac(100));
        assert_eq!(proc.channels[1].velocity_dac, dac::velocity_to_dac(50));
    }
}
