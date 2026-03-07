//! Rotary encoder (EC11E × 2) quadrature decoding + push button.
//!
//! Each encoder has:
//! - Phase A + Phase B for rotation (gray code)
//! - Push switch for press events
//!
//! Hardware has 10kΩ pull-ups + 100nF caps (~1ms RC time constant).
//! Firmware debounce: ~30ms for push, quadrature state machine for rotation.

use embassy_rp::gpio::Input;
use requencer_engine::input::ControlEvent;

/// Quadrature state machine for one encoder.
/// Tracks gray code transitions to determine direction.
struct QuadratureState {
    prev_a: bool,
    prev_b: bool,
    /// Accumulated sub-detent steps (4 edges per detent for EC11E).
    sub_steps: i8,
}

impl QuadratureState {
    const fn new() -> Self {
        Self {
            prev_a: false,
            prev_b: false,
            sub_steps: 0,
        }
    }

    /// Update with new A/B readings. Returns delta detents (-1, 0, or +1).
    fn update(&mut self, a: bool, b: bool) -> i32 {
        let prev = (self.prev_a as u8) << 1 | self.prev_b as u8;
        let curr = (a as u8) << 1 | b as u8;
        self.prev_a = a;
        self.prev_b = b;

        // Gray code direction table
        // Transitions that indicate CW rotation: 00→01, 01→11, 11→10, 10→00
        // Transitions that indicate CCW rotation: 00→10, 10→11, 11→01, 01→00
        let direction: i8 = match (prev, curr) {
            (0b00, 0b01) => 1,
            (0b01, 0b11) => 1,
            (0b11, 0b10) => 1,
            (0b10, 0b00) => 1,
            (0b00, 0b10) => -1,
            (0b10, 0b11) => -1,
            (0b11, 0b01) => -1,
            (0b01, 0b00) => -1,
            _ => 0, // no change or invalid (missed edge)
        };

        self.sub_steps += direction;

        // EC11E has 4 edges per detent — emit one delta per detent
        if self.sub_steps >= 4 {
            self.sub_steps -= 4;
            return 1;
        } else if self.sub_steps <= -4 {
            self.sub_steps += 4;
            return -1;
        }
        0
    }
}

/// Push button debounce state.
struct ButtonDebounce {
    /// How many consecutive reads the button has been in the target state.
    stable_count: u8,
    /// Last debounced state (true = pressed).
    debounced: bool,
}

impl ButtonDebounce {
    const fn new() -> Self {
        Self {
            stable_count: 0,
            debounced: false,
        }
    }

    /// Update with a raw reading. Returns Some(true) on press, Some(false) on release.
    /// Debounce threshold: 6 reads at ~1kHz polling ≈ 6ms (hardware RC + firmware).
    fn update(&mut self, pressed: bool) -> Option<bool> {
        if pressed != self.debounced {
            self.stable_count += 1;
            if self.stable_count >= 6 {
                self.debounced = pressed;
                self.stable_count = 0;
                return Some(pressed);
            }
        } else {
            self.stable_count = 0;
        }
        None
    }
}

/// Encoder pair — two encoders (A and B) with rotation + push.
pub struct EncoderPair<'a> {
    enc_a_phase_a: Input<'a>,
    enc_a_phase_b: Input<'a>,
    enc_a_push: Input<'a>,
    enc_b_phase_a: Input<'a>,
    enc_b_phase_b: Input<'a>,
    enc_b_push: Input<'a>,
    quad_a: QuadratureState,
    quad_b: QuadratureState,
    btn_a: ButtonDebounce,
    btn_b: ButtonDebounce,
}

impl<'a> EncoderPair<'a> {
    pub fn new(
        enc_a_phase_a: Input<'a>,
        enc_a_phase_b: Input<'a>,
        enc_a_push: Input<'a>,
        enc_b_phase_a: Input<'a>,
        enc_b_phase_b: Input<'a>,
        enc_b_push: Input<'a>,
    ) -> Self {
        Self {
            enc_a_phase_a,
            enc_a_phase_b,
            enc_a_push,
            enc_b_phase_a,
            enc_b_phase_b,
            enc_b_push,
            quad_a: QuadratureState::new(),
            quad_b: QuadratureState::new(),
            btn_a: ButtonDebounce::new(),
            btn_b: ButtonDebounce::new(),
        }
    }

    /// Poll both encoders. Call at ~1kHz. Pushes events into the provided vec.
    pub fn poll(&mut self, events: &mut heapless::Vec<ControlEvent, 8>) {
        // Encoder A rotation
        let delta_a = self.quad_a.update(
            self.enc_a_phase_a.is_high(),
            self.enc_a_phase_b.is_high(),
        );
        if delta_a != 0 {
            let _ = events.push(ControlEvent::EncoderATurn { delta: delta_a });
        }

        // Encoder B rotation
        let delta_b = self.quad_b.update(
            self.enc_b_phase_a.is_high(),
            self.enc_b_phase_b.is_high(),
        );
        if delta_b != 0 {
            let _ = events.push(ControlEvent::EncoderBTurn { delta: delta_b });
        }

        // Encoder A push (active low — switch connects to GND)
        if let Some(pressed) = self.btn_a.update(self.enc_a_push.is_low()) {
            if pressed {
                let _ = events.push(ControlEvent::EncoderAPush);
            }
        }

        // Encoder B push
        if let Some(pressed) = self.btn_b.update(self.enc_b_push.is_low()) {
            if pressed {
                let _ = events.push(ControlEvent::EncoderBPush);
            }
        }
    }
}
