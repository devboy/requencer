//! SD card storage via SPI0 (shared with display).
//!
//! GP0 = SPI0 MISO, GP2 = SPI0 SCK, GP3 = SPI0 MOSI (shared),
//! GP24 = SD CS, GP25 = SD card detect (active low).
//!
//! Bus arbitration: never access SD and display simultaneously (both on SPI0).
//! The main loop controls when SD access happens (between display flushes).
//!
//! File layout on SD card (FAT32):
//!   /REQSTATE.BIN      (full sequencer state backup)
//!   /REQLIB.BIN        (patterns + presets)
//!
//! SD card is accessed via raw SPI mode using embedded-sdmmc. The SPI bus
//! is shared with the display — the caller must ensure exclusive access
//! by not flushing the display during SD operations.

use embassy_rp::gpio::{Input, Output};

/// Re-export from engine for convenience.
pub use requencer_engine::storage::STATE_BUF_SIZE;

#[cfg(target_os = "none")]
use defmt::*;
#[cfg(target_os = "none")]
use embassy_rp::spi::Spi;
#[cfg(target_os = "none")]
use embedded_sdmmc::{SdCard, VolumeIdx, VolumeManager, Mode};

/// Blocking delay for SD card SPI operations.
#[cfg(target_os = "none")]
struct SdDelay;

#[cfg(target_os = "none")]
impl embedded_hal::delay::DelayNs for SdDelay {
    fn delay_ns(&mut self, ns: u32) {
        // ~7ns per cycle at 150MHz
        cortex_m::asm::delay(ns / 7);
    }
}

/// Minimal SpiDevice wrapper that borrows the SPI bus + CS pin.
/// Implements embedded_hal::spi::SpiDevice for use with embedded-sdmmc.
#[cfg(target_os = "none")]
struct SdSpiDevice<'a, 'b> {
    spi: &'a mut Spi<'b, embassy_rp::peripherals::SPI0, embassy_rp::spi::Blocking>,
    cs: &'a mut Output<'b>,
}

#[cfg(target_os = "none")]
impl embedded_hal::spi::ErrorType for SdSpiDevice<'_, '_> {
    type Error = embedded_hal::spi::ErrorKind;
}

#[cfg(target_os = "none")]
impl embedded_hal::spi::SpiDevice<u8> for SdSpiDevice<'_, '_> {
    fn transaction(
        &mut self,
        operations: &mut [embedded_hal::spi::Operation<'_, u8>],
    ) -> Result<(), Self::Error> {
        self.cs.set_low();
        for op in operations {
            let result = match op {
                embedded_hal::spi::Operation::Read(buf) => self.spi.blocking_read(buf),
                embedded_hal::spi::Operation::Write(data) => self.spi.blocking_write(data),
                embedded_hal::spi::Operation::Transfer(read, write) => {
                    self.spi.blocking_transfer(read, write)
                }
                embedded_hal::spi::Operation::TransferInPlace(buf) => {
                    self.spi.blocking_transfer_in_place(buf)
                }
                embedded_hal::spi::Operation::DelayNs(ns) => {
                    cortex_m::asm::delay(*ns / 7);
                    Ok(())
                }
            };
            if result.is_err() {
                self.cs.set_high();
                return Err(embedded_hal::spi::ErrorKind::Other);
            }
        }
        self.cs.set_high();
        Ok(())
    }
}

/// Dummy time source — firmware has no RTC, so files get a fixed timestamp.
#[cfg(target_os = "none")]
struct FirmwareTime;

#[cfg(target_os = "none")]
impl embedded_sdmmc::TimeSource for FirmwareTime {
    fn get_timestamp(&self) -> embedded_sdmmc::Timestamp {
        embedded_sdmmc::Timestamp::from_calendar(2026, 3, 7, 0, 0, 0)
            .unwrap_or(embedded_sdmmc::Timestamp::from_calendar(2000, 1, 1, 0, 0, 0).unwrap())
    }
}

/// SD card storage handle.
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
}

