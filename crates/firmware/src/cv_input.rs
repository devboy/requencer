//! CV input reading via ADC4-7 on RP2350B.
//!
//! GP40 = ADC4 (CV A), GP41 = ADC5 (CV B), GP42 = ADC6 (CV C), GP43 = ADC7 (CV D).
//!
//! Hardware: 22kΩ/10kΩ 1% voltage divider + BAT54S Schottky clamp + 100nF filter.
//! Input range: -5V to +10V eurorack → 0V to 3.125V at ADC (divider ratio 10/(10+22) = 0.3125).
//!
//! ADC is 12-bit (0-4095), Vref = 3.3V.
//! ADC reading → input voltage: V_in = (adc_raw / 4095.0) * 3.3 / 0.3125
//!
//! CV modulation is mapped to engine parameters via a simple scheme:
//! - CV A: pitch offset (semitones, 1V/oct → 12 semitones per volt)
//! - CV B: gate threshold (>1V = gate high)
//! - CV C: velocity (0-5V → 0-127)
//! - CV D: modulation (0-5V → 0-127)

/// Voltage divider ratio: R2 / (R1 + R2) = 10kΩ / (22kΩ + 10kΩ)
const DIVIDER_RATIO: f32 = 10.0 / 32.0;

/// ADC reference voltage (RP2350 internal).
const VREF: f32 = 3.3;

/// ADC resolution (12-bit).
const ADC_MAX: f32 = 4095.0;

/// Convert a 12-bit ADC reading to the actual input voltage (before divider).
/// Returns the eurorack-level voltage in the range roughly -5V to +10V.
pub fn adc_to_voltage(raw: u16) -> f32 {
    let v_adc = (raw as f32 / ADC_MAX) * VREF;
    v_adc / DIVIDER_RATIO
}

/// Convert input voltage to pitch offset in semitones (1V/octave).
/// 0V = 0 semitones offset. Returns signed value.
pub fn voltage_to_semitones(voltage: f32) -> i8 {
    let semitones = voltage * 12.0;
    semitones.clamp(-128.0, 127.0) as i8
}

/// Convert input voltage to a gate state. Threshold at 1V.
pub fn voltage_to_gate(voltage: f32) -> bool {
    voltage > 1.0
}

/// Convert input voltage (0-5V) to MIDI-range value (0-127).
/// Clamps to valid range.
pub fn voltage_to_midi_value(voltage: f32) -> u8 {
    let normalized = (voltage / 5.0).clamp(0.0, 1.0);
    (normalized * 127.0) as u8
}

/// Smoothed CV input channel. Applies exponential moving average to reduce noise.
pub struct CvChannel {
    /// Smoothed ADC value (fixed-point, 8 fractional bits for precision).
    smoothed: u32,
    /// Previous output value for change detection.
    prev_value: u16,
}

impl CvChannel {
    pub const fn new() -> Self {
        Self {
            smoothed: 0,
            prev_value: 0,
        }
    }

    /// Feed a new raw ADC sample. Returns the smoothed 12-bit value.
    /// Uses exponential moving average: out = out * 7/8 + sample * 1/8
    pub fn update(&mut self, raw: u16) -> u16 {
        // Scale up to fixed-point (8 fractional bits)
        let sample = (raw as u32) << 8;
        // EMA with alpha = 1/8: fast enough to track CV, smooth enough for noise
        self.smoothed = self.smoothed - (self.smoothed >> 3) + (sample >> 3);
        // Return integer part
        (self.smoothed >> 8) as u16
    }

    /// Check if the smoothed value changed by more than `threshold` since last check.
    /// Returns Some(new_value) if changed, None otherwise.
    pub fn changed(&mut self, threshold: u16) -> Option<u16> {
        let current = (self.smoothed >> 8) as u16;
        let diff = if current > self.prev_value {
            current - self.prev_value
        } else {
            self.prev_value - current
        };
        if diff >= threshold {
            self.prev_value = current;
            Some(current)
        } else {
            None
        }
    }
}

/// Four CV input channels with smoothing.
pub struct CvInputs {
    pub channels: [CvChannel; 4],
}

impl CvInputs {
    pub const fn new() -> Self {
        Self {
            channels: [
                CvChannel::new(),
                CvChannel::new(),
                CvChannel::new(),
                CvChannel::new(),
            ],
        }
    }
}

#[cfg(target_os = "none")]
use embassy_rp::adc::{Adc, Channel};

