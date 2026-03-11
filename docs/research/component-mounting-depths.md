# Component Mounting Depths Behind Faceplate

Research on physical depth dimensions for panel-mounted eurorack components.

## Context: Typical Eurorack PCB-to-Panel Gap

Standard eurorack modules use a **9-12mm PCB-to-panel gap** when mounting a PCB parallel to the faceplate. This gap is set by the tallest panel-mount component (usually jacks or pots at ~10mm bushing height). Faceplate thickness is typically 1.5-2mm aluminum.

---

## 1. PJ398SM (Thonkiconn) 3.5mm Jack

**Mounting type:** Panel-mount (threads through faceplate, secured with nut)

| Parameter | Dimension |
|---|---|
| Total body height (PCB to top of bushing) | 10mm |
| Threaded bushing length (above panel) | 4.5mm |
| Body behind panel (bushing base to PCB) | ~5.5mm |
| Panel hole diameter | 6mm |
| Nut + washer thickness | ~2mm |
| Solder pin length below body | ~3.5mm |

**Key notes:**
- The jack body sits on the panel surface. With a 2mm panel, ~2.5mm of thread protrudes above the nut.
- Advisable to drill a 3mm hole in the PCB directly under the jack barrel center to clear inserted plugs, or avoid routing traces/ground plane in that area.
- WQP518MA, PJ301M-12, and PJ398SM are all identical footprints (collectively "Thonkiconn").
- Sets the standard PCB-to-panel distance: the jack body height (~5.5mm behind panel + ~3.5mm pins) defines a natural ~10mm PCB standoff.

**Panel cutout:** 6mm round hole.

---

## 2. EC11E Series Rotary Encoder (Alps Alpine)

**Mounting type:** Panel-mount (threaded bushing through faceplate, secured with nut)

| Parameter | Dimension |
|---|---|
| Shaft diameter | 6mm (D-shaft or round) |
| Shaft length (above panel, various models) | 15mm, 20mm, 25mm typical |
| Threaded bushing diameter | M7 (7mm) |
| Threaded bushing length | ~4.5mm |
| Body width | 11.7mm |
| Body depth (behind panel to PCB surface) | ~6.6mm |
| Total height (PCB to shaft tip, 20mm shaft) | ~30mm |
| Pin row spacing | 7.5mm / 5mm |
| Mounting hole pattern | 5 x 1mm holes |
| Panel hole diameter | 7mm |

**Key notes:**
- **Height mismatch problem:** The bushing-to-PCB distance is only ~6.6mm, compared to ~10mm for Alpha pots and ~8mm for Thonkiconn jacks. If jacks and encoders share the same PCB, the encoder will sit ~3.4mm too low relative to jacks.
- **Workaround:** Add a nut underneath the panel so the encoder body hangs lower, then secure with a nut on top. Or use a spacer/daughter board.
- The EC11E15204A3 specifically: 15-pulse, 30-detent, no push switch. For push-switch variants, add ~2mm to body depth.

**Panel cutout:** 7mm round hole.

---

## 3. TC002 (Well Buying) LED Illuminated Tactile Switch

**Mounting type:** PCB-mount (soldered to PCB, button cap pokes through faceplate hole)

| Parameter | Dimension |
|---|---|
| Body footprint | 12mm x 12mm |
| Body height above PCB (switch only) | ~7.3mm (common variant) |
| Total height with cap | ~12-13mm |
| Button cap diameter (clear, for LED) | 4.0mm or 5.5mm |
| LED type | RGB (common anode or individual) |
| Total depth above PCB (with RGB LED tact) | ~17.6mm (per ModWiggler reports) |

**Key notes:**
- These are PCB-mount only -- no panel thread. The button protrudes through a hole in the faceplate.
- With a standard ~10mm PCB-to-panel gap, a 7.3mm body switch would sit ~2.7mm below the panel surface. A taller variant or cap is needed to reach through.
- The TC002-N11AS1XT-RGB has a 4.0mm clear button; TC002-N11AS2XT-RGB has 5.5mm clear button.
- TC002-N11AS1XKT-RGB has a smoky/translucent cap -- nearly invisible unlit on a black panel.
- Thonk sells "Low Profile LED Buttons" that are specifically designed to sit at the same height as Thonkiconn jacks with a ~10mm standoff. These require 3 extra holes in the PCB for body extrusions.
- Standard 12x12mm switch caps are widely available: cylindrical (11.5mm diameter, 5.7mm tall), mushroom, square, transparent.

