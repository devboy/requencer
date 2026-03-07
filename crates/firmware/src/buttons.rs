//! Button scanning via 5× daisy-chained 74HC165 shift registers.
//!
//! Generic over `embedded-hal` GPIO traits — the scanner works with any
//! OutputPin/InputPin implementation.
//!
//! 40 bits total: 16 step buttons + 24 function/control buttons.
//! Scanned at ~200 Hz with software debouncing.

use embedded_hal::digital::{InputPin, OutputPin};
use requencer_engine::input::ControlEvent;
use requencer_engine::ui_types::{Feature, HeldButton, UiSubtrack};

use crate::pins;

/// Debounce history depth (4 identical reads @ 5ms = 20ms debounce).
const DEBOUNCE_COUNT: u8 = 4;

/// Hold threshold in scan ticks (100 × 5ms = 500ms).
const HOLD_THRESHOLD_TICKS: u32 = 100;

/// Button bit positions in the 40-bit shift register word.
pub mod bit {
    pub const STEP_BASE: usize = 0;
    pub const TRACK_BASE: usize = 16;
    pub const SUBTRACK_BASE: usize = 20;
    pub const MUTE: usize = 24;
    pub const ROUTE: usize = 25;
    pub const DRIFT: usize = 26;
    pub const XPOSE: usize = 27;
    pub const VAR: usize = 28;
    pub const PLAY: usize = 29;
    pub const RESET: usize = 30;
    pub const PAT: usize = 31;
    pub const BACK: usize = 32;
    pub const RAND: usize = 33;
    pub const CLR: usize = 34;
    pub const SETTINGS: usize = 35;
}

/// Map a shift register bit index to a ControlEvent (for press).
pub fn map_button(bit_idx: usize) -> Option<ControlEvent> {
    match bit_idx {
        i if i >= bit::STEP_BASE && i < bit::STEP_BASE + 16 => {
            Some(ControlEvent::StepPress {
                step: (i - bit::STEP_BASE) as u8,
            })
        }
        i if i >= bit::TRACK_BASE && i < bit::TRACK_BASE + 4 => {
            Some(ControlEvent::TrackSelect {
                track: (i - bit::TRACK_BASE) as u8,
            })
        }
        i if i >= bit::SUBTRACK_BASE && i < bit::SUBTRACK_BASE + 4 => {
            let sub = match i - bit::SUBTRACK_BASE {
                0 => UiSubtrack::Gate,
                1 => UiSubtrack::Pitch,
                2 => UiSubtrack::Velocity,
                _ => UiSubtrack::Mod,
            };
            Some(ControlEvent::SubtrackSelect { subtrack: sub })
        }
        bit::MUTE => Some(ControlEvent::FeaturePress { feature: Feature::Mute }),
        bit::ROUTE => Some(ControlEvent::FeaturePress { feature: Feature::Route }),
        bit::DRIFT => Some(ControlEvent::FeaturePress { feature: Feature::Mutate }),
        bit::XPOSE => Some(ControlEvent::FeaturePress { feature: Feature::Transpose }),
        bit::VAR => Some(ControlEvent::FeaturePress { feature: Feature::Variation }),
        bit::PLAY => Some(ControlEvent::PlayStop),
        bit::RESET => Some(ControlEvent::Reset),
        bit::PAT => Some(ControlEvent::PatternPress),
        bit::BACK => Some(ControlEvent::Back),
        bit::RAND => Some(ControlEvent::FeaturePress { feature: Feature::Rand }),
        bit::CLR => Some(ControlEvent::ClrPress),
        bit::SETTINGS => Some(ControlEvent::SettingsPress),
        _ => None,
    }
}

