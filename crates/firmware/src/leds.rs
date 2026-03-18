//! IS31FL3216A LED driver chain — 3× I2C constant-current drivers, 22 single-color LEDs.
//!
//! GP12 = I2C0 SDA, GP13 = I2C0 SCL (RP2350 function select F3).
//!
//! IS31FL3216A: 16 channels × 8-bit PWM each. 3 chips on shared I2C0 bus.
//! Write PWM registers then pulse Update register to latch.
//!
//! Channel mapping (from control.ato):
//!   led_a (0x68, AD=GND): step1-4 (OUT1-4), step9-12 (OUT5-8), t1-t4 (OUT9-12)
//!   led_b (0x6B, AD=VCC): step5-8 (OUT13-16), step13-16 (OUT9-12), clr (OUT5)
//!   led_c (0x6A, AD=SDA): play (OUT1)

use embassy_rp::i2c::{self, I2c};
use requencer_engine::ui_types::{LedMode, LedState};

/// I2C addresses (7-bit) per IS31FL3216A datasheet Table 1.
const ADDR_A: u8 = 0x68; // AD=GND
const ADDR_B: u8 = 0x6B; // AD=VCC
const ADDR_C: u8 = 0x6A; // AD=SDA

// Register addresses (IS31FL3216A datasheet Table 2)
const REG_CONFIG: u8 = 0x00;
const REG_LED_CTRL_HI: u8 = 0x01; // OUT9-OUT16 enable
const REG_LED_CTRL_LO: u8 = 0x02; // OUT1-OUT8 enable
const REG_LIGHTING: u8 = 0x03;
const REG_PWM_BASE: u8 = 0x10; // OUT1=0x10 .. OUT16=0x1F
const REG_UPDATE: u8 = 0xB0;

// Config register: SSD=1 (normal operation), MODE=00 (PWM), AE=0
const CONFIG_NORMAL: u8 = 0x80;
// Config register: SSD=0 (software shutdown)
const CONFIG_SHUTDOWN: u8 = 0x00;

// Brightness levels (8-bit PWM)
const BRIGHT_ON: u8 = 0xFF;
const BRIGHT_DIM: u8 = 0x20;
const BRIGHT_OFF: u8 = 0x00;

type I2c0 = I2c<'static, embassy_rp::peripherals::I2C0, i2c::Blocking>;

/// LED driver handle for 3× IS31FL3216A over I2C0.
pub struct LedDriver {
    i2c: I2c0,
    /// Flash toggle state (toggled at ~4Hz for flashing LEDs).
    flash_on: bool,
    flash_counter: u8,
}

impl LedDriver {
    pub fn new(i2c: I2c0) -> Self {
        Self {
            i2c,
            flash_on: false,
            flash_counter: 0,
        }
    }

    /// Write a single register on one chip.
    fn write_reg(&mut self, addr: u8, reg: u8, value: u8) {
        let _ = self.i2c.blocking_write(addr, &[reg, value]);
    }

    /// Write PWM values for all 16 channels on one chip using auto-increment.
    fn write_pwm_burst(&mut self, addr: u8, values: &[u8; 16]) {
        let mut buf = [0u8; 17]; // register address + 16 data bytes
        buf[0] = REG_PWM_BASE;
        buf[1..17].copy_from_slice(values);
        let _ = self.i2c.blocking_write(addr, &buf);
    }

    /// Initialize one IS31FL3216A chip.
    fn init_chip(&mut self, addr: u8) {
        // Software shutdown first (clean state)
        self.write_reg(addr, REG_CONFIG, CONFIG_SHUTDOWN);

        // Enable all 16 LED outputs
        self.write_reg(addr, REG_LED_CTRL_HI, 0xFF); // OUT9-OUT16
        self.write_reg(addr, REG_LED_CTRL_LO, 0xFF); // OUT1-OUT8

        // Lighting effect: CS=000 (I_LED × 1.0), no audio
        self.write_reg(addr, REG_LIGHTING, 0x00);

        // All PWM to 0
        let zeros = [0u8; 16];
        self.write_pwm_burst(addr, &zeros);
        self.write_reg(addr, REG_UPDATE, 0x00);

        // Normal operation
        self.write_reg(addr, REG_CONFIG, CONFIG_NORMAL);
    }

    /// Initialize all 3 chips.
    pub fn init(&mut self) {
        self.init_chip(ADDR_A);
        self.init_chip(ADDR_B);
        self.init_chip(ADDR_C);
    }

    /// Map LedMode to 8-bit PWM brightness.
    fn mode_to_pwm(&self, mode: LedMode) -> u8 {
        match mode {
            LedMode::On => BRIGHT_ON,
            LedMode::Dim => BRIGHT_DIM,
            LedMode::Flash => {
                if self.flash_on {
                    BRIGHT_ON
                } else {
                    BRIGHT_OFF
                }
            }
            LedMode::Off => BRIGHT_OFF,
        }
    }

    /// Update LED state from the engine's LedState.
    pub fn update(&mut self, led_state: &LedState, _selected_track: u8) {
        // Toggle flash at ~4Hz (called at ~30Hz, so toggle every 8 calls)
        self.flash_counter = self.flash_counter.wrapping_add(1);
        if self.flash_counter >= 8 {
            self.flash_counter = 0;
            self.flash_on = !self.flash_on;
        }

        // --- Chip A (0x68): step1-4, step9-12, t1-t4 ---
        let mut pwm_a = [0u8; 16];
        // OUT1-4 = step1-4
        for i in 0..4 {
            pwm_a[i] = self.mode_to_pwm(led_state.steps[i]);
        }
        // OUT5-8 = step9-12
        for i in 0..4 {
            pwm_a[4 + i] = self.mode_to_pwm(led_state.steps[8 + i]);
        }
        // OUT9-12 = track buttons t1-t4
        for i in 0..4 {
            pwm_a[8 + i] = if led_state.tracks[i] { BRIGHT_ON } else { BRIGHT_OFF };
        }
        self.write_pwm_burst(ADDR_A, &pwm_a);
        self.write_reg(ADDR_A, REG_UPDATE, 0x00);

        // --- Chip B (0x6B): step5-8, step13-16, clr ---
        let mut pwm_b = [0u8; 16];
        // OUT5 = clr button
        pwm_b[4] = self.mode_to_pwm(led_state.subtracks[0]); // clr maps to subtrack[0]
        // OUT9-12 = step13-16
        for i in 0..4 {
            pwm_b[8 + i] = self.mode_to_pwm(led_state.steps[12 + i]);
        }
        // OUT13-16 = step5-8
        for i in 0..4 {
            pwm_b[12 + i] = self.mode_to_pwm(led_state.steps[4 + i]);
        }
        self.write_pwm_burst(ADDR_B, &pwm_b);
        self.write_reg(ADDR_B, REG_UPDATE, 0x00);

        // --- Chip C (0x6A): play ---
        let mut pwm_c = [0u8; 16];
        pwm_c[0] = self.mode_to_pwm(led_state.play); // OUT1 = play
        self.write_pwm_burst(ADDR_C, &pwm_c);
        self.write_reg(ADDR_C, REG_UPDATE, 0x00);
    }
}