/// Hardware CV input reader wrapping RP2350B ADC.
#[cfg(target_os = "none")]
pub struct CvReader<'a> {
    adc: Adc<'a, embassy_rp::adc::Blocking>,
    ch_a: Channel<'a>,
    ch_b: Channel<'a>,
    ch_c: Channel<'a>,
    ch_d: Channel<'a>,
    pub inputs: CvInputs,
}

#[cfg(target_os = "none")]
impl<'a> CvReader<'a> {
    pub fn new(
        adc: Adc<'a, embassy_rp::adc::Blocking>,
        ch_a: Channel<'a>,
        ch_b: Channel<'a>,
        ch_c: Channel<'a>,
        ch_d: Channel<'a>,
    ) -> Self {
        Self {
            adc,
            ch_a,
            ch_b,
            ch_c,
            ch_d,
            inputs: CvInputs::new(),
        }
    }

    /// Sample all 4 CV channels and update smoothing filters.
    /// Returns array of smoothed 12-bit values.
    pub fn sample_all(&mut self) -> [u16; 4] {
        let raw = [
            self.adc.blocking_read(&mut self.ch_a).unwrap_or(0),
            self.adc.blocking_read(&mut self.ch_b).unwrap_or(0),
            self.adc.blocking_read(&mut self.ch_c).unwrap_or(0),
            self.adc.blocking_read(&mut self.ch_d).unwrap_or(0),
        ];
        [
            self.inputs.channels[0].update(raw[0]),
            self.inputs.channels[1].update(raw[1]),
            self.inputs.channels[2].update(raw[2]),
            self.inputs.channels[3].update(raw[3]),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Voltage conversion tests ──────────────────────────────────

    #[test]
    fn adc_zero_is_zero_volts() {
        assert_eq!(adc_to_voltage(0), 0.0);
    }

    #[test]
    fn adc_max_is_full_scale() {
        let v = adc_to_voltage(4095);
        // 4095/4095 * 3.3 / 0.3125 = 10.56V
        assert!((v - 10.56).abs() < 0.01);
    }

    #[test]
    fn adc_midpoint_voltage() {
        let v = adc_to_voltage(2048);
        // ~5.28V
        let expected = (2048.0 / 4095.0) * 3.3 / DIVIDER_RATIO;
        assert!((v - expected).abs() < 0.01);
    }

    #[test]
    fn voltage_0v_at_adc() {
        // 0V input → 0V at ADC → 0 reading
        let v = adc_to_voltage(0);
        assert_eq!(v, 0.0);
    }

    #[test]
    fn voltage_5v_adc_reading() {
        // 5V input → 5 * 0.3125 = 1.5625V at ADC → ~1940 ADC counts
        let adc_val = ((5.0 * DIVIDER_RATIO / VREF) * ADC_MAX) as u16;
        let v = adc_to_voltage(adc_val);
        assert!((v - 5.0).abs() < 0.05);
    }

    // ── Semitone conversion tests ─────────────────────────────────

    #[test]
    fn zero_volts_zero_semitones() {
        assert_eq!(voltage_to_semitones(0.0), 0);
    }

    #[test]
    fn one_volt_twelve_semitones() {
        assert_eq!(voltage_to_semitones(1.0), 12);
    }

    #[test]
    fn five_volts_sixty_semitones() {
        assert_eq!(voltage_to_semitones(5.0), 60);
    }

    #[test]
    fn negative_voltage_negative_semitones() {
        assert_eq!(voltage_to_semitones(-1.0), -12);
    }

    #[test]
    fn semitones_clamp_high() {
        // 15V would be 180 semitones, clamped to 127
        assert_eq!(voltage_to_semitones(15.0), 127);
    }

    #[test]
    fn semitones_clamp_low() {
        assert_eq!(voltage_to_semitones(-15.0), -128);
    }

    #[test]
    fn half_volt_six_semitones() {
        assert_eq!(voltage_to_semitones(0.5), 6);
    }

    // ── Gate conversion tests ─────────────────────────────────────

    #[test]
    fn gate_below_threshold() {
        assert!(!voltage_to_gate(0.0));
        assert!(!voltage_to_gate(0.5));
        assert!(!voltage_to_gate(1.0)); // exactly 1V is not above threshold
    }

    #[test]
    fn gate_above_threshold() {
        assert!(voltage_to_gate(1.1));
        assert!(voltage_to_gate(5.0));
        assert!(voltage_to_gate(10.0));
    }

    // ── MIDI value conversion tests ───────────────────────────────

    #[test]
    fn midi_value_zero_volts() {
        assert_eq!(voltage_to_midi_value(0.0), 0);
    }

    #[test]
    fn midi_value_five_volts() {
        assert_eq!(voltage_to_midi_value(5.0), 127);
    }

    #[test]
    fn midi_value_midpoint() {
        let v = voltage_to_midi_value(2.5);
        assert!(v >= 63 && v <= 64); // 2.5/5 * 127 = 63.5
    }

    #[test]
    fn midi_value_clamps_negative() {
        assert_eq!(voltage_to_midi_value(-1.0), 0);
    }

    #[test]
    fn midi_value_clamps_high() {
        assert_eq!(voltage_to_midi_value(10.0), 127);
    }

    // ── CvChannel smoothing tests ─────────────────────────────────

    #[test]
    fn cv_channel_initial_zero() {
        let ch = CvChannel::new();
        assert_eq!(ch.prev_value, 0);
    }

    #[test]
    fn cv_channel_converges_to_constant() {
        let mut ch = CvChannel::new();
        // Feed constant value — should converge
        for _ in 0..64 {
            ch.update(2000);
        }
        let val = ch.update(2000);
        assert!((val as i32 - 2000).unsigned_abs() <= 1);
    }

    #[test]
    fn cv_channel_smooths_noise() {
        let mut ch = CvChannel::new();
        // Warm up to 2000
        for _ in 0..64 {
            ch.update(2000);
        }
        // Single spike should be smoothed
        let after_spike = ch.update(3000);
        assert!(after_spike < 2200, "spike not smoothed: {}", after_spike);
    }

    #[test]
    fn cv_channel_tracks_slow_ramp() {
        let mut ch = CvChannel::new();
        // Ramp from 0 to 4000 over 100 samples
        for i in 0..100 {
            let target = (i * 40) as u16;
            ch.update(target);
        }
        let final_val = ch.update(4000);
        // Should be close to 4000 after sustained input
        // EMA with alpha=1/8 takes ~16 samples to reach 87% of step
        // After 100 samples of ramp, it'll lag slightly
        assert!(final_val > 3000, "ramp not tracked: {}", final_val);
    }

    #[test]
    fn cv_channel_change_detection() {
        let mut ch = CvChannel::new();
        // Warm up
        for _ in 0..64 {
            ch.update(1000);
        }
        // No change should return None
        assert!(ch.changed(10).is_none() || ch.changed(10).is_none());

        // Big change
        for _ in 0..64 {
            ch.update(3000);
        }
        let result = ch.changed(10);
        assert!(result.is_some(), "large change not detected");
        let val = result.unwrap();
        assert!((val as i32 - 3000).unsigned_abs() <= 5);
    }

    #[test]
    fn cv_channel_small_change_ignored() {
        let mut ch = CvChannel::new();
        for _ in 0..64 {
            ch.update(2000);
        }
        // Mark current value
        ch.changed(50);

        // Small change (within threshold)
        for _ in 0..64 {
            ch.update(2030);
        }
        assert!(ch.changed(50).is_none());
    }

    // ── End-to-end conversion tests ───────────────────────────────

    #[test]
    fn adc_to_semitones_1v_oct() {
        // 1V input → ADC ≈ 388 → back to ~1V → 12 semitones
        // Allow ±1 semitone for ADC quantization
        let adc_val = ((1.0 * DIVIDER_RATIO / VREF) * ADC_MAX) as u16;
        let v = adc_to_voltage(adc_val);
        let semis = voltage_to_semitones(v);
        assert!((semis - 12).abs() <= 1, "expected ~12 semitones, got {}", semis);
    }

    #[test]
    fn adc_to_gate_threshold() {
        // Just above 1V threshold
        let adc_above = ((1.1 * DIVIDER_RATIO / VREF) * ADC_MAX) as u16;
        assert!(voltage_to_gate(adc_to_voltage(adc_above)));

        // Just below
        let adc_below = ((0.9 * DIVIDER_RATIO / VREF) * ADC_MAX) as u16;
        assert!(!voltage_to_gate(adc_to_voltage(adc_below)));
    }

    #[test]
    fn full_scale_cv_to_midi() {
        // 5V → should map to ~127 (allow ADC quantization rounding)
        let adc_5v = ((5.0 * DIVIDER_RATIO / VREF) * ADC_MAX) as u16;
        let midi_val = voltage_to_midi_value(adc_to_voltage(adc_5v));
        assert!(midi_val >= 126, "expected ~127, got {}", midi_val);
    }
}
