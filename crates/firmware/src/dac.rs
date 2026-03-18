//! DAC80508 dual 8-channel 16-bit DAC driver over SPI1.
//!
//! Two DAC80508 chips on a dedicated SPI1 bus (direct 3.3V via VIO pin):
//! - DAC1 (GP32 CS): CH 0-3 = Gate 1-4, CH 4-7 = Pitch 1-4
//! - DAC2 (GP33 CS): CH 0-3 = Velocity 1-4, CH 4-7 = Mod 1-4
//!
//! DAC80508 protocol: 24-bit SPI frame = [R/W(1) + register(7)][data_MSB(8)][data_LSB(8)]

#[cfg(target_os = "none")]
use embassy_rp::gpio::Output;
#[cfg(target_os = "none")]
use embassy_rp::spi::Spi;

/// DAC80508 register addresses (7-bit).
pub mod dac_reg {
    pub const CONFIG: u8 = 0x03;
    pub const GAIN: u8 = 0x04;
    pub const TRIGGER: u8 = 0x05;
    #[allow(dead_code)]
    pub const BROADCAST: u8 = 0x06;
    /// Channel N data register = DAC_BASE + N (0x08..0x0F)
    pub const DAC_BASE: u8 = 0x08;
}

/// Build a 24-bit DAC80508 SPI write frame.
/// Format: [0 + register(7)][data_MSB(8)][data_LSB(8)]
/// Bit 23 (R/W) = 0 for write.
pub fn build_frame(register: u8, data: u16) -> [u8; 3] {
    [register & 0x7F, (data >> 8) as u8, data as u8]
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

    fn write_dac1(&mut self, frame: &[u8; 3]) {
        self.cs1.set_low();
        if self.spi.blocking_write(frame).is_err() {
            defmt::warn!("DAC1 SPI write failed");
        }
        self.cs1.set_high();
    }

    fn write_dac2(&mut self, frame: &[u8; 3]) {
        self.cs2.set_low();
        if self.spi.blocking_write(frame).is_err() {
            defmt::warn!("DAC2 SPI write failed");
        }
        self.cs2.set_high();
    }

    pub fn init(&mut self) {
        // Soft reset via TRIGGER register (bit 4 = SOFT_RESET)
        let reset = build_frame(dac_reg::TRIGGER, 0x000A);
        self.write_dac1(&reset);
        self.write_dac2(&reset);

        // DAC80508 internal 2.5V reference is ON by default (unlike DAC8568).
        // CONFIG register: keep defaults (internal ref enabled, no CRC, no power-down).
        // No write needed — default CONFIG = 0x0000 is correct.

        // GAIN register: all channels gain=2 for 0-5V output with 2.5V internal ref.
        // Bits 15:8 = per-channel gain select (1 = gain of 2), bit 0 = ref divider (0 = no divider).
        // 0xFF00 = all 8 channels at 2× gain, ref divider disabled → 2.5V × 2 = 5V full scale.
        let gain = build_frame(dac_reg::GAIN, 0xFF00);
        self.write_dac1(&gain);
        self.write_dac2(&gain);
    }

    pub fn set_dac1_channel(&mut self, channel: u8, value: u16) {
        let frame = build_frame(dac_reg::DAC_BASE + channel, value);
        self.write_dac1(&frame);
    }

    pub fn set_dac2_channel(&mut self, channel: u8, value: u16) {
        let frame = build_frame(dac_reg::DAC_BASE + channel, value);
        self.write_dac2(&frame);
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

    // ── build_frame tests ─────────────────────────────────────────────

    #[test]
    fn build_frame_zeros() {
        let f = build_frame(0, 0);
        assert_eq!(f, [0, 0, 0]);
    }

    #[test]
    fn build_frame_register_field() {
        // Register 0x08 (DAC channel 0) should appear in byte 0
        let f = build_frame(0x08, 0);
        assert_eq!(f[0], 0x08);
        assert_eq!(f[1], 0x00);
        assert_eq!(f[2], 0x00);
    }

    #[test]
    fn build_frame_data_field() {
        // Data 0xFFFF should fill bytes 1-2
        let f = build_frame(0, 0xFFFF);
        assert_eq!(f[0], 0x00);
        assert_eq!(f[1], 0xFF);
        assert_eq!(f[2], 0xFF);
    }

    #[test]
    fn build_frame_data_split() {
        // Data 0x1234 → MSB = 0x12, LSB = 0x34
        let f = build_frame(0, 0x1234);
        assert_eq!(f[1], 0x12);
        assert_eq!(f[2], 0x34);
    }

    #[test]
    fn build_frame_register_masks_high_bit() {
        // Bit 7 should be masked off (R/W bit = 0 for write)
        let f = build_frame(0xFF, 0);
        assert_eq!(f[0], 0x7F); // masked to 7 bits
    }

    #[test]
    fn build_frame_full_example() {
        // Write 0x8000 to DAC channel 5 (register 0x0D)
        let f = build_frame(dac_reg::DAC_BASE + 5, 0x8000);
        assert_eq!(f[0], 0x0D);
        assert_eq!(f[1], 0x80);
        assert_eq!(f[2], 0x00);
    }

    #[test]
    fn build_frame_gain_register() {
        // GAIN register (0x04), all channels gain=2, no ref divider
        let f = build_frame(dac_reg::GAIN, 0xFF00);
        assert_eq!(f[0], 0x04);
        assert_eq!(f[1], 0xFF);
        assert_eq!(f[2], 0x00);
    }

    #[test]
    fn build_frame_trigger_soft_reset() {
        // TRIGGER register (0x05), soft reset value
        let f = build_frame(dac_reg::TRIGGER, 0x000A);
        assert_eq!(f[0], 0x05);
        assert_eq!(f[1], 0x00);
        assert_eq!(f[2], 0x0A);
    }

    #[test]
    fn build_frame_config_register() {
        // CONFIG register (0x03), default = 0x0000
        let f = build_frame(dac_reg::CONFIG, 0x0000);
        assert_eq!(f[0], 0x03);
        assert_eq!(f[1], 0x00);
        assert_eq!(f[2], 0x00);
    }

    #[test]
    fn build_frame_channel_addresses() {
        // Verify channel 0-7 map to registers 0x08-0x0F
        for ch in 0u8..8 {
            let f = build_frame(dac_reg::DAC_BASE + ch, 0);
            assert_eq!(f[0], 0x08 + ch);
        }
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
