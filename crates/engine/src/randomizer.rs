use heapless::Vec;

use crate::euclidean::euclidean;
use crate::math::{floorf, roundf};
use crate::rng::Rng;
use crate::scales::get_scale_notes;
use crate::types::{
    GateAlgo, GateConfig, GateLengthConfig, ModGenConfig, ModMode, ModStep, PitchArpDirection,
    PitchConfig, PitchMode, RatchetConfig, RandomConfig, VelocityConfig, VelocityMode,
};
use crate::MAX_STEPS;

// ── Gate Randomization ─────────────────────────────────────────────

/// Generate a random gate pattern.
pub fn randomize_gates(config: &GateConfig, length: usize, seed: u32) -> Vec<bool, MAX_STEPS> {
    let mut rng = Rng::new(seed);
    let fill_min = roundf(config.fill_min * length as f32) as usize;
    let fill_max = roundf(config.fill_max * length as f32) as usize;
    let range = if fill_max >= fill_min {
        fill_max - fill_min + 1
    } else {
        1
    };
    let hits = fill_min + floorf(rng.next_f32() * range as f32) as usize;
    let hits = hits.min(length);

    match config.mode {
        GateAlgo::Euclidean => {
            let pattern = euclidean(hits, length);
            if config.random_offset && length > 0 {
                let offset = floorf(rng.next_f32() * length as f32) as usize;
                let mut rotated = Vec::new();
                for i in 0..length {
                    let _ = rotated.push(pattern[(i + offset) % length]);
                }
                rotated
            } else {
                pattern
            }
        }
        GateAlgo::Cluster => {
            let continuation = config.cluster_continuation;
            let base_prob = if length > 0 {
                hits as f32 / length as f32
            } else {
                0.0
            };
            let mut pattern: Vec<bool, MAX_STEPS> = Vec::new();

            // Markov chain walk
            for i in 0..length {
                let prob = if i > 0 && pattern[i - 1] {
                    continuation
                } else {
                    base_prob
                };
                let _ = pattern.push(rng.next_f32() < prob);
            }

            // Adjust to exact hit count
            let mut current_hits = pattern.iter().filter(|&&b| b).count();

            // Shuffle indices for random adjustment
            let mut indices: Vec<usize, MAX_STEPS> = Vec::new();
            for i in 0..length {
                let _ = indices.push(i);
            }
            // Fisher-Yates shuffle
            for i in (1..length).rev() {
                let j = floorf(rng.next_f32() * (i + 1) as f32) as usize;
                let j = j.min(i);
                indices.swap(i, j);
            }

            if current_hits < hits {
                for &idx in indices.iter() {
                    if !pattern[idx] {
                        pattern[idx] = true;
                        current_hits += 1;
                        if current_hits >= hits {
                            break;
                        }
                    }
                }
            } else if current_hits > hits {
                for &idx in indices.iter() {
                    if pattern[idx] {
                        pattern[idx] = false;
                        current_hits -= 1;
                        if current_hits <= hits {
                            break;
                        }
                    }
                }
            }

            pattern
        }
        GateAlgo::Sync => {
            // Weighted random placement biased away from strong beats
            let mut weights: Vec<u8, MAX_STEPS> = Vec::new();
            for i in 0..length {
                let pos = i % 4;
                let w = if pos == 0 {
                    1
                } else if pos == 3 {
                    2
                } else {
                    4
                };
                let _ = weights.push(w);
            }

            let mut pattern: Vec<bool, MAX_STEPS> = Vec::new();
            for _ in 0..length {
                let _ = pattern.push(false);
            }

            for _ in 0..hits {
                let mut total_weight: u32 = 0;
                for i in 0..length {
                    if !pattern[i] {
                        total_weight += weights[i] as u32;
                    }
                }
                if total_weight == 0 {
                    break;
                }
                let mut pick = rng.next_f32() * total_weight as f32;
                for i in 0..length {
                    if pattern[i] {
                        continue;
                    }
                    pick -= weights[i] as f32;
                    if pick <= 0.0 {
                        pattern[i] = true;
                        break;
                    }
                }
            }

            pattern
        }
        GateAlgo::Random => {
            // Fisher-Yates shuffle of pattern with exactly `hits` gates
            let mut pattern: Vec<bool, MAX_STEPS> = Vec::new();
            for i in 0..length {
                let _ = pattern.push(i < hits);
            }

            for i in (1..length).rev() {
                let j = floorf(rng.next_f32() * (i + 1) as f32) as usize;
                let j = j.min(i);
                pattern.swap(i, j);
            }

            pattern
        }
    }
}

