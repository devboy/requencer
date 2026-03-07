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

use embassy_rp::gpio::{Input, Output};
use requencer_engine::input::ControlEvent;
use requencer_engine::ui_types::{Feature, HeldButton, UiSubtrack};

const NUM_BITS: usize = 40;
/// Number of consecutive identical reads for debounce (~20ms at 200Hz = 4 reads).
const DEBOUNCE_COUNT: u8 = 4;
/// Hold threshold in scan cycles (~200Hz). 400ms = 80 cycles.
const HOLD_THRESHOLD: u16 = 80;

/// Raw button state with debounce tracking.
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
        // Latch: pull SH/LD low to capture parallel inputs
        self.latch.set_low();
        cortex_m::asm::delay(10); // ~67ns at 150MHz — well within 74HC165 spec
        self.latch.set_high();
        cortex_m::asm::delay(10);

        let mut result: u64 = 0;
        for i in 0..NUM_BITS {
            // Read data bit (MSB first from daisy chain)
            if self.data.is_high() {
                result |= 1u64 << (NUM_BITS - 1 - i);
            }
            // Clock pulse
            self.clk.set_high();
            cortex_m::asm::delay(10);
            self.clk.set_low();
            cortex_m::asm::delay(10);
        }
        result
    }

    /// Perform one scan cycle. Returns a list of events (up to 8 per scan).
    /// Call this at ~200 Hz (every 5ms).
    pub fn scan(&mut self, events: &mut heapless::Vec<ControlEvent, 8>) {
        let raw = self.read_raw();

        // Store in debounce history
        self.raw_history[self.history_idx] = raw;
        self.history_idx = (self.history_idx + 1) % DEBOUNCE_COUNT as usize;

        // A bit is considered stable if all history entries agree
        let mut stable_high: u64 = !0;
        let mut stable_low: u64 = !0;
        for &h in &self.raw_history {
            stable_high &= h;
            stable_low &= !h;
        }

        let prev = self.debounced;
        // Update debounced: set bits that are stably high, clear bits that are stably low
        self.debounced = (self.debounced | stable_high) & !stable_low;

        let pressed = self.debounced & !prev; // rising edges
        let released = prev & !self.debounced; // falling edges

        // Process releases (and hold ends)
        for bit in 0..NUM_BITS {
            if released & (1u64 << bit) != 0 {
                if self.hold_emitted[bit] {
                    let _ = events.push(ControlEvent::HoldEnd);
                }
                self.hold_counter[bit] = 0;
                self.hold_emitted[bit] = false;
            }
        }

        // Process presses
        for bit in 0..NUM_BITS {
            if pressed & (1u64 << bit) != 0 {
                if let Some(ev) = bit_to_event(bit) {
                    let _ = events.push(ev);
                }
                self.hold_counter[bit] = 0;
                self.hold_emitted[bit] = false;
            }
        }

        // Process holds (for currently-pressed buttons)
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

/// Map a shift register bit position to a ControlEvent for press.
fn bit_to_event(bit: usize) -> Option<ControlEvent> {
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
fn bit_to_held_button(bit: usize) -> Option<HeldButton> {
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
