//! Button scanning via 5× daisy-chained 74HC165D shift registers.
//!
//! 40 bits total, scanned at ~200 Hz with debounce.
//! Scan: pull GP9 (SH/LD) low to latch, then clock 40 bits out via GP8/GP10.
//!
//! Bit mapping (74HC165 shifts D7 first; chain SR1→SR2→SR3→SR4→SR5,
//! MCU reads SR5.QH. After read, SR1.D0=bit0, SR5.D7=bit39):
//!   SR1 (0-7):   Step 1-8 (D0-D7)
//!   SR2 (8-15):  Step 9-16 (D0-D7)
//!   SR3 (16-23): T1-T4 (D0-D3), Settings, Back, Rand, Clr (D4-D7)
//!   SR4 (24-31): Gate, Pitch, Vel, Mod (D0-D3), Pat, Mute, Route, Drift (D4-D7)
//!   SR5 (32-39): Xpose, Var, Play, Reset (D0-D3), 4× spare (D4-D7, tied VCC)

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

impl Default for DebounceState {
    fn default() -> Self {
        Self::new()
    }
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
///
/// Bit positions match hardware wiring in button-scan.ato:
///   SR1 D0-D7 = bits 0-7:   Step 1-8
///   SR2 D0-D7 = bits 8-15:  Step 9-16
///   SR3 D0-D3 = bits 16-19: T1-T4
///   SR3 D4-D7 = bits 20-23: Settings, Back, Rand, Clr
///   SR4 D0-D3 = bits 24-27: Gate, Pitch, Vel, Mod
///   SR4 D4-D7 = bits 28-31: Pat, Mute, Route, Drift
///   SR5 D0-D3 = bits 32-35: Xpose, Var, Play, Reset
///   SR5 D4-D7 = bits 36-39: spare (VCC)
pub fn bit_to_event(bit: usize) -> Option<ControlEvent> {
    match bit {
        // SR1: Step buttons 1-8 (bits 0-7)
        0..=15 => Some(ControlEvent::StepPress { step: bit as u8 }),
        // SR3 D0-D3: Track T1-T4 (bits 16-19)
        16..=19 => Some(ControlEvent::TrackSelect {
            track: (bit - 16) as u8,
        }),
        // SR3 D4-D7: Settings, Back, Rand, Clr (bits 20-23)
        20 => Some(ControlEvent::SettingsPress),
        21 => Some(ControlEvent::Back),
        22 => Some(ControlEvent::FeaturePress {
            feature: Feature::Rand,
        }),
        23 => Some(ControlEvent::ClrPress),
        // SR4 D0-D3: Subtrack Gate/Pitch/Vel/Mod (bits 24-27)
        24 => Some(ControlEvent::SubtrackSelect {
            subtrack: UiSubtrack::Gate,
        }),
        25 => Some(ControlEvent::SubtrackSelect {
            subtrack: UiSubtrack::Pitch,
        }),
        26 => Some(ControlEvent::SubtrackSelect {
            subtrack: UiSubtrack::Velocity,
        }),
        27 => Some(ControlEvent::SubtrackSelect {
            subtrack: UiSubtrack::Mod,
        }),
        // SR4 D4-D7: Pat, Mute, Route, Drift (bits 28-31)
        28 => Some(ControlEvent::PatternPress),
        29 => Some(ControlEvent::FeaturePress {
            feature: Feature::Mute,
        }),
        30 => Some(ControlEvent::FeaturePress {
            feature: Feature::Route,
        }),
        31 => Some(ControlEvent::FeaturePress {
            feature: Feature::Mutate,
        }),
        // SR5 D0-D3: Xpose, Var, Play, Reset (bits 32-35)
        32 => Some(ControlEvent::FeaturePress {
            feature: Feature::Transpose,
        }),
        33 => Some(ControlEvent::FeaturePress {
            feature: Feature::Variation,
        }),
        34 => Some(ControlEvent::PlayStop),
        35 => Some(ControlEvent::Reset),
        // SR5 D4-D7: spare (bits 36-39)
        _ => None,
    }
}

/// Map a shift register bit to a HeldButton for hold detection.
pub fn bit_to_held_button(bit: usize) -> Option<HeldButton> {
    match bit {
        0..=15 => Some(HeldButton::Step(bit as u8)),
        16..=19 => Some(HeldButton::Track((bit - 16) as u8)),
        // Subtrack hold (bits 24-27)
        24 => Some(HeldButton::Subtrack(UiSubtrack::Gate)),
        25 => Some(HeldButton::Subtrack(UiSubtrack::Pitch)),
        26 => Some(HeldButton::Subtrack(UiSubtrack::Velocity)),
        27 => Some(HeldButton::Subtrack(UiSubtrack::Mod)),
        // Feature hold (bits 29-33)
        29 => Some(HeldButton::Feature(Feature::Mute)),
        30 => Some(HeldButton::Feature(Feature::Route)),
        31 => Some(HeldButton::Feature(Feature::Mutate)),
        32 => Some(HeldButton::Feature(Feature::Transpose)),
        33 => Some(HeldButton::Feature(Feature::Variation)),
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
    fn settings_and_back() {
        match bit_to_event(20) {
            Some(ControlEvent::SettingsPress) => {}
            other => panic!("bit 20 expected SettingsPress, got {:?}", other),
        }
        match bit_to_event(21) {
            Some(ControlEvent::Back) => {}
            other => panic!("bit 21 expected Back, got {:?}", other),
        }
    }

    #[test]
    fn rand_and_clear() {
        match bit_to_event(22) {
            Some(ControlEvent::FeaturePress { feature: Feature::Rand }) => {}
            other => panic!("bit 22 expected Rand, got {:?}", other),
        }
        match bit_to_event(23) {
            Some(ControlEvent::ClrPress) => {}
            other => panic!("bit 23 expected ClrPress, got {:?}", other),
        }
    }

    #[test]
    fn subtrack_gate() {
        match bit_to_event(24) {
            Some(ControlEvent::SubtrackSelect { subtrack: UiSubtrack::Gate }) => {}
            other => panic!("bit 24 expected Gate, got {:?}", other),
        }
    }

    #[test]
    fn subtrack_pitch() {
        match bit_to_event(25) {
            Some(ControlEvent::SubtrackSelect { subtrack: UiSubtrack::Pitch }) => {}
            other => panic!("bit 25 expected Pitch, got {:?}", other),
        }
    }

    #[test]
    fn subtrack_velocity() {
        match bit_to_event(26) {
            Some(ControlEvent::SubtrackSelect { subtrack: UiSubtrack::Velocity }) => {}
            other => panic!("bit 26 expected Velocity, got {:?}", other),
        }
    }

    #[test]
    fn subtrack_mod() {
        match bit_to_event(27) {
            Some(ControlEvent::SubtrackSelect { subtrack: UiSubtrack::Mod }) => {}
            other => panic!("bit 27 expected Mod, got {:?}", other),
        }
    }

    #[test]
    fn pattern_press() {
        match bit_to_event(28) {
            Some(ControlEvent::PatternPress) => {}
            other => panic!("bit 28 expected PatternPress, got {:?}", other),
        }
    }

    #[test]
    fn feature_buttons() {
        let expected = [
            (29, Feature::Mute),
            (30, Feature::Route),
            (31, Feature::Mutate),
            (32, Feature::Transpose),
            (33, Feature::Variation),
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
        match bit_to_event(34) {
            Some(ControlEvent::PlayStop) => {}
            other => panic!("bit 34 expected PlayStop, got {:?}", other),
        }
        match bit_to_event(35) {
            Some(ControlEvent::Reset) => {}
            other => panic!("bit 35 expected Reset, got {:?}", other),
        }
    }

    #[test]
    fn spare_bits_return_none() {
        for bit in 36..NUM_BITS {
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
        assert!(matches!(bit_to_held_button(24), Some(HeldButton::Subtrack(UiSubtrack::Gate))));
        assert!(matches!(bit_to_held_button(25), Some(HeldButton::Subtrack(UiSubtrack::Pitch))));
        assert!(matches!(bit_to_held_button(26), Some(HeldButton::Subtrack(UiSubtrack::Velocity))));
        assert!(matches!(bit_to_held_button(27), Some(HeldButton::Subtrack(UiSubtrack::Mod))));
    }

    #[test]
    fn held_pattern_is_none() {
        // bit 28 (PAT) has no HeldButton
        assert!(bit_to_held_button(28).is_none());
    }

    #[test]
    fn held_feature_buttons() {
        assert!(matches!(bit_to_held_button(29), Some(HeldButton::Feature(Feature::Mute))));
        assert!(matches!(bit_to_held_button(30), Some(HeldButton::Feature(Feature::Route))));
        assert!(matches!(bit_to_held_button(31), Some(HeldButton::Feature(Feature::Mutate))));
        assert!(matches!(bit_to_held_button(32), Some(HeldButton::Feature(Feature::Transpose))));
        assert!(matches!(bit_to_held_button(33), Some(HeldButton::Feature(Feature::Variation))));
    }

    #[test]
    fn held_transport_is_none() {
        // PLAY and RESET don't have hold behavior
        assert!(bit_to_held_button(34).is_none());
        assert!(bit_to_held_button(35).is_none());
    }

    #[test]
    fn held_settings_back_rand_clr_is_none() {
        // Settings/Back/Rand/Clr don't have hold behavior
        assert!(bit_to_held_button(20).is_none());
        assert!(bit_to_held_button(21).is_none());
        assert!(bit_to_held_button(22).is_none());
        assert!(bit_to_held_button(23).is_none());
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