// ── Pitch Randomization ────────────────────────────────────────────

/// Generate pitch values constrained to a scale and range.
pub fn randomize_pitch(config: &PitchConfig, length: usize, seed: u32) -> Vec<u8, MAX_STEPS> {
    let mut rng = Rng::new(seed);
    let mut scale_notes = get_scale_notes(config.root, &config.scale, config.low, config.high);

    if scale_notes.is_empty() {
        let mut result = Vec::new();
        for _ in 0..length {
            let _ = result.push(config.low);
        }
        return result;
    }

    // Limit to N distinct notes by picking a random subset
    if config.max_notes > 0 && scale_notes.len() > config.max_notes as usize {
        // Fisher-Yates shuffle
        let n = scale_notes.len();
        for i in (1..n).rev() {
            let j = floorf(rng.next_f32() * (i + 1) as f32) as usize;
            let j = j.min(i);
            scale_notes.swap(i, j);
        }
        scale_notes.truncate(config.max_notes as usize);
        // Sort ascending
        let slice = scale_notes.as_mut_slice();
        slice.sort_unstable();
    }

    match config.mode {
        PitchMode::Arp => randomize_pitch_arp(&scale_notes, config.arp_direction, length, &mut rng),
        PitchMode::Walk => randomize_pitch_walk(&scale_notes, length, &mut rng),
        PitchMode::Rise => randomize_pitch_ramp(&scale_notes, length, false),
        PitchMode::Fall => randomize_pitch_ramp(&scale_notes, length, true),
        PitchMode::Random => {
            let mut notes = Vec::new();
            let n = scale_notes.len();
            for _ in 0..length {
                let idx = floorf(rng.next_f32() * n as f32) as usize;
                let _ = notes.push(scale_notes[idx.min(n - 1)]);
            }
            notes
        }
    }
}

fn randomize_pitch_arp(
    scale_notes: &[u8],
    direction: PitchArpDirection,
    length: usize,
    rng: &mut Rng,
) -> Vec<u8, MAX_STEPS> {
    let n = scale_notes.len();
    let mut notes = Vec::new();

    match direction {
        PitchArpDirection::Up => {
            for i in 0..length {
                let _ = notes.push(scale_notes[i % n]);
            }
        }
        PitchArpDirection::Down => {
            for i in 0..length {
                let _ = notes.push(scale_notes[n - 1 - (i % n)]);
            }
        }
        PitchArpDirection::UpDown => {
            let cycle = if n > 1 { 2 * (n - 1) } else { 1 };
            for i in 0..length {
                let pos = i % cycle;
                let idx = if pos < n { pos } else { cycle - pos };
                let _ = notes.push(scale_notes[idx]);
            }
        }
        PitchArpDirection::Random => {
            let mut idx = floorf(rng.next_f32() * n as f32) as usize;
            if idx >= n {
                idx = n - 1;
            }
            for _ in 0..length {
                let _ = notes.push(scale_notes[idx]);
                let dir: i32 = if rng.next_f32() < 0.5 { 1 } else { -1 };
                let new_idx = idx as i32 + dir;
                idx = new_idx.max(0).min(n as i32 - 1) as usize;
            }
        }
    }

    notes
}

