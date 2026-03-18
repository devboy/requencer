//! GPIO pin assignments for the PGA2350 (RP2350B) board.
//!
//! All pin numbers match the hardware schematic (`mcu.ato`) and RP2350
//! hardware function-select constraints.

use embassy_rp::peripherals::*;

// ── SPI0 — Display + SD Card (shared bus, both on main board) ──────
// GP0 = SPI0_RX (MISO), GP3 = SPI0_TX (MOSI) — RP2350 hardware constraint

pub type Spi0Miso = PIN_0;
pub type LcdCs = PIN_1;
pub type Spi0Sck = PIN_2;
pub type Spi0Mosi = PIN_3;
pub type LcdBacklight = PIN_5;
pub type LcdDc = PIN_7;
pub type SdCs = PIN_24;
pub type SdDetect = PIN_25;

// ── SPI1 — DACs (dedicated bus, direct 3.3V via DAC80508 VIO) ──────
// GP30 = SPI1_SCK, GP31 = SPI1_TX (MOSI) — RP2350 hardware constraint

pub type Spi1Sck = PIN_30;
pub type Spi1Mosi = PIN_31;
pub type Dac1Cs = PIN_32;
pub type Dac2Cs = PIN_33;

// ── Button Shift Registers (74HC165 × 5) ───────────────────────────

pub type BtnSrClk = PIN_8;
pub type BtnSrLatch = PIN_9;
pub type BtnSrData = PIN_10;

// ── LED Drivers (IS31FL3216A × 3, I2C0) ─────────────────────────────
// GP12 = I2C0 SDA (F3), GP13 = I2C0 SCL (F3)

pub type I2c0Sda = PIN_12;
pub type I2c0Scl = PIN_13;

// ── LCD Reset ────────────────────────────────────────────────────────

pub type LcdRst = PIN_22;

// ── Encoders (EC11E × 2) ───────────────────────────────────────────

pub type EncAPhaseA = PIN_15;
pub type EncAPhaseB = PIN_16;
pub type EncAPush = PIN_17;
pub type EncBPhaseA = PIN_18;
pub type EncBPhaseB = PIN_19;
pub type EncBPush = PIN_6;

// ── MIDI (UART1) ───────────────────────────────────────────────────
// GP20 = UART1_TX, GP21 = UART1_RX — RP2350 hardware constraint

pub type MidiTx = PIN_20;
pub type MidiRx = PIN_21;

// ── Clock/Reset I/O ────────────────────────────────────────────────

pub type ResetOut = PIN_4;
pub type ClockIn = PIN_26;
pub type ResetIn = PIN_27;
pub type ClockOut = PIN_28;