/// Map a bit index to a HeldButton for hold events.
fn map_hold_button(bit_idx: usize) -> Option<HeldButton> {
    match bit_idx {
        i if i >= bit::STEP_BASE && i < bit::STEP_BASE + 16 => {
            Some(HeldButton::Step((i - bit::STEP_BASE) as u8))
        }
        i if i >= bit::TRACK_BASE && i < bit::TRACK_BASE + 4 => {
            Some(HeldButton::Track((i - bit::TRACK_BASE) as u8))
        }
        i if i >= bit::SUBTRACK_BASE && i < bit::SUBTRACK_BASE + 4 => {
            let sub = match i - bit::SUBTRACK_BASE {
                0 => UiSubtrack::Gate,
                1 => UiSubtrack::Pitch,
                2 => UiSubtrack::Velocity,
                _ => UiSubtrack::Mod,
            };
            Some(HeldButton::Subtrack(sub))
        }
        bit::MUTE => Some(HeldButton::Feature(Feature::Mute)),
        bit::ROUTE => Some(HeldButton::Feature(Feature::Route)),
        bit::DRIFT => Some(HeldButton::Feature(Feature::Mutate)),
        bit::XPOSE => Some(HeldButton::Feature(Feature::Transpose)),
        bit::VAR => Some(HeldButton::Feature(Feature::Variation)),
        _ => None,
    }
}

/// Button scanner, generic over GPIO pins.
pub struct ButtonScanner<CLK, LATCH, DATA> {
    clk: CLK,
    latch: LATCH,
    data: DATA,
    prev_state: u64,
    debounce_hist: [u64; DEBOUNCE_COUNT as usize],
    debounce_idx: usize,
    hold_button: Option<usize>,
    hold_ticks: u32,
    hold_sent: bool,
}

impl<CLK, LATCH, DATA> ButtonScanner<CLK, LATCH, DATA>
where
    CLK: OutputPin,
    LATCH: OutputPin,
    DATA: InputPin,
{
    pub fn new(clk: CLK, latch: LATCH, data: DATA) -> Self {
        Self {
            clk,
            latch,
            data,
            prev_state: 0,
            debounce_hist: [0; DEBOUNCE_COUNT as usize],
            debounce_idx: 0,
            hold_button: None,
            hold_ticks: 0,
            hold_sent: false,
        }
    }

    /// Latch and shift in all 40 bits from the 74HC165 chain.
    pub fn scan_raw(&mut self) -> u64 {
        // Latch: pulse SH/LD low
        let _ = self.latch.set_low();
        gpio_delay();
        let _ = self.latch.set_high();

        let mut result: u64 = 0;
        for i in 0..pins::SHIFT_REG_BITS {
            let bit_val = if self.data.is_high().unwrap_or(false) {
                1u64
            } else {
                0u64
            };
            result |= bit_val << (pins::SHIFT_REG_BITS - 1 - i);

            let _ = self.clk.set_high();
            gpio_delay();
            let _ = self.clk.set_low();
        }
        result
    }

    /// Scan buttons with debouncing. Returns a list of events (up to 8).
    pub fn scan(&mut self) -> heapless::Vec<ControlEvent, 8> {
        let raw = self.scan_raw();

        self.debounce_hist[self.debounce_idx] = raw;
        self.debounce_idx = (self.debounce_idx + 1) % DEBOUNCE_COUNT as usize;

        let debounced = self.debounce_hist.iter().fold(!0u64, |acc, &x| acc & x);
        let pressed = debounced & !self.prev_state;
        let released = !debounced & self.prev_state;

        let mut events = heapless::Vec::new();

        // Hold detection (tick-based, no timer dependency)
        if self.hold_button.is_some() {
            self.hold_ticks += 1;
            if !self.hold_sent && self.hold_ticks >= HOLD_THRESHOLD_TICKS {
                if let Some(bit_idx) = self.hold_button {
                    if let Some(button) = map_hold_button(bit_idx) {
                        let _ = events.push(ControlEvent::HoldStart { button });
                    }
                }
                self.hold_sent = true;
            }
        }

        if released != 0 {
            if self.hold_sent {
                let _ = events.push(ControlEvent::HoldEnd);
            }
            self.hold_button = None;
            self.hold_ticks = 0;
            self.hold_sent = false;
        }

        for i in 0..pins::SHIFT_REG_BITS {
            if pressed & (1u64 << i) != 0 {
                if let Some(ev) = map_button(i) {
                    let _ = events.push(ev);
                }
                self.hold_button = Some(i);
                self.hold_ticks = 0;
                self.hold_sent = false;
            }
        }

        self.prev_state = debounced;
        events
    }
}

