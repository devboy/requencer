use crate::math::roundf;
use crate::types::{
    ModSource, MuteTrack, NoteEvent, OutputRouting, SequenceTrack, SubtrackKey,
    TransposeConfig, VariationPattern,
};
use crate::variation::{
    get_effective_gate_step, get_effective_mod_step, get_effective_pitch_step,
    get_effective_velocity_step, get_transforms_for_subtrack,
};
use crate::NUM_OUTPUTS;

/// Create default identity routing (output i reads from track i).
pub fn create_default_routing() -> [OutputRouting; NUM_OUTPUTS] {
    core::array::from_fn(|i| OutputRouting::identity(i as u8))
}

/// Resolve all output events from current track state.
pub fn resolve_outputs(
    tracks: &[SequenceTrack; 4],
    routing: &[OutputRouting; NUM_OUTPUTS],
    mutes: &[MuteTrack; 4],
    transpose_configs: &[TransposeConfig; 4],
    variation_patterns: &[VariationPattern; 4],
    lfo_values: &[f32; 4],
) -> [NoteEvent; NUM_OUTPUTS] {
    core::array::from_fn(|i| {
        resolve_single_output(
            i,
            tracks,
            &routing[i],
            mutes,
            transpose_configs,
            variation_patterns,
            lfo_values,
        )
    })
}

