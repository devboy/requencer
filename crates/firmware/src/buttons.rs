//! Button scanning via 5× daisy-chained 74HC165D shift registers.
//!
//! 40 bits total, scanned at ~200 Hz with debounce.
//! Scan: pull GP9 (SH/LD) low to latch, then clock 40 bits out via GP8/GP10.
//!
//! Bit mapping:
//!   SR1 (0-7):   Step buttons 1-8
//!   SR2 (8-15):  Step buttons 9-16
//!   SR3 (16-23): Track T1-T4, Subtrack GATE/PITCH/VEL/MOD
//!   SR4 (24-31): PAT, MUTE, ROUTE, DRIFT, XPOSE, VAR, PLAY, RESET
//!   SR5 (32-39): SETTINGS, TBD, 6× spare

#[cfg(target_os = "none")]
use embassy_rp::gpio::{Input, Output};
use requencer_engine::input::ControlEvent;
use requencer_engine::ui_types::{Feature, HeldButton, UiSubtrack};

pub const NUM_BITS: usize = 40;
/// Number of consecutive identical reads for debounce (~20ms at 200Hz = 4 reads).
pub const DEBOUNCE_COUNT: u8 = 4;
/// Hold threshold in scan cycles (~200Hz). 400ms = 80 cycles.
pub const HOLD_THRESHOLD: u16 = 80;

/// Raw button state with debounce tracking.
#[cfg(target_os = "none")]
pub struct ButtonScanner<'a> {
    clk: Output<'a>,
    latch: Output<'a>,
    data: Input<'a>,
    /// Debounced state (1 = pressed).
    debounced: u64,
    /// Previous raw readings for debounce.
    raw_history: [u64; DEBOUNCE_COUNT as usize],
    history_idx: usize,
    /// How many cycles each button has been held down.
    hold_counter: [u16; NUM_BITS],
    /// Whether we've already emitted a HoldStart for this press.
    hold_emitted: [bool; NUM_BITS],
}

#[cfg(target_os = "none")]
impl<'a> ButtonScanner<'a> {
    pub fn new(clk: Output<'a>, latch: Output<'a>, data: Input<'a>) -> Self {
        Self {
            clk,
            latch,
            data,
            debounced: 0,
            raw_history: [0; DEBOUNCE_COUNT as usize],
            history_idx: 0,
            hold_counter: [0; NUM_BITS],
            hold_emitted: [false; NUM_BITS],
        }
    }

    /// Latch and read 40 bits from the shift register chain.
    fn read_raw(&mut self) -> u64 {
        self.latch.set_low();
        cortex_m::asm::delay(10);
        self.latch.set_high();
        cortex_m::asm::delay(10);

        let mut result: u64 = 0;
        for i in 0..NUM_BITS {
            if self.data.is_high() {
                result |= 1u64 << (NUM_BITS - 1 - i);
            }
            self.clk.set_high();
            cortex_m::asm::delay(10);
            self.clk.set_low();
            cortex_m::asm::delay(10);
        }
        result
    }

    pub fn scan(&mut self, events: &mut heapless::Vec<ControlEvent, 8>) {
        let raw = self.read_raw();
        self.raw_history[self.history_idx] = raw;
        self.history_idx = (self.history_idx + 1) % DEBOUNCE_COUNT as usize;

        let mut stable_high: u64 = !0;
        let mut stable_low: u64 = !0;
        for &h in &self.raw_history {
            stable_high &= h;
            stable_low &= !h;
        }

        let prev = self.debounced;
        self.debounced = (self.debounced | stable_high) & !stable_low;

        let pressed = self.debounced & !prev;
        let released = prev & !self.debounced;

        for bit in 0..NUM_BITS {
            if released & (1u64 << bit) != 0 {
                if self.hold_emitted[bit] {
                    let _ = events.push(ControlEvent::HoldEnd);
                }
                self.hold_counter[bit] = 0;
                self.hold_emitted[bit] = false;
            }
        }

        for bit in 0..NUM_BITS {
            if pressed & (1u64 << bit) != 0 {
                if let Some(ev) = bit_to_event(bit) {
                    let _ = events.push(ev);
                }
                self.hold_counter[bit] = 0;
                self.hold_emitted[bit] = false;
            }
        }

        for bit in 0..NUM_BITS {
            if self.debounced & (1u64 << bit) != 0 && !self.hold_emitted[bit] {
                self.hold_counter[bit] = self.hold_counter[bit].saturating_add(1);
                if self.hold_counter[bit] >= HOLD_THRESHOLD {
                    if let Some(held) = bit_to_held_button(bit) {
                        let _ = events.push(ControlEvent::HoldStart { button: held });
                        self.hold_emitted[bit] = true;
                    }
                }
            }
        }
    }
}

