//! External clock/reset I/O via GPIO.
//!
//! Generic over `embedded-hal` GPIO traits.
//! Clock/Reset outputs use inverted logic (GPIO LOW = jack HIGH via transistor).

use embedded_hal::digital::{InputPin, OutputPin};

/// Clock/reset output driver, generic over GPIO pins.
pub struct ClockOutput<CLK, RST> {
    clk_out: CLK,
    rst_out: RST,
}

impl<CLK, RST> ClockOutput<CLK, RST>
where
    CLK: OutputPin,
    RST: OutputPin,
{
    pub fn new(clk_out: CLK, rst_out: RST) -> Self {
        Self { clk_out, rst_out }
    }

    /// Pulse clock output high (LOW on GPIO = HIGH on jack via transistor).
    pub fn pulse_clock(&mut self) {
        let _ = self.clk_out.set_low();
    }

    pub fn release_clock(&mut self) {
        let _ = self.clk_out.set_high();
    }

    pub fn pulse_reset(&mut self) {
        let _ = self.rst_out.set_low();
    }

    pub fn release_reset(&mut self) {
        let _ = self.rst_out.set_high();
    }
}

/// Clock/reset input reader, generic over GPIO pins.
pub struct ClockInput<CLK, RST> {
    clk_in: CLK,
    rst_in: RST,
    clk_prev: bool,
    rst_prev: bool,
}

impl<CLK, RST> ClockInput<CLK, RST>
where
    CLK: InputPin,
    RST: InputPin,
{
    pub fn new(clk_in: CLK, rst_in: RST) -> Self {
        Self {
            clk_in,
            rst_in,
            clk_prev: false,
            rst_prev: false,
        }
    }

    /// Check for rising edge on clock input.
    pub fn clock_edge(&mut self) -> bool {
        let current = self.clk_in.is_high().unwrap_or(false);
        let edge = current && !self.clk_prev;
        self.clk_prev = current;
        edge
    }

    /// Check for rising edge on reset input.
    pub fn reset_edge(&mut self) -> bool {
        let current = self.rst_in.is_high().unwrap_or(false);
        let edge = current && !self.rst_prev;
        self.rst_prev = current;
        edge
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use embedded_hal_mock::eh1::digital::{Mock as PinMock, State, Transaction as PinTx};

    #[test]
    fn clock_output_inverted_logic() {
        let clk = PinMock::new(&[PinTx::set(State::Low)]);
        let rst = PinMock::new(&[]);

        let mut out = ClockOutput::new(clk, rst);
        out.pulse_clock(); // should set GPIO LOW (= jack HIGH)

        out.clk_out.done();
        out.rst_out.done();
    }

    #[test]
    fn clock_input_rising_edge() {
        let clk = PinMock::new(&[
            PinTx::get(State::Low),
            PinTx::get(State::High),
            PinTx::get(State::High),
        ]);
        let rst = PinMock::new(&[]);

        let mut input = ClockInput::new(clk, rst);
        assert!(!input.clock_edge()); // low → no edge
        assert!(input.clock_edge()); // low→high = rising edge
        assert!(!input.clock_edge()); // high→high = no edge

        input.clk_in.done();
        input.rst_in.done();
    }
}