fn randomize_pitch_walk(
    scale_notes: &[u8],
    length: usize,
    rng: &mut Rng,
) -> Vec<u8, MAX_STEPS> {
    let n = scale_notes.len();
    let mut idx = n / 2;
    let mut notes = Vec::new();
    for _ in 0..length {
        let _ = notes.push(scale_notes[idx]);
        let dir: i32 = if rng.next_f32() < 0.5 { 1 } else { -1 };
        let new_idx = idx as i32 + dir;
        idx = new_idx.max(0).min(n as i32 - 1) as usize;
    }
    notes
}

fn randomize_pitch_ramp(
    scale_notes: &[u8],
    length: usize,
    reverse: bool,
) -> Vec<u8, MAX_STEPS> {
    let n = scale_notes.len();
    let mut notes = Vec::new();
    for i in 0..length {
        let t = if length > 1 {
            i as f32 / (length - 1) as f32
        } else {
            0.0
        };
        let degree_idx = if reverse {
            roundf((1.0 - t) * (n - 1) as f32) as usize
        } else {
            roundf(t * (n - 1) as f32) as usize
        };
        let _ = notes.push(scale_notes[degree_idx.min(n - 1)]);
    }
    notes
}

// ── Velocity Randomization ─────────────────────────────────────────

/// Generate velocity values within a range.
pub fn randomize_velocity(
    config: &VelocityConfig,
    length: usize,
    seed: u32,
) -> Vec<u8, MAX_STEPS> {
    let mut rng = Rng::new(seed);
    let range = config.high as i32 - config.low as i32;

    match config.mode {
        VelocityMode::Accent => randomize_velocity_accent(config, length, &mut rng, false),
        VelocityMode::Sync => randomize_velocity_accent(config, length, &mut rng, true),
        VelocityMode::Rise => randomize_velocity_ramp(config, length, false),
        VelocityMode::Fall => randomize_velocity_ramp(config, length, true),
        VelocityMode::Walk => randomize_velocity_walk(config, length, &mut rng),
        VelocityMode::Random => {
            let mut velocities = Vec::new();
            for _ in 0..length {
                let v = floorf(config.low as f32 + rng.next_f32() * (range + 1) as f32) as i32;
                let _ = velocities.push(v.clamp(0, 127) as u8);
            }
            velocities
        }
    }
}

fn randomize_velocity_accent(
    config: &VelocityConfig,
    length: usize,
    rng: &mut Rng,
    inverted: bool,
) -> Vec<u8, MAX_STEPS> {
    let range = config.high as f32 - config.low as f32;
    let mut velocities = Vec::new();
    for i in 0..length {
        let pos = i % 4;
        let is_strong = pos == 0;
        let is_medium = pos == 2;
        let mut strong = is_strong || is_medium;
        if inverted {
            strong = !strong;
        }

        let v = if strong {
            let lo = config.low as f32 + range * 0.8;
            floorf(lo + rng.next_f32() * (config.high as f32 - lo + 1.0)) as i32
        } else {
            let hi = config.low as f32 + range * 0.4;
            floorf(config.low as f32 + rng.next_f32() * (hi - config.low as f32 + 1.0)) as i32
        };

        let _ = velocities.push(v.clamp(0, 127) as u8);
    }
    velocities
}

fn randomize_velocity_ramp(
    config: &VelocityConfig,
    length: usize,
    reverse: bool,
) -> Vec<u8, MAX_STEPS> {
    let range = config.high as f32 - config.low as f32;
    let mut velocities = Vec::new();
    for i in 0..length {
        let t = if length > 1 {
            i as f32 / (length - 1) as f32
        } else {
            0.0
        };
        let v = if reverse {
            roundf(config.high as f32 - t * range) as i32
        } else {
            roundf(config.low as f32 + t * range) as i32
        };
        let _ = velocities.push(v.clamp(0, 127) as u8);
    }
    velocities
}

