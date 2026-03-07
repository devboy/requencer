//! SD card storage via SPI0 (shared with display).
//!
//! GP0 = SPI0 MISO, GP2 = SPI0 SCK, GP3 = SPI0 MOSI (shared),
//! GP24 = SD CS, GP25 = SD card detect (active low).
//!
//! Bus arbitration: never access SD and display simultaneously (both on SPI0).
//! The main loop controls when SD access happens (between display flushes).
//!
//! File layout on SD card:
//!   /requencer/
//!     state.bin             (full sequencer state backup)
//!     library.bin           (patterns + presets)
//!
//! SD card is accessed via raw SPI mode using embedded-sdmmc. The SPI bus
//! is shared with the display — the caller must ensure exclusive access
//! by not flushing the display during SD operations.
//!
//! NOTE: Full embedded-sdmmc integration requires adding the crate to Cargo.toml
//! and implementing the SPI bus sharing. The current implementation provides
//! the interface that main.rs calls, with the actual FAT filesystem operations
//! stubbed until the SD card hardware is verified.

use embassy_rp::gpio::{Input, Output};

/// Re-export from engine for convenience.
pub use requencer_engine::storage::STATE_BUF_SIZE;

/// SD card storage handle.
pub struct SdStorage<'a> {
    _cs: Output<'a>,
    detect: Input<'a>,
}

impl<'a> SdStorage<'a> {
    pub fn new(cs: Output<'a>, detect: Input<'a>) -> Self {
        Self { _cs: cs, detect }
    }

    /// Check if an SD card is inserted (card detect pin is active low).
    pub fn is_card_present(&self) -> bool {
        self.detect.is_low()
    }

    /// Save full sequencer state to SD card.
    /// Serializes state to postcard bytes, writes to /requencer/state.bin.
    pub fn save_state(&mut self, _data: &[u8]) -> bool {
        if !self.is_card_present() {
            return false;
        }
        // TODO: embedded-sdmmc FAT filesystem write
        // 1. Init SD card in SPI mode (CMD0, CMD8, ACMD41, CMD58)
        // 2. Mount FAT32 filesystem
        // 3. Open/create /requencer/state.bin
        // 4. Write data bytes
        // 5. Close file, unmount
        false
    }

    /// Load full sequencer state from SD card.
    /// Returns the number of bytes read into buf, or None if no file found.
    pub fn load_state(&mut self, _buf: &mut [u8]) -> Option<usize> {
        if !self.is_card_present() {
            return None;
        }
        // TODO: embedded-sdmmc FAT filesystem read
        // 1. Init SD card in SPI mode
        // 2. Mount FAT32 filesystem
        // 3. Open /requencer/state.bin
        // 4. Read into buf
        // 5. Return bytes read
        None
    }

    /// Save library (patterns + presets) to SD card.
    pub fn save_library(&mut self, _data: &[u8]) -> bool {
        if !self.is_card_present() {
            return false;
        }
        // TODO: Write to /requencer/library.bin
        false
    }

    /// Load library from SD card.
    pub fn load_library(&mut self, _buf: &mut [u8]) -> Option<usize> {
        if !self.is_card_present() {
            return None;
        }
        // TODO: Read from /requencer/library.bin
        None
    }
}
