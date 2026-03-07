//! SD card storage via SPI0 (shared with display).
//!
//! GP0 = SPI0 MOSI (shared), GP2 = SPI0 SCK (shared), GP23 = SPI0 MISO,
//! GP24 = SD CS, GP25 = SD card detect (active low).
//!
//! Uses the embedded-sdmmc crate for FAT filesystem access.
//! Bus arbitration: never access SD and display simultaneously (both on SPI0).
//!
//! File layout on SD card:
//!   /requencer/
//!     patterns/
//!       000.pat - 127.pat   (postcard-serialized pattern data)
//!     presets/
//!       000.pre - 127.pre   (postcard-serialized preset data)
//!     state.bin             (full sequencer state backup)

use embassy_rp::gpio::{Input, Output};

/// SD card storage handle.
/// Currently a structured placeholder — actual FAT filesystem implementation
/// requires the embedded-sdmmc crate which will be added when SD card is tested.
pub struct SdStorage<'a> {
    cs: Output<'a>,
    detect: Input<'a>,
}

impl<'a> SdStorage<'a> {
    pub fn new(cs: Output<'a>, detect: Input<'a>) -> Self {
        Self { cs, detect }
    }

    /// Check if an SD card is inserted (card detect pin is active low).
    pub fn is_card_present(&self) -> bool {
        self.detect.is_low()
    }

    /// Save pattern data to SD card.
    /// slot: 0-127, data: postcard-serialized bytes.
    pub fn save_pattern(&mut self, _slot: u8, _data: &[u8]) -> bool {
        if !self.is_card_present() {
            return false;
        }
        // TODO: Initialize SD card SPI mode, mount FAT filesystem,
        // write to /requencer/patterns/NNN.pat
        false
    }

    /// Load pattern data from SD card.
    pub fn load_pattern(&mut self, _slot: u8, _buf: &mut [u8]) -> Option<usize> {
        if !self.is_card_present() {
            return None;
        }
        // TODO: Read from /requencer/patterns/NNN.pat
        None
    }

    /// Save full sequencer state.
    pub fn save_state(&mut self, _data: &[u8]) -> bool {
        if !self.is_card_present() {
            return false;
        }
        // TODO: Write to /requencer/state.bin
        false
    }

    /// Load full sequencer state.
    pub fn load_state(&mut self, _buf: &mut [u8]) -> Option<usize> {
        if !self.is_card_present() {
            return None;
        }
        // TODO: Read from /requencer/state.bin
        None
    }
}
