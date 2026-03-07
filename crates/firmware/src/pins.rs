//! GPIO pin assignments for the PGA2350 (RP2350B).
//!
//! Pin numbers match the schematic in docs/research/2026-03-06-qfn-rp2350-research.md,
//! corrected for RP2350 hardware function mapping where the schematic disagrees.
//!
//! Key corrections from schematic:
//! - SPI0: GP0=MISO(RX), GP23=MOSI(TX) (schematic had MOSI/MISO labels swapped)
//! - SPI1: GP30=SCK, GP31=MOSI (schematic had them swapped)
//! - MIDI: Uses UART1 on GP20(TX)/GP21(RX) (schematic had GP21/GP22 which aren't
//!   valid UART TX/RX pins). ENC_B_SW moved from GP20 to GP22.

// ── SPI0: Display + SD Card ──────────────────────────────────────────
// RP2350 function map: GP0=SPI0_RX(MISO), GP2=SPI0_SCK, GP23=SPI0_TX(MOSI)
pub const SPI0_SCK: u8 = 2; // GP2 — SPI0 SCK
pub const SPI0_MOSI: u8 = 23; // GP23 — SPI0 TX (data to display/SD)
pub const SPI0_MISO: u8 = 0; // GP0 — SPI0 RX (data from SD card)
pub const LCD_CS: u8 = 1; // GP1
pub const SD_CS: u8 = 24; // GP24
pub const SD_CD: u8 = 25; // GP25 — card detect (active low)

// ── Display Control ──────────────────────────────────────────────────
pub const LCD_DC: u8 = 3; // GP3 — data/command
pub const LCD_BL: u8 = 5; // GP5 — backlight PWM

// ── SPI1: DACs (Dedicated Bus) ───────────────────────────────────────
// RP2350 function map: GP30=SPI1_SCK, GP31=SPI1_TX(MOSI)
pub const SPI1_SCK: u8 = 30; // GP30 — SPI1 SCK
pub const SPI1_MOSI: u8 = 31; // GP31 — SPI1 TX (MOSI)
pub const DAC1_CS: u8 = 32; // GP32 — DAC8568 #1
pub const DAC2_CS: u8 = 33; // GP33 — DAC8568 #2

// ── Button Scanning (74HC165 Chain) ──────────────────────────────────
pub const BTN_CLK: u8 = 8; // GP8 — shift register clock
pub const BTN_LATCH: u8 = 9; // GP9 — SH/LD (latch)
pub const BTN_DATA: u8 = 10; // GP10 — QH (serial data out)

// ── LED Drivers (TLC5947 Chain) ──────────────────────────────────────
pub const LED_SIN: u8 = 11; // GP11 — serial data in
pub const LED_SCLK: u8 = 12; // GP12 — serial clock
pub const LED_XLAT: u8 = 13; // GP13 — latch
pub const LED_BLANK: u8 = 14; // GP14 — output enable (active high)

// ── Encoders ─────────────────────────────────────────────────────────
pub const ENC_A_A: u8 = 15; // GP15 — Encoder A, phase A
pub const ENC_A_B: u8 = 16; // GP16 — Encoder A, phase B
pub const ENC_A_SW: u8 = 17; // GP17 — Encoder A, push switch
pub const ENC_B_A: u8 = 18; // GP18 — Encoder B, phase A
pub const ENC_B_B: u8 = 19; // GP19 — Encoder B, phase B
pub const ENC_B_SW: u8 = 22; // GP22 — Encoder B, push switch (moved from GP20)

// ── MIDI (UART1) ─────────────────────────────────────────────────────
// RP2350 UART1: GP20=TX, GP21=RX (only valid UART pins near GP20-21)
pub const MIDI_TX: u8 = 20; // GP20 — UART1 TX (MIDI OUT)
pub const MIDI_RX: u8 = 21; // GP21 — UART1 RX (MIDI IN)

