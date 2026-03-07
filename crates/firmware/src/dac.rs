//! DAC8568 dual 8-channel 16-bit DAC driver over SPI1.
//!
//! Two DAC8568 chips on a dedicated SPI1 bus (via 74HCT125 level shifter):
//! - DAC1 (GP32 CS): CH A-D = Gate 1-4, CH E-H = Pitch 1-4
//! - DAC2 (GP33 CS): CH A-D = Velocity 1-4, CH E-H = Mod 1-4
//!
//! DAC8568 protocol: 32-bit SPI word = [prefix(4)][command(4)][address(4)][data(16)][feature(4)]

#[cfg(target_os = "none")]
use embassy_rp::gpio::Output;
#[cfg(target_os = "none")]
use embassy_rp::spi::Spi;

/// DAC8568 command codes (4-bit, bits 27:24 of the 32-bit word).
pub mod dac_cmd {
    pub const WRITE_REG: u8 = 0x0;
    pub const UPDATE_REG: u8 = 0x1;
    pub const WRITE_UPDATE_ALL: u8 = 0x2;
    pub const WRITE_UPDATE: u8 = 0x3;
    pub const POWER: u8 = 0x4;
    pub const RESET: u8 = 0x7;
    pub const SETUP_REF: u8 = 0x8;
}

/// DAC8568 channel addresses (4-bit, bits 23:20).
#[allow(dead_code)]
pub mod dac_ch {
    pub const A: u8 = 0;
    pub const B: u8 = 1;
    pub const C: u8 = 2;
    pub const D: u8 = 3;
    pub const E: u8 = 4;
    pub const F: u8 = 5;
    pub const G: u8 = 6;
    pub const H: u8 = 7;
}

/// Build a 32-bit DAC8568 SPI word.
/// Format: [0000][command(4)][address(4)][data(16)][feature(4)]
pub fn build_word(command: u8, address: u8, data: u16, feature: u8) -> [u8; 4] {
    let word: u32 = ((command as u32 & 0xF) << 24)
        | ((address as u32 & 0xF) << 20)
        | ((data as u32) << 4)
        | (feature as u32 & 0xF);
    word.to_be_bytes()
}

/// Convert MIDI note (0-127) to DAC value for 1V/octave pitch output.
/// C0 (MIDI 12) = 0V output. Op-amp gain = 2, offset = -2V.
/// Vout = semitones_above_c0 / 12.0, Vdac = (Vout + 2.0) / 2.0
pub fn note_to_dac(note: u8) -> u16 {
    let semitones_above_c0 = (note as i16 - 12).max(0) as f32;
    let v_out = semitones_above_c0 / 12.0;
    let v_dac = (v_out + 2.0) / 2.0;
    let normalized = (v_dac / 5.0).clamp(0.0, 1.0);
    (normalized * 65535.0) as u16
}

/// Convert velocity (0-127) to DAC value. Linear 0-127 → 0-65535.
pub fn velocity_to_dac(velocity: u8) -> u16 {
    ((velocity as u32 * 65535) / 127) as u16
}

/// Convert modulation (0-127) to DAC value.
/// Inverting op-amp: Vout = 5 - 2*Vdac. Vdac = 5*(1 - mod/127) / 2.
pub fn mod_to_dac(modulation: u8) -> u16 {
    let mod_frac = modulation as f32 / 127.0;
    let v_dac = 5.0 * (1.0 - mod_frac) / 2.0;
    let normalized = (v_dac / 5.0).clamp(0.0, 1.0);
    (normalized * 65535.0) as u16
}

/// Convert gate on/off to DAC value. Gate high = 5V (65535), low = 0V (0).
pub fn gate_to_dac(gate: bool) -> u16 {
    if gate { 65535 } else { 0 }
}

/// Hardware handle for both DAC chips on SPI1.
#[cfg(target_os = "none")]
pub struct DacOutput<'a> {
    spi: Spi<'a, embassy_rp::peripherals::SPI1, embassy_rp::spi::Blocking>,
    cs1: Output<'a>,
    cs2: Output<'a>,
}

#[cfg(target_os = "none")]
impl<'a> DacOutput<'a> {
    pub fn new(
        spi: Spi<'a, embassy_rp::peripherals::SPI1, embassy_rp::spi::Blocking>,
        cs1: Output<'a>,
        cs2: Output<'a>,
    ) -> Self {
        Self { spi, cs1, cs2 }
    }

    fn write_dac1(&mut self, word: &[u8; 4]) {
        self.cs1.set_low();
        if self.spi.blocking_write(word).is_err() {
            defmt::warn!("DAC1 SPI write failed");
        }
        self.cs1.set_high();
    }