/// GPIO timing delay (~13ns at 150MHz). No-op on non-ARM targets.
#[inline(always)]
fn gpio_delay() {
    #[cfg(target_arch = "arm")]
    unsafe {
        core::arch::asm!("nop", "nop");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use embedded_hal_mock::eh1::digital::{Mock as PinMock, State, Transaction as PinTx};

    #[test]
    fn map_button_step_0() {
        assert!(matches!(
            map_button(0),
            Some(ControlEvent::StepPress { step: 0 })
        ));
    }

    #[test]
    fn map_button_step_15() {
        assert!(matches!(
            map_button(15),
            Some(ControlEvent::StepPress { step: 15 })
        ));
    }

    #[test]
    fn map_button_track_select() {
        assert!(matches!(
            map_button(16),
            Some(ControlEvent::TrackSelect { track: 0 })
        ));
        assert!(matches!(
            map_button(19),
            Some(ControlEvent::TrackSelect { track: 3 })
        ));
    }

    #[test]
    fn map_button_subtrack() {
        assert!(matches!(
            map_button(20),
            Some(ControlEvent::SubtrackSelect {
                subtrack: UiSubtrack::Gate
            })
        ));
        assert!(matches!(
            map_button(23),
            Some(ControlEvent::SubtrackSelect {
                subtrack: UiSubtrack::Mod
            })
        ));
    }

    #[test]
    fn map_button_features() {
        assert!(matches!(
            map_button(bit::MUTE),
            Some(ControlEvent::FeaturePress {
                feature: Feature::Mute
            })
        ));
        assert!(matches!(map_button(bit::PLAY), Some(ControlEvent::PlayStop)));
        assert!(matches!(
            map_button(bit::SETTINGS),
            Some(ControlEvent::SettingsPress)
        ));
    }

    #[test]
    fn map_button_unmapped_returns_none() {
        assert!(map_button(36).is_none());
        assert!(map_button(39).is_none());
    }

    #[test]
    fn scanner_scan_raw_reads_40_bits() {
        // Set up mock: latch low→high, then 40 clock cycles reading data
        let latch_txns = vec![PinTx::set(State::Low), PinTx::set(State::High)];
        let mut clk_txns = Vec::new();
        let mut data_txns = Vec::new();

        // Simulate bit pattern: step 0 pressed (MSB first, bit 39 first)
        for i in 0..40 {
            let bit_pos = 39 - i;
            let state = if bit_pos == 0 { State::High } else { State::Low };
            data_txns.push(PinTx::get(state));
            clk_txns.push(PinTx::set(State::High));
            clk_txns.push(PinTx::set(State::Low));
        }

        let clk = PinMock::new(&clk_txns);
        let latch = PinMock::new(&latch_txns);
        let data = PinMock::new(&data_txns);

        let mut scanner = ButtonScanner::new(clk, latch, data);
        let result = scanner.scan_raw();

        assert_eq!(result & 1, 1, "bit 0 (step 0) should be set");
        assert_eq!(result >> 1, 0, "all other bits should be 0");

        scanner.clk.done();
        scanner.latch.done();
        scanner.data.done();
    }

    #[test]
    fn hold_button_mapping() {
        assert!(matches!(map_hold_button(0), Some(HeldButton::Step(0))));
        assert!(matches!(map_hold_button(16), Some(HeldButton::Track(0))));
        assert!(matches!(
            map_hold_button(bit::MUTE),
            Some(HeldButton::Feature(Feature::Mute))
        ));
        assert!(map_hold_button(bit::PLAY).is_none()); // transport buttons don't hold
    }
}
