# Illuminated Button Selection Research

**Date:** 2026-03-10
**Decision:** Hybrid — bi-color step buttons, unlit track/subtrack and function buttons

## Context

The Requencer has 34 tactile buttons: 16 step buttons (2 rows of 8), 4 track selectors, 4 subtrack selectors, and 10 function/transport buttons. The original design specified the Well Buying TC002-N11AS1XT-RGB — an integrated RGB tactile switch with common-anode LED.

This research evaluates LED options per button group to balance expressiveness and circuit complexity.

## Options Evaluated

### Option A: Single-Color White (All Buttons)

**Component:** TC002-N11AS1XT-W (Well Buying, Mouser) or equivalent white LED tact switch.

- 6-pin THT: 4 switch + 2 LED (anode + cathode)
- PCB footprint: 6.5 × 4.5mm
- 1 TLC5947 channel per button

**Circuit impact:**
- TLC5947 LED drivers: **2** (48 channels total, 34 used, 14 spare)
- Total LED traces on control board: **34**
- ICs removed vs current design: 3× TLC5947, 3× 2kΩ IREF, 3× bypass cap

**Sourcing:** Mouser. Not available on LCSC. The LCSC part number C5765888 currently in the `.ato` file is **incorrect** — it maps to a 255kΩ resistor.

### Option E: Hybrid Bi-Color Steps + Unlit Everything Else (Selected)

Assigns LED type per button group based on UX need:

| Group | Count | LED Type | Channels/button | Component |
|-------|-------|----------|-----------------|-----------|
| Step buttons (2×8) | 16 | Bi-color (red/green) | 2 | TC002-N11AS1XT (2-color) |
| Track/subtrack selectors (left of screen) | 8 | None (unlit) | 0 | Standard tact switch |
| Function/transport buttons (right of screen) | 10 | None (unlit) | 0 | Standard tact switch |

**Circuit impact:**
- LED channels: 16×2 + 8×0 + 10×0 = **32 channels**
- TLC5947 LED drivers: **2** (48 channels total, 32 used, 16 spare)
- Total LED traces on control board: **32**
- ICs removed vs current design: 3× TLC5947, 3× 2kΩ IREF, 3× bypass cap
- Shift registers: 5× 74HC165 (unchanged — scanning is independent of LED type)
- MCU GPIO: 4 pins for LED SPI chain (unchanged)
- Board-to-board connector: no change (same 4 LED control lines)
- Button SKUs: 2 (bi-color illuminated, standard unlit)

**UX rationale:**
- **Step buttons** need color — red/green mixing gives red, green, yellow/orange to distinguish active step, current playhead, accented steps, muted steps
- **Track/subtrack selectors** — state shown on OLED display with color-coded detail; LEDs unnecessary
- **Function buttons** (play, stop, shift, etc.) are stateless or state is obvious from context — no LED needed

**UX feedback via:**
- Step buttons: color (red/green/yellow) + 12-bit PWM brightness + blink patterns
- All other buttons: OLED display for state feedback
- OLED display remains the rich visual feedback channel

**Sourcing:** TC002 bi-color from Mouser. Unlit tact switches widely available (LCSC or Mouser).

### Option B: Bi-Color Red/Green (Considered)

**Component:** TC002-N11AS1XT with 2-color LED variant.

- 6-pin THT: same footprint as single-color
- 2 TLC5947 channels per button (red + green cathodes)

**Circuit impact:**
- TLC5947 LED drivers: **3** (72 channels total, 68 used, 4 spare)
- Total LED traces: **68**
- Mixing produces red, green, and yellow/orange — 3 distinct colors + brightness

**Trade-off:** More expressive than white (color-coded states without display), but +1 TLC5947 and double the LED traces. Same 6-pin footprint — no PCB width change.

### Option C: Full RGB (Original Design)

**Component:** TC002-N11AS1XT-RGB (Well Buying, Mouser).

- **8-pin THT** for full color: 4 switch + 4 LED (anode + R/G/B cathodes)
- PCB footprint: 6.5 × 5.8mm (30% wider than single/bi-color)
- 3 TLC5947 channels per button

**Circuit impact:**
- TLC5947 LED drivers: **5** (120 channels total, 102 used, 18 spare)
- Total LED traces: **102**
- Maximum flexibility — any color, smooth transitions

**Trade-off:** Most complex routing, most ICs, widest footprint, Mouser-only sourcing. The 8-pin full-color variant has a different pinout than the 6-pin single/bi-color and requires updating the KiCad symbol and footprint.

