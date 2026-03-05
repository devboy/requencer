#![cfg_attr(not(feature = "std"), no_std)]

//! Requencer engine — pure sequencer logic.
//!
//! Zero dependencies on DOM, audio, or any platform-specific APIs.
//! Targets both WASM (browser) and RP2350 (embedded).

pub mod arpeggiator;
pub mod clock_divider;
pub mod euclidean;
pub mod lfo;
pub mod math;
pub mod mutator;
pub mod randomizer;
pub mod rng;
pub mod routing;
pub mod scales;
pub mod types;
pub mod variation;

// ── Constants ───────────────────────────────────────────────────────

/// Maximum steps per subtrack.
pub const MAX_STEPS: usize = 16;

/// Number of sequencer tracks.
pub const NUM_TRACKS: usize = 4;

/// Number of CV/gate outputs.
pub const NUM_OUTPUTS: usize = 4;
