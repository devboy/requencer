//! EC11E rotary encoder quadrature decoding.
//!
//! Pure state machine — no hardware dependencies. The `QuadratureDecoder`
//! tracks Gray code transitions and accumulates fractional steps.

/// Quadrature state machine for one encoder.
///
/// EC11E encoders produce 4 quadrature edges per mechanical detent.
pub struct QuadratureDecoder {
    prev_state: u8,
    accum: i8,
}

impl QuadratureDecoder {
    pub fn new() -> Self {
        Self {
            prev_state: 0,
            accum: 0,
        }
    }

    /// Update with new A/B pin readings. Returns delta detents (±1 or 0).
    pub fn update(&mut self, a: bool, b: bool) -> i32 {
        let new_state = ((a as u8) << 1) | (b as u8);
        let delta: i8 = match (self.prev_state, new_state) {
            (0b00, 0b01) => 1,
            (0b01, 0b11) => 1,
            (0b11, 0b10) => 1,
            (0b10, 0b00) => 1,
            (0b00, 0b10) => -1,
            (0b10, 0b11) => -1,
            (0b11, 0b01) => -1,
            (0b01, 0b00) => -1,
            _ => 0,
        };
        self.prev_state = new_state;

        self.accum += delta;
        if self.accum >= 4 {
            self.accum -= 4;
            1
        } else if self.accum <= -4 {
            self.accum += 4;
            -1
        } else {
            0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_movement() {
        let mut dec = QuadratureDecoder::new();
        assert_eq!(dec.update(false, false), 0);
        assert_eq!(dec.update(false, false), 0);
    }

    #[test]
    fn clockwise_one_detent() {
        let mut dec = QuadratureDecoder::new();
        assert_eq!(dec.update(false, true), 0);
        assert_eq!(dec.update(true, true), 0);
        assert_eq!(dec.update(true, false), 0);
        assert_eq!(dec.update(false, false), 1);
    }

    #[test]
    fn counterclockwise_one_detent() {
        let mut dec = QuadratureDecoder::new();
        assert_eq!(dec.update(true, false), 0);
        assert_eq!(dec.update(true, true), 0);
        assert_eq!(dec.update(false, true), 0);
        assert_eq!(dec.update(false, false), -1);
    }

    #[test]
    fn two_detents_cw() {
        let mut dec = QuadratureDecoder::new();
        for i in 0..2 {
            dec.update(false, true);
            dec.update(true, true);
            dec.update(true, false);
            assert_eq!(dec.update(false, false), 1, "detent {}", i);
        }
    }

    #[test]
    fn partial_then_reverse_cancels() {
        let mut dec = QuadratureDecoder::new();
        dec.update(false, true); // +1
        dec.update(true, true); // +2
        dec.update(false, true); // +1 (reversed)
        assert_eq!(dec.update(false, false), 0);
    }

    #[test]
    fn invalid_transition_ignored() {
        let mut dec = QuadratureDecoder::new();
        assert_eq!(dec.update(true, true), 0); // 00→11 skip
    }
}
