//! Input event types for the mode machine.
//!
//! These map 1:1 to the hardware controls (encoders, buttons, step pads)
//! and are the same events used via WASM from browser key/button handlers.

use crate::ui_types::{Feature, HeldButton, UiSubtrack};

/// A control event from the hardware or browser UI.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ControlEvent {
    EncoderATurn { delta: i32 },
    EncoderAPush,
    EncoderBTurn { delta: i32 },
    EncoderBPush,
    Back,
    PlayStop,
    Reset,
    TrackSelect { track: u8 },
    SubtrackSelect { subtrack: UiSubtrack },
    FeaturePress { feature: Feature },
    StepPress { step: u8 },
    HoldStart { button: HeldButton },
    HoldEnd,
    SettingsPress,
    ClrPress,
    PatternPress,
    MidiNoteOn { channel: u8, note: u8, velocity: u8 },
    MidiNoteOff { channel: u8, note: u8 },
}
