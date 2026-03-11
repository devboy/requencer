# Faceplate Connector Research: USB-C and MicroSD

Date: 2026-03-11

## Context

The Requencer needs USB-C (data-only, USB 2.0 Full Speed) and MicroSD (SPI mode) accessible from the front panel. Both are currently edge-mount parts on the main board and need to move to the control board with faceplate cutouts.

### Physical Constraints

- Faceplate: 1.6mm FR4 (matte black soldermask)
- Control board sits ~10mm behind faceplate (set by Thonkiconn jack standoff)
- Total gap from PCB surface to faceplate front: **~11.6mm**
- Both components mount on the control board, signals route through board-to-board connector spare pins (11 available on Header A pins 9-17, 20-21)

### Signal Requirements

| Signal | Pins needed | Notes |
|--------|------------|-------|
| Display SPI | 5 | MOSI, SCK, CS, DC, BL_CTRL |
| SD Card | 3 | MISO, SD_CS, SD_CD (MOSI/SCK shared with display) |
| USB | 2 | DP, DM |
| **Total** | **10** | Fits in 11 spare pins |

---

## MicroSD: Yamaichi PJS008U-3000-0 (Recommended)

The de facto standard for eurorack vertical MicroSD mounting. Used by Music Thing Modular "Radio Music," Prok drum modules, MIDIbox projects, and many other DIY eurorack modules.

