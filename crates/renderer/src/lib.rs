#![cfg_attr(not(feature = "std"), no_std)]

//! Requencer renderer — platform-agnostic display rendering.
//!
//! Uses `embedded-graphics` DrawTarget abstraction to render
//! the sequencer UI to any display backend (Canvas2D via WASM,
//! ST7796 TFT via SPI on RP2350).
