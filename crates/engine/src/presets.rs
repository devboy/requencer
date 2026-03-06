use crate::scales::Scales;
use crate::types::{
    GateAlgo, GateConfig, GateLengthConfig, ModGenConfig, ModMode, PitchArpDirection, PitchConfig,
    PitchMode, RandomConfig, RatchetConfig, SlideConfig, TieConfig, VelocityConfig, VelocityMode,
};

/// A named randomizer preset.
pub struct Preset {
    pub name: &'static str,
    pub config: RandomConfig,
}

/// Factory presets matching the TypeScript engine.
pub const NUM_PRESETS: usize = 8;

pub fn get_presets() -> [Preset; NUM_PRESETS] {
    [
        Preset {
            name: "Bassline",
            config: RandomConfig {
                pitch: PitchConfig {
                    low: 24,
                    high: 36,
                    scale: Scales::MINOR_PENTATONIC,
                    root: 24,
                    max_notes: 3,
                    mode: PitchMode::Random,
                    arp_direction: PitchArpDirection::Up,
                },
                gate: GateConfig {
                    fill_min: 0.6,
                    fill_max: 0.9,
                    mode: GateAlgo::Euclidean,
                    random_offset: true,
                    cluster_continuation: 0.7,
                },
                velocity: VelocityConfig {
                    low: 90,
                    high: 120,
                    mode: VelocityMode::Random,
                },
                gate_length: GateLengthConfig {
                    min: 0.4,
                    max: 0.7,
                },
                ratchet: RatchetConfig {
                    max_ratchet: 2,
                    probability: 0.05,
                },
                slide: SlideConfig { probability: 0.0 },
                modulation: ModGenConfig {
                    low: 0.0,
                    high: 0.5,
                    mode: ModMode::Walk,
                    slew: 0.5,
                    slew_probability: 0.5,
                    walk_step_size: 0.1,
                    sync_bias: 0.7,
                },
                tie: TieConfig {
                    probability: 0.1,
                    max_length: 2,
                },
            },
        },
        Preset {
            name: "Hypnotic",
            config: RandomConfig {
                pitch: PitchConfig {
                    low: 48,
                    high: 60,
                    scale: Scales::MINOR_PENTATONIC,
                    root: 48,
                    max_notes: 3,
                    mode: PitchMode::Random,
                    arp_direction: PitchArpDirection::Up,
                },
                gate: GateConfig {
                    fill_min: 0.75,
                    fill_max: 1.0,
                    mode: GateAlgo::Cluster,
                    random_offset: true,
                    cluster_continuation: 0.85,
                },
                velocity: VelocityConfig {
                    low: 90,
                    high: 110,
                    mode: VelocityMode::Random,
                },
                gate_length: GateLengthConfig {
                    min: 0.4,
                    max: 0.6,
                },
                ratchet: RatchetConfig {
                    max_ratchet: 1,
                    probability: 0.0,
                },
                slide: SlideConfig { probability: 0.0 },
                modulation: ModGenConfig {
                    low: 0.2,
                    high: 0.8,
                    mode: ModMode::Rise,
                    slew: 0.8,
                    slew_probability: 1.0,
                    walk_step_size: 0.15,
                    sync_bias: 0.7,
                },
                tie: TieConfig {
                    probability: 0.0,
                    max_length: 2,
                },
            },
        },
        Preset {
            name: "Acid",
            config: RandomConfig {
                pitch: PitchConfig {
                    low: 36,
                    high: 60,
                    scale: Scales::BLUES,
                    root: 36,
                    max_notes: 5,
                    mode: PitchMode::Random,
                    arp_direction: PitchArpDirection::Up,
                },
                gate: GateConfig {
                    fill_min: 0.5,
                    fill_max: 0.85,
                    mode: GateAlgo::Sync,
                    random_offset: false,
                    cluster_continuation: 0.7,
                },
                velocity: VelocityConfig {
                    low: 64,
                    high: 127,
                    mode: VelocityMode::Random,
                },
                gate_length: GateLengthConfig {
                    min: 0.3,
                    max: 0.8,
                },
                ratchet: RatchetConfig {
                    max_ratchet: 1,
                    probability: 0.0,
                },
                slide: SlideConfig { probability: 0.25 },
                modulation: ModGenConfig {
                    low: 0.0,
                    high: 1.0,
                    mode: ModMode::Sync,
                    slew: 0.3,
                    slew_probability: 0.4,
                    walk_step_size: 0.15,
                    sync_bias: 0.8,
                },
                tie: TieConfig {
                    probability: 0.15,
                    max_length: 3,
                },
            },
        },
        Preset {
            name: "Ambient",
            config: RandomConfig {
                pitch: PitchConfig {
                    low: 48,
                    high: 72,
                    scale: Scales::MAJOR,
                    root: 48,
                    max_notes: 0,
                    mode: PitchMode::Random,
                    arp_direction: PitchArpDirection::Up,
                },
                gate: GateConfig {
                    fill_min: 0.1,
                    fill_max: 0.3,
                    mode: GateAlgo::Random,
                    random_offset: false,
                    cluster_continuation: 0.7,
                },
                velocity: VelocityConfig {
                    low: 40,
                    high: 80,
                    mode: VelocityMode::Random,
                },
                gate_length: GateLengthConfig {
                    min: 0.6,
                    max: 1.0,
                },
                ratchet: RatchetConfig {
                    max_ratchet: 1,
                    probability: 0.0,
                },
                slide: SlideConfig { probability: 0.0 },
                modulation: ModGenConfig {
                    low: 0.3,
                    high: 0.7,
                    mode: ModMode::Walk,
                    slew: 0.9,
                    slew_probability: 0.8,
                    walk_step_size: 0.05,
                    sync_bias: 0.7,
                },
                tie: TieConfig {
                    probability: 0.2,
                    max_length: 4,
                },
            },
        },
        Preset {
            name: "Percussive",
            config: RandomConfig {
                pitch: PitchConfig {
                    low: 60,
                    high: 72,
                    scale: Scales::CHROMATIC,
                    root: 60,
                    max_notes: 0,
                    mode: PitchMode::Random,
                    arp_direction: PitchArpDirection::Up,
                },
                gate: GateConfig {
                    fill_min: 0.6,
                    fill_max: 0.9,
                    mode: GateAlgo::Euclidean,
                    random_offset: true,
                    cluster_continuation: 0.7,
                },
                velocity: VelocityConfig {
                    low: 100,
                    high: 127,
                    mode: VelocityMode::Random,
                },
                gate_length: GateLengthConfig {
                    min: 0.15,
                    max: 0.3,
                },
                ratchet: RatchetConfig {
                    max_ratchet: 3,
                    probability: 0.15,
                },
                slide: SlideConfig { probability: 0.0 },
                modulation: ModGenConfig {
                    low: 0.0,
                    high: 0.3,
                    mode: ModMode::Random,
                    slew: 0.0,
                    slew_probability: 0.0,
                    walk_step_size: 0.15,
                    sync_bias: 0.7,
                },
                tie: TieConfig {
                    probability: 0.0,
                    max_length: 2,
                },
            },
        },
        Preset {
            name: "Sparse",
            config: RandomConfig {
                pitch: PitchConfig {
                    low: 48,
                    high: 67,
                    scale: Scales::DORIAN,
                    root: 48,
                    max_notes: 4,
                    mode: PitchMode::Random,
                    arp_direction: PitchArpDirection::Up,
                },
                gate: GateConfig {
                    fill_min: 0.15,
                    fill_max: 0.35,
                    mode: GateAlgo::Euclidean,
                    random_offset: true,
                    cluster_continuation: 0.7,
                },
                velocity: VelocityConfig {
                    low: 50,
                    high: 100,
                    mode: VelocityMode::Random,
                },
                gate_length: GateLengthConfig {
                    min: 0.5,
                    max: 0.8,
                },
                ratchet: RatchetConfig {
                    max_ratchet: 1,
                    probability: 0.0,
                },
                slide: SlideConfig { probability: 0.0 },
                modulation: ModGenConfig {
                    low: 0.1,
                    high: 0.6,
                    mode: ModMode::Fall,
                    slew: 0.6,
                    slew_probability: 1.0,
                    walk_step_size: 0.15,
                    sync_bias: 0.7,
                },
                tie: TieConfig {
                    probability: 0.0,
                    max_length: 2,
                },
            },
        },
        Preset {
            name: "Stab",
            config: RandomConfig {
                pitch: PitchConfig {
                    low: 60,
                    high: 72,
                    scale: Scales::MINOR,
                    root: 60,
                    max_notes: 4,
                    mode: PitchMode::Random,
                    arp_direction: PitchArpDirection::Up,
                },
                gate: GateConfig {
                    fill_min: 0.3,
                    fill_max: 0.6,
                    mode: GateAlgo::Sync,
                    random_offset: false,
                    cluster_continuation: 0.7,
                },
                velocity: VelocityConfig {
                    low: 90,
                    high: 127,
                    mode: VelocityMode::Random,
                },
                gate_length: GateLengthConfig {
                    min: 0.15,
                    max: 0.35,
                },
                ratchet: RatchetConfig {
                    max_ratchet: 1,
                    probability: 0.0,
                },
                slide: SlideConfig { probability: 0.0 },
                modulation: ModGenConfig {
                    low: 0.4,
                    high: 0.9,
                    mode: ModMode::Sync,
                    slew: 0.0,
                    slew_probability: 0.0,
                    walk_step_size: 0.15,
                    sync_bias: 0.5,
                },
                tie: TieConfig {
                    probability: 0.0,
                    max_length: 2,
                },
            },
        },
        Preset {
            name: "Driving",
            config: RandomConfig {
                pitch: PitchConfig {
                    low: 36,
                    high: 48,
                    scale: Scales::MINOR_PENTATONIC,
                    root: 36,
                    max_notes: 3,
                    mode: PitchMode::Random,
                    arp_direction: PitchArpDirection::Up,
                },
                gate: GateConfig {
                    fill_min: 0.8,
                    fill_max: 1.0,
                    mode: GateAlgo::Euclidean,
                    random_offset: true,
                    cluster_continuation: 0.7,
                },
                velocity: VelocityConfig {
                    low: 80,
                    high: 110,
                    mode: VelocityMode::Random,
                },
                gate_length: GateLengthConfig {
                    min: 0.3,
                    max: 0.5,
                },
                ratchet: RatchetConfig {
                    max_ratchet: 2,
                    probability: 0.1,
                },
                slide: SlideConfig { probability: 0.0 },
                modulation: ModGenConfig {
                    low: 0.1,
                    high: 0.5,
                    mode: ModMode::Random,
                    slew: 0.2,
                    slew_probability: 0.5,
                    walk_step_size: 0.15,
                    sync_bias: 0.7,
                },
                tie: TieConfig {
                    probability: 0.05,
                    max_length: 2,
                },
            },
        },
    ]
}