/// Debounce state machine (pure logic, no hardware).
/// Computes stable high/low from a ring buffer of raw readings.
pub struct DebounceState {
    pub debounced: u64,
    pub raw_history: [u64; DEBOUNCE_COUNT as usize],
    pub history_idx: usize,
    pub hold_counter: [u16; NUM_BITS],
    pub hold_emitted: [bool; NUM_BITS],
}

impl DebounceState {
    pub fn new() -> Self {
        Self {
            debounced: 0,
            raw_history: [0; DEBOUNCE_COUNT as usize],
            history_idx: 0,
            hold_counter: [0; NUM_BITS],
            hold_emitted: [false; NUM_BITS],
        }
    }

    /// Process a raw reading and return (pressed_mask, released_mask).
    pub fn process(&mut self, raw: u64) -> (u64, u64) {
        self.raw_history[self.history_idx] = raw;
        self.history_idx = (self.history_idx + 1) % DEBOUNCE_COUNT as usize;

        let mut stable_high: u64 = !0;
        let mut stable_low: u64 = !0;
        for &h in &self.raw_history {
            stable_high &= h;
            stable_low &= !h;
        }

        let prev = self.debounced;
        self.debounced = (self.debounced | stable_high) & !stable_low;

        let pressed = self.debounced & !prev;
        let released = prev & !self.debounced;
        (pressed, released)
    }
}

/// Map a shift register bit position to a ControlEvent for press.
pub fn bit_to_event(bit: usize) -> Option<ControlEvent> {
    match bit {
        // Step buttons 1-16 (bits 0-15)
        0..=15 => Some(ControlEvent::StepPress { step: bit as u8 }),
        // Track T1-T4 (bits 16-19)
        16..=19 => Some(ControlEvent::TrackSelect {
            track: (bit - 16) as u8,
        }),
        // Subtrack GATE/PITCH/VEL/MOD (bits 20-23)
        20 => Some(ControlEvent::SubtrackSelect {
            subtrack: UiSubtrack::Gate,
        }),
        21 => Some(ControlEvent::SubtrackSelect {
            subtrack: UiSubtrack::Pitch,
        }),
        22 => Some(ControlEvent::SubtrackSelect {
            subtrack: UiSubtrack::Velocity,
        }),
        23 => Some(ControlEvent::SubtrackSelect {
            subtrack: UiSubtrack::Mod,
        }),
        // Feature buttons (bits 24-29)
        24 => Some(ControlEvent::PatternPress),
        25 => Some(ControlEvent::FeaturePress {
            feature: Feature::Mute,
        }),
        26 => Some(ControlEvent::FeaturePress {
            feature: Feature::Route,
        }),
        27 => Some(ControlEvent::FeaturePress {
            feature: Feature::Mutate,
        }),
        28 => Some(ControlEvent::FeaturePress {
            feature: Feature::Transpose,
        }),
        29 => Some(ControlEvent::FeaturePress {
            feature: Feature::Variation,
        }),
        // Transport (bits 30-31)
        30 => Some(ControlEvent::PlayStop),
        31 => Some(ControlEvent::Reset),
        // SR5 (bits 32-39)
        32 => Some(ControlEvent::SettingsPress),
        33 => Some(ControlEvent::Back), // TBD button → Back
        _ => None,
    }
}

