//! Tick timing calculations — pure math, no hardware dependencies.

/// Pulses Per Quarter Note — standard MIDI clock resolution.
pub const PPQN: u32 = 24;

/// Calculate tick period in microseconds from BPM.
///
/// At 120 BPM: 60_000_000 / (120 × 24) = 20_833 µs ≈ 48 Hz
pub fn tick_period_us(bpm: u16) -> u64 {
    60_000_000 / (bpm as u64 * PPQN as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn period_120_bpm() {
        assert_eq!(tick_period_us(120), 20_833);
    }

    #[test]
    fn period_60_bpm() {
        assert_eq!(tick_period_us(60), 41_666);
    }

    #[test]
    fn period_240_bpm() {
        assert_eq!(tick_period_us(240), 10_416);
    }

    #[test]
    fn period_1_bpm() {
        assert_eq!(tick_period_us(1), 2_500_000);
    }
}