**Panel cutout:** ~5-6mm round hole for button cap (check specific cap diameter). Body stays behind panel.

---

## 4. Micro SD Card Slot

**Mounting type:** PCB-mount (surface mount on PCB)

| Parameter | Dimension |
|---|---|
| Molex 1040310811 (push-pull) height | 1.42mm |
| Molex 1040310811 footprint | 11.14mm x 11.4mm |
| Molex 5031821853 (push-push) height | 1.45mm |
| Card insertion depth | ~12mm |
| Contacts | 8 (phosphor bronze, gold/nickel) |
| Max current | 0.5A per contact |

**Key notes:**
- At only ~1.4-1.85mm tall, micro SD connectors sit flat on the PCB. They are NOT panel-mountable directly.
- **Panel-accessible options:**
  1. **PCB edge-mount:** Orient the PCB so the SD slot faces the faceplate edge. Card inserts through a rectangular cutout in the faceplate. Requires the PCB to be perpendicular to the panel, or a small daughter board perpendicular to the main PCB.
  2. **Panel-mount extender (Adafruit #6070):** Round panel-mount micro SD adapter. ~30mm diameter mounting hole -- very large for eurorack.
  3. **Ribbon/FPC extender:** Use an FPC-to-micro-SD adapter ribbon, with one end on the main PCB and the other end near a panel slot.
- For eurorack, the most practical approach is a **right-angle micro SD connector** on a PCB mounted perpendicular to the panel, with a slot cutout in the faceplate (~12mm x 2.5mm).

**Panel cutout (if edge-accessible):** ~13mm x 2.5mm rectangular slot.

---

## 5. USB-C Connector

**Mounting type:** Either panel-mount (cable) or PCB-mount (right-angle through-hole)

### Option A: Right-Angle PCB-Mount Receptacle (e.g., GCT USB4085)

| Parameter | Dimension |
|---|---|
| Height above PCB | 3.46mm |
| Body length (depth into PCB) | 9.17mm |
| Receptacle opening | 8.34mm x 2.56mm |
| Mating depth | ~6.2mm |
| Mount type | Through-hole, horizontal |
| Contacts | 16-pin (USB 2.0) |

**Key notes:**
- At 3.46mm above PCB, the USB-C receptacle opening sits well below a typical ~10mm PCB-to-panel gap. The connector would need the PCB very close to the panel, or a cutout/step in the panel.
- For a PCB parallel to the panel: the USB-C plug inserts **parallel to the panel surface**. You need a slot in the faceplate side, not the front.
- For front-panel access: mount a small daughter PCB **perpendicular** to the main PCB, with the USB-C receptacle facing forward through a faceplate cutout.

### Option B: Panel-Mount USB-C Cable (e.g., DataPro, Newnex)

| Parameter | Dimension |
|---|---|
| Panel cutout | ~9mm x 3.5mm rectangular (or ~30mm round for Adafruit bulkhead) |
| Mounting screws | M3, ~24mm apart |
| Cable length (internal) | 150-300mm |

**Key notes:**
- Panel-mount cables are the simplest: USB-C female on panel, short cable to PCB header or another USB-C.
- Newnex/DataPro cables support USB 3.2, Power Delivery, and DisplayPort alt mode.
- M3 screw mounting provides mechanical stress relief (critical for USB-C, which sees frequent plug/unplug).

### Option C: Vertical PCB-Mount (board perpendicular to panel)

- If the main PCB is perpendicular to the faceplate, a standard vertical USB-C receptacle faces forward naturally.
- Common in eurorack expander modules (e.g., Michigan Synth Works EXP F8R).

**Panel cutout:** ~9.5mm x 3.5mm rectangular (with rounded corners matching USB-C plug shape). Add ~0.5mm clearance each side.

---

## 6. 3.5" TFT Display (ST7796, 320x480)

### DECISION: JC3248A035N-1 bare panel + FPC

**Chosen part:** JC3248A035N-1 — bare ST7796 3.5" SPI TFT (no carrier PCB, no touch)

**Why bare panel over breakout module:**
- Breakout modules (MSP3526 etc.) have a carrier PCB extending ~13mm below the glass with a pin header. This carrier PCB physically overlaps the encoder and control strip button area.
- The bare panel is only 2.5mm thick — sits directly in the faceplate cutout.
- FPC ribbon connects to a small ZIF connector on the control board. No mechanical interference with other components.

### Chosen Part Specifications

| Parameter | JC3248A035N-1 |
|---|---|
| Driver IC | ST7796S |
| Resolution | 480 × 320 |
| Active area | 73.44 × 48.96mm |
| Glass outline | 85.5 × 54.94 × 2.5mm |
| Interface | 4-wire SPI (IM pins pre-configured internally) |
| FPC | 18-pin, 0.5mm pitch, bottom short edge (landscape) |
| Backlight | 4 parallel LED cathodes (K1-K4), anode to VCC |
| Touch | None ("N" suffix) |
| Source | AliExpress ~$4-8 |

### FPC Pinout (18-pin)

| Pin | Signal | Pin | Signal |
|-----|--------|-----|--------|
| 1 | GND | 10 | LEDA (backlight anode) |
| 2 | RESET | 11 | K1 (backlight cathode) |
| 3 | SCK | 12 | K2 (backlight cathode) |
| 4 | DC | 13 | K3 (backlight cathode) |
| 5 | CS | 14 | K4 (backlight cathode) |
| 6 | MOSI | 15-18 | NC (touch, unused) |
| 7 | MISO | | |
| 8 | GND | | |
| 9 | VCC (3.3V) | | |

### Mating FPC Connector

18-pin, 0.5mm pitch, bottom-contact ZIF. Available on LCSC from Molex, Cankemeng, BOOMELE (~$0.10-0.30).

### Mounting

Glass sits in faceplate cutout from behind. The glass bezel (~6mm on long sides, ~3mm on short sides) rests against the back of the faceplate, preventing the glass from falling through. FPC ribbon folds down to ZIF connector on control board.

**Faceplate cutout:** 82.5 × 52.0mm (glass minus 1.5mm lip all around for seating).

### Backlight Driving

4 parallel LED cathodes (K1-K4) at ~3.3V forward. Connect LEDA to 3.3V (with current-limiting resistor if needed), switch all K1-K4 cathodes through N-channel MOSFET to GND. Existing backlight MOSFET circuit in display.ato works — just needs 4 cathode pins wired together to the MOSFET drain.

### Other Display Variants (reference)

| Part | Type | Interface | FPC | Thickness | Notes |
|---|---|---|---|---|---|
| MSP3526 (LCDWiki) | Module w/ carrier PCB | SPI (14-pin header) | N/A | 13mm | Too thick, carrier interferes with buttons |
| HotHMI TFT-H035 | Slim module | SPI (15-pin) | 15-pin | 3.8mm | Harder to source |
| GY-TFT035F056 | Bare panel | MCU parallel (40-pin) | 40-pin | 2.2mm | Needs IM pin config for SPI |
| ER-TFT035-6 | Bare panel | Multi (50-pin) | 50-pin | 2.25mm | ILI9488, not ST7796 |
| CFAF320480C7-035TN | Bare panel | Multi (50-pin) | 50-pin | 2.25mm | $42, Crystalfontz |

---

## Summary: Depth Stack Behind Faceplate

```
Component              Behind-panel depth    Mount type     Sets PCB distance?
─────────────────────  ────────────────────  ─────────────  ──────────────────
Thonkiconn jack        5.5mm body + 3.5mm    Panel-mount    YES (~10mm)
                       pins = ~10mm total
EC11E encoder          6.6mm body + pins     Panel-mount    NO (too short,
                       = ~9mm total                         needs spacer)
TC002 tact switch      7.3-17.6mm above PCB  PCB-mount      NO
Micro SD connector     1.4-1.85mm            PCB-mount      NO
USB-C (GCT USB4085)    3.46mm above PCB      PCB-mount      NO
3.5" TFT module        13-14mm total         Custom mount   NO
```

The Thonkiconn jack is the height-setting component for most eurorack builds, establishing a ~10mm PCB-to-panel distance. All other components must be designed around this constraint.
