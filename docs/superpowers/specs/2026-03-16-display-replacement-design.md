# Display Replacement: JC3248A035N-1 → ST7796 32-pin Bare Panel

## Context

The JC3248A035N-1 bare display panel (18-pin FPC, SPI-only) is unavailable in
small quantities (MOQ 500). A generic ST7796 32-pin bare panel from AliExpress
(maithoga store, ~€7.59/ea) is a suitable replacement. Same controller, same
resolution, same active area. Different FPC connector and exposed IM/parallel pins.

Full sourcing research: `docs/research/aliexpress-parts-sourcing.md` section 3.

## Scope

- Swap FPC connector part (18-pin → 32-pin)
- Remap display wiring in control board schematic
- Add IM mode pull-up resistors
- Update faceplate cutout for new glass dimensions
- Update documentation and metadata
- No firmware changes (same ST7796 command set, same SPI protocol)
- No main board changes (display SPI signals through board connector unchanged)
- No touch support (omit 8-pin touch FPC)

## Design

### 1. FPC Connector Swap

**Current:** `FPC_18P_05MM` (Cankemeng FPC-0.5mm-18P-Bottom, LCSC C262657)
- Body: 11.5 × 5.0mm, 18 pads @ 0.5mm pitch

**New:** `FPC_32P_05MM` — JUSHUO AFC01-S32FCA-00, LCSC **C262672**
- Body: 17.5 × 6.1 × 2.8mm, 32 pads @ 0.5mm pitch
- FPC width: P0.5 × (32-1) = 15.5mm
- Overall width with fitting nails: 20.9mm
- Same AFC01 family as existing 18-pin (C262657) — mechanically consistent
- ~6,700 in stock, ~$0.13/ea, JLCPCB extended parts
- Same position: PCB coords (61.33, 30.39), rotation 270°, side F
- FPC ribbon exits right side of display

**New part files to create:**
- `hardware/boards/parts/FPC_32P_05MM/FPC_32P_05MM.ato`
- `hardware/boards/parts/FPC_32P_05MM/FPC_32P_05MM.kicad_sym`
- `hardware/boards/parts/FPC_32P_05MM/FPC_32P_05MM.kicad_mod`
- `hardware/boards/parts/FPC_32P_05MM/FPC_32P_05MM.step` (if available)

### 2. Pin Remapping (control.ato)

Replace `lcd_fpc = new FPC_18P_05MM` with `lcd_fpc = new FPC_32P_05MM`.

**Signal mapping (old → new pin numbers):**

| Signal | Old (18-pin) | New (32-pin) | Notes |
|--------|-------------|-------------|-------|
| GND | PIN1, PIN8 | PIN1 | Single GND pin |
| VDDA | — | PIN2 | New: analog supply → 3.3V |
| VDDI | — | PIN3 | New: I/O supply → 3.3V |
| TE | — | PIN4 | New: leave floating |
| CS | PIN5 | PIN5 | Same pin number, lucky |
| DC | PIN4 | PIN6 | Moved |
| SCK | PIN3 | PIN7 | Moved |
| RDX | — | PIN8 | New: tie to 3.3V (deassert read strobe) |
| MOSI | PIN6 | PIN9 | Moved |
| MISO | PIN7 | PIN10 | Moved |
| DB0-DB15 | — | PIN11-26 | New: leave floating (SPI mode) |
| RESET | PIN2 | PIN27 | Moved |
| IM2 | — | PIN28 | New: tie to 3.3V |
| IM1 | — | PIN29 | New: tie to 3.3V |
| IM0 | — | PIN30 | New: tie to 3.3V |
| LED-A | PIN10 | PIN31 | Moved |
| LED-K | PIN11-14 | PIN32 | Was 4 cathodes, now 1 |
| VCC | PIN9 | — | Replaced by VDDA+VDDI |
| NC | PIN15-18 | — | Gone |

### 3. New Passive Components

**IM mode pull-ups (3× 10kΩ resistors):**
- `r_im0`, `r_im1`, `r_im2`: 10kΩ ± 5%
- Each wired: one end to 3.3V, other end to respective IM pin
- Sets IM2=1, IM1=1, IM0=1 → 4-wire SPI mode

