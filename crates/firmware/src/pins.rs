//! GPIO pin assignments for the PGA2350 (RP2350B) board.
//!
//! All pin numbers match the hardware schematic and `docs/plans/2026-03-06-firmware-implementation.md`.

use embassy_rp::peripherals::*;

// ── SPI0 — Display + SD Card (shared bus) ──────────────────────────

pub type Spi0Mosi = PIN_0;
pub type LcdCs = PIN_1;
pub type Spi0Sck = PIN_2;
pub type LcdDc = PIN_3;
pub type LcdBacklight = PIN_5;
pub type Spi0Miso = PIN_23;
pub type SdCs = PIN_24;
pub type SdDetect = PIN_25;

// ── SPI1 — DACs (dedicated bus, via 74HCT125 level shifter) ────────

pub type Spi1Mosi = PIN_30;
pub type Spi1Sck = PIN_31;
pub type Dac1Cs = PIN_32;
pub type Dac2Cs = PIN_33;

// ── Button Shift Registers (74HC165 × 5) ───────────────────────────

pub type BtnSrClk = PIN_8;
pub type BtnSrLatch = PIN_9;
pub type BtnSrData = PIN_10;

// ── LED Drivers (TLC5947 × 5) ──────────────────────────────────────

pub type LedSin = PIN_11;
pub type LedSclk = PIN_12;
pub type LedXlat = PIN_13;
pub type LedBlank = PIN_14;

// ── Encoders (EC11E × 2) ───────────────────────────────────────────

pub type EncAPhaseA = PIN_15;
pub type EncAPhaseB = PIN_16;
pub type EncAPush = PIN_17;
pub type EncBPhaseA = PIN_18;
pub type EncBPhaseB = PIN_19;
pub type EncBPush = PIN_20;

// ── MIDI (UART0) ───────────────────────────────────────────────────

pub type MidiTx = PIN_21;
pub type MidiRx = PIN_22;

// ── Clock/Reset I/O ────────────────────────────────────────────────

pub type ResetOut = PIN_4;
pub type ClockIn = PIN_26;
pub type ResetIn = PIN_27;
pub type ClockOut = PIN_28;
