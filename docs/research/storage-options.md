# Storage Options for Requencer

Research notes on adding persistent storage for presets, patterns, and user data.

## Current State

The RP2350 (Pico 2) has **4 MB internal flash** shared between firmware and data. With firmware using ~256KB–1MB, roughly 3 MB remains. This is technically usable for basic preset storage via flash sectors, but:

- Flash has limited write endurance (~100K cycles per sector)
- Wear-leveling adds firmware complexity
- No room for large user content (MIDI files, long sequences)
- Firmware updates risk clobbering user data

**Conclusion:** Dedicated external storage is needed.

## Available Resources

**Free GPIO pins:** GP23, GP24, GP25 (3 pins)

**Existing SPI bus (SPI0):** GP0 (MOSI), GP2 (SCK) — shared by LCD and both DACs. Adding another device only costs 1 CS pin. Note: SPI0 currently has no MISO line assigned — storage devices that return data (flash, SD) will need GP24 or GP25 assigned as SPI0 RX.

**SPI1:** Available on GP23–GP25 if we want a fully independent bus (avoids contention with display/DAC traffic).

## Options Evaluated

### 1. SPI NOR Flash (W25Q128JV — 16 MB) ⭐ Recommended

A dedicated SPI flash chip soldered to the PCB.

| Attribute | Detail |
|-----------|--------|
| Capacity | 16 MB (W25Q128JV), up to 128 MB available |
| Interface | SPI (shares SPI0 bus, 1 new CS pin) or Quad-SPI |
| Pins needed | 1 GPIO (CS) + 1 GPIO (MISO if not yet assigned) = **2 pins** |
| Package | SOIC-8 (5.3 × 5.2 mm) or WSON-8 (3 × 2 mm) |
| Write endurance | 100K cycles per sector (with wear-leveling, effectively unlimited for preset use) |
| Read speed | 50–133 MHz SPI clock, >10 MB/s reads |
| Cost | ~$0.30–0.50 |
| Power | <25 mA active, <1 µA standby |

**Firmware support:**
- `embedded-storage` traits in Rust ecosystem
- `littlefs2` crate — power-safe filesystem with wear-leveling, designed for embedded flash
- `sequential-storage` crate — simpler key-value store for `embedded-storage` devices

**What 16 MB stores:**
- A single preset (4 tracks × 64 steps × ~20 bytes/step) ≈ 5 KB
- **~3,000 presets** in 16 MB, or thousands of presets + hundreds of MIDI files
- More than enough for any realistic use case

**Pros:**
- Zero panel space — soldered to PCB, invisible to user
- Rock-solid in a vibrating rack (no mechanical connector)
- Fast random-access reads for pattern loading
- Tiny PCB footprint
- Well-proven in embedded (used by virtually every microcontroller product with storage)

**Cons:**
- Not user-removable — no sneakernet sharing
- Capacity fixed at manufacture (but 16 MB is generous)
- Users can't browse files on a PC without USB firmware support

---

### 2. Micro SD Card Slot

Standard micro SD in SPI mode.

| Attribute | Detail |
|-----------|--------|
| Capacity | User-selected (GB+) |
| Interface | SPI mode (slower than SDIO, but only needs 4 wires) |
| Pins needed | 2 (CS + MISO) sharing SPI0, or 3–4 on SPI1 |
| Slot footprint | ~15 × 14 mm (push-push or hinged) |
| Cost | ~$0.50–1.00 for slot + card is user-supplied |

**Firmware support:**
- `embedded-sdmmc` crate — FAT16/FAT32 filesystem over SPI
- Well-documented SPI-mode SD protocol

**Pros:**
- Unlimited capacity
- User can pull card, browse/edit on PC
- Import MIDI files, share presets between modules
- Standard FAT filesystem — maximum interoperability

**Cons:**
- Needs physical slot — either panel cutout (uses precious HP) or rear-mount (awkward access while racked)
- Mechanical connector in a vibrating eurorack environment (contact reliability)
- SD cards vary wildly in quality and SPI compatibility
- FAT filesystem overhead in firmware (~10–20 KB flash)
- Slower than dedicated flash for random access
- Power: some cards draw 100+ mA during writes

