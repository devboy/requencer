# FPC_32P_05MM — 32-Pin 0.5mm FPC ZIF Connector

## Overview
Bottom-contact FPC ZIF connector, 32-pin, 0.5mm pitch. Mates with the ST7796 3.5" bare display panel FPC ribbon cable.

## Key Specifications
| Parameter | Value |
|-----------|-------|
| Pitch     | 0.5mm |
| Pins      | 32 |
| Contact   | Bottom |
| LCSC      | C262672 |

## Datasheet
- [LCSC page](https://www.lcsc.com/product-detail/C262672.html)

## Used In
- [`control.ato`](../../boards/control/control.ato) — display FPC connector

---

## Display Panel: ST7796 3.5" TFT (bare panel, no carrier PCB)

The FPC connector mates with a bare 3.5" TFT panel purchased from AliExpress. The panel has no carrier PCB — the FPC ribbon connects directly to the ZIF connector on the control board.

### Panel Specifications
| Parameter | Value |
|-----------|-------|
| Display type | TFT |
| Driver IC | ST7796U (COG) |
| Size | 3.5 inch |
| Resolution | 320RGB x 480 |
| Viewing direction | 12 o'clock |
| Backlight | 6-chip white LED (parallel) |
| Operating temp | -20°C to 70°C |
| Storage temp | -30°C to 80°C |
| General tolerance | ±0.20mm |
| RoHS | Yes |

### Panel Dimensions
| Dimension | Value |
|-----------|-------|
| Overall (W × H) | 55.26 × 84.52mm |
| Active area (W × H) | 48.96 × 73.44mm |
| Thickness (max) | 4.13mm |
| Locating post height | 0.80mm |
| Locating post spacing | 52.20mm (horizontal) |
| FPC width | 16.50mm |
| FPC pin pitch | 0.5mm, 32 pins (P0.5 × (32-1) = 15.50mm) |
| FPC+PI stiffener | 0.30 ±0.03mm |
| Gold finger width | 0.30mm |
| Gold finger gap | 0.20mm |

### FPC Pinout (32-pin, active-low active signals in red on datasheet)

| Pin | Symbol | Pin | Symbol |
|-----|--------|-----|--------|
| 1 | GND | 17 | DB7 |
| 2 | VDDA | 18 | DB8 |
| 3 | VDDI | 19 | DB9 |
| 4 | TE | 20 | DB10 |
| 5 | CSX/SPI_CS | 21 | DB11 |
| 6 | DCX/SPI4_DC | 22 | DB12 |
| 7 | WRX/SPI_SCLK | 23 | DB13 |
| 8 | RDX | 24 | DB14 |
| 9 | SPI_MOSI | 25 | DB15 |
| 10 | SPI_MISO | 26 | — |
| 11 | DB0 | 27 | RESET |
| 12 | DB1 | 28 | IM2 |
| 13 | DB2 | 29 | IM1 |
| 14 | DB3 | 30 | IM0 |
| 15 | DB4 | 31 | LED-A |
| 16 | DB5 | 32 | LED-K |

### Interface Mode Selection (IM2/IM1/IM0)

| IM2 | IM1 | IM0 | MCU Interface Mode | Data Pins |
|-----|-----|-----|--------------------|-----------|
| 0 | 1 | 0 | 80-system 16-bit parallel | DB15–DB0 |
| 0 | 1 | 1 | 80-system 8-bit parallel | DB7–DB0 |
| 1 | 0 | 1 | 3-line 9-bit serial | SDA in, SDO out |
| 1 | 1 | 1 | 4-line 8-bit serial (SPI) | SDA in, SDO out |

Our design uses **4-line 8-bit SPI** (IM2=1, IM1=1, IM0=1): pins CSX, DCX, WRX/SCLK, SPI_MOSI, SPI_MISO.

### Footprint Pin Numbering (REVERSED)

The footprint pad numbering is **reversed** relative to a standard connector datasheet.
Pads run 32→1 left-to-right in the footprint, so the schematic can use pin numbers
that match the panel datasheet directly (PIN1=GND, PIN32=LED-K).

**Why:** The connector is mounted at 270° rotation on the control board. At this
rotation, the footprint's rightmost pad (X=+7.75) ends up at the TOP and the
leftmost (X=-7.75) at the BOTTOM. But on the FPC cable (oriented as it exits the
display panel in landscape), pin 1 is at the BOTTOM and pin 32 is at the TOP.

Standard footprint numbering (1→32 left-to-right) would put pin 1 at the top of
the connector — opposite to the cable. Reversing the pad numbers fixes this:

```
Connector (270° rotation):     FPC cable (as mounted):
  TOP:    pad 1  (X=+7.75)      TOP:    pin 32 (LED-K) ← no match!
  BOTTOM: pad 32 (X=-7.75)      BOTTOM: pin 1  (GND)

With REVERSED numbering:
  TOP:    pad 1  (X=+7.75)  ←→  cable pin 1  (GND)     ✓
  BOTTOM: pad 32 (X=-7.75)  ←→  cable pin 32 (LED-K)   ✓
```

This means `lcd_fpc.PIN1 ~ gnd` in the schematic connects GND to the physical
copper pad that will contact pin 1 of the FPC cable. No signal remapping needed.

**Verification before first power-on:** Use a multimeter to confirm pin 1 (GND)
on the FPC cable makes contact with the pad wired to GND on the PCB.

### Reference Images
- [Dimensions (front view)](docs/tft-dimensions-front.png)
- [Dimensions (side view)](docs/tft-dimensions-side.png)
- [FPC pinout table](docs/tft-pinout.png)
- [Interface mode selection](docs/tft-interface-modes.png)
- [General notes](docs/tft-notes.png)

### Source
AliExpress listing — bare 3.5" ST7796 TFT panel, 32-pin 0.5mm FPC, no touch, no carrier PCB.
