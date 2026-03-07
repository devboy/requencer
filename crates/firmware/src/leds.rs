//! TLC5947 LED driver chain — 5× daisy-chained, 120 channels (34 RGB LEDs × 3).
//!
//! GP11 = SIN (serial data), GP12 = SCLK (clock), GP13 = XLAT (latch), GP14 = BLANK.
//!
//! TLC5947: 24 channels × 12-bit PWM each. 5 chips = 120 channels = 1440 bits.
//! Clock out data MSB-first, then pulse XLAT to latch. BLANK controls output enable.
//!
//! Channel mapping:
//!   TLC1 (ch 0-23):  Step LEDs 1-8 (RGB) = ch 0-23
//!   TLC2 (ch 24-47): Step LEDs 9-16 (RGB) = ch 24-47
//!   TLC3 (ch 48-71): Track T1-T4 + Subtrack GATE/PITCH/VEL/MOD (RGB)
//!   TLC4 (ch 72-95): Function buttons PAT/MUTE/ROUTE/DRIFT/XPOSE/VAR/PLAY/RESET (RGB)
//!   TLC5 (ch 96-119): SETTINGS + TBD + spare

use embassy_rp::gpio::Output;
use requencer_engine::ui_types::{LedMode, LedState};

const NUM_CHANNELS: usize = 120;
/// 12-bit max brightness.
const MAX_BRIGHTNESS: u16 = 4095;
const DIM_BRIGHTNESS: u16 = 512;

/// LED driver handle.
pub struct LedDriver<'a> {
    sin: Output<'a>,
    sclk: Output<'a>,
    xlat: Output<'a>,
    blank: Output<'a>,
    /// 12-bit PWM values for all 120 channels.
    channels: [u16; NUM_CHANNELS],
    /// Flash toggle state (toggled at ~4Hz for flashing LEDs).
    flash_on: bool,
    flash_counter: u8,
}

/// RGB color for an LED.
struct Rgb {
    r: u16,
    g: u16,
    b: u16,
}

/// Track colors (matching the web UI).
const TRACK_COLORS: [Rgb; 4] = [
    Rgb { r: 4095, g: 0, b: 800 },     // Track 1: red-ish
    Rgb { r: 0, g: 4095, b: 400 },     // Track 2: green
    Rgb { r: 0, g: 800, b: 4095 },     // Track 3: blue
    Rgb { r: 4095, g: 2048, b: 0 },    // Track 4: orange
];

const OFF: Rgb = Rgb { r: 0, g: 0, b: 0 };

impl<'a> LedDriver<'a> {
    pub fn new(
        sin: Output<'a>,
        sclk: Output<'a>,
        xlat: Output<'a>,
        blank: Output<'a>,
    ) -> Self {
        Self {
            sin,
            sclk,
            xlat,
            blank,
            channels: [0; NUM_CHANNELS],
            flash_on: false,
            flash_counter: 0,
        }
    }

    /// Initialize: enable outputs (BLANK low).
    pub fn init(&mut self) {
        self.blank.set_low(); // Output enable
        self.update_hardware();
    }

    /// Update LED state from the engine's LedState.
    /// selected_track: 0-3, used for step LED color.
    pub fn update(&mut self, led_state: &LedState, selected_track: u8) {
        // Toggle flash at ~4Hz (called at ~30Hz, so toggle every 8 calls)
        self.flash_counter = self.flash_counter.wrapping_add(1);
        if self.flash_counter >= 8 {
            self.flash_counter = 0;
            self.flash_on = !self.flash_on;
        }

        // Clear all channels
        self.channels = [0; NUM_CHANNELS];

        let track_color = &TRACK_COLORS[selected_track.min(3) as usize];

        // Step LEDs (16 steps × RGB, channels 0-47)
        for i in 0..16usize {
            let rgb_base = i * 3; // channels 0-47
            let color = match led_state.steps[i] {
                LedMode::On => Rgb {
                    r: track_color.r,
                    g: track_color.g,
                    b: track_color.b,
                },
                LedMode::Dim => Rgb {
                    r: track_color.r / 8,
                    g: track_color.g / 8,
                    b: track_color.b / 8,
                },
                LedMode::Flash => {
                    if self.flash_on {
                        Rgb {
                            r: track_color.r,
                            g: track_color.g,
                            b: track_color.b,
                        }
                    } else {
                        OFF
                    }
                }
                LedMode::Off => OFF,
            };
            self.channels[rgb_base] = color.r;
            self.channels[rgb_base + 1] = color.g;
            self.channels[rgb_base + 2] = color.b;
        }

        // Track LEDs (4 tracks × RGB, channels 48-59)
        for i in 0..4usize {
            let rgb_base = 48 + i * 3;
            if led_state.tracks[i] {
                self.channels[rgb_base] = TRACK_COLORS[i].r;
                self.channels[rgb_base + 1] = TRACK_COLORS[i].g;
                self.channels[rgb_base + 2] = TRACK_COLORS[i].b;
            }
        }

        // Subtrack LEDs (4 subtracks × RGB, channels 60-71)
        // Just light up white for now — mode machine doesn't track subtrack LEDs separately
        // The active subtrack gets full brightness
        // (This can be refined later based on UI state)

        // Play LED (channel 90-92 in TLC4: position 6 of 8 function buttons)
        let play_base = 72 + 6 * 3; // PLAY is bit 30, 7th button in TLC4
        match led_state.play {
            LedMode::On => {
                self.channels[play_base] = 0;
                self.channels[play_base + 1] = MAX_BRIGHTNESS;
                self.channels[play_base + 2] = 0;
            }
            LedMode::Flash => {
                if self.flash_on {
                    self.channels[play_base] = 0;
                    self.channels[play_base + 1] = MAX_BRIGHTNESS;
                    self.channels[play_base + 2] = 0;
                }
            }
            LedMode::Dim => {
                self.channels[play_base + 1] = DIM_BRIGHTNESS;
            }
            LedMode::Off => {}
        }

        self.update_hardware();
    }

    /// Clock out all 1440 bits to the TLC5947 chain and latch.
    fn update_hardware(&mut self) {
        // TLC5947 expects data for the LAST channel of the LAST chip first (MSB first).
        // So we send channel 119 first, channel 0 last.
        for ch_idx in (0..NUM_CHANNELS).rev() {
            let value = self.channels[ch_idx];
            // Clock out 12 bits MSB first
            for bit in (0..12).rev() {
                if value & (1 << bit) != 0 {
                    self.sin.set_high();
                } else {
                    self.sin.set_low();
                }
                self.sclk.set_high();
                cortex_m::asm::delay(4); // ~27ns at 150MHz
                self.sclk.set_low();
                cortex_m::asm::delay(4);
            }
        }

        // Latch: pulse XLAT high
        self.xlat.set_high();
        cortex_m::asm::delay(4);
        self.xlat.set_low();
    }
}