fn resolve_single_output(
    output_index: usize,
    tracks: &[SequenceTrack; 4],
    routing: &OutputRouting,
    mutes: &[MuteTrack; 4],
    transpose_configs: &[TransposeConfig; 4],
    variation_patterns: &[VariationPattern; 4],
    lfo_values: &[f32; 4],
) -> NoteEvent {
    let gate_track = &tracks[routing.gate as usize];
    let pitch_track = &tracks[routing.pitch as usize];
    let vel_track = &tracks[routing.velocity as usize];
    let mod_track = &tracks[routing.modulation as usize];

    // Gate step — with variation overlay if active
    let gate_vp = &variation_patterns[routing.gate as usize];
    let gate_step = if gate_vp.enabled {
        let transforms = get_transforms_for_subtrack(gate_vp, SubtrackKey::Gate);
        if transforms.is_empty() {
            gate_track.gate.steps[gate_track.gate.current_step as usize].clone()
        } else {
            get_effective_gate_step(&gate_track.gate, transforms, gate_vp.current_bar)
        }
    } else {
        gate_track.gate.steps[gate_track.gate.current_step as usize].clone()
    };

    // Gate is on if step is on or is a tie (continuation)
    let mut gate = gate_step.on || gate_step.tie;

    // Pitch step — with variation overlay
    let pitch_vp = &variation_patterns[routing.pitch as usize];
    let pitch_step = if pitch_vp.enabled {
        let transforms = get_transforms_for_subtrack(pitch_vp, SubtrackKey::Pitch);
        if transforms.is_empty() {
            pitch_track.pitch.steps[pitch_track.pitch.current_step as usize].clone()
        } else {
            get_effective_pitch_step(&pitch_track.pitch, transforms)
        }
    } else {
        pitch_track.pitch.steps[pitch_track.pitch.current_step as usize].clone()
    };

    let mut pitch = pitch_step.note as i32;

    // Apply transpose
    let transpose = &transpose_configs[routing.pitch as usize];
    if transpose.semitones != 0 {
        pitch = (pitch + transpose.semitones as i32).clamp(0, 127);
    }

    // Note window octave-wrapping
    let lo = transpose.note_low;
    let hi = transpose.note_high;
    if !(lo == 0 && hi == 127) && hi > lo {
        while pitch > hi as i32 {
            pitch -= 12;
        }
        while pitch < lo as i32 {
            pitch += 12;
        }
    }

    // Velocity step — with variation overlay
    let vel_vp = &variation_patterns[routing.velocity as usize];
    let mut velocity = if vel_vp.enabled {
        let transforms = get_transforms_for_subtrack(vel_vp, SubtrackKey::Velocity);
        if transforms.is_empty() {
            vel_track.velocity.steps[vel_track.velocity.current_step as usize]
        } else {
            get_effective_velocity_step(&vel_track.velocity, transforms, vel_vp.current_bar)
        }
    } else {
        vel_track.velocity.steps[vel_track.velocity.current_step as usize]
    };

    let slide = pitch_step.slide;

    // Mod resolution: choose source based on mod_source
    let (mod_value, mod_slew) = match routing.mod_source {
        ModSource::Lfo => {
            let lfo_val = lfo_values[routing.modulation as usize];
            // Scale 0.0-1.0 to 0-127
            ((lfo_val * 127.0) as u8, 0.0)
        }
        ModSource::Seq => {
            let mod_vp = &variation_patterns[routing.modulation as usize];
            let mod_step = if mod_vp.enabled {
                let transforms = get_transforms_for_subtrack(mod_vp, SubtrackKey::Mod);
                if transforms.is_empty() {
                    mod_track.modulation.steps[mod_track.modulation.current_step as usize].clone()
                } else {
                    get_effective_mod_step(&mod_track.modulation, transforms)
                }
            } else {
                mod_track.modulation.steps[mod_track.modulation.current_step as usize].clone()
            };
            ((mod_step.value * 127.0) as u8, mod_step.slew)
        }
    };

    // Look-back: is this a continuation? (retrigger only on new note, not ties)
    let retrigger = gate && !gate_step.tie;

    // Look-ahead: should we sustain? (next step is a tie)
    let next_idx =
        ((gate_track.gate.current_step as usize) + 1) % (gate_track.gate.length as usize);
    let next_gate_step = &gate_track.gate.steps[next_idx];
    let sustain = gate && next_gate_step.tie;

    // Tied steps force ratchet to 1 and full gate length when sustaining
    let ratchet_count = if gate_step.tie { 1 } else { gate_step.ratchet };
    let mut gate_length = if gate_step.tie && sustain {
        1.0
    } else {
        gate_step.length
    };

    // GL/VEL scaling from transpose config
    let gate_xpose = &transpose_configs[routing.gate as usize];
    if gate_xpose.gl_scale != 1.0 {
        gate_length = (gate_length * gate_xpose.gl_scale).clamp(0.05, 1.0);
    }
    let vel_xpose = &transpose_configs[routing.velocity as usize];
    if vel_xpose.vel_scale != 1.0 {
        velocity = roundf(velocity as f32 * vel_xpose.vel_scale).clamp(1.0, 127.0) as u8;
    }

    // Mute: per-output
    let mute = &mutes[output_index];
    if mute.steps[mute.current_step as usize] {
        gate = false;
    }

    NoteEvent {
        output: output_index as u8,
        gate,
        pitch: pitch as u8,
        velocity,
        modulation: mod_value,
        mod_slew,
        gate_length,
        ratchet_count,
        slide,
        retrigger,
        sustain,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::SequencerState;

    fn default_state() -> SequencerState {
        SequencerState::new()
    }

    #[test]
    fn default_routing_is_identity() {
        let routing = create_default_routing();
        for (i, r) in routing.iter().enumerate() {
            assert_eq!(r.gate, i as u8);
            assert_eq!(r.pitch, i as u8);
            assert_eq!(r.velocity, i as u8);
            assert_eq!(r.modulation, i as u8);
        }
    }

    #[test]
    fn resolve_outputs_default_state() {
        let state = default_state();
        let lfo_values = [0.5_f32; 4];
        let events = resolve_outputs(
            &state.tracks,
            &state.routing,
            &state.mute_patterns,
            &state.transpose_configs,
            &state.variation_patterns,
            &lfo_values,
        );

        assert_eq!(events.len(), 4);
        for (i, e) in events.iter().enumerate() {
            assert_eq!(e.output, i as u8);
            // Default gates are off
            assert!(!e.gate);
            // Default pitch is 60
            assert_eq!(e.pitch, 60);
            // Default velocity is 100
            assert_eq!(e.velocity, 100);
        }
    }

    #[test]
    fn gate_on_produces_event() {
        let mut state = default_state();
        state.tracks[0].gate.steps[0].on = true;

        let lfo_values = [0.5_f32; 4];
        let events = resolve_outputs(
            &state.tracks,
            &state.routing,
            &state.mute_patterns,
            &state.transpose_configs,
            &state.variation_patterns,
            &lfo_values,
        );

        assert!(events[0].gate);
        assert!(events[0].retrigger);
    }

    #[test]
    fn cross_routing() {
        let mut state = default_state();
        // Track 0 gate on
        state.tracks[0].gate.steps[0].on = true;
        // Track 1 has different pitch
        state.tracks[1].pitch.steps[0].note = 72;

        // Output 0 gets gate from track 0, pitch from track 1
        state.routing[0].pitch = 1;

        let lfo_values = [0.5_f32; 4];
        let events = resolve_outputs(
            &state.tracks,
            &state.routing,
            &state.mute_patterns,
            &state.transpose_configs,
            &state.variation_patterns,
            &lfo_values,
        );

        assert!(events[0].gate);
        assert_eq!(events[0].pitch, 72);
    }

    #[test]
    fn mute_overrides_gate() {
        let mut state = default_state();
        state.tracks[0].gate.steps[0].on = true;
        state.mute_patterns[0].steps[0] = true; // mute output 0

        let lfo_values = [0.5_f32; 4];
        let events = resolve_outputs(
            &state.tracks,
            &state.routing,
            &state.mute_patterns,
            &state.transpose_configs,
            &state.variation_patterns,
            &lfo_values,
        );

        assert!(!events[0].gate);
    }

    #[test]
    fn transpose_shifts_pitch() {
        let mut state = default_state();
        state.tracks[0].gate.steps[0].on = true;
        state.tracks[0].pitch.steps[0].note = 60;
        state.transpose_configs[0].semitones = 7;

        let lfo_values = [0.5_f32; 4];
        let events = resolve_outputs(
            &state.tracks,
            &state.routing,
            &state.mute_patterns,
            &state.transpose_configs,
            &state.variation_patterns,
            &lfo_values,
        );

        assert_eq!(events[0].pitch, 67);
    }

    #[test]
    fn lfo_mod_source() {
        let mut state = default_state();
        state.routing[0].mod_source = ModSource::Lfo;

        let lfo_values = [1.0_f32, 0.0, 0.0, 0.0];
        let events = resolve_outputs(
            &state.tracks,
            &state.routing,
            &state.mute_patterns,
            &state.transpose_configs,
            &state.variation_patterns,
            &lfo_values,
        );

        assert_eq!(events[0].modulation, 127);
    }

    #[test]
    fn tie_sustain_behavior() {
        let mut state = default_state();
        state.tracks[0].gate.steps[0].on = true;
        state.tracks[0].gate.steps[1].tie = true;

        // current_step = 0
        let lfo_values = [0.5_f32; 4];
        let events = resolve_outputs(
            &state.tracks,
            &state.routing,
            &state.mute_patterns,
            &state.transpose_configs,
            &state.variation_patterns,
            &lfo_values,
        );

        // Step 0: gate on, next step is tie → sustain=true, retrigger=true
        assert!(events[0].gate);
        assert!(events[0].retrigger);
        assert!(events[0].sustain);
        // gate_length is NOT forced to 1.0 — that only happens when current step IS a tie
        assert_eq!(events[0].gate_length, 0.5); // default gate length
    }
}