/// Look up a preset by name.
pub fn get_preset_by_name(name: &str) -> Option<RandomConfig> {
    let presets = get_presets();
    for preset in presets {
        if preset.name == name {
            return Some(preset.config);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_presets_exist() {
        let presets = get_presets();
        assert_eq!(presets.len(), 8);
    }

    #[test]
    fn lookup_by_name() {
        assert!(get_preset_by_name("Bassline").is_some());
        assert!(get_preset_by_name("Acid").is_some());
        assert!(get_preset_by_name("Nonexistent").is_none());
    }

    #[test]
    fn bassline_preset_values() {
        let config = get_preset_by_name("Bassline").unwrap();
        assert_eq!(config.pitch.low, 24);
        assert_eq!(config.pitch.high, 36);
        assert_eq!(config.gate.mode, GateAlgo::Euclidean);
        assert_eq!(config.ratchet.max_ratchet, 2);
    }

    #[test]
    fn acid_preset_has_slide() {
        let config = get_preset_by_name("Acid").unwrap();
        assert_eq!(config.slide.probability, 0.25);
        assert_eq!(config.tie.probability, 0.15);
    }

    #[test]
    fn preset_names_match() {
        let expected = [
            "Bassline",
            "Hypnotic",
            "Acid",
            "Ambient",
            "Percussive",
            "Sparse",
            "Stab",
            "Driving",
        ];
        let presets = get_presets();
        for (i, name) in expected.iter().enumerate() {
            assert_eq!(presets[i].name, *name);
        }
    }
}
