//! Clock and reset I/O for external sync.
//!
//! - Clock IN:  GP26 (ADC0 as digital) — rising edge = clock pulse
//! - Reset IN:  GP27 (ADC1 as digital) — rising edge = reset
//! - Clock OUT: GP28 — via 2N3904 (inverted: LOW = 5V output)
//! - Reset OUT: GP4  — via 2N3904 (inverted: LOW = 5V output)
//!
//! Input protection: 22kΩ/10kΩ 1% divider + BAT54S Schottky clamp + 100nF filter.

use embassy_rp::gpio::{Input, Output};

/// Clock/reset I/O driver.
pub struct ClockIo<'a> {
    clock_in: Input<'a>,
    reset_in: Input<'a>,
    clock_out: Output<'a>,
    reset_out: Output<'a>,
    /// Previous state for edge detection.
    prev_clock_in: bool,
    prev_reset_in: bool,
}

impl<'a> ClockIo<'a> {
    pub fn new(
        clock_in: Input<'a>,
        reset_in: Input<'a>,
        clock_out: Output<'a>,
        reset_out: Output<'a>,
    ) -> Self {
        Self {
            clock_in,
            reset_in,
            clock_out,
            reset_out,
            prev_clock_in: false,
            prev_reset_in: false,
        }
    }

    /// Check for rising edge on clock input. Call from scan loop.
    pub fn clock_pulse(&mut self) -> bool {
        let current = self.clock_in.is_high();
        let rising = current && !self.prev_clock_in;
        self.prev_clock_in = current;
        rising
    }

    /// Check for rising edge on reset input.
    pub fn reset_pulse(&mut self) -> bool {
        let current = self.reset_in.is_high();
        let rising = current && !self.prev_reset_in;
        self.prev_reset_in = current;
        rising
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
