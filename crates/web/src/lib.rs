//! Requencer WASM target — browser integration.
//!
//! Provides Canvas2D DrawTarget implementation and
//! wasm-bindgen bindings for the JS/TS web preview.

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn init() {
    // Future: initialize engine state, set up Canvas2D DrawTarget
}