### Option D: Hybrid RGB Steps + White Function (Considered)

- 16 step buttons: TC002-N11AS1XT-RGB (8-pin, full RGB)
- 18 function buttons: TC002-N11AS1XT-W (6-pin, white)

**Circuit impact:**
- TLC5947 LED drivers: **3** (48 + 18 = 66 channels)
- Two different button SKUs and footprints on the same board

**Trade-off:** RGB where it matters most (step visualization), simple elsewhere. But mixed BOM and mixed footprints increase assembly complexity.

## Comparison Summary

| Metric | A: White | B: Bi-Color | C: RGB | D: RGB+White | **E: Selected** |
|--------|----------|-------------|--------|-------------|-----------------|
| TLC5947 count | 2 | 3 | 5 | 3 | **2** |
| LED channels total | 34 | 68 | 102 | 66 | **32** |
| Pins per button | 6 | 6 | 8 | Mixed | Mixed (6-pin + 4-pin) |
| PCB footprint | 6.5×4.5mm | 6.5×4.5mm | 6.5×5.8mm | Mixed | Mixed |
| Distinct colors | 1 | 3 | Unlimited | Mixed | Steps: 3, Others: 0 |
| Button SKUs | 1 | 1 | 1 | 2 | **2** |
| Spare TLC channels | 14 | 4 | 18 | ~6 | **16** |
| Sourcing | Mouser | Mouser | Mouser | Mouser | Mouser + LCSC |

## Button Component Candidates

### Step buttons (bi-color): Well Buying TC002-N11AS1XT (2-color)

- 6-pin THT: 4 switch + 2 LED cathodes (red + green), common anode
- 8.2 × 5.8mm base, same footprint as single-color variant
- Red/green mixing → red, green, yellow/orange
- Source: Mouser (Well Buying brand)
- Fits 10.2mm step button pitch with clearance

### Track/subtrack/function buttons (unlit): TC002-N11AS1XT without LED connection

- Same TC002 form factor as the step buttons — consistent cap size and feel across the panel
- 6-pin THT but LED pins left unconnected (no TLC5947 channel wired)
- Alternatively, a no-LED TC002 variant or opaque cap if available
- Source: Mouser (same vendor as step buttons)

### Alternative (step buttons): Diptronics ML6 series

- Available on LCSC (C225012 and variants)
- 9.9mm round button — **may be too large** for 10.2mm step pitch (only 0.3mm gap)
- Bi-color LED variants need verification
- Larger courtyard than TC002

## Implementation Changes Required

1. **Create bi-color `.ato` part** — 6-pin pinout with LED_RED and LED_GREEN cathodes for step buttons
2. **Unlit buttons use same TC002 part** — same footprint, LED pins unconnected
3. **Update KiCad symbol** — bi-color variant (6-pin, 2 cathodes)
4. **Remove 3× TLC5947** from `led-driver.ato` (keep TLC1 and TLC2, remove TLC3–TLC5)
5. **Rewire LED channel assignments** — 32 channels across 2 TLC5947s (step buttons only)
6. **Fix supplier reference** — remove incorrect LCSC C5765888, add correct Mouser part number
7. **Update `component-map.json`** — no dimension change (same TC002 form factor for all buttons)
8. **Firmware** — LED driver code for 2 TLC5947s (48 bits), with color mixing logic for step buttons

## UX Precedent

Single-color illuminated buttons are used by many successful eurorack sequencers:
- Pamela's NEW Workout (ALM) — white LEDs, brightness-coded
- Hermod (Squarp) — white/blue LEDs with display for state detail
- Various Mutable Instruments modules — single-color with blink patterns
- Digitakt/Digitone (Elektron) — single-color backlit pads with display

The OLED display (SSD1351, 128×128 color) provides the rich visual feedback channel. Buttons communicate binary/ternary state; the display shows the nuance.

## Conclusion

The hybrid approach (Option E) puts color only where it matters: step buttons get bi-color red/green/yellow to show playhead, active steps, accents, and mutes at a glance. All other buttons (track, subtrack, function) use the same TC002 form factor but without LED connections — consistent look and feel, zero additional LED routing.

32 LED channels on 2 TLC5947s leaves 16 spare channels for future indicator LEDs (encoder rings, status LEDs) without adding another IC. Only 2 button SKUs (bi-color and unlit, same physical shell) keeps BOM and assembly simple.
