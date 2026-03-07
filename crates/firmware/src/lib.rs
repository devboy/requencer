//! Requencer firmware library — testable driver and logic modules.
//!
//! This lib exposes generic hardware drivers (parameterized over `embedded-hal`
//! traits) and pure logic functions. Tests run on the host with mock HAL
//! implementations via `embedded-hal-mock`.
//!
//! The binary target (`main.rs`) instantiates these drivers with concrete
//! embassy-rp types for the RP2350.

#![cfg_attr(not(test), no_std)]

pub mod pins;
pub mod dac;
pub mod buttons;
pub mod encoders;
pub mod leds;
pub mod clock_io;
pub mod tick;