**Power supply bypass (2× 100nF caps):**
- `c_lcd_vdda`: 100nF ± 20% across VDDA (PIN2) to GND
- `c_lcd_vddi`: 100nF ± 20% across VDDI (PIN3) to GND
- VDDA (analog) and VDDI (digital I/O) are separate supply domains —
  each needs its own local decoupling to prevent digital noise coupling
  into the analog supply. Replace the single `c_lcd` with two caps.

### 4. Backlight Circuit Changes

**Current:** 4 LED cathodes (PIN11-14) all wired to same MOSFET drain.
**New:** Single LED cathode (PIN32) wired to MOSFET drain.

The MOSFET circuit stays identical (2N7002, 100Ω gate resistor, 100kΩ
pull-down). Only the cathode wiring simplifies from 4 pins to 1 pin.

LED anode (PIN31) keeps the 33Ω current-limiting resistor from 3.3V.
The 4→1 cathode change does not affect current — the LEDs are the same,
just internally tied. The 33Ω resistor with 3.3V supply gives ~6-15mA
depending on Vf (barely any headroom with white LEDs). If too dim after
testing, drop to 10Ω (~20-30mA) or 4.7Ω (~40-60mA).

### 5. Faceplate Cutout Update

**Current cutout:** 82.5 × 52.0mm (for 85.5 × 54.94mm glass, ~1.5mm lip)
**New glass:** 84.52 × 55.26mm (landscape: width=84.52, height=55.26)

New cutout maintaining ~1.5mm lip:
- Width: 84.52 - 2×1.5 = **81.5mm** (was 82.5)
- Height: 55.26 - 2×1.5 = **52.3mm** (was 52.0)

Cutout center stays at **(54.78, 39.89)** for now — active area dimensions are
identical. However, the new panel likely has different bezel asymmetry than
the JC3248A035N-1 (which had 8.40mm left / 3.66mm right due to COG bond area).
The cutout center may need adjustment once the physical panel arrives and
the bezel offsets can be measured.

**Files to update:**
- `hardware/faceplate/elec/src/faceplate.ato` — update comment (line 21)
- `hardware/faceplate/elec/layout/faceplate/faceplate.kicad_pcb` — update cutout geometry
- `hardware/boards/component-map.json` — update `lcd_cutout` and `display` sections

### 6. Documentation Updates

**display.ato:** Update all spec comments (part name, glass size, FPC pins,
pinout, backlight).

**component-map.json display section:** Update part, glass dimensions, FPC
pins, FPC edge, backlight description, bezel dimensions.

**component-map.json lcd_cutout section:** Update width, height, glass
dimensions.

**component-map.json footprints:** Add `fpc_32p_05mm` footprint entry, update
body/courtyard dimensions.

**board-config.json:** Update `component_padding` for `lcd_fpc` if the wider
connector needs different clearance (left padding may need adjustment from
5.0mm given the connector is ~6.5mm wider).

## Files Changed

| File | Change |
|------|--------|
| `boards/parts/FPC_32P_05MM/*` | **New:** 32-pin FPC connector part (ato + sym + mod) |
| `boards/elec/src/control.ato` | Swap connector, remap all pins, add IM pull-ups |
| `boards/elec/src/display.ato` | Update documentation comments |
| `boards/component-map.json` | Update display specs, cutout dims, add footprint |
| `boards/board-config.json` | Update lcd_fpc padding if needed |
| `faceplate/elec/src/faceplate.ato` | Update cutout comment |
| `faceplate/elec/layout/faceplate/faceplate.kicad_pcb` | Update cutout geometry |

## What Does NOT Change

- **Firmware** — same ST7796 command set, same SPI init, same MADCTL
- **Main board schematic** — display SPI signals through board connector unchanged
- **Board connector pinout** — lcd_cs, lcd_dc, lcd_bl, spi0_mosi, spi0_sck, spi0_miso all stay
- **FPC connector position** — same PCB coords (61.33, 30.39), same rotation (270°)
- **Display resolution** — 480×320, same active area (73.44 × 48.96mm)

## Verification

1. `ato build` — schematic compiles with new connector
2. `make hw-place` — placement succeeds with wider FPC connector
3. `make hw-route` — routing succeeds (same signal count, just different pad positions)
4. Visual check: faceplate cutout accommodates 84.52 × 55.26mm glass
5. FPC ribbon cable reaches from display glass (right edge) to connector on control board
