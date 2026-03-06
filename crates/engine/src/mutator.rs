use heapless::Vec;

use crate::randomizer::{randomize_gates, randomize_mod, randomize_pitch, randomize_velocity};
use crate::rng::Rng;
use crate::types::{MutateConfig, RandomConfig, SequenceTrack};
use crate::MAX_STEPS;

/// Pick random step indices to mutate based on rate (0.0-1.0).
fn pick_mutation_indices(length: usize, rate: f32, rng: &mut Rng) -> Vec<usize, MAX_STEPS> {
    let mut indices = Vec::new();
    for i in 0..length {
        if rng.next_f32() < rate {
            let _ = indices.push(i);
        }
    }
    indices
}

/// Mutate a track's core subtracks (gate, pitch, velocity, mod).
/// Each subtrack uses its own rate from MutateConfig.
/// Regeneration constraints come from the track's RandomConfig.
pub fn mutate_track(
    track: &mut SequenceTrack,
    random_config: &RandomConfig,
    mutate_config: &MutateConfig,
    seed: u32,
) {
    let mut rng = Rng::new(seed);

    // Gate mutation: only mutate .on, preserve .length and .ratchet
    if mutate_config.gate > 0.0 {
        let indices = pick_mutation_indices(track.gate.length as usize, mutate_config.gate, &mut rng);
        if !indices.is_empty() {
            let replacement = randomize_gates(&random_config.gate, track.gate.length as usize, seed + 10);
            for &idx in indices.iter() {
                if idx < track.gate.steps.len() && idx < replacement.len() {
                    track.gate.steps[idx].on = replacement[idx];
                }
            }
        }
    }

    // Pitch mutation: only mutate .note, preserve .slide
    if mutate_config.pitch > 0.0 {
        let indices = pick_mutation_indices(track.pitch.length as usize, mutate_config.pitch, &mut rng);
        if !indices.is_empty() {
            let replacement = randomize_pitch(&random_config.pitch, track.pitch.length as usize, seed + 11);
            for &idx in indices.iter() {
                if idx < track.pitch.steps.len() && idx < replacement.len() {
                    track.pitch.steps[idx].note = replacement[idx];
                }
            }
        }
    }

    // Velocity mutation
    if mutate_config.velocity > 0.0 {
        let indices = pick_mutation_indices(track.velocity.length as usize, mutate_config.velocity, &mut rng);
        if !indices.is_empty() {
            let replacement = randomize_velocity(&random_config.velocity, track.velocity.length as usize, seed + 12);
            for &idx in indices.iter() {
                if idx < track.velocity.steps.len() && idx < replacement.len() {
                    track.velocity.steps[idx] = replacement[idx];
                }
            }
        }
    }

    // Mod mutation: only mutate .value, preserve .slew
    if mutate_config.modulation > 0.0 {
        let indices = pick_mutation_indices(track.modulation.length as usize, mutate_config.modulation, &mut rng);
        if !indices.is_empty() {
            let replacement = randomize_mod(&random_config.modulation, track.modulation.length as usize, seed + 13);
            for &idx in indices.iter() {
                if idx < track.modulation.steps.len() && idx < replacement.len() {
                    track.modulation.steps[idx].value = replacement[idx].value;
                }
            }
        }
    }
}

/// Check if any subtrack in a MutateConfig has drift enabled (rate > 0).
pub fn is_mutate_active(config: &MutateConfig) -> bool {
    config.gate > 0.0 || config.pitch > 0.0 || config.velocity > 0.0 || config.modulation > 0.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_mutation_when_rates_zero() {
        let mut track = SequenceTrack::new(0);
        let config = RandomConfig::default();
        let mutate = MutateConfig::default(); // all rates = 0
        let original_gate = track.gate.steps.clone();

        mutate_track(&mut track, &config, &mutate, 42);
        assert_eq!(track.gate.steps, original_gate);
    }

    #[test]
    fn mutation_changes_steps() {
        let mut track = SequenceTrack::new(0);
        // Set all gates on
        for step in track.gate.steps.iter_mut() {
            step.on = true;
        }
        let config = RandomConfig::default();
        let mutate = MutateConfig {
            gate: 1.0, // mutate every step
            ..MutateConfig::default()
        };

        mutate_track(&mut track, &config, &mutate, 42);
        // With rate=1.0, all steps should be candidates for mutation
        // The replacement pattern likely has some false values
        let on_count = track.gate.steps.iter().filter(|s| s.on).count();
        assert!(on_count < 16, "expected some gates mutated off");
    }

    #[test]
    fn is_mutate_active_detects() {
        assert!(!is_mutate_active(&MutateConfig::default()));
        assert!(is_mutate_active(&MutateConfig {
            gate: 0.5,
            ..MutateConfig::default()
        }));
        assert!(is_mutate_active(&MutateConfig {
            pitch: 0.1,
            ..MutateConfig::default()
        }));
    }

    #[test]
    fn mutation_deterministic() {
        let config = RandomConfig::default();
        let mutate = MutateConfig {
            gate: 0.5,
            pitch: 0.5,
            ..MutateConfig::default()
        };

        let mut t1 = SequenceTrack::new(0);
        let mut t2 = SequenceTrack::new(0);
        mutate_track(&mut t1, &config, &mutate, 42);
        mutate_track(&mut t2, &config, &mutate, 42);
        assert_eq!(t1.gate.steps, t2.gate.steps);
        assert_eq!(t1.pitch.steps, t2.pitch.steps);
    }
}
