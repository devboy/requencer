//! DAC8568 dual 8-channel 16-bit DAC driver over SPI1.
//!
//! Two DAC8568 chips on a dedicated SPI1 bus (via 74HCT125 level shifter):
//! - DAC1 (GP32 CS): CH A-D = Gate 1-4, CH E-H = Pitch 1-4
//! - DAC2 (GP33 CS): CH A-D = Velocity 1-4, CH E-H = Mod 1-4
//!
//! DAC8568 protocol: 32-bit SPI word = [prefix(4)][command(4)][address(4)][data(16)][feature(4)]

use embassy_rp::gpio::Output;
use embassy_rp::spi::Spi;

/// DAC8568 command codes (4-bit, bits 27:24 of the 32-bit word).
mod dac_cmd {
    /// Write to input register (no update).
    pub const WRITE_REG: u8 = 0x0;
    /// Update DAC register from input register.
    pub const UPDATE_REG: u8 = 0x1;
    /// Write to input register and update all DACs.
    pub const WRITE_UPDATE_ALL: u8 = 0x2;
    /// Write to input register and update this DAC.
    pub const WRITE_UPDATE: u8 = 0x3;
    /// Power down/up.
    pub const POWER: u8 = 0x4;
    /// Software reset.
    pub const RESET: u8 = 0x7;
    /// Setup internal reference.
    pub const SETUP_REF: u8 = 0x8;
}

/// DAC8568 channel addresses (4-bit, bits 23:20).
mod dac_ch {
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
fn build_word(command: u8, address: u8, data: u16, feature: u8) -> [u8; 4] {
    let word: u32 = ((command as u32 & 0xF) << 24)
        | ((address as u32 & 0xF) << 20)
        | ((data as u32) << 4)
        | (feature as u32 & 0xF);
    word.to_be_bytes()
}

/// Hardware handle for both DAC chips on SPI1.
pub struct DacOutput<'a> {
    spi: Spi<'a, embassy_rp::peripherals::SPI1, embassy_rp::spi::Blocking>,
    cs1: Output<'a>,
    cs2: Output<'a>,
}

impl<'a> DacOutput<'a> {
    pub fn new(
        spi: Spi<'a, embassy_rp::peripherals::SPI1, embassy_rp::spi::Blocking>,
        cs1: Output<'a>,
        cs2: Output<'a>,
    ) -> Self {
        // CS lines idle high (active low)
        Self { spi, cs1, cs2 }
    }

    /// Send a 32-bit word to DAC1.
    fn write_dac1(&mut self, word: &[u8; 4]) {
        self.cs1.set_low();
        let _ = self.spi.blocking_write(word);
        self.cs1.set_high();
    }

    /// Send a 32-bit word to DAC2.
    fn write_dac2(&mut self, word: &[u8; 4]) {
        self.cs2.set_low();
        let _ = self.spi.blocking_write(word);
        self.cs2.set_high();
    }

    /// Initialize both DACs: software reset, enable internal reference.
    pub fn init(&mut self) {
        // Software reset both DACs
        let reset = build_word(dac_cmd::RESET, 0, 0, 0);
        self.write_dac1(&reset);
        self.write_dac2(&reset);

        // Enable internal reference (2.5V × 2 = 5V full scale).
        // Feature bits: 0x1 = static mode, always on.
        let ref_on = build_word(dac_cmd::SETUP_REF, 0, 0, 0x1);
        self.write_dac1(&ref_on);
        self.write_dac2(&ref_on);
    }

    /// Set a single channel on DAC1 (gate/pitch outputs).
    /// channel: 0-7 (A-H), value: 0-65535
    pub fn set_dac1_channel(&mut self, channel: u8, value: u16) {
        let word = build_word(dac_cmd::WRITE_UPDATE, channel, value, 0);
        self.write_dac1(&word);
    }

    /// Set a single channel on DAC2 (velocity/mod outputs).
    pub fn set_dac2_channel(&mut self, channel: u8, value: u16) {
        let word = build_word(dac_cmd::WRITE_UPDATE, channel, value, 0);
        self.write_dac2(&word);
    }