fn randomize_velocity_walk(
    config: &VelocityConfig,
    length: usize,
    rng: &mut Rng,
) -> Vec<u8, MAX_STEPS> {
    let range = config.high as f32 - config.low as f32;
    let step_size = roundf(range * 0.15).max(1.0) as i32;
    let mut current = roundf((config.low as f32 + config.high as f32) / 2.0) as i32;
    let mut velocities = Vec::new();
    for _ in 0..length {
        let _ = velocities.push(current.clamp(0, 127) as u8);
        let delta = roundf((rng.next_f32() * 2.0 - 1.0) * step_size as f32) as i32;
        current = (current + delta).max(config.low as i32).min(config.high as i32);
    }
    velocities
}

// ── Gate Length Randomization ──────────────────────────────────────

/// Generate random gate length values. Clamped 0.05-1.0, quantized to 0.05.
pub fn randomize_gate_length(
    config: &GateLengthConfig,
    length: usize,
    seed: u32,
) -> Vec<f32, MAX_STEPS> {
    let mut rng = Rng::new(seed);
    let min = config.min.max(0.05);
    let max = config.max.min(1.0);
    let range = max - min;

    let mut values = Vec::new();
    for _ in 0..length {
        let raw = min + rng.next_f32() * range;
        let _ = values.push(roundf(raw * 20.0) / 20.0);
    }
    values
}

// ── Ratchet Randomization ──────────────────────────────────────────

/// Generate random ratchet values. Each step has `probability` chance of being > 1.
pub fn randomize_ratchets(
    config: &RatchetConfig,
    length: usize,
    seed: u32,
) -> Vec<u8, MAX_STEPS> {
    let mut rng = Rng::new(seed);
    let mut values = Vec::new();
    for _ in 0..length {
        if config.probability > 0.0 && rng.next_f32() < config.probability && config.max_ratchet > 1
        {
            let extra = floorf(rng.next_f32() * (config.max_ratchet - 1) as f32) as u8;
            let _ = values.push(2 + extra);
        } else {
            let _ = values.push(1);
        }
    }
    values
}

// ── Slide Randomization ────────────────────────────────────────────

/// Generate random slide values. Returns 0.1 for slides, 0.0 for no slide.
pub fn randomize_slides(probability: f32, length: usize, seed: u32) -> Vec<f32, MAX_STEPS> {
    let mut rng = Rng::new(seed);
    let mut values = Vec::new();
    for _ in 0..length {
        let v = if probability > 0.0 && rng.next_f32() < probability {
            0.1
        } else {
            0.0
        };
        let _ = values.push(v);
    }
    values
}

// ── Mod Randomization ──────────────────────────────────────────────

/// Generate mod step values based on mode.
pub fn randomize_mod(
    config: &ModGenConfig,
    length: usize,
    seed: u32,
) -> Vec<ModStep, MAX_STEPS> {
    match config.mode {
        ModMode::Rise | ModMode::Fall | ModMode::Vee | ModMode::Hill => {
            randomize_mod_ramp(config, length)
        }
        ModMode::Sync => randomize_mod_sync(config, length, seed),
        ModMode::Walk => randomize_mod_walk(config, length, seed),
        ModMode::Random => randomize_mod_random(config, length, seed),
    }
}

fn randomize_mod_random(config: &ModGenConfig, length: usize, seed: u32) -> Vec<ModStep, MAX_STEPS> {
    let mut rng = Rng::new(seed);
    let range = config.high - config.low;
    let mut steps = Vec::new();
    for _ in 0..length {
        let raw = config.low + rng.next_f32() * range;
        let value = roundf(raw * 100.0) / 100.0;
        let slew = if config.slew_probability > 0.0 && rng.next_f32() < config.slew_probability {
            config.slew
        } else {
            0.0
        };
        let _ = steps.push(ModStep { value, slew });
    }
    steps
}

