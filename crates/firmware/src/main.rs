// #![no_std]
// #![no_main]

//! Requencer firmware — RP2350 embedded target.
//!
//! Structured stub for the hardware platform. Storage is intentionally
//! left as a stub until we decide on SD card vs internal flash.
//!
//! ## Hardware Components (to be implemented)
//! - **Display**: ST7796 480x320 TFT via SPI (DrawTarget for renderer)
//! - **DAC**: DAC8568 8-channel 16-bit DAC for CV output (4x pitch + 4x mod)
//! - **ADC**: External clock/reset input detection
//! - **GPIO**: 16 step buttons + 4 track buttons via shift registers
//! - **Encoders**: 2x rotary encoders with push (navigation + value edit)
//! - **MIDI**: UART-based MIDI in/out
//! - **Storage**: TBD (SD card or internal flash)
//!
//! ## Architecture
//! The firmware runs a main loop that:
//! 1. Scans inputs (buttons, encoders, clock, MIDI)
//! 2. Updates engine state via `requencer_engine`
//! 3. Renders display via `requencer_renderer`
//! 4. Outputs CV/gate via DAC
//! 5. Sends MIDI messages
//!
//! The no_std/no_main attributes and HAL dependencies will be
//! added when we start firmware development with embassy or RTIC.

/// Hardware abstraction modules (stubs).
#[allow(dead_code)]
mod hw {
    /// Display driver stub — ST7796 480x320 TFT via SPI.
    pub mod display {
        /// Initialize SPI display. Returns a DrawTarget-compatible handle.
        pub fn init() {
            // TODO: SPI init, ST7796 init sequence, backlight PWM
        }
    }

    /// DAC8568 8-channel CV output stub.
    pub mod dac {
        /// Set a DAC channel voltage (0-65535 → 0-10V).
        pub fn set_channel(_channel: u8, _value: u16) {
            // TODO: SPI transaction to DAC8568
        }

        /// Convert MIDI note to DAC value (1V/oct).
        /// Assumes DAC8568 in unipolar 0-10V mode (0=0V, 65535=10V).
        /// Reference: C0 (MIDI 12) = 0V, C1 (MIDI 24) = 1V, ..., C8 (MIDI 108) = 8V.
        /// Notes below MIDI 12 clamp to 0V. Notes above MIDI 127 clamp to ~9.58V.
        pub fn note_to_dac(note: u8) -> u16 {
            let semitones_above_c0 = (note as i16 - 12).max(0) as f32;
            let volts = semitones_above_c0 / 12.0; // 1V per octave
            let normalized = (volts / 10.0).min(1.0);
            (normalized * 65535.0) as u16
        }
    }

    /// Button/encoder input scanning stub.
    pub mod input {
        /// Scan shift registers for button state. Returns 20-bit mask.
        pub fn scan_buttons() -> u32 {
            // TODO: shift register clock/data/latch sequence
            0
        }

        /// Read encoder delta since last call. Returns (enc_a_delta, enc_b_delta).
        pub fn read_encoders() -> (i8, i8) {
            // TODO: quadrature decoding via GPIO interrupts or polling
            (0, 0)
        }
    }

    /// External clock/reset input stub.
    pub mod clock {
        /// Check if external clock pulse detected since last call.
        pub fn clock_pulse() -> bool {
            // TODO: GPIO edge detection
            false
        }

        /// Check if reset pulse detected since last call.
        pub fn reset_pulse() -> bool {
            // TODO: GPIO edge detection
            false
        }
    }

    /// UART MIDI I/O stub.
    pub mod midi {
        /// Send a MIDI message (3 bytes).
        pub fn send(_bytes: &[u8]) {
            // TODO: UART TX at 31250 baud
        }

        /// Read next MIDI byte if available.
        pub fn read_byte() -> Option<u8> {
            // TODO: UART RX buffer
            None
        }
    }

    /// Storage stub — TBD (SD card or internal flash).
    pub mod storage {
        /// Save pattern data to storage.
        pub fn save_pattern(_slot: u8, _data: &[u8]) -> bool {
            // Stub: storage backend not yet decided
            false
        }

        /// Load pattern data from storage.
        pub fn load_pattern(_slot: u8, _buf: &mut [u8]) -> bool {
            // Stub: storage backend not yet decided
            false
        }

        /// Check if storage is available.
        pub fn is_available() -> bool {
            false
        }
    }
}

fn main() {
    // This will become no_main with embassy or RTIC.
    // For now, demonstrate the intended structure:

    // 1. Init hardware
    hw::display::init();

    // 2. Create engine state
    let _state = requencer_engine::types::SequencerState::new();
    let _ui = requencer_renderer::types::UiState::default();

    // 3. Main loop would be:
    // loop {
    //     let buttons = hw::input::scan_buttons();
    //     let (enc_a, enc_b) = hw::input::read_encoders();
    //     let ext_clock = hw::clock::clock_pulse();
    //     let ext_reset = hw::clock::reset_pulse();
    //
    //     // Update UI state from inputs
    //     // Update engine state
    //     // Render to display
    //     // Output CV via DAC
    //     // Send MIDI
    // }
}