    /// Convert MIDI note (0-127) to DAC value for 1V/octave pitch output.
    /// C0 (MIDI 12) = 0V, C1 (MIDI 24) = 1V, ..., C8 (MIDI 108) = 8V.
    /// DAC full scale = 5V (internal ref × 2). Op-amp gain = 2, offset = -2V.
    /// So DAC 0V → op-amp outputs -2V, DAC 5V → op-amp outputs +8V.
    /// Target: note 0 (C-1) → -2V → DAC 0V, note 12 (C0) → 0V → DAC 2V.
    /// Formula: dac_volts = (note - 0) / 12.0  (then clamp to 0-5V DAC range)
    /// Actually: pitch output = (dac_v * 2) - 2, so dac_v = (pitch_v + 2) / 2
    /// pitch_v = note/12 - 1 (C0=0V), dac_v = (note/12 - 1 + 2)/2 = (note/12 + 1)/2
    pub fn note_to_dac(note: u8) -> u16 {
        // Map note linearly. C0 (MIDI 12) = 0V output. DAC range 0-5V → op-amp out -2V to +8V.
        // Vout = semitones_above_c0 / 12.0 (1V/oct)
        // Vdac = (Vout + 2.0) / 2.0 (account for op-amp gain=2, offset=-2V)
        let semitones_above_c0 = (note as i16 - 12).max(0) as f32;
        let v_out = semitones_above_c0 / 12.0; // 1V/oct
        let v_dac = (v_out + 2.0) / 2.0; // account for op-amp gain=2, offset=-2V
        let normalized = (v_dac / 5.0).clamp(0.0, 1.0); // DAC range 0-5V
        (normalized * 65535.0) as u16
    }

    /// Convert velocity (0-127) to DAC value.
    /// DAC2 CH A-D. Op-amp gain ≈ 1.6, so DAC 5V → ~8V output.
    /// Map 0-127 → 0-65535.
    pub fn velocity_to_dac(velocity: u8) -> u16 {
        ((velocity as u32 * 65535) / 127) as u16
    }

    /// Convert modulation (0-127) to DAC value.
    /// DAC2 CH E-H. Op-amp: inverting gain=-2, offset=+5V.
    /// DAC 0V → +5V out, DAC 5V → -5V out. So for 0-127 → 0V to +5V:
    /// We want mod 0 = 0V out (DAC = 2.5V), mod 127 = +5V out (DAC = 0V).
    /// Vout = 5 - 2*Vdac, so Vdac = (5 - Vout) / 2
    /// For Vout = mod/127 * 5: Vdac = (5 - mod/127*5) / 2 = 5*(1 - mod/127) / 2
    pub fn mod_to_dac(modulation: u8) -> u16 {
        let mod_frac = modulation as f32 / 127.0;
        let v_dac = 5.0 * (1.0 - mod_frac) / 2.0;
        let normalized = (v_dac / 5.0).clamp(0.0, 1.0);
        (normalized * 65535.0) as u16
    }

    /// Convert gate on/off to DAC value.
    /// DAC1 CH A-D, unity gain buffer. Gate high = 5V, gate low = 0V.
    pub fn gate_to_dac(gate: bool) -> u16 {
        if gate { 65535 } else { 0 }
    }

    /// Update all outputs from a set of NoteEvents (one per output).
    pub fn update_from_events(
        &mut self,
        events: &[Option<requencer_engine::types::NoteEvent>; 4],
        gate_state: &mut [bool; 4],
    ) {
        for (i, event) in events.iter().enumerate() {
            if let Some(ev) = event {
                gate_state[i] = ev.gate;
                let ch = i as u8;

                // DAC1: gates (CH A-D) and pitches (CH E-H)
                self.set_dac1_channel(ch, Self::gate_to_dac(ev.gate));
                self.set_dac1_channel(ch + 4, Self::note_to_dac(ev.pitch));

                // DAC2: velocity (CH A-D) and modulation (CH E-H)
                self.set_dac2_channel(ch, Self::velocity_to_dac(ev.velocity));
                self.set_dac2_channel(ch + 4, Self::mod_to_dac(ev.modulation));
            }
        }
    }
}
