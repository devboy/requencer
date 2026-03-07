//! DAC8568 dual 8-channel 16-bit DAC driver via SPI.
//!
//! Generic over `embedded-hal` SPI and GPIO traits — works with any HAL
//! implementation (embassy-rp on hardware, mocks in tests).
//!
//! Channel mapping:
//!   DAC1 (CS1): CH A-D = Gate 1-4, CH E-H = Pitch 1-4
//!   DAC2 (CS2): CH A-D = Velocity 1-4, CH E-H = Mod 1-4

use embedded_hal::digital::OutputPin;
use embedded_hal::spi::SpiBus;
use requencer_engine::types::NoteEvent;

/// DAC8568 command codes (bits [27:24] of 32-bit word).
pub mod cmd {
    pub const WRITE_REG: u8 = 0x0;
    pub const UPDATE_REG: u8 = 0x1;
    pub const WRITE_UPDATE_ALL: u8 = 0x2;
    pub const WRITE_UPDATE_N: u8 = 0x3;
    #[allow(dead_code)]
    pub const POWER_DOWN: u8 = 0x4;
    pub const RESET: u8 = 0x7;
    pub const SETUP_INTERNAL_REF: u8 = 0x8;
}

/// Build a 32-bit DAC8568 SPI word.
///
/// Format: `[prefix:4][command:4][address:4][data:16][feature:4]`
pub fn build_word(command: u8, address: u8, data: u16, feature: u8) -> [u8; 4] {
    let word: u32 = ((command as u32 & 0xF) << 24)
        | ((address as u32 & 0xF) << 20)
        | ((data as u32) << 4)
        | (feature as u32 & 0xF);
    word.to_be_bytes()
}

/// Convert MIDI note to DAC value (1V/octave, integer math).
///
/// C0 (MIDI 12) = 0V, C1 (24) = 1V, ..., C8 (108) = 8V.
/// DAC range: 0 = 0V, 65535 = 10V (120 semitones).
pub fn note_to_dac(note: u8) -> u16 {
    let semitones = (note as i32 - 12).max(0);
    let dac = (semitones as u32 * 65535) / 120;
    (dac.min(65535)) as u16
}

/// Scale a u8 (0-127) value to u16 (0-65535) range.
pub fn scale_u8_to_u16(value: u8) -> u16 {
    (value as u16) * 516 // 127 * 516 = 65532 ≈ 65535
}

/// DAC8568 driver, generic over SPI bus and chip-select pins.
pub struct Dac<SPI, CS1, CS2> {
    spi: SPI,
    cs1: CS1,
    cs2: CS2,
}

