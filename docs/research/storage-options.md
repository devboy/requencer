# Storage Options for Requencer

## Decision: Front-Panel SD Card + Onboard Flash

**Updated:** 2026-03-06 (PGA2350 migration)

### What Changed

With the PGA2350 giving us 48 GPIO (15+ spare), the GPIO constraints that forced earlier compromises are gone. We now have:

- **16MB onboard QSPI flash** on the PGA2350 itself (program storage + littlefs filesystem)
- **Front-panel micro SD card slot** using SPI0 (shared with display)
- **SPI0 MISO on GP23** — available now (was reserved on Pico 2)
- **SD CS on GP24** — dedicated chip select

### Architecture

```
PGA2350 onboard flash (16MB)
  └── Firmware binary (~256KB-1MB)
  └── littlefs partition (~14MB)
      ├── Active patterns / presets (fast access)
      ├── Settings / calibration data
      └── State snapshots

Front-panel micro SD card (user-supplied, GB+)
  └── FAT32 filesystem
      ├── Preset backup/restore
      ├── MIDI file import
      ├── Firmware update files (.uf2)
      └── Pattern sharing between modules
```

### Why Both

- **Onboard flash** is always present, fast, reliable, vibration-proof — primary working storage
- **SD card** is for import/export operations — user-accessible, removable, PC-readable
- Module works fine without SD card inserted
- SD card is not required for normal operation

### Pin Assignment

| GPIO | Assignment | Notes |
|------|-----------|-------|
| GP0 | SPI0 TX (MOSI) | Shared with display |
| GP2 | SPI0 SCK | Shared with display |
| GP23 | SPI0 RX (MISO) | SD card reads |
| GP24 | SD_CS | SD card chip select |
| GP1 | LCD_CS | Display chip select (bus arbitration) |

### Firmware Support

- **Onboard flash:** `littlefs2` crate — power-safe, wear-leveled, designed for embedded NOR flash
- **SD card:** `embedded-sdmmc` crate — FAT16/FAT32 over SPI
- **Bus arbitration:** Firmware ensures display and SD card are never accessed simultaneously on SPI0

### Capacity

**Onboard flash (14MB usable after firmware):**
- Single preset: ~5 KB
- 32 saved patterns (full state): ~244 KB
- **~2,800 presets** fit in 14MB — more than enough

**SD card (user-supplied):**
- Unlimited for practical purposes
- Standard FAT32 — read/write on any PC

### SD Card Physical Placement

Micro SD push-push slot on the front panel faceplate, below the CV input jacks. Accessible while module is racked — no need to remove the module for preset management.

### Open Questions

- USB mass storage mode: Could expose onboard flash as USB drive when connected to PC for direct preset management. Future firmware feature, no hardware changes needed.
