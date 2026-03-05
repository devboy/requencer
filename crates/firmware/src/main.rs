// #![no_std]
// #![no_main]

//! Requencer firmware — RP2350 embedded target.
//!
//! This will contain:
//! - Hardware initialization (SPI display, DAC, shift registers)
//! - DrawTarget impl for ST7796 TFT
//! - Button/encoder input scanning
//! - DAC8568 CV output
//! - UART MIDI I/O
//!
//! Currently a placeholder. The no_std/no_main attributes and HAL
//! dependencies will be added when we start firmware development.

fn main() {
    // Placeholder — will become no_main with embassy or rtic
}