/// Map a shift register bit to a HeldButton for hold detection.
pub fn bit_to_held_button(bit: usize) -> Option<HeldButton> {
    match bit {
        0..=15 => Some(HeldButton::Step(bit as u8)),
        16..=19 => Some(HeldButton::Track((bit - 16) as u8)),
        20 => Some(HeldButton::Subtrack(UiSubtrack::Gate)),
        21 => Some(HeldButton::Subtrack(UiSubtrack::Pitch)),
        22 => Some(HeldButton::Subtrack(UiSubtrack::Velocity)),
        23 => Some(HeldButton::Subtrack(UiSubtrack::Mod)),
        25 => Some(HeldButton::Feature(Feature::Mute)),
        26 => Some(HeldButton::Feature(Feature::Route)),
        27 => Some(HeldButton::Feature(Feature::Mutate)),
        28 => Some(HeldButton::Feature(Feature::Transpose)),
        29 => Some(HeldButton::Feature(Feature::Variation)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── bit_to_event tests ────────────────────────────────────────────

    #[test]
    fn step_buttons_0_to_15() {
        for i in 0..16 {
            match bit_to_event(i) {
                Some(ControlEvent::StepPress { step }) => assert_eq!(step, i as u8),
                other => panic!("bit {} expected StepPress({}), got {:?}", i, i, other),
            }
        }
    }

    #[test]
    fn track_select_16_to_19() {
        for i in 16..20 {
            match bit_to_event(i) {
                Some(ControlEvent::TrackSelect { track }) => {
                    assert_eq!(track, (i - 16) as u8);
                }
                other => panic!("bit {} expected TrackSelect({}), got {:?}", i, i - 16, other),
            }
        }
    }

    #[test]
    fn subtrack_gate() {
        match bit_to_event(20) {
            Some(ControlEvent::SubtrackSelect { subtrack: UiSubtrack::Gate }) => {}
            other => panic!("bit 20 expected Gate, got {:?}", other),
        }
    }

    #[test]
    fn subtrack_pitch() {
        match bit_to_event(21) {
            Some(ControlEvent::SubtrackSelect { subtrack: UiSubtrack::Pitch }) => {}
            other => panic!("bit 21 expected Pitch, got {:?}", other),
        }
    }

    #[test]
    fn subtrack_velocity() {
        match bit_to_event(22) {
            Some(ControlEvent::SubtrackSelect { subtrack: UiSubtrack::Velocity }) => {}
            other => panic!("bit 22 expected Velocity, got {:?}", other),
        }
    }

    #[test]
    fn subtrack_mod() {
        match bit_to_event(23) {
            Some(ControlEvent::SubtrackSelect { subtrack: UiSubtrack::Mod }) => {}
            other => panic!("bit 23 expected Mod, got {:?}", other),
        }
    }

    #[test]
    fn pattern_press() {
        match bit_to_event(24) {
            Some(ControlEvent::PatternPress) => {}
            other => panic!("bit 24 expected PatternPress, got {:?}", other),
        }
    }

    #[test]
    fn feature_buttons() {
        let expected = [
            (25, Feature::Mute),
            (26, Feature::Route),
            (27, Feature::Mutate),
            (28, Feature::Transpose),
            (29, Feature::Variation),
        ];
        for (bit, feature) in expected {
            match bit_to_event(bit) {
                Some(ControlEvent::FeaturePress { feature: f }) => {
                    assert_eq!(f, feature, "bit {} feature mismatch", bit);
                }
                other => panic!("bit {} expected FeaturePress({:?}), got {:?}", bit, feature, other),
            }
        }
    }

    #[test]
    fn transport_buttons() {
        match bit_to_event(30) {
            Some(ControlEvent::PlayStop) => {}
            other => panic!("bit 30 expected PlayStop, got {:?}", other),
        }
        match bit_to_event(31) {
            Some(ControlEvent::Reset) => {}
            other => panic!("bit 31 expected Reset, got {:?}", other),
        }
    }

    #[test]
    fn settings_and_back() {
        match bit_to_event(32) {
            Some(ControlEvent::SettingsPress) => {}
            other => panic!("bit 32 expected SettingsPress, got {:?}", other),
        }
        match bit_to_event(33) {
            Some(ControlEvent::Back) => {}
            other => panic!("bit 33 expected Back, got {:?}", other),
        }
    }

    #[test]
    fn spare_bits_return_none() {
        for bit in 34..NUM_BITS {
            assert!(bit_to_event(bit).is_none(), "bit {} should be None", bit);
        }
    }

    #[test]
    fn out_of_range_bits_return_none() {
        assert!(bit_to_event(40).is_none());
        assert!(bit_to_event(100).is_none());
    }

    // ── bit_to_held_button tests ──────────────────────────────────────

    #[test]
    fn held_step_buttons() {
        for i in 0..16 {
            match bit_to_held_button(i) {
                Some(HeldButton::Step(s)) => assert_eq!(s, i as u8),
                other => panic!("bit {} expected HeldButton::Step({}), got {:?}", i, i, other),
            }
        }
    }

    #[test]
    fn held_track_buttons() {
        for i in 16..20 {
            match bit_to_held_button(i) {
                Some(HeldButton::Track(t)) => assert_eq!(t, (i - 16) as u8),
                other => panic!("bit {} expected HeldButton::Track({}), got {:?}", i, i - 16, other),
            }
        }
    }

    #[test]
    fn held_subtrack_buttons() {
        assert!(matches!(bit_to_held_button(20), Some(HeldButton::Subtrack(UiSubtrack::Gate))));
        assert!(matches!(bit_to_held_button(21), Some(HeldButton::Subtrack(UiSubtrack::Pitch))));
        assert!(matches!(bit_to_held_button(22), Some(HeldButton::Subtrack(UiSubtrack::Velocity))));
        assert!(matches!(bit_to_held_button(23), Some(HeldButton::Subtrack(UiSubtrack::Mod))));
    }

    #[test]
    fn held_pattern_is_none() {
        // bit 24 (PAT) has no HeldButton
        assert!(bit_to_held_button(24).is_none());
    }

    #[test]
    fn held_feature_buttons() {
        assert!(matches!(bit_to_held_button(25), Some(HeldButton::Feature(Feature::Mute))));
        assert!(matches!(bit_to_held_button(26), Some(HeldButton::Feature(Feature::Route))));
        assert!(matches!(bit_to_held_button(27), Some(HeldButton::Feature(Feature::Mutate))));
        assert!(matches!(bit_to_held_button(28), Some(HeldButton::Feature(Feature::Transpose))));
        assert!(matches!(bit_to_held_button(29), Some(HeldButton::Feature(Feature::Variation))));
    }

    #[test]
    fn held_transport_is_none() {
        // PLAY and RESET don't have hold behavior
        assert!(bit_to_held_button(30).is_none());
        assert!(bit_to_held_button(31).is_none());
    }

    // ── Debounce state machine tests ──────────────────────────────────

    #[test]
    fn debounce_requires_consecutive_reads() {
        let mut state = DebounceState::new();

        // One reading is not enough
        let (pressed, _) = state.process(1);
        assert_eq!(pressed, 0);

        // Two readings
        let (pressed, _) = state.process(1);
        assert_eq!(pressed, 0);

        // Three readings
        let (pressed, _) = state.process(1);
        assert_eq!(pressed, 0);

        // Fourth reading — all 4 history slots agree
        let (pressed, _) = state.process(1);
        assert_eq!(pressed, 1); // bit 0 now pressed
    }

    #[test]
    fn debounce_rejects_bouncy_signal() {
        let mut state = DebounceState::new();

        // Bouncing: on, off, on, off
        state.process(1);
        state.process(0);
        state.process(1);
        let (pressed, _) = state.process(0);
        assert_eq!(pressed, 0); // never stable
    }

    #[test]
    fn debounce_release() {
        let mut state = DebounceState::new();

        // Press: 4 consecutive reads
        for _ in 0..4 {
            state.process(1);
        }
        assert_eq!(state.debounced, 1);

        // Release: 4 consecutive reads with bit cleared
        for i in 0..4 {
            let (_, released) = state.process(0);
            if i < 3 {
                assert_eq!(released, 0);
            } else {
                assert_eq!(released, 1); // released on 4th read
            }
        }
    }

    #[test]
    fn debounce_multiple_buttons() {
        let mut state = DebounceState::new();

        // Press bits 0 and 5 simultaneously
        for _ in 0..4 {
            state.process(0b100001);
        }
        assert_eq!(state.debounced & 1, 1);
        assert_eq!(state.debounced & (1 << 5), 1 << 5);
    }
}
