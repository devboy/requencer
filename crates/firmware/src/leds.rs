//! TLC5947 LED driver — 5× daisy-chained, 120 channels (102 used for 34 RGB LEDs).
//!
//! Generic over `embedded-hal` GPIO traits. 12-bit PWM per channel,
//! bit-banged via SIN, SCLK, XLAT, BLANK pins.

use embedded_hal::digital::OutputPin;
use requencer_engine::ui_types::{LedMode, LedState};

use crate::pins;

/// RGB color (12-bit per channel for TLC5947).
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Rgb12 {
    pub r: u16,
    pub g: u16,
    pub b: u16,
}

impl Rgb12 {
    pub const OFF: Self = Self { r: 0, g: 0, b: 0 };
    pub const fn new(r: u16, g: u16, b: u16) -> Self {
        Self { r, g, b }
    }
}

/// Track colors (full brightness, 12-bit).
pub const TRACK_COLORS: [Rgb12; 4] = [
    Rgb12::new(4095, 0, 0),    // T1: Red
    Rgb12::new(0, 4095, 0),    // T2: Green
    Rgb12::new(0, 0, 4095),    // T3: Blue
    Rgb12::new(4095, 4095, 0), // T4: Yellow
];

pub const STEP_ON: Rgb12 = Rgb12::new(4095, 4095, 4095);
pub const STEP_DIM: Rgb12 = Rgb12::new(1024, 1024, 1024);

/// Resolve a LedMode to an RGB color.
pub fn resolve_mode(mode: LedMode, on_color: Rgb12, dim_color: Rgb12, flash_on: bool) -> Rgb12 {
    match mode {
        LedMode::Off => Rgb12::OFF,
        LedMode::On => on_color,
        LedMode::Dim => dim_color,
        LedMode::Flash => {
            if flash_on {
                on_color
            } else {
                Rgb12::OFF
            }
        }
    }
}

/// TLC5947 LED driver, generic over GPIO pins.
pub struct LedDriver<SIN, SCLK, XLAT, BLANK> {
    sin: SIN,
    sclk: SCLK,
    xlat: XLAT,
    blank: BLANK,
    pub channels: [u16; pins::LED_CHANNELS],
    pub flash_on: bool,
}

impl<SIN, SCLK, XLAT, BLANK> LedDriver<SIN, SCLK, XLAT, BLANK>
where
    SIN: OutputPin,
    SCLK: OutputPin,
    XLAT: OutputPin,
    BLANK: OutputPin,
{
    pub fn new(sin: SIN, sclk: SCLK, xlat: XLAT, mut blank: BLANK) -> Self {
        let _ = blank.set_low();
        Self {
            sin,
            sclk,
            xlat,
            blank,
            channels: [0; pins::LED_CHANNELS],
            flash_on: false,
        }
    }

    /// Apply engine LED state to the channel buffer.
    pub fn apply_state(&mut self, state: &LedState, _selected_track: u8) {
        self.channels = [0; pins::LED_CHANNELS];

        for (i, &mode) in state.steps.iter().enumerate() {
            let color = resolve_mode(mode, STEP_ON, STEP_DIM, self.flash_on);
            let base = i * 3;
            if base + 2 < pins::LED_CHANNELS {
                self.channels[base] = color.r;
                self.channels[base + 1] = color.g;
                self.channels[base + 2] = color.b;
            }
        }

        for (i, &active) in state.tracks.iter().enumerate() {
            let color = if active { TRACK_COLORS[i] } else { Rgb12::OFF };
            let base = 48 + i * 3;
            if base + 2 < pins::LED_CHANNELS {
                self.channels[base] = color.r;
                self.channels[base + 1] = color.g;
                self.channels[base + 2] = color.b;
            }
        }

        let play_color = resolve_mode(
            state.play,
            Rgb12::new(0, 4095, 0),
            Rgb12::new(0, 1024, 0),
            self.flash_on,
        );
        if 62 < pins::LED_CHANNELS {
            self.channels[60] = play_color.r;
            self.channels[61] = play_color.g;
            self.channels[62] = play_color.b;
        }
    }

    pub fn toggle_flash(&mut self) {
        self.flash_on = !self.flash_on;
    }

    /// Shift out all channel data to the TLC5947 chain and latch.
    pub fn flush(&mut self) {
        for &value in self.channels.iter().rev() {
            for bit_pos in (0..12).rev() {
                if value & (1 << bit_pos) != 0 {
                    let _ = self.sin.set_high();
                } else {
                    let _ = self.sin.set_low();
                }
                let _ = self.sclk.set_high();
                gpio_delay();
                let _ = self.sclk.set_low();
            }
        }
        let _ = self.xlat.set_high();
        gpio_delay();
        let _ = self.xlat.set_low();
    }
}

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

    #[test]
    fn resolve_mode_off() {
        assert_eq!(resolve_mode(LedMode::Off, STEP_ON, STEP_DIM, true), Rgb12::OFF);
    }

    #[test]
    fn resolve_mode_on() {
        assert_eq!(resolve_mode(LedMode::On, STEP_ON, STEP_DIM, false), STEP_ON);
    }

    #[test]
    fn resolve_mode_dim() {
        assert_eq!(resolve_mode(LedMode::Dim, STEP_ON, STEP_DIM, true), STEP_DIM);
    }

    #[test]
    fn resolve_mode_flash_toggles() {
        assert_eq!(
            resolve_mode(LedMode::Flash, STEP_ON, STEP_DIM, true),
            STEP_ON
        );
        assert_eq!(
            resolve_mode(LedMode::Flash, STEP_ON, STEP_DIM, false),
            Rgb12::OFF
        );
    }

    #[test]
    fn track_colors_defined() {
        assert_eq!(TRACK_COLORS[0], Rgb12::new(4095, 0, 0)); // Red
        assert_eq!(TRACK_COLORS[3], Rgb12::new(4095, 4095, 0)); // Yellow
    }

    #[test]
    fn flush_shifts_correct_bits() {
        use embedded_hal_mock::eh1::digital::{Mock as PinMock, State, Transaction as PinTx};

        // Only set channel 119 (last, shifted out first) to 0xFFF (12 bits all high)
        let mut channels = [0u16; pins::LED_CHANNELS];
        channels[119] = 0xFFF;

        // Channel 119 (0xFFF) shifted first: 12 high bits
        // Then 119 channels of zeros: 119 × 12 = 1428 low bits
        let mut sin_txns = Vec::new();
        let mut sclk_txns = Vec::new();

        // Channel 119: all 12 bits high
        for _ in 0..12 {
            sin_txns.push(PinTx::set(State::High));
            sclk_txns.push(PinTx::set(State::High));
            sclk_txns.push(PinTx::set(State::Low));
        }
        // Remaining 119 channels: all zero
        for _ in 0..(119 * 12) {
            sin_txns.push(PinTx::set(State::Low));
            sclk_txns.push(PinTx::set(State::High));
            sclk_txns.push(PinTx::set(State::Low));
        }

        let sin = PinMock::new(&sin_txns);
        let sclk = PinMock::new(&sclk_txns);
        let xlat = PinMock::new(&[PinTx::set(State::High), PinTx::set(State::Low)]);
        let blank = PinMock::new(&[PinTx::set(State::Low)]); // from new()

        let mut driver = LedDriver::new(sin, sclk, xlat, blank);
        driver.channels = channels;
        driver.flush();

        driver.sin.done();
        driver.sclk.done();
        driver.xlat.done();
        driver.blank.done();
    }
}
