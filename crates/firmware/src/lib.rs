//! Requencer firmware library — exposes pure logic modules for host-target testing.
//!
//! The firmware binary (`main.rs`) uses these modules for the RP2350B target.
//! This library target allows running `cargo test` on the host for pure logic:
//!
//! ```sh
//! cargo test -p requencer-firmware --lib --target x86_64-unknown-linux-gnu
//! ```

#![cfg_attr(not(test), no_std)]

pub mod buttons;
pub mod clock_io;
pub mod cv_input;
pub mod dac;
pub mod display;
pub mod encoders;
pub mod midi;