    fn write_dac2(&mut self, word: &[u8; 4]) {
        self.cs2.set_low();
        if self.spi.blocking_write(word).is_err() {
            defmt::warn!("DAC2 SPI write failed");
        }
        self.cs2.set_high();
    }

    pub fn init(&mut self) {
        let reset = build_word(dac_cmd::RESET, 0, 0, 0);
        self.write_dac1(&reset);
        self.write_dac2(&reset);

        let ref_on = build_word(dac_cmd::SETUP_REF, 0, 0, 0x1);
        self.write_dac1(&ref_on);
        self.write_dac2(&ref_on);
    }

    pub fn set_dac1_channel(&mut self, channel: u8, value: u16) {
        let word = build_word(dac_cmd::WRITE_UPDATE, channel, value, 0);
        self.write_dac1(&word);
    }

    pub fn set_dac2_channel(&mut self, channel: u8, value: u16) {
        let word = build_word(dac_cmd::WRITE_UPDATE, channel, value, 0);
        self.write_dac2(&word);
    }

    pub fn update_from_events(
        &mut self,
        events: &[Option<requencer_engine::types::NoteEvent>; 4],
        gate_state: &mut [bool; 4],
    ) {
        for (i, event) in events.iter().enumerate() {
            if let Some(ev) = event {
                gate_state[i] = ev.gate;
                let ch = i as u8;
                self.set_dac1_channel(ch, gate_to_dac(ev.gate));
                self.set_dac1_channel(ch + 4, note_to_dac(ev.pitch));
                self.set_dac2_channel(ch, velocity_to_dac(ev.velocity));
                self.set_dac2_channel(ch + 4, mod_to_dac(ev.modulation));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── build_word tests ──────────────────────────────────────────────

    #[test]
    fn build_word_zeros() {
        let w = build_word(0, 0, 0, 0);
        assert_eq!(w, [0, 0, 0, 0]);
    }

    #[test]
    fn build_word_command_field() {
        // Command 0x3 in bits 27:24 → byte 0 = 0x03
        let w = build_word(0x3, 0, 0, 0);
        assert_eq!(w[0], 0x03);
        assert_eq!(w[1], 0x00);
    }

    #[test]
    fn build_word_address_field() {
        // Address 0x7 in bits 23:20 → byte 0 upper nibble of byte 1 = 0x70
        let w = build_word(0, 0x7, 0, 0);
        assert_eq!(w[0], 0x00);
        assert_eq!(w[1], 0x70);
    }

    #[test]
    fn build_word_data_field() {
        // Data 0xFFFF in bits 19:4
        let w = build_word(0, 0, 0xFFFF, 0);
        // bits 19:16 in byte 1 lower nibble, bits 15:8 in byte 2, bits 7:4 in byte 3 upper nibble
        assert_eq!(w[1], 0x0F);
        assert_eq!(w[2], 0xFF);
        assert_eq!(w[3], 0xF0);
    }

    #[test]
    fn build_word_feature_field() {
        // Feature 0xF in bits 3:0
        let w = build_word(0, 0, 0, 0xF);
        assert_eq!(w[3], 0x0F);
    }

    #[test]
    fn build_word_full_example() {
        // WRITE_UPDATE (0x3), channel 5, data 0x8000, feature 0
        let w = build_word(0x3, 5, 0x8000, 0);
        let word = u32::from_be_bytes(w);
        assert_eq!((word >> 24) & 0xF, 0x3); // command
        assert_eq!((word >> 20) & 0xF, 5);   // address
        assert_eq!((word >> 4) & 0xFFFF, 0x8000); // data
        assert_eq!(word & 0xF, 0);            // feature
    }

    #[test]
    fn build_word_truncates_oversized_fields() {
        // Command > 4 bits should be masked
        let w = build_word(0xFF, 0xFF, 0xFFFF, 0xFF);
        let word = u32::from_be_bytes(w);
        assert_eq!((word >> 24) & 0xF, 0xF); // masked to 4 bits
        assert_eq!((word >> 20) & 0xF, 0xF); // masked to 4 bits
        assert_eq!(word & 0xF, 0xF);         // masked to 4 bits
    }

    #[test]
    fn build_word_reset_command() {
        let w = build_word(dac_cmd::RESET, 0, 0, 0);
        let word = u32::from_be_bytes(w);
        assert_eq!((word >> 24) & 0xF, 7);
    }

    #[test]
    fn build_word_setup_ref_with_feature() {
        let w = build_word(dac_cmd::SETUP_REF, 0, 0, 0x1);
        let word = u32::from_be_bytes(w);
        assert_eq!((word >> 24) & 0xF, 8);
        assert_eq!(word & 0xF, 1);
    }

    // ── note_to_dac tests ─────────────────────────────────────────────

    #[test]
    fn note_to_dac_c0_is_zero_volts() {
        // C0 = MIDI note 12 → 0V output → Vdac = (0+2)/2 = 1.0V → 1.0/5.0 * 65535
        let val = note_to_dac(12);
        let expected = ((1.0f32 / 5.0) * 65535.0) as u16; // 13107
        assert_eq!(val, expected);
    }

    #[test]
    fn note_to_dac_c1_is_one_volt() {
        // C1 = MIDI note 24 → 1V output → Vdac = (1+2)/2 = 1.5V
        let val = note_to_dac(24);
        let expected = ((1.5f32 / 5.0) * 65535.0) as u16; // 19660
        assert_eq!(val, expected);
    }

    #[test]
    fn note_to_dac_c4_is_four_volts() {
        // C4 = MIDI note 60 → 4V output → Vdac = (4+2)/2 = 3.0V
        let val = note_to_dac(60);
        let expected = ((3.0f32 / 5.0) * 65535.0) as u16; // 39321
        assert_eq!(val, expected);
    }

    #[test]
    fn note_to_dac_monotonic() {
        // Higher notes should produce higher DAC values
        let mut prev = note_to_dac(0);
        for note in 1..=127 {
            let val = note_to_dac(note);
            assert!(val >= prev, "note {} produced {} < {} (note {})", note, val, prev, note - 1);
            prev = val;
        }
    }

    #[test]
    fn note_to_dac_below_c0_clamps() {
        // Notes below C0 (12) should still produce valid values (clamped to 0V output)
        let val_0 = note_to_dac(0);
        let val_11 = note_to_dac(11);
        // Both should map to 0 semitones above C0 → same DAC value
        assert_eq!(val_0, val_11);
    }

    #[test]
    fn note_to_dac_high_notes_clamp() {
        // Note 127 → Vout = (127-12)/12 = 9.58V → Vdac = (9.58+2)/2 = 5.79V → clamps to 5V
        let val = note_to_dac(127);
        assert_eq!(val, 65535); // Should clamp to max
    }

    #[test]
    fn note_to_dac_one_volt_per_octave() {
        // Each octave (12 semitones) should add exactly 1V output
        let c2 = note_to_dac(36); // 2V out
        let c3 = note_to_dac(48); // 3V out
        let c4 = note_to_dac(60); // 4V out

        // 1V output = 0.5V DAC difference = 0.1 normalized = 6553.5 DAC counts
        let octave_counts = c3 - c2;
        let octave_counts2 = c4 - c3;
        // Should be very close (within floating point rounding)
        assert!((octave_counts as i32 - octave_counts2 as i32).unsigned_abs() <= 1);
        // Each octave should be ~6553-6554 counts
        assert!(octave_counts >= 6553 && octave_counts <= 6554);
    }

    // ── velocity_to_dac tests ─────────────────────────────────────────

    #[test]
    fn velocity_to_dac_zero() {
        assert_eq!(velocity_to_dac(0), 0);
    }

    #[test]
    fn velocity_to_dac_max() {
        assert_eq!(velocity_to_dac(127), 65535);
    }

    #[test]
    fn velocity_to_dac_midpoint() {
        let mid = velocity_to_dac(64);
        // 64/127 * 65535 ≈ 33026
        assert!(mid > 33000 && mid < 33100);
    }

    #[test]
    fn velocity_to_dac_monotonic() {
        let mut prev = velocity_to_dac(0);
        for v in 1..=127 {
            let val = velocity_to_dac(v);
            assert!(val > prev);
            prev = val;
        }
    }

    // ── mod_to_dac tests ──────────────────────────────────────────────

    #[test]
    fn mod_to_dac_zero_is_half_scale() {
        // mod 0 → Vout = 0V → Vdac = 2.5V → normalized = 0.5 → 32767
        let val = mod_to_dac(0);
        assert_eq!(val, 32767);
    }

    #[test]
    fn mod_to_dac_max_is_zero() {
        // mod 127 → Vout = 5V → Vdac = 0V → 0
        let val = mod_to_dac(127);
        assert_eq!(val, 0);
    }

    #[test]
    fn mod_to_dac_inversely_monotonic() {
        // Higher modulation → lower DAC value (inverting op-amp)
        let mut prev = mod_to_dac(0);
        for m in 1..=127 {
            let val = mod_to_dac(m);
            assert!(val < prev, "mod {} produced {} >= {} (mod {})", m, val, prev, m - 1);
            prev = val;
        }
    }

    // ── gate_to_dac tests ─────────────────────────────────────────────

    #[test]
    fn gate_to_dac_on() {
        assert_eq!(gate_to_dac(true), 65535);
    }

    #[test]
    fn gate_to_dac_off() {
        assert_eq!(gate_to_dac(false), 0);
    }
}