#[cfg(target_os = "none")]
impl<'a> SdStorage<'a> {
    /// Write data to a file on the SD card. Returns true on success.
    fn write_file(
        &mut self,
        spi: &mut Spi<'a, embassy_rp::peripherals::SPI0, embassy_rp::spi::Blocking>,
        filename: &str,
        data: &[u8],
    ) -> bool {
        let spi_dev = SdSpiDevice { spi, cs: &mut self.cs };
        let sd_card = SdCard::new(spi_dev, SdDelay);
        let mut vm = VolumeManager::new(sd_card, FirmwareTime);

        let Ok(mut volume) = vm.open_volume(VolumeIdx(0)) else {
            warn!("SD: failed to open volume");
            return false;
        };
        let Ok(mut root) = volume.open_root_dir() else {
            warn!("SD: failed to open root dir");
            return false;
        };
        let Ok(mut file) = root.open_file_in_dir(
            filename,
            Mode::ReadWriteCreateOrTruncate,
        ) else {
            warn!("SD: failed to create file {}", filename);
            return false;
        };

        match file.write(data) {
            Ok(()) => {
                info!("SD: wrote {} bytes to {}", data.len(), filename);
                true
            }
            Err(_) => {
                warn!("SD: write failed for {}", filename);
                false
            }
        }
        // Volume, Directory, File all close on drop
    }

    /// Read a file from the SD card into buf. Returns bytes read, or None.
    fn read_file(
        &mut self,
        spi: &mut Spi<'a, embassy_rp::peripherals::SPI0, embassy_rp::spi::Blocking>,
        filename: &str,
        buf: &mut [u8],
    ) -> Option<usize> {
        let spi_dev = SdSpiDevice { spi, cs: &mut self.cs };
        let sd_card = SdCard::new(spi_dev, SdDelay);
        let mut vm = VolumeManager::new(sd_card, FirmwareTime);

        let mut volume = vm.open_volume(VolumeIdx(0)).ok()?;
        let mut root = volume.open_root_dir().ok()?;
        let mut file = root.open_file_in_dir(filename, Mode::ReadOnly).ok()?;

        let mut total = 0usize;
        loop {
            match file.read(&mut buf[total..]) {
                Ok(0) => break,
                Ok(n) => total += n,
                Err(_) => {
                    warn!("SD: read error for {}", filename);
                    return None;
                }
            }
        }

        info!("SD: read {} bytes from {}", total, filename);
        Some(total)
        // Volume, Directory, File all close on drop
    }

    /// Save full sequencer state to SD card.
    pub fn save_state(
        &mut self,
        spi: &mut Spi<'a, embassy_rp::peripherals::SPI0, embassy_rp::spi::Blocking>,
        data: &[u8],
    ) -> bool {
        if !self.is_card_present() {
            return false;
        }
        self.write_file(spi, "REQSTATE.BIN", data)
    }

    /// Load full sequencer state from SD card.
    pub fn load_state(
        &mut self,
        spi: &mut Spi<'a, embassy_rp::peripherals::SPI0, embassy_rp::spi::Blocking>,
        buf: &mut [u8],
    ) -> Option<usize> {
        if !self.is_card_present() {
            return None;
        }
        self.read_file(spi, "REQSTATE.BIN", buf)
    }

    /// Save library (patterns + presets) to SD card.
    pub fn save_library(
        &mut self,
        spi: &mut Spi<'a, embassy_rp::peripherals::SPI0, embassy_rp::spi::Blocking>,
        data: &[u8],
    ) -> bool {
        if !self.is_card_present() {
            return false;
        }
        self.write_file(spi, "REQLIB.BIN", data)
    }

    /// Load library from SD card.
    pub fn load_library(
        &mut self,
        spi: &mut Spi<'a, embassy_rp::peripherals::SPI0, embassy_rp::spi::Blocking>,
        buf: &mut [u8],
    ) -> Option<usize> {
        if !self.is_card_present() {
            return None;
        }
        self.read_file(spi, "REQLIB.BIN", buf)
    }
}
