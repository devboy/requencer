//! Clock and reset I/O for external sync.
//!
//! - Clock IN:  GP26 (ADC0 as digital) — rising edge = clock pulse
//! - Reset IN:  GP27 (ADC1 as digital) — rising edge = reset
//! - Clock OUT: GP28 — via 2N3904 (inverted: LOW = 5V output)
//! - Reset OUT: GP4  — via 2N3904 (inverted: LOW = 5V output)
//!
//! Input protection: 22kΩ/10kΩ 1% divider + BAT54S Schottky clamp + 100nF filter.
//!
//! Clock input uses interrupt-driven edge detection via a spawned embassy task.
//! The task waits for a GPIO rising edge and sets an atomic flag, which the
//! main loop polls. This ensures no clock pulses are missed regardless of
//! main loop latency.

#[cfg(target_os = "none")]
use embassy_rp::gpio::{Input, Output};
#[cfg(target_os = "none")]
use portable_atomic::{AtomicBool, Ordering};

/// Atomic flags shared between clock ISR tasks and main loop.
#[cfg(target_os = "none")]
pub static CLOCK_EDGE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "none")]
pub static RESET_EDGE: AtomicBool = AtomicBool::new(false);

/// Embassy task: waits for rising edge on clock input GPIO, sets atomic flag.
/// Spawned once at startup. Runs at highest available priority.
#[cfg(target_os = "none")]
#[embassy_executor::task]
pub async fn clock_input_task(mut pin: Input<'static>) {
    loop {
        pin.wait_for_rising_edge().await;
        CLOCK_EDGE.store(true, Ordering::Release);
    }
}

/// Embassy task: waits for rising edge on reset input GPIO, sets atomic flag.
#[cfg(target_os = "none")]
#[embassy_executor::task]
pub async fn reset_input_task(mut pin: Input<'static>) {
    loop {
        pin.wait_for_rising_edge().await;
        RESET_EDGE.store(true, Ordering::Release);
    }
}

/// Clock/reset output driver + edge flag polling.
#[cfg(target_os = "none")]
pub struct ClockIo<'a> {
    clock_out: Output<'a>,
    reset_out: Output<'a>,
}

#[cfg(target_os = "none")]
impl<'a> ClockIo<'a> {
    pub fn new(
        clock_out: Output<'a>,
        reset_out: Output<'a>,
    ) -> Self {
        Self { clock_out, reset_out }
    }

    /// Check and clear the clock edge flag (set by ISR task).
    pub fn clock_pulse(&mut self) -> bool {
        CLOCK_EDGE.swap(false, Ordering::AcqRel)
    }

    /// Check and clear the reset edge flag (set by ISR task).
    pub fn reset_pulse(&mut self) -> bool {
        RESET_EDGE.swap(false, Ordering::AcqRel)
    }

    /// Set clock output high (via NPN inverter: set GPIO LOW for 5V output).
    pub fn set_clock_out(&mut self, high: bool) {
        if high {
            self.clock_out.set_low(); // NPN inverted: low GPIO = high output
        } else {
            self.clock_out.set_high();
        }
    }

    /// Pulse reset output (via NPN inverter).
    pub fn pulse_reset_out(&mut self) {
        self.reset_out.set_low(); // Inverted: low = 5V output
        cortex_m::asm::delay(1500); // ~10µs pulse at 150MHz
        self.reset_out.set_high();
    }
}

/// Pure edge detector for host testing (no hardware GPIO).
pub struct EdgeDetector {
    prev: bool,
}

impl EdgeDetector {
    pub const fn new() -> Self {
        Self { prev: false }
    }

    /// Feed a level sample, returns true on rising edge.
    pub fn update(&mut self, level: bool) -> bool {
        let rising = level && !self.prev;
        self.prev = level;
        rising
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edge_detector_rising() {
        let mut ed = EdgeDetector::new();
        assert!(!ed.update(false));
        assert!(ed.update(true));  // rising edge
        assert!(!ed.update(true)); // still high, no edge
    }

    #[test]
    fn edge_detector_no_edge_on_low() {
        let mut ed = EdgeDetector::new();
        assert!(!ed.update(false));
        assert!(!ed.update(false));
    }

    #[test]
    fn edge_detector_falling_not_detected() {
        let mut ed = EdgeDetector::new();
        ed.update(true);
        assert!(!ed.update(false)); // falling edge not a rising edge
    }

    #[test]
    fn edge_detector_multiple_pulses() {
        let mut ed = EdgeDetector::new();
        // First pulse
        assert!(ed.update(true));
        assert!(!ed.update(false));
        // Second pulse
        assert!(ed.update(true));
        assert!(!ed.update(false));
        // Third pulse
        assert!(ed.update(true));
    }

    #[test]
    fn edge_detector_initial_high() {
        // If input starts high, first sample is a rising edge from implicit low
        let mut ed = EdgeDetector::new();
        assert!(ed.update(true));
    }

    #[test]
    fn edge_detector_rapid_toggle() {
        let mut ed = EdgeDetector::new();
        for _ in 0..10 {
            assert!(ed.update(true));
            assert!(!ed.update(false));
        }
    }
}
