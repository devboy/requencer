//! ADC CV inputs A-D on GP40-43 (ADC4-7).
//!
//! 12-bit ADC, 0-3.3V range. Hardware voltage divider (22kΩ/10kΩ) maps
//! 0-10V eurorack range to 0-3.12V ADC range.
//!
//! Read at ~100 Hz, values available for modulation routing.

use embassy_rp::adc::{Adc, Channel};

/// CV input readings (normalized 0.0-1.0).
#[derive(Clone, Copy, Default)]
pub struct CvReadings {
    pub a: f32,
    pub b: f32,
    pub c: f32,
    pub d: f32,
}

/// Read all 4 CV inputs and return normalized values.
pub async fn read_cv(
    adc: &mut Adc<'_, embassy_rp::adc::Async>,
    ch_a: &mut Channel<'_>,
    ch_b: &mut Channel<'_>,
    ch_c: &mut Channel<'_>,
    ch_d: &mut Channel<'_>,
) -> CvReadings {
    let raw_a = adc.read(ch_a).await.unwrap_or(0);
    let raw_b = adc.read(ch_b).await.unwrap_or(0);
    let raw_c = adc.read(ch_c).await.unwrap_or(0);
    let raw_d = adc.read(ch_d).await.unwrap_or(0);

    CvReadings {
        a: adc_to_normalized(raw_a),
        b: adc_to_normalized(raw_b),
        c: adc_to_normalized(raw_c),
        d: adc_to_normalized(raw_d),
    }
}

/// Convert 12-bit ADC reading to normalized 0.0-1.0 float.
fn adc_to_normalized(raw: u16) -> f32 {
    (raw as f32) / 4095.0
}

/// Convert normalized reading back to approximate input voltage (0-10V).
#[allow(dead_code)]
pub fn normalized_to_volts(normalized: f32) -> f32 {
    // Voltage divider: Vin × 10k / (22k + 10k) = Vadc
    // So Vin = Vadc × 3.2 ≈ normalized × 3.3V × 3.2
    normalized * 3.3 * 3.2
}