// ── Clock/Reset I/O ─────────────────────────────────────────────────
pub const CLK_IN: u8 = 26; // GP26 (ADC0) — external clock input
pub const RST_IN: u8 = 27; // GP27 (ADC1) — external reset input
pub const CLK_OUT: u8 = 28; // GP28 (ADC2) — clock output
pub const RST_OUT: u8 = 4; // GP4 — reset output

// ── CV Inputs (ADC) ─────────────────────────────────────────────────
pub const CV_A: u8 = 40; // GP40 (ADC4)
pub const CV_B: u8 = 41; // GP41 (ADC5)
pub const CV_C: u8 = 42; // GP42 (ADC6)
pub const CV_D: u8 = 43; // GP43 (ADC7)

// ── Display Dimensions ──────────────────────────────────────────────
pub const LCD_WIDTH: u16 = 480;
pub const LCD_HEIGHT: u16 = 320;

// ── Button Counts ───────────────────────────────────────────────────
/// Total bits in the 74HC165 shift register chain (5 × 8 = 40).
pub const SHIFT_REG_BITS: usize = 40;
/// Number of step buttons (illuminated RGB).
pub const NUM_STEP_BUTTONS: usize = 16;

// ── LED Counts ──────────────────────────────────────────────────────
/// Total TLC5947 channels (5 × 24 = 120). 102 used for 34 RGB LEDs.
pub const LED_CHANNELS: usize = 120;
/// Number of RGB LEDs.
pub const NUM_LEDS: usize = 34;

// ── DAC ─────────────────────────────────────────────────────────────
/// DAC8568 resolution (16-bit).
pub const DAC_MAX: u16 = 65535;
/// Number of DAC channels per chip.
pub const DAC_CHANNELS_PER_CHIP: u8 = 8;

// ── Timing ──────────────────────────────────────────────────────────
/// MIDI baud rate.
pub const MIDI_BAUD: u32 = 31250;
/// Button scan interval in microseconds (5ms = 200 Hz).
pub const BUTTON_SCAN_US: u64 = 5_000;
/// Encoder poll interval in microseconds (1ms = 1 kHz).
pub const ENCODER_POLL_US: u64 = 1_000;
/// Display refresh interval in milliseconds (~30 fps).
pub const DISPLAY_REFRESH_MS: u64 = 33;
/// LED update interval in milliseconds (~30 Hz).
pub const LED_UPDATE_MS: u64 = 33;
/// CV ADC read interval in milliseconds (~100 Hz).
pub const CV_READ_MS: u64 = 10;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_pin_collisions() {
        let pins: &[u8] = &[
            SPI0_SCK, SPI0_MOSI, SPI0_MISO, LCD_CS, SD_CS, SD_CD,
            LCD_DC, LCD_BL,
            SPI1_SCK, SPI1_MOSI, DAC1_CS, DAC2_CS,
            BTN_CLK, BTN_LATCH, BTN_DATA,
            LED_SIN, LED_SCLK, LED_XLAT, LED_BLANK,
            ENC_A_A, ENC_A_B, ENC_A_SW, ENC_B_A, ENC_B_B, ENC_B_SW,
            MIDI_TX, MIDI_RX,
            CLK_IN, RST_IN, CLK_OUT, RST_OUT,
            CV_A, CV_B, CV_C, CV_D,
        ];
        for (i, &a) in pins.iter().enumerate() {
            for &b in &pins[i + 1..] {
                assert_ne!(a, b, "GPIO pin {} used twice", a);
            }
        }
    }

    #[test]
    fn shift_reg_chain_size() {
        assert_eq!(SHIFT_REG_BITS, 40); // 5 × 8-bit registers
    }

    #[test]
    fn led_channel_count() {
        assert_eq!(LED_CHANNELS, 120); // 5 × 24 channels
        assert_eq!(NUM_LEDS, 34);
        assert!(NUM_LEDS * 3 <= LED_CHANNELS); // RGB fits
    }

    #[test]
    fn midi_baud_standard() {
        assert_eq!(MIDI_BAUD, 31250);
    }
}