impl<SPI, CS1, CS2> Dac<SPI, CS1, CS2>
where
    SPI: SpiBus,
    CS1: OutputPin,
    CS2: OutputPin,
{
    pub fn new(spi: SPI, cs1: CS1, cs2: CS2) -> Self {
        Self { spi, cs1, cs2 }
    }

    /// Initialize both DACs: software reset + enable internal 2.5V reference.
    pub fn init(&mut self) {
        self.write_raw_cs1(build_word(cmd::RESET, 0, 0, 0));
        self.write_raw_cs2(build_word(cmd::RESET, 0, 0, 0));
        self.write_raw_cs1(build_word(cmd::SETUP_INTERNAL_REF, 0, 0, 0x1));
        self.write_raw_cs2(build_word(cmd::SETUP_INTERNAL_REF, 0, 0, 0x1));
    }

    pub fn write_dac1(&mut self, channel: u8, value: u16) {
        let word = build_word(cmd::WRITE_UPDATE_N, channel & 0x7, value, 0);
        self.write_raw_cs1(word);
    }

    pub fn write_dac2(&mut self, channel: u8, value: u16) {
        let word = build_word(cmd::WRITE_UPDATE_N, channel & 0x7, value, 0);
        self.write_raw_cs2(word);
    }

    fn write_raw_cs1(&mut self, data: [u8; 4]) {
        let _ = self.cs1.set_low();
        let _ = self.spi.write(&data);
        let _ = self.cs1.set_high();
    }

    fn write_raw_cs2(&mut self, data: [u8; 4]) {
        let _ = self.cs2.set_low();
        let _ = self.spi.write(&data);
        let _ = self.cs2.set_high();
    }

    /// Output all 16 DAC channels from engine events.
    pub fn output_events(&mut self, events: &[Option<NoteEvent>; 4]) {
        for (i, event) in events.iter().enumerate() {
            let ch = i as u8;
            if let Some(e) = event {
                let gate_val = if e.gate { crate::pins::DAC_MAX } else { 0 };
                self.write_dac1(ch, gate_val);
                self.write_dac1(ch + 4, note_to_dac(e.pitch));
                self.write_dac2(ch, scale_u8_to_u16(e.velocity));
                self.write_dac2(ch + 4, scale_u8_to_u16(e.modulation));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use embedded_hal_mock::eh1::digital::{Mock as PinMock, State, Transaction as PinTx};
    use embedded_hal_mock::eh1::spi::{Mock as SpiMock, Transaction as SpiTx};

    #[test]
    fn build_word_format() {
        let word = build_word(cmd::WRITE_UPDATE_N, 3, 0x8000, 0);
        let val = u32::from_be_bytes(word);
        assert_eq!((val >> 24) & 0xF, 0x3); // command
        assert_eq!((val >> 20) & 0xF, 0x3); // address
        assert_eq!((val >> 4) & 0xFFFF, 0x8000); // data
        assert_eq!(val & 0xF, 0x0); // feature
    }

    #[test]
    fn build_word_reset() {
        let word = build_word(cmd::RESET, 0, 0, 0);
        let val = u32::from_be_bytes(word);
        assert_eq!((val >> 24) & 0xF, 0x7);
    }

    #[test]
    fn build_word_internal_ref() {
        let word = build_word(cmd::SETUP_INTERNAL_REF, 0, 0, 0x1);
        let val = u32::from_be_bytes(word);
        assert_eq!((val >> 24) & 0xF, 0x8);
        assert_eq!(val & 0xF, 0x1);
    }

    #[test]
    fn note_to_dac_c0_is_zero() {
        assert_eq!(note_to_dac(12), 0);
    }

    #[test]
    fn note_to_dac_below_c0_clamps() {
        assert_eq!(note_to_dac(0), 0);
        assert_eq!(note_to_dac(11), 0);
    }

    #[test]
    fn note_to_dac_one_octave() {
        let val = note_to_dac(24);
        assert_eq!(val, (12u32 * 65535 / 120) as u16);
    }

    #[test]
    fn note_to_dac_max_clamps() {
        assert_eq!(note_to_dac(132), 65535);
        assert_eq!(note_to_dac(255), 65535);
    }

    #[test]
    fn scale_u8_range() {
        assert_eq!(scale_u8_to_u16(0), 0);
        assert_eq!(scale_u8_to_u16(127), 65532);
    }

    #[test]
    fn dac_init_sends_reset_and_ref() {
        let reset_word = build_word(cmd::RESET, 0, 0, 0);
        let ref_word = build_word(cmd::SETUP_INTERNAL_REF, 0, 0, 0x1);

        let spi = SpiMock::new(&[
            SpiTx::write_vec(reset_word.to_vec()),
            SpiTx::write_vec(reset_word.to_vec()),
            SpiTx::write_vec(ref_word.to_vec()),
            SpiTx::write_vec(ref_word.to_vec()),
        ]);
        let cs1 = PinMock::new(&[
            PinTx::set(State::Low),
            PinTx::set(State::High),
            PinTx::set(State::Low),
            PinTx::set(State::High),
        ]);
        let cs2 = PinMock::new(&[
            PinTx::set(State::Low),
            PinTx::set(State::High),
            PinTx::set(State::Low),
            PinTx::set(State::High),
        ]);

        let mut dac = Dac::new(spi, cs1, cs2);
        dac.init();

        let (mut spi, mut cs1, mut cs2) = (dac.spi, dac.cs1, dac.cs2);
        spi.done();
        cs1.done();
        cs2.done();
    }

    #[test]
    fn dac_write_dac1_toggles_cs1() {
        let word = build_word(cmd::WRITE_UPDATE_N, 0, 0x8000, 0);
        let spi = SpiMock::new(&[SpiTx::write_vec(word.to_vec())]);
        let cs1 = PinMock::new(&[PinTx::set(State::Low), PinTx::set(State::High)]);
        let cs2 = PinMock::new(&[]);

        let mut dac = Dac::new(spi, cs1, cs2);
        dac.write_dac1(0, 0x8000);

        dac.spi.done();
        dac.cs1.done();
        dac.cs2.done();
    }
}
