use heapless::{String, Vec};
use serde::{Deserialize, Serialize};

use crate::scales::Scale;
use crate::{MAX_STEPS, NUM_OUTPUTS, NUM_TRACKS};

// ── Step types ──────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GateStep {
    pub on: bool,
    pub tie: bool,
    pub length: f32,   // 0.0-1.0, fraction of step window
    pub ratchet: u8,   // 1-4, sub-triggers per step
}

impl Default for GateStep {
    fn default() -> Self {
        Self {
            on: false,
            tie: false,
            length: 0.5,
            ratchet: 1,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PitchStep {
    pub note: u8,    // MIDI 0-127
    pub slide: f32,  // 0 = off, 0.01-0.50 = portamento time in seconds
}

impl Default for PitchStep {
    fn default() -> Self {
        Self {
            note: 60,
            slide: 0.0,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ModStep {
    pub value: f32,  // 0.0-1.0, CV value
    pub slew: f32,   // 0.0-1.0, interpolation time as fraction of step
}

impl Default for ModStep {
    fn default() -> Self {
        Self {
            value: 0.5,
            slew: 0.0,
        }
    }
}

// ── Subtrack ────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(bound = "T: Serialize + serde::de::DeserializeOwned")]
pub struct Subtrack<T: Clone> {
    pub steps: Vec<T, MAX_STEPS>,
    pub length: u8,           // active length (1..=MAX_STEPS)
    pub clock_divider: u8,    // 1..=32
    pub current_step: u8,     // playback position
}

impl<T: Clone + Default> Default for Subtrack<T> {
    fn default() -> Self {
        let mut steps = Vec::new();
        for _ in 0..16 {
            let _ = steps.push(T::default());
        }
        Self {
            steps,
            length: 16,
            clock_divider: 1,
            current_step: 0,
        }
    }
}

// ── Enums ───────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum PitchMode {
    Random,
    Arp,
    Walk,
    Rise,
    Fall,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum PitchArpDirection {
    Up,
    Down,
    UpDown,
    Random,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum GateAlgo {
    Random,
    Euclidean,
    Sync,
    Cluster,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum VelocityMode {
    Random,
    Accent,
    Sync,
    Rise,
    Fall,
    Walk,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ModMode {
    Random,
    Rise,
    Fall,
    Vee,
    Hill,
    Sync,
    Walk,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ArpDirection {
    Up,
    Down,
    Triangle,
    Random,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum LfoWaveform {
    Sine,
    Triangle,
    Saw,
    Square,
    SlewRandom,
    SampleAndHold,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum LfoSyncMode {
    Track,
    Free,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClockSource {
    Internal,
    Midi,
    External,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum MutateTrigger {
    Loop,
    Bars,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ModSource {
    Seq,
    Lfo,
}

// ── Sequence Track ──────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SequenceTrack {
    pub id: String<32>,
    pub name: String<32>,
    pub clock_divider: u8, // track-level division (1..=32)
    pub gate: Subtrack<GateStep>,
    pub pitch: Subtrack<PitchStep>,
    pub velocity: Subtrack<u8>,
    pub modulation: Subtrack<ModStep>,
}

impl SequenceTrack {
    pub fn new(index: usize) -> Self {
        let mut id = String::new();
        let _ = core::fmt::Write::write_fmt(&mut id, format_args!("{}", index));
        let mut name = String::new();
        let _ = core::fmt::Write::write_fmt(&mut name, format_args!("Track {}", index + 1));

        // Default velocity subtrack: all 100
        let mut vel_steps: Vec<u8, MAX_STEPS> = Vec::new();
        for _ in 0..16 {
            let _ = vel_steps.push(100);
        }

        Self {
            id,
            name,
            clock_divider: 1,
            gate: Subtrack::default(),
            pitch: Subtrack::default(),
            velocity: Subtrack {
                steps: vel_steps,
                length: 16,
                clock_divider: 1,
                current_step: 0,
            },
            modulation: Subtrack::default(),
        }
    }
}

// ── Random Config ───────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PitchConfig {
    pub low: u8,
    pub high: u8,
    pub scale: Scale,
    pub root: u8,
    pub max_notes: u8,   // 0 = unlimited
    pub mode: PitchMode,
    pub arp_direction: PitchArpDirection,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GateConfig {
    pub fill_min: f32,
    pub fill_max: f32,
    pub mode: GateAlgo,
    pub random_offset: bool,
    pub cluster_continuation: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct VelocityConfig {
    pub low: u8,
    pub high: u8,
    pub mode: VelocityMode,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GateLengthConfig {
    pub min: f32,
    pub max: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RatchetConfig {
    pub max_ratchet: u8,
    pub probability: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SlideConfig {
    pub probability: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ModGenConfig {
    pub low: f32,
    pub high: f32,
    pub mode: ModMode,
    pub slew: f32,
    pub slew_probability: f32,
    pub walk_step_size: f32,
    pub sync_bias: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TieConfig {
    pub probability: f32,
    pub max_length: u8,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RandomConfig {
    pub pitch: PitchConfig,
    pub gate: GateConfig,
    pub velocity: VelocityConfig,
    pub gate_length: GateLengthConfig,
    pub ratchet: RatchetConfig,
    pub slide: SlideConfig,
    pub modulation: ModGenConfig,
    pub tie: TieConfig,
}

impl Default for RandomConfig {
    fn default() -> Self {
        use crate::scales::Scales;
        Self {
            pitch: PitchConfig {
                low: 48,
                high: 72,
                scale: Scales::MINOR_PENTATONIC,
                root: 60,
                max_notes: 0,
                mode: PitchMode::Random,
                arp_direction: PitchArpDirection::Up,
            },
            gate: GateConfig {
                fill_min: 0.25,
                fill_max: 0.75,
                mode: GateAlgo::Random,
                random_offset: false,
                cluster_continuation: 0.5,
            },
            velocity: VelocityConfig {
                low: 64,
                high: 127,
                mode: VelocityMode::Random,
            },
            gate_length: GateLengthConfig {
                min: 0.25,
                max: 0.75,
            },
            ratchet: RatchetConfig {
                max_ratchet: 1,
                probability: 0.0,
            },
            slide: SlideConfig { probability: 0.0 },
            modulation: ModGenConfig {
                low: 0.0,
                high: 1.0,
                mode: ModMode::Random,
                slew: 0.0,
                slew_probability: 0.0,
                walk_step_size: 0.15,
                sync_bias: 0.5,
            },
            tie: TieConfig {
                probability: 0.0,
                max_length: 2,
            },
        }
    }
}

// ── Output Routing ──────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct OutputRouting {
    pub gate: u8,      // source track index 0-3
    pub pitch: u8,
    pub velocity: u8,
    pub modulation: u8,
    pub mod_source: ModSource,
}

impl OutputRouting {
    pub fn identity(index: u8) -> Self {
        Self {
            gate: index,
            pitch: index,
            velocity: index,
            modulation: index,
            mod_source: ModSource::Seq,
        }
    }
}

// ── Mute Track ──────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MuteTrack {
    pub steps: Vec<bool, MAX_STEPS>,
    pub length: u8,
    pub clock_divider: u8,
    pub current_step: u8,
}

impl Default for MuteTrack {
    fn default() -> Self {
        let mut steps = Vec::new();
        for _ in 0..16 {
            let _ = steps.push(false);
        }
        Self {
            steps,
            length: 16,
            clock_divider: 1,
            current_step: 0,
        }
    }
}

// ── Note Event ──────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NoteEvent {
    pub output: u8,
    pub gate: bool,
    pub pitch: u8,
    pub velocity: u8,
    pub modulation: u8,    // 0-127 (scaled from 0.0-1.0)
    pub mod_slew: f32,     // 0.0-1.0
    pub gate_length: f32,  // 0.0-1.0
    pub ratchet_count: u8, // 1-4
    pub slide: f32,        // seconds (0 = off)
    pub retrigger: bool,
    pub sustain: bool,
}

// ── Transport ───────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Transport {
    pub bpm: u16,
    pub playing: bool,
    pub master_tick: u64,
    pub clock_source: ClockSource,
}

impl Default for Transport {
    fn default() -> Self {
        Self {
            bpm: 135,
            playing: false,
            master_tick: 0,
            clock_source: ClockSource::Internal,
        }
    }
}

// ── LFO ─────────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LfoConfig {
    pub waveform: LfoWaveform,
    pub sync_mode: LfoSyncMode,
    pub rate: u8,         // steps per cycle (1-64) in synced mode
    pub free_rate: f32,   // Hz (0.05-20.0) in free mode
    pub depth: f32,       // 0.0-1.0
    pub offset: f32,      // 0.0-1.0
    pub width: f32,       // 0.0-1.0 (waveform skew)
    pub phase: f32,       // 0.0-1.0 phase offset
}

impl Default for LfoConfig {
    fn default() -> Self {
        Self {
            waveform: LfoWaveform::Sine,
            sync_mode: LfoSyncMode::Track,
            rate: 16,
            free_rate: 1.0,
            depth: 1.0,
            offset: 0.5,
            width: 0.5,
            phase: 0.0,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LfoRuntime {
    pub current_phase: f32,
    pub last_sh_value: f32,
    pub slew_target: f32,
    pub slew_current: f32,
}

impl Default for LfoRuntime {
    fn default() -> Self {
        Self {
            current_phase: 0.0,
            last_sh_value: 0.0,
            slew_target: 0.0,
            slew_current: 0.0,
        }
    }
}

// ── Transpose ───────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TransposeConfig {
    pub semitones: i8,     // -48 to +48
    pub note_low: u8,      // MIDI floor
    pub note_high: u8,     // MIDI ceiling
    pub gl_scale: f32,     // gate length multiplier (0.25-4.0)
    pub vel_scale: f32,    // velocity multiplier (0.25-4.0)
}

impl Default for TransposeConfig {
    fn default() -> Self {
        Self {
            semitones: 0,
            note_low: 0,
            note_high: 127,
            gl_scale: 1.0,
            vel_scale: 1.0,
        }
    }
}

// ── Arpeggiator ─────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ArpConfig {
    pub enabled: bool,
    pub direction: ArpDirection,
    pub octave_range: u8, // 1-4
}

impl Default for ArpConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            direction: ArpDirection::Up,
            octave_range: 1,
        }
    }
}

// ── Mutation ────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MutateConfig {
    pub trigger: MutateTrigger,
    pub bars: u8,      // 1, 2, 4, 8, 16
    pub gate: f32,     // 0-1.0 drift rate
    pub pitch: f32,
    pub velocity: f32,
    pub modulation: f32,
}

impl Default for MutateConfig {
    fn default() -> Self {
        Self {
            trigger: MutateTrigger::Loop,
            bars: 1,
            gate: 0.0,
            pitch: 0.0,
            velocity: 0.0,
            modulation: 0.0,
        }
    }
}

// ── MIDI Config ─────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MidiOutputConfig {
    pub channel: u8, // 1-16
}

impl MidiOutputConfig {
    pub fn new(channel: u8) -> Self {
        Self { channel }
    }
}

// ── Variation / Transforms ──────────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransformType {
    // Playhead transforms
    Reverse,
    PingPong,
    Rotate,
    DoubleTime,
    Stutter,
    HalfTime,
    Skip,
    DrunkWalk,
    Scramble,
    // Gate value transforms
    Thin,
    Fill,
    SkipEven,
    SkipOdd,
    InvertGates,
    Densify,
    Drop,
    Ratchet,
    // Pitch value transforms
    Transpose,
    Invert,
    OctaveShift,
    Fold,
    Quantize,
    // Velocity value transforms
    Accent,
    FadeIn,
    FadeOut,
    Humanize,
}

impl TransformType {
    pub fn is_playhead(&self) -> bool {
        matches!(
            self,
            Self::Reverse
                | Self::PingPong
                | Self::Rotate
                | Self::DoubleTime
                | Self::Stutter
                | Self::HalfTime
                | Self::Skip
                | Self::DrunkWalk
                | Self::Scramble
        )
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Transform {
    pub transform_type: TransformType,
    pub param: i32,
}

/// Maximum transforms per variation slot.
pub const MAX_TRANSFORMS: usize = 8;

/// Maximum variation slots (bars in phrase).
pub const MAX_VARIATION_SLOTS: usize = 16;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct VariationSlot {
    pub transforms: Vec<Transform, MAX_TRANSFORMS>,
}

impl Default for VariationSlot {
    fn default() -> Self {
        Self {
            transforms: Vec::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SubtrackKey {
    Gate,
    Pitch,
    Velocity,
    Mod,
}

/// A flat variation pattern used for per-subtrack overrides (no further nesting).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct OverridePattern {
    pub length: u8,
    pub loop_mode: bool,
    pub slots: Vec<VariationSlot, MAX_VARIATION_SLOTS>,
    pub current_bar: u8,
}

impl Default for OverridePattern {
    fn default() -> Self {
        let mut slots = Vec::new();
        for _ in 0..4 {
            let _ = slots.push(VariationSlot::default());
        }
        Self {
            length: 4,
            loop_mode: true,
            slots,
            current_bar: 0,
        }
    }
}

/// Per-subtrack override: None = inherit track, Bypass = no transforms, Pattern = custom.
/// Size difference is intentional — Box not available in no_std.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[allow(clippy::large_enum_variant)]
pub enum SubtrackOverride {
    Bypass,
    Pattern(OverridePattern),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct VariationPattern {
    pub enabled: bool,
    pub length: u8,
    pub loop_mode: bool,
    pub slots: Vec<VariationSlot, MAX_VARIATION_SLOTS>,
    pub current_bar: u8,
    pub gate_override: Option<SubtrackOverride>,
    pub pitch_override: Option<SubtrackOverride>,
    pub velocity_override: Option<SubtrackOverride>,
    pub mod_override: Option<SubtrackOverride>,
}

impl Default for VariationPattern {
    fn default() -> Self {
        let mut slots = Vec::new();
        for _ in 0..4 {
            let _ = slots.push(VariationSlot::default());
        }
        Self {
            enabled: false,
            length: 4,
            loop_mode: true,
            slots,
            current_bar: 0,
            gate_override: None,
            pitch_override: None,
            velocity_override: None,
            mod_override: None,
        }
    }
}

// ── Pattern Storage ─────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TrackSlotData {
    pub track: SequenceTrack,
    pub transpose_config: TransposeConfig,
    pub mutate_config: MutateConfig,
    pub variation_pattern: VariationPattern,
    pub lfo_config: LfoConfig,
    pub random_config: RandomConfig,
    pub arp_config: ArpConfig,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LayerFlags {
    pub gate: bool,
    pub pitch: bool,
    pub velocity: bool,
    pub modulation: bool,
    pub transpose: bool,
    pub drift: bool,
    pub variation: bool,
}

impl Default for LayerFlags {
    fn default() -> Self {
        Self {
            gate: true,
            pitch: true,
            velocity: true,
            modulation: true,
            transpose: true,
            drift: true,
            variation: true,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SavedPattern {
    pub name: String<32>,
    pub data: TrackSlotData,
    pub source_track: u8,
}

// ── User Preset ─────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct UserPreset {
    pub name: String<32>,
    pub config: RandomConfig,
}

// ── Top-Level State ─────────────────────────────────────────────────

/// Maximum saved patterns / user presets.
pub const MAX_SAVED: usize = 32;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SequencerState {
    pub tracks: [SequenceTrack; NUM_TRACKS],
    pub routing: [OutputRouting; NUM_OUTPUTS],
    pub mute_patterns: [MuteTrack; NUM_TRACKS],
    pub transport: Transport,
    pub random_configs: [RandomConfig; NUM_TRACKS],
    pub transpose_configs: [TransposeConfig; NUM_TRACKS],
    pub lfo_configs: [LfoConfig; NUM_TRACKS],
    pub lfo_runtimes: [LfoRuntime; NUM_TRACKS],
    pub arp_configs: [ArpConfig; NUM_TRACKS],
    pub mutate_configs: [MutateConfig; NUM_TRACKS],
    pub midi_configs: [MidiOutputConfig; NUM_OUTPUTS],
    pub midi_enabled: bool,
    pub midi_clock_out: bool,
    pub user_presets: Vec<UserPreset, MAX_SAVED>,
    pub variation_patterns: [VariationPattern; NUM_TRACKS],
    pub saved_patterns: Vec<SavedPattern, MAX_SAVED>,
}

impl SequencerState {
    pub fn new() -> Self {
        Self {
            tracks: core::array::from_fn(SequenceTrack::new),
            routing: core::array::from_fn(|i| OutputRouting::identity(i as u8)),
            mute_patterns: core::array::from_fn(|_| MuteTrack::default()),
            transport: Transport::default(),
            random_configs: core::array::from_fn(|_| RandomConfig::default()),
            transpose_configs: core::array::from_fn(|_| TransposeConfig::default()),
            lfo_configs: core::array::from_fn(|_| LfoConfig::default()),
            lfo_runtimes: core::array::from_fn(|_| LfoRuntime::default()),
            arp_configs: core::array::from_fn(|_| ArpConfig::default()),
            mutate_configs: core::array::from_fn(|_| MutateConfig::default()),
            midi_configs: core::array::from_fn(|i| MidiOutputConfig::new((i + 1) as u8)),
            midi_enabled: false,
            midi_clock_out: false,
            user_presets: Vec::new(),
            variation_patterns: core::array::from_fn(|_| VariationPattern::default()),
            saved_patterns: Vec::new(),
        }
    }
}

impl Default for SequencerState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_state_has_4_tracks() {
        let state = SequencerState::new();
        assert_eq!(state.tracks.len(), 4);
    }

    #[test]
    fn track_names() {
        let state = SequencerState::new();
        assert_eq!(state.tracks[0].name.as_str(), "Track 1");
        assert_eq!(state.tracks[3].name.as_str(), "Track 4");
    }

    #[test]
    fn default_routing_is_identity() {
        let state = SequencerState::new();
        for i in 0..4 {
            assert_eq!(state.routing[i].gate, i as u8);
            assert_eq!(state.routing[i].pitch, i as u8);
        }
    }

    #[test]
    fn default_subtracks_have_16_steps() {
        let state = SequencerState::new();
        assert_eq!(state.tracks[0].gate.length, 16);
        assert_eq!(state.tracks[0].gate.steps.len(), 16);
        assert_eq!(state.tracks[0].pitch.length, 16);
        assert_eq!(state.tracks[0].velocity.length, 16);
    }

    #[test]
    fn sequencer_state_serde_round_trip() {
        // SequencerState is large; run on a thread with extra stack space.
        let result = std::thread::Builder::new()
            .stack_size(16 * 1024 * 1024)
            .spawn(|| {
                let state = Box::new(SequencerState::new());
                let mut buf = vec![0u8; 64 * 1024];
                let bytes = postcard::to_slice(&*state, &mut buf).unwrap();
                let len = bytes.len();
                let restored: Box<SequencerState> =
                    Box::new(postcard::from_bytes(&buf[..len]).unwrap());
                assert_eq!(*state, *restored);
            })
            .unwrap()
            .join();
        result.unwrap();
    }

    #[test]
    fn state_is_cloneable() {
        let state = SequencerState::new();
        let cloned = state.clone();
        assert_eq!(state, cloned);
    }
}