| Parameter | Value |
|---|---|
| Manufacturer | Yamaichi Electronics |
| Part number | PJS008U-3000-0 |
| Height above PCB | **14.18mm** (0.558") |
| Mounting type | Through-hole (THT) |
| Mechanism | Push-in / pull-out (manual, no spring eject) |
| Positions | 8 (includes card detect) |
| Pitch | 1.1mm (2.2mm between rows) |
| Contact finish | Gold over nickel |
| Operating temp | -25C to +85C |

### Availability

| Source | Part/SKU | Price | Notes |
|--------|----------|-------|-------|
| LCSC | C3177022 | ~$2-3 | JLCPCB assembly compatible |
| DigiKey | PJS008U-3000-0 | ~$3-4 | In stock |
| Mouser | PJS008U-3000-0 | ~$3-4 | In stock, datasheet available |
| Thonk | Radio Music SD holder | ~$2 | Eurorack-specific supplier |
| midiphy | PJS008U-3000-0 | ~$2 | MIDIbox supplier |

### Fit Analysis

- At 14.18mm, the connector protrudes **~2.6mm above the faceplate** front surface
- This is acceptable — similar protrusion to jack bushings and encoder shafts
- Faceplate needs a rectangular slot: **~13mm x 3mm**
- KiCad footprint available from SnapEDA and Ultra Librarian

### Implementation

Replace current `MicroSD_Slot` atopile part (Molex 5031821852, flat push-push SMD) with a new component definition for the Yamaichi PJS008U-3000-0 with THT footprint and appropriate pin mapping.

### Alternatives Considered

| Part | Height | Price | Verdict |
|------|--------|-------|---------|
| ACES MSDV-2008-AKA0T01 | ~14mm | ~$1.44 | Manual pull-out only, less established supply |
| ACES MSDV-2108-BK33T | >14mm | ~$2.88 | Push-push but availability concern (discontinued?) |
| Multicomp Pro MP009827 | N/A | ~$10+ | C4 panel jack, circular hole too large for eurorack |
| Adafruit #6070 | N/A | ~$6 | 30mm round hole, way too large |
| FPC ribbon extenders | N/A | ~$5-8 | Fragile plug connection, vibration concern |
| Full-size SD vertical | N/A | varies | 25mm x 3mm cutout, no advantage over MicroSD |

---

## USB-C: Two Viable Options

### Option A: Vertical THT Connector (Simplest)

**Witarea W0026-16-VM2-S3**

| Parameter | Value |
|---|---|
| Manufacturer | Witarea (Shenzhen) |
| Part number | W0026-16-VM2-S3 |
| Height above PCB | **17.5mm** |
| Mounting type | DIP through-hole, vertical |
| USB version | USB 2.0 (16 pins) |
| Price | ~$0.50-1.50 (estimate) |

- Protrudes ~5.9mm above faceplate (similar to jack bushings)
- THT gives mechanical strength for plug/unplug forces
- Faceplate cutout: ~9.5mm x 3.5mm rectangular
- **Caveat:** Witarea is a Shenzhen manufacturer — LCSC/JLCPCB availability unverified. If unavailable, fall back to Option B.

Also considered: W0026-16-VM2-S4 (18.5mm), W0026-16-VM1-S4C/S4D (10.0-10.4mm SMD, borderline too short)

### Option B: Daughterboard + JST Cable (Most Flexible)

Inspired by the mechanical keyboard community's Unified Daughterboard project.

- Small custom PCB (~20mm x 12mm) with standard horizontal USB-C connector
- Mounts directly behind faceplate cutout (screwed or adhered to faceplate back)
- 4-pin JST-SH 1.0 cable (D+, D-, VBUS, GND) connects to control board header
- Can reuse existing TYPE-C-31-M-12 connector (Korean Hroparts, LCSC C165948)
- Decouples connector height from board-to-board spacing entirely
- ESD protection (PRTR5V0U2X) and CC pull-downs stay on main board

**Pros:** Works with any board spacing, proven approach at scale, uses existing parts.
**Cons:** Extra PCB to design/order, additional assembly step, JST cable adds a failure point.

### Alternatives Considered

| Part | Height | Price | Verdict |
|------|--------|-------|---------|
| GCT USB4145 (SMD vertical) | 7.46mm | ~$2 | Too short — 4mm recessed below faceplate |
| GCT USB4070 (SMD vertical) | 10.5mm | ~$3-4 | 1.1mm recessed, 24-pin overkill |
| GCT USB4160 (SMD vertical) | 7.46mm | ~$2 | Same height as USB4145, too short |
| Witarea W0026-24-VM1-S15 | 13.5mm | ~$1-2 | Workable (1.9mm protrusion), 24-pin overkill |
| DataPro panel mount cable | N/A | ~$20 | Expensive, excess cable length |
| Adafruit round panel mount | N/A | ~$5 | 21.5mm hole, way too large for eurorack |
| Hirose CX70M-24P1 | 3.66mm | ~$3 | Mid-mount, designed for board-edge only |
| Generic mid-mount 16P | 1.6mm | ~$0.20 | Edge-of-board only, not panel-through |

---

## Supporting Circuitry Location

| Circuit | Stays on main board | Moves to control board |
|---------|--------------------|-----------------------|
| USB 27ohm series resistors | Yes (near MCU) | |
| USB CC 5.1k pull-downs | Yes | |
| USB ESD (PRTR5V0U2X) | Yes | |
| SD card decoupling cap | | Yes (near connector) |
| SD card detect pull-up | Yes (near MCU) | |
| Display backlight MOSFET | Yes or move | Either works |
| Display RC reset | Yes or move | Either works |

---

## References

- [Music Thing Modular Radio Music](https://musicthing.co.uk/pages/radio.html) — uses Yamaichi PJS008U-3000-0
- [Unified Daughterboard Project](https://github.com/Unified-Daughterboard/UDB-C-JSH) — open source USB-C daughterboard
- [GCT Vertical USB-C](https://gct.co/usb-connector/vertical) — connector catalog
- [Witarea Vertical USB-C Guide](https://www.wit-area.com/blog/Comprehensive-Guide-to-Vertical-USB-Type-C-Receptacles/)
- [Yamaichi PJS008U Datasheet](https://www.mouser.com/datasheet/2/448/Yamaichi_Electronics_08162018_PJS008U-3000-0_RevD-1391577.pdf)