fn randomize_mod_ramp(config: &ModGenConfig, length: usize) -> Vec<ModStep, MAX_STEPS> {
    let mut steps = Vec::new();
    let range = config.high - config.low;
    for i in 0..length {
        let t = if length > 1 {
            i as f32 / (length - 1) as f32
        } else {
            0.0
        };
        let base = match config.mode {
            ModMode::Rise => t,
            ModMode::Fall => 1.0 - t,
            ModMode::Hill => {
                if t < 0.5 {
                    t * 2.0
                } else {
                    (1.0 - t) * 2.0
                }
            }
            ModMode::Vee => {
                if t < 0.5 {
                    1.0 - t * 2.0
                } else {
                    (t - 0.5) * 2.0
                }
            }
            _ => unreachable!(),
        };
        let value = roundf((config.low + base * range) * 100.0) / 100.0;
        let _ = steps.push(ModStep {
            value,
            slew: config.slew,
        });
    }
    steps
}

fn randomize_mod_sync(config: &ModGenConfig, length: usize, seed: u32) -> Vec<ModStep, MAX_STEPS> {
    let mut rng = Rng::new(seed);
    let range = config.high - config.low;
    let mut steps = Vec::new();
    for i in 0..length {
        let pos = i % 4;
        let weight: f32 = if pos == 0 {
            0.15
        } else if pos == 3 {
            0.6
        } else {
            1.0
        };
        let effective_weight = 0.5 + (weight - 0.5) * config.sync_bias;
        let value = roundf((config.low + effective_weight * rng.next_f32() * range) * 100.0)
            / 100.0;
        let slew = if config.slew_probability > 0.0 && rng.next_f32() < config.slew_probability {
            config.slew
        } else {
            0.0
        };
        let _ = steps.push(ModStep { value, slew });
    }
    steps
}

fn randomize_mod_walk(config: &ModGenConfig, length: usize, seed: u32) -> Vec<ModStep, MAX_STEPS> {
    let mut rng = Rng::new(seed);
    let mut steps = Vec::new();
    let mut current = (config.low + config.high) / 2.0;
    for _ in 0..length {
        let delta = (rng.next_f32() * 2.0 - 1.0) * config.walk_step_size;
        current = (current + delta).max(config.low).min(config.high);
        let value = roundf(current * 100.0) / 100.0;
        let slew = if config.slew_probability > 0.0 && rng.next_f32() < config.slew_probability {
            config.slew
        } else {
            0.0
        };
        let _ = steps.push(ModStep { value, slew });
    }
    steps
}

// ── Tie Randomization ──────────────────────────────────────────────

/// Generate tie pattern. Ties continue the previous note.
/// Only gate-on steps can start a tie chain. Step 0 is never a tie.
pub fn randomize_ties(
    probability: f32,
    max_length: u8,
    gate_pattern: &[bool],
    length: usize,
    seed: u32,
) -> Vec<bool, MAX_STEPS> {
    let mut ties: Vec<bool, MAX_STEPS> = Vec::new();
    for _ in 0..length {
        let _ = ties.push(false);
    }

    if probability <= 0.0 {
        return ties;
    }

    let mut rng = Rng::new(seed);
    let mut i = 0;
    while i < length {
        if !gate_pattern[i] {
            i += 1;
            continue;
        }

        // Decide whether this gate-on step starts a tie chain
        if rng.next_f32() >= probability {
            i += 1;
            continue;
        }

        // Create a chain of 1..max_length tied steps
        let chain_len = 1 + floorf(rng.next_f32() * max_length as f32) as usize;
        for j in 1..=chain_len {
            if i + j < length {
                ties[i + j] = true;
            }
        }

        // Skip past the chain
        i += chain_len + 1;
    }

    ties
}

// ── Composite Track Randomization ──────────────────────────────────

/// Subtrack lengths for randomization.
pub struct SubtrackLengths {
    pub gate: usize,
    pub pitch: usize,
    pub velocity: usize,
    pub modulation: usize,
}

