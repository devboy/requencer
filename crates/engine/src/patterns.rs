use heapless::String;

use crate::types::{
    LayerFlags, SavedPattern, SequencerState, TrackSlotData,
};
use crate::variation::zero_variation_bar;

/// Snapshot a track's complete state for save/restore.
pub fn snapshot_track_slot(state: &SequencerState, track_index: usize) -> TrackSlotData {
    let track = &state.tracks[track_index];

    // Clone track with playheads reset to 0
    let mut saved_track = track.clone();
    saved_track.gate.current_step = 0;
    saved_track.pitch.current_step = 0;
    saved_track.velocity.current_step = 0;
    saved_track.modulation.current_step = 0;

    let mut vp = state.variation_patterns[track_index].clone();
    zero_variation_bar(&mut vp);

    TrackSlotData {
        track: saved_track,
        transpose_config: state.transpose_configs[track_index].clone(),
        mutate_config: state.mutate_configs[track_index].clone(),
        variation_pattern: vp,
        lfo_config: state.lfo_configs[track_index].clone(),
        random_config: state.random_configs[track_index].clone(),
        arp_config: state.arp_configs[track_index].clone(),
    }
}

/// Create a saved pattern from a track snapshot.
pub fn create_saved_pattern(
    state: &SequencerState,
    track_index: usize,
    name: &str,
) -> SavedPattern {
    let mut n = String::new();
    // Truncate to fit heapless::String<32>
    for c in name.chars() {
        if n.push(c).is_err() {
            break;
        }
    }
    SavedPattern {
        name: n,
        data: snapshot_track_slot(state, track_index),
        source_track: track_index as u8,
    }
}

/// Restore a saved slot into a target track, respecting layer flags.
pub fn restore_track_slot(
    state: &mut SequencerState,
    target_track: usize,
    slot: &TrackSlotData,
    layers: &LayerFlags,
) {
    // Save existing current steps before overwriting
    let gate_step = state.tracks[target_track].gate.current_step;
    let pitch_step = state.tracks[target_track].pitch.current_step;
    let vel_step = state.tracks[target_track].velocity.current_step;
    let mod_step = state.tracks[target_track].modulation.current_step;

    // Per-subtrack restore
    if layers.gate {
        state.tracks[target_track].gate = slot.track.gate.clone();
        state.tracks[target_track].gate.current_step = gate_step;
    }
    if layers.pitch {
        state.tracks[target_track].pitch = slot.track.pitch.clone();
        state.tracks[target_track].pitch.current_step = pitch_step;
    }
    if layers.velocity {
        state.tracks[target_track].velocity = slot.track.velocity.clone();
        state.tracks[target_track].velocity.current_step = vel_step;
    }
    if layers.modulation {
        state.tracks[target_track].modulation = slot.track.modulation.clone();
        state.tracks[target_track].modulation.current_step = mod_step;
    }

    if layers.transpose {
        state.transpose_configs[target_track] = slot.transpose_config.clone();
    }
    if layers.drift {
        state.mutate_configs[target_track] = slot.mutate_config.clone();
    }
    if layers.variation {
        state.variation_patterns[target_track] = slot.variation_pattern.clone();
    }

    // Always restore: lfo, random, arp configs
    state.lfo_configs[target_track] = slot.lfo_config.clone();
    state.random_configs[target_track] = slot.random_config.clone();
    state.arp_configs[target_track] = slot.arp_config.clone();
}

/// Save a pattern to the state's saved patterns list.
pub fn save_pattern(state: &mut SequencerState, pattern: SavedPattern) {
    let _ = state.saved_patterns.push(pattern);
}

/// Delete a saved pattern by index.
pub fn delete_pattern(state: &mut SequencerState, index: usize) {
    if index < state.saved_patterns.len() {
        state.saved_patterns.remove(index);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_state() -> SequencerState {
        SequencerState::new()
    }

    #[test]
    fn snapshot_resets_playheads() {
        let mut state = default_state();
        state.tracks[0].gate.current_step = 5;
        state.tracks[0].pitch.current_step = 3;

        let slot = snapshot_track_slot(&state, 0);
        assert_eq!(slot.track.gate.current_step, 0);
        assert_eq!(slot.track.pitch.current_step, 0);
    }

    #[test]
    fn restore_preserves_current_step() {
        let mut state = default_state();
        state.tracks[1].gate.current_step = 7;

        let slot = snapshot_track_slot(&state, 0);
        restore_track_slot(&mut state, 1, &slot, &LayerFlags::default());

        // Current step should be preserved from target track
        assert_eq!(state.tracks[1].gate.current_step, 7);
    }

    #[test]
    fn restore_selective_layers() {
        let mut state = default_state();
        // Modify track 0
        state.tracks[0].gate.steps[0].on = true;
        state.tracks[0].pitch.steps[0].note = 72;

        let slot = snapshot_track_slot(&state, 0);

        // Restore only gate to track 1
        let layers = LayerFlags {
            gate: true,
            pitch: false,
            velocity: false,
            modulation: false,
            transpose: false,
            drift: false,
            variation: false,
        };
        restore_track_slot(&mut state, 1, &slot, &layers);

        assert!(state.tracks[1].gate.steps[0].on);
        assert_eq!(state.tracks[1].pitch.steps[0].note, 60); // unchanged
    }

    #[test]
    fn save_and_delete_pattern() {
        let mut state = default_state();
        let pattern = create_saved_pattern(&state, 0, "Test Pattern");
        assert_eq!(pattern.name.as_str(), "Test Pattern");

        save_pattern(&mut state, pattern);
        assert_eq!(state.saved_patterns.len(), 1);

        delete_pattern(&mut state, 0);
        assert_eq!(state.saved_patterns.len(), 0);
    }

    #[test]
    fn delete_out_of_bounds_is_noop() {
        let mut state = default_state();
        delete_pattern(&mut state, 5);
        assert_eq!(state.saved_patterns.len(), 0);
    }
}