---

### 3. SPI Flash + SD Card (Both)

Use SPI flash as primary working storage, SD card as import/export/backup.

| Attribute | Detail |
|-----------|--------|
| Pins needed | 3 GPIOs total (flash CS, SD CS, shared MISO) — uses all 3 free pins |
| Panel space | SD slot only if front-mounted |

**How it works:**
- SPI flash holds active presets/patterns (fast, reliable, always available)
- SD card is for bulk import/export: load MIDI files, backup all presets, share with other users
- Module works fine without SD card inserted

**Pros:**
- Best of both worlds — reliable internal storage + user-accessible import/export
- Module never depends on a card being inserted
- MIDI file import becomes trivial (copy .mid to card, insert, load from menu)

**Cons:**
- Uses all 3 remaining GPIOs
- More firmware complexity (two filesystem drivers)
- SD slot still needs physical space somewhere

---

### 4. I2C FRAM (MB85RC256V — 32 KB)

Ferroelectric RAM — unlimited writes, byte-addressable, non-volatile.

| Attribute | Detail |
|-----------|--------|
| Capacity | 32 KB (max ~512 KB in larger parts) |
| Interface | I2C (2 pins: SDA, SCL) |
| Write endurance | 10 trillion cycles |
| Speed | 1 MHz I2C, ~100 KB/s |

**Verdict:** Great for settings/calibration data, but 32–512 KB is too small for a meaningful preset library. Not a primary storage solution.

---

### 5. USB Mass Storage (no extra hardware)

The Pico 2's USB port could expose internal flash as a USB drive when connected to a PC.

**Pros:** Zero additional hardware, zero GPIOs, zero PCB space.
**Cons:** Only works when USB is connected, requires USB stack in firmware (significant complexity), can't work while module is racked (USB port faces PCB-inward).

Not practical as primary storage, but could complement SPI flash for firmware updates.

## Recommendation

### Minimum Viable: SPI Flash only

Add a **W25Q128JV** (16 MB SPI flash) sharing the existing SPI0 bus. This costs:
- 1 GPIO for CS (GP23)
- 1 GPIO for MISO (GP24) — SPI0 RX not currently assigned
- 1 SOIC-8 footprint (~5 × 5 mm)
- ~$0.40 BOM cost

This covers presets, patterns, settings, and calibration with room to spare. Use `littlefs2` for a power-safe wear-leveled filesystem.

### Stretch Goal: Add SD Card Slot

If MIDI file import is a priority, add a **rear-mounted micro SD slot** using GP25 as CS (sharing the same SPI0 bus + MISO on GP24). This uses the last free GPIO.

Rear-mount avoids burning panel space and keeps the card accessible by removing the module from the rack — acceptable for an occasional import/export operation (not something users do mid-performance).

**The SD card should be optional** — the module must function fully without one. It's an import/export peripheral, not primary storage.

### Pin Assignment Plan

| GPIO | Assignment | Notes |
|------|-----------|-------|
| GP23 | FLASH_CS | SPI flash chip select |
| GP24 | SPI0_MISO | Shared MISO for flash + SD card reads |
| GP25 | SD_CS | Micro SD chip select (stretch goal) |

All three share the existing SPI0 bus (MOSI on GP0, SCK on GP2).

## Parts Shortlist

| Part | Description | Package | LCSC |
|------|------------|---------|------|
| W25Q128JVSIQ | 128Mbit SPI NOR flash, 3.3V | SOIC-8 | C97521 |
| Micro SD slot (TBD) | Push-push micro SD connector | SMD | TBD |

## Open Questions

- Do we want quad-SPI for faster flash reads? Would need 2 more pins (not available unless we reorganize).
- Should we reserve space on the PCB for an SD slot even if we don't populate it in v1? Allows the option without a board respin.
- USB-based preset transfer as a future firmware feature? Would work with the SPI flash, no extra hardware needed.