/// Result of randomizing all subtracks for a track.
pub struct RandomizedTrack {
    pub gate: Vec<bool, MAX_STEPS>,
    pub pitch: Vec<u8, MAX_STEPS>,
    pub velocity: Vec<u8, MAX_STEPS>,
    pub gate_length: Vec<f32, MAX_STEPS>,
    pub ratchet: Vec<u8, MAX_STEPS>,
    pub slide: Vec<f32, MAX_STEPS>,
    pub modulation: Vec<ModStep, MAX_STEPS>,
    pub tie: Vec<bool, MAX_STEPS>,
}

/// Generate all subtracks for a track using its random config.
pub fn randomize_track(
    config: &RandomConfig,
    lengths: &SubtrackLengths,
    seed: u32,
) -> RandomizedTrack {
    let gate = randomize_gates(&config.gate, lengths.gate, seed);
    RandomizedTrack {
        pitch: randomize_pitch(&config.pitch, lengths.pitch, seed + 1),
        velocity: randomize_velocity(&config.velocity, lengths.velocity, seed + 2),
        gate_length: randomize_gate_length(&config.gate_length, lengths.gate, seed + 3),
        ratchet: randomize_ratchets(&config.ratchet, lengths.gate, seed + 4),
        slide: randomize_slides(config.slide.probability, lengths.pitch, seed + 5),
        modulation: randomize_mod(&config.modulation, lengths.modulation, seed + 6),
        tie: randomize_ties(
            config.tie.probability,
            config.tie.max_length,
            &gate,
            lengths.gate,
            seed + 7,
        ),
        gate,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scales::Scales;

    // ── Gate Tests ──────────────────────────────────────────────────

    #[test]
    fn random_gates_exact_hit_count() {
        let config = GateConfig {
            fill_min: 0.5,
            fill_max: 0.5,
            mode: GateAlgo::Random,
            random_offset: false,
            cluster_continuation: 0.5,
        };
        let gates = randomize_gates(&config, 16, 42);
        assert_eq!(gates.len(), 16);
        assert_eq!(gates.iter().filter(|&&b| b).count(), 8);
    }

    #[test]
    fn euclidean_gates_exact_hit_count() {
        let config = GateConfig {
            fill_min: 0.5,
            fill_max: 0.5,
            mode: GateAlgo::Euclidean,
            random_offset: false,
            cluster_continuation: 0.5,
        };
        let gates = randomize_gates(&config, 8, 42);
        assert_eq!(gates.iter().filter(|&&b| b).count(), 4);
    }

    #[test]
    fn cluster_gates_exact_hit_count() {
        let config = GateConfig {
            fill_min: 0.5,
            fill_max: 0.5,
            mode: GateAlgo::Cluster,
            random_offset: false,
            cluster_continuation: 0.5,
        };
        let gates = randomize_gates(&config, 16, 42);
        assert_eq!(gates.iter().filter(|&&b| b).count(), 8);
    }

    #[test]
    fn sync_gates_hit_count() {
        let config = GateConfig {
            fill_min: 0.5,
            fill_max: 0.5,
            mode: GateAlgo::Sync,
            random_offset: false,
            cluster_continuation: 0.5,
        };
        let gates = randomize_gates(&config, 16, 42);
        assert_eq!(gates.iter().filter(|&&b| b).count(), 8);
    }

    #[test]
    fn gates_deterministic() {
        let config = GateConfig {
            fill_min: 0.25,
            fill_max: 0.75,
            mode: GateAlgo::Random,
            random_offset: false,
            cluster_continuation: 0.5,
        };
        let g1 = randomize_gates(&config, 16, 42);
        let g2 = randomize_gates(&config, 16, 42);
        assert_eq!(g1, g2);
    }

    // ── Pitch Tests ────────────────────────────────────────────────

    #[test]
    fn pitch_random_in_scale() {
        let config = PitchConfig {
            low: 60,
            high: 72,
            scale: Scales::MAJOR,
            root: 60,
            max_notes: 0,
            mode: PitchMode::Random,
            arp_direction: PitchArpDirection::Up,
        };
        let notes = randomize_pitch(&config, 16, 42);
        let scale_notes = get_scale_notes(60, &Scales::MAJOR, 60, 72);
        for &note in notes.iter() {
            assert!(
                scale_notes.contains(&note),
                "note {note} not in C major scale 60-72"
            );
        }
    }

    #[test]
    fn pitch_rise_monotonic() {
        let config = PitchConfig {
            low: 48,
            high: 72,
            scale: Scales::CHROMATIC,
            root: 60,
            max_notes: 0,
            mode: PitchMode::Rise,
            arp_direction: PitchArpDirection::Up,
        };
        let notes = randomize_pitch(&config, 8, 42);
        for i in 1..notes.len() {
            assert!(notes[i] >= notes[i - 1], "rise should be non-decreasing");
        }
    }

    #[test]
    fn pitch_fall_monotonic() {
        let config = PitchConfig {
            low: 48,
            high: 72,
            scale: Scales::CHROMATIC,
            root: 60,
            max_notes: 0,
            mode: PitchMode::Fall,
            arp_direction: PitchArpDirection::Up,
        };
        let notes = randomize_pitch(&config, 8, 42);
        for i in 1..notes.len() {
            assert!(notes[i] <= notes[i - 1], "fall should be non-increasing");
        }
    }

    #[test]
    fn pitch_max_notes_limits() {
        let config = PitchConfig {
            low: 48,
            high: 72,
            scale: Scales::CHROMATIC,
            root: 60,
            max_notes: 3,
            mode: PitchMode::Random,
            arp_direction: PitchArpDirection::Up,
        };
        let notes = randomize_pitch(&config, 16, 42);
        let mut unique: Vec<u8, MAX_STEPS> = Vec::new();
        for &n in notes.iter() {
            if !unique.contains(&n) {
                let _ = unique.push(n);
            }
        }
        assert!(
            unique.len() <= 3,
            "max_notes=3 but got {} distinct notes",
            unique.len()
        );
    }

    // ── Velocity Tests ─────────────────────────────────────────────

    #[test]
    fn velocity_random_in_range() {
        let config = VelocityConfig {
            low: 64,
            high: 127,
            mode: VelocityMode::Random,
        };
        let vels = randomize_velocity(&config, 16, 42);
        for &v in vels.iter() {
            assert!(v >= 64 && v <= 127, "velocity {v} out of range 64-127");
        }
    }

    #[test]
    fn velocity_rise_monotonic() {
        let config = VelocityConfig {
            low: 0,
            high: 127,
            mode: VelocityMode::Rise,
        };
        let vels = randomize_velocity(&config, 8, 42);
        for i in 1..vels.len() {
            assert!(vels[i] >= vels[i - 1], "rise should be non-decreasing");
        }
    }

    // ── Gate Length Tests ──────────────────────────────────────────

    #[test]
    fn gate_length_in_range() {
        let config = GateLengthConfig {
            min: 0.25,
            max: 0.75,
        };
        let lengths = randomize_gate_length(&config, 16, 42);
        for &gl in lengths.iter() {
            assert!(gl >= 0.25 && gl <= 0.75, "gate length {gl} out of range");
        }
    }

    #[test]
    fn gate_length_quantized() {
        let config = GateLengthConfig {
            min: 0.05,
            max: 1.0,
        };
        let lengths = randomize_gate_length(&config, 16, 42);
        for &gl in lengths.iter() {
            let quantized = roundf(gl * 20.0) / 20.0;
            assert!(
                (gl - quantized).abs() < 1e-6,
                "gate length {gl} not quantized to 0.05"
            );
        }
    }

    // ── Ratchet Tests ──────────────────────────────────────────────

    #[test]
    fn ratchets_all_one_when_no_probability() {
        let config = RatchetConfig {
            max_ratchet: 4,
            probability: 0.0,
        };
        let ratchets = randomize_ratchets(&config, 16, 42);
        assert!(ratchets.iter().all(|&r| r == 1));
    }

    #[test]
    fn ratchets_in_range() {
        let config = RatchetConfig {
            max_ratchet: 4,
            probability: 0.5,
        };
        let ratchets = randomize_ratchets(&config, 16, 42);
        for &r in ratchets.iter() {
            assert!(r >= 1 && r <= 4, "ratchet {r} out of range 1-4");
        }
    }

    // ── Slide Tests ────────────────────────────────────────────────

    #[test]
    fn slides_all_zero_when_no_probability() {
        let slides = randomize_slides(0.0, 16, 42);
        assert!(slides.iter().all(|&s| s == 0.0));
    }

    // ── Mod Tests ──────────────────────────────────────────────────

    #[test]
    fn mod_random_in_range() {
        let config = ModGenConfig {
            low: 0.2,
            high: 0.8,
            mode: ModMode::Random,
            slew: 0.0,
            slew_probability: 0.0,
            walk_step_size: 0.15,
            sync_bias: 0.5,
        };
        let steps = randomize_mod(&config, 16, 42);
        for step in steps.iter() {
            assert!(
                step.value >= 0.19 && step.value <= 0.81,
                "mod value {} out of range",
                step.value
            );
        }
    }

    #[test]
    fn mod_rise_monotonic() {
        let config = ModGenConfig {
            low: 0.0,
            high: 1.0,
            mode: ModMode::Rise,
            slew: 0.0,
            slew_probability: 0.0,
            walk_step_size: 0.15,
            sync_bias: 0.5,
        };
        let steps = randomize_mod(&config, 8, 42);
        for i in 1..steps.len() {
            assert!(
                steps[i].value >= steps[i - 1].value,
                "rise should be non-decreasing"
            );
        }
    }

    // ── Tie Tests ──────────────────────────────────────────────────

    #[test]
    fn ties_all_false_when_no_probability() {
        let gates = [true, false, true, true, false, true, false, false];
        let ties = randomize_ties(0.0, 2, &gates, 8, 42);
        assert!(ties.iter().all(|&t| !t));
    }

    #[test]
    fn ties_never_at_step_zero() {
        let gates = [true; 16];
        let ties = randomize_ties(1.0, 4, &gates, 16, 42);
        assert!(!ties[0], "step 0 should never be a tie");
    }

    // ── Composite Tests ────────────────────────────────────────────

    #[test]
    fn randomize_track_produces_all_subtracks() {
        let config = RandomConfig::default();
        let lengths = SubtrackLengths {
            gate: 16,
            pitch: 16,
            velocity: 16,
            modulation: 16,
        };
        let result = randomize_track(&config, &lengths, 42);
        assert_eq!(result.gate.len(), 16);
        assert_eq!(result.pitch.len(), 16);
        assert_eq!(result.velocity.len(), 16);
        assert_eq!(result.gate_length.len(), 16);
        assert_eq!(result.ratchet.len(), 16);
        assert_eq!(result.slide.len(), 16);
        assert_eq!(result.modulation.len(), 16);
        assert_eq!(result.tie.len(), 16);
    }

    #[test]
    fn randomize_track_deterministic() {
        let config = RandomConfig::default();
        let lengths = SubtrackLengths {
            gate: 16,
            pitch: 16,
            velocity: 16,
            modulation: 16,
        };
        let r1 = randomize_track(&config, &lengths, 42);
        let r2 = randomize_track(&config, &lengths, 42);
        assert_eq!(r1.gate, r2.gate);
        assert_eq!(r1.pitch, r2.pitch);
        assert_eq!(r1.velocity, r2.velocity);
    }
}
