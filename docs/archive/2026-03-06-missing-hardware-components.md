# Missing Hardware Components Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add settings button (GP23), RST OUT jack (GP24), LCD connector (9-pin header), and fix all custom part footprint/picker traits for atopile 0.14.

**Architecture:** Three new circuits added to existing modules (mcu, io-jacks, display), one new part (pin header), and 9 existing part files updated with `is_atomic_part` + `has_part_picked` traits following the pattern established by PJ398SM/TC002-RGB/EC11E.

**Tech Stack:** Atopile 0.14, KiCad 9 (via Docker for pcbnew)

---

### Task 1: Add `is_atomic_part` traits to 74HC165D

**Files:**
- Modify: `hardware/parts/74HC165D/74HC165D.ato`

**Step 1: Add trait imports and trait lines to the component**

Replace the entire file with:

```
# 74HC165D — NXP 8-bit Parallel-In Serial-Out Shift Register, SOIC-16
# LCSC: C5613

#pragma experiment("TRAITS")
import is_atomic_part
import has_designator_prefix
import has_part_picked

component _74HC165D:
    trait is_atomic_part<manufacturer="NXP", partnumber="74HC165D", footprint="74HC165D.kicad_mod", symbol="74HC165D.kicad_sym">
    trait has_designator_prefix<prefix="U">
    trait has_part_picked::by_supplier<supplier_id="lcsc", supplier_partno="C5613", manufacturer="NXP", partno="74HC165D">

    signal SH_LD ~ pin 1
    signal CLK ~ pin 2
    signal D4 ~ pin 3
    signal D5 ~ pin 4
    signal D6 ~ pin 5
    signal D7 ~ pin 6
    signal QH_N ~ pin 7
    signal GND ~ pin 8
    signal QH ~ pin 9
    signal SER ~ pin 10
    signal D0 ~ pin 11
    signal D1 ~ pin 12
    signal D2 ~ pin 13
    signal D3 ~ pin 14
    signal CLK_INH ~ pin 15
    signal VCC ~ pin 16
```

**Step 2: Verify syntax**

Run: `cd hardware && ato validate`
Expected: No syntax errors for this file.

---

### Task 2: Add `is_atomic_part` traits to TLC5947DAP

**Files:**
- Modify: `hardware/parts/TLC5947DAP/TLC5947DAP.ato`

**Step 1: Add trait imports and trait lines**

Add before line 5 (`component TLC5947DAP:`):

```
#pragma experiment("TRAITS")
import is_atomic_part
import has_designator_prefix
import has_part_picked
```

Add as first lines inside the component (after `component TLC5947DAP:`):

```
    trait is_atomic_part<manufacturer="TI", partnumber="TLC5947DAP", footprint="TLC5947DAP.kicad_mod", symbol="TLC5947DAP.kicad_sym">
    trait has_designator_prefix<prefix="U">
    trait has_part_picked::by_supplier<supplier_id="lcsc", supplier_partno="C1554203", manufacturer="TI", partno="TLC5947DAP">
```

Remove the old `designator_prefix = "U"` line at the bottom (replaced by trait).

---

### Task 3: Add `is_atomic_part` traits to OPA4172ID

**Files:**
- Modify: `hardware/parts/OPA4172ID/OPA4172ID.ato`

**Step 1: Add trait imports and trait lines**

Same pattern. LCSC: C1849436 (OPA4172IPWR TSSOP-14 variant).

Add before `component OPA4172ID:`:

```
#pragma experiment("TRAITS")
import is_atomic_part
import has_designator_prefix
import has_part_picked
```

Add as first lines inside component:

```
    trait is_atomic_part<manufacturer="TI", partnumber="OPA4172ID", footprint="OPA4172ID.kicad_mod", symbol="OPA4172ID.kicad_sym">
    trait has_designator_prefix<prefix="U">
    trait has_part_picked::by_supplier<supplier_id="lcsc", supplier_partno="C1849436", manufacturer="TI", partno="OPA4172IPWR">
```

Remove old `designator_prefix = "U"`.

---

### Task 4: Add `is_atomic_part` traits to DAC8568SPMR

**Files:**
- Modify: `hardware/parts/DAC8568SPMR/DAC8568SPMR.ato`

LCSC: C524819.

Add before `component DAC8568SPMR:`:

```
#pragma experiment("TRAITS")
import is_atomic_part
import has_designator_prefix
import has_part_picked
```

Add inside component:

```
    trait is_atomic_part<manufacturer="TI", partnumber="DAC8568SPMR", footprint="DAC8568SPMR.kicad_mod", symbol="DAC8568SPMR.kicad_sym">
    trait has_designator_prefix<prefix="U">
    trait has_part_picked::by_supplier<supplier_id="lcsc", supplier_partno="C524819", manufacturer="TI", partno="DAC8568SPMR">
```

Remove old `designator_prefix = "U"`.

---

### Task 5: Add `is_atomic_part` traits to 6N138

**Files:**
- Modify: `hardware/parts/6N138/6N138.ato`

LCSC: C571211.

Add before `component _6N138:`:

```
#pragma experiment("TRAITS")
import is_atomic_part
import has_designator_prefix
import has_part_picked
```

Add inside component:

```
    trait is_atomic_part<manufacturer="Vishay", partnumber="6N138", footprint="6N138.kicad_mod", symbol="6N138.kicad_sym">
    trait has_designator_prefix<prefix="U">
    trait has_part_picked::by_supplier<supplier_id="lcsc", supplier_partno="C571211", manufacturer="Vishay", partno="6N138">
```

Remove old `designator_prefix = "U"`.

---

### Task 6: Add `is_atomic_part` traits to 2N3904

**Files:**
- Modify: `hardware/parts/2N3904/2N3904.ato`

LCSC: C18536.

Add before `component _2N3904:`:

```
#pragma experiment("TRAITS")
import is_atomic_part
import has_designator_prefix
import has_part_picked
```

Add inside component:

```
    trait is_atomic_part<manufacturer="Changjiang Electronics", partnumber="2N3904", footprint="2N3904.kicad_mod", symbol="2N3904.kicad_sym">
    trait has_designator_prefix<prefix="Q">
    trait has_part_picked::by_supplier<supplier_id="lcsc", supplier_partno="C18536", manufacturer="Changjiang Electronics", partno="2N3904">
```

Remove old `designator_prefix = "Q"`.

---

### Task 7: Add `is_atomic_part` traits to AMS1117-3.3

**Files:**
- Modify: `hardware/parts/AMS1117-3.3/AMS1117-3.3.ato`

LCSC: C6186.

Add before `component AMS1117_3V3:`:

```
#pragma experiment("TRAITS")
import is_atomic_part
import has_designator_prefix
import has_part_picked
```

Add inside component:

```
    trait is_atomic_part<manufacturer="AMS", partnumber="AMS1117-3.3", footprint="AMS1117-3.3.kicad_mod", symbol="AMS1117-3.3.kicad_sym">
    trait has_designator_prefix<prefix="U">
    trait has_part_picked::by_supplier<supplier_id="lcsc", supplier_partno="C6186", manufacturer="AMS", partno="AMS1117-3.3">
```

Remove old `designator_prefix = "U"`.

---

### Task 8: Add `is_atomic_part` traits to AZ1117IH-5.0

**Files:**
- Modify: `hardware/parts/AZ1117IH-5.0/AZ1117IH-5.0.ato`

LCSC: C108496.

Add before `component AZ1117_5V0:`:

```
#pragma experiment("TRAITS")
import is_atomic_part
import has_designator_prefix
import has_part_picked
```

Add inside component:

```
    trait is_atomic_part<manufacturer="Diodes Inc", partnumber="AZ1117IH-5.0", footprint="AZ1117IH-5.0.kicad_mod", symbol="AZ1117IH-5.0.kicad_sym">
    trait has_designator_prefix<prefix="U">
    trait has_part_picked::by_supplier<supplier_id="lcsc", supplier_partno="C108496", manufacturer="Diodes Inc", partno="AZ1117IH-5.0TRG1">
```

Remove old `designator_prefix = "U"`.

---

### Task 9: Add `is_atomic_part` traits to BAT54S

**Files:**
- Modify: `hardware/parts/BAT54S/BAT54S.ato`

LCSC: C83935.

Add before `component BAT54S:`:

```
#pragma experiment("TRAITS")
import is_atomic_part
import has_designator_prefix
import has_part_picked
```

Add inside component:

```
    trait is_atomic_part<manufacturer="Nexperia", partnumber="BAT54S", footprint="BAT54S.kicad_mod", symbol="BAT54S.kicad_sym">
    trait has_designator_prefix<prefix="D">
    trait has_part_picked::by_supplier<supplier_id="lcsc", supplier_partno="C83935", manufacturer="Nexperia", partno="BAT54S,215">
```

Remove old `designator_prefix = "D"`.

---

### Task 10: Build checkpoint — verify part traits work

**Step 1: Run ato build**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd hardware && ato build --build default --frozen`

Expected: Build succeeds. The "No pickers and no footprint" warnings for sr1-sr4, tlc1-tlc4, opamp1-opamp4, dac1-dac2, opto, q_clk, reg_3v3, reg_5v, and BAT54S instances should be gone or reduced.

**Step 2: Check remaining warnings**

If some parts still warn about missing footprints, it may be because atopile couldn't download from LCSC (network issue or part number mismatch). Note which ones fail — they may need local `.kicad_sym`/`.kicad_mod` files created manually.

---

### Task 11: Add GP23 and GP24 signals to MCU module

**Files:**
- Modify: `hardware/elec/src/mcu.ato`

**Step 1: Add new signal declarations**

After line 56 (`signal clk_out    # GP28`), add:

```
    # Settings button (direct GPIO)
    signal settings_btn  # GP23

    # Reset output
    signal rst_out       # GP24
```

**Step 2: Add GPIO pin assignments**

After line 105 (`pico.GP28_ADC2 ~ clk_out`), add:

```
    pico.GP23 ~ settings_btn
    pico.GP24 ~ rst_out
```

---

### Task 12: Add RST OUT jack and buffer to IOJacks

**Files:**
- Modify: `hardware/elec/src/io-jacks.ato`

**Step 1: Add rst_out_gpio signal**

After line 38 (`signal clk_out_gpio   # From Pico GP28`), add:

```
    signal rst_out_gpio   # From Pico GP24
```

**Step 2: Add RST OUT circuit after the CLK OUT section (after line 140)**

Add after line 140 (`j_clk_out.SLEEVE ~ gnd`):

```

    # --- Reset Output Jack ---
    # Same transistor buffer as CLK OUT
    j_rst_out = new PJ398SM
    q_rst = new _2N3904

    r_rst_base = new Resistor
    r_rst_base.resistance = 1kohm +/- 5%

    r_rst_collector = new Resistor
    r_rst_collector.resistance = 1kohm +/- 5%

    rst_out_gpio ~ r_rst_base.unnamed[0]
    r_rst_base.unnamed[1] ~ q_rst.BASE
    q_rst.EMITTER ~ gnd
    v5v ~ r_rst_collector.unnamed[0]
    r_rst_collector.unnamed[1] ~ q_rst.COLLECTOR
    q_rst.COLLECTOR ~ j_rst_out.TIP
    j_rst_out.SLEEVE ~ gnd
```

---

### Task 13: Create PinHeader1x9 part

**Files:**
- Create: `hardware/parts/PinHeader1x9/PinHeader1x9.ato`

**Step 1: Create directory and .ato file**

```
# PinHeader1x9 — Generic 1×9 Male Pin Header, 2.54mm, Through-Hole
# Used for LCD module connector

#pragma experiment("TRAITS")
import is_atomic_part
import has_designator_prefix
import has_part_picked

component PinHeader1x9:
    trait is_atomic_part<manufacturer="Generic", partnumber="PinHeader_1x9_P2.54mm", footprint="PinHeader1x9.kicad_mod", symbol="PinHeader1x9.kicad_sym">
    trait has_designator_prefix<prefix="J">
    trait has_part_picked::by_supplier<supplier_id="lcsc", supplier_partno="C124413", manufacturer="BOOMELE", partno="C124413">

    signal PIN1 ~ pin 1
    signal PIN2 ~ pin 2
    signal PIN3 ~ pin 3
    signal PIN4 ~ pin 4
    signal PIN5 ~ pin 5
    signal PIN6 ~ pin 6
    signal PIN7 ~ pin 7
    signal PIN8 ~ pin 8
    signal PIN9 ~ pin 9
```

---

### Task 14: Add LCD header to DisplayConnector module

**Files:**
- Modify: `hardware/elec/src/display.ato`

**Step 1: Add header import and instance**

After line 3 (`import MOSFET`), add:

```
from "../../parts/PinHeader1x9/PinHeader1x9.ato" import PinHeader1x9
```

**Step 2: Add header instance and wiring**

After line 50 (`c_lcd.unnamed[1] ~ gnd`), add:

```

    # --- Physical LCD connector (9-pin header) ---
    header = new PinHeader1x9

    # Pin 1: VCC
    header.PIN1 ~ vcc
    # Pin 2: GND
    header.PIN2 ~ gnd
    # Pin 3: CS
    header.PIN3 ~ cs
    # Pin 4: RESET
    header.PIN4 ~ rst
    # Pin 5: DC
    header.PIN5 ~ dc
    # Pin 6: MOSI
    header.PIN6 ~ mosi
    # Pin 7: SCK
    header.PIN7 ~ sck
    # Pin 8: LED (backlight — connects to MOSFET drain)
    header.PIN8 ~ q_bl.drain
    # Pin 9: MISO (not connected in current design)
    signal miso
    header.PIN9 ~ miso
```

---

### Task 15: Add settings button and RST OUT wiring to top-level Requencer

**Files:**
- Modify: `hardware/elec/src/requencer.ato`

**Step 1: Add settings button imports and instance**

After line 14 (`from "../../parts/EC11E/EC11E.ato" import EC11E`), add:

```
from "../../parts/TC002-RGB/TC002-RGB.ato" import TC002_RGB
```

After line 33 (`enc_b = new EC11E`), add:

```

    # Settings button (direct GPIO, no LED)
    btn_settings = new TC002_RGB
```

**Step 2: Add settings button wiring**

After the encoder debounce caps section (after line 307, `c_enc_b_b.unnamed[1] ~ gnd`), add:

```

    # === SETTINGS BUTTON (direct GPIO) ===
    # Pull-up resistor
    r_settings_pu = new Resistor
    r_settings_pu.resistance = 10kohm +/- 5%
    r_settings_pu.unnamed[0] ~ power.v3v3
    r_settings_pu.unnamed[1] ~ mcu.settings_btn

    # Debounce cap
    c_settings = new Capacitor
    c_settings.capacitance = 100nF +/- 20%
    c_settings.unnamed[0] ~ mcu.settings_btn
    c_settings.unnamed[1] ~ gnd

    # Switch wiring (active low: press connects to GND)
    btn_settings.SW1 ~ mcu.settings_btn
    btn_settings.SW2 ~ gnd

    # LED anode to VCC (LED cathodes left unconnected — no TLC channels available)
    btn_settings.LED_ANODE ~ leds.led_vcc
```

**Step 3: Add RST OUT wiring**

After line 316 (`mcu.clk_out ~ jacks.clk_out_gpio`), add:

```
    mcu.rst_out ~ jacks.rst_out_gpio
```

---

### Task 16: Final build and verification

**Step 1: Run full ato build**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd hardware && ato build --build default --frozen`

Expected: Build succeeds with fewer warnings. The new components (btn_settings, j_rst_out, lcd header) should appear in the netlist.

**Step 2: Run placement**

Run:
```bash
cp hardware/build/builds/default/backups/$(ls -t hardware/build/builds/default/backups/ | head -1) hardware/elec/layout/default/default.kicad_pcb
docker run --rm --platform linux/amd64 --entrypoint "" \
  -v $(pwd):/work -w /work \
  ghcr.io/atopile/atopile-kicad:main \
  python3 hardware/scripts/place_components.py hardware/elec/layout/default/default.kicad_pcb
```

Expected: More components placed than before (217+). New RST OUT jack and settings button should be placeable.

**Step 3: Export gerbers for visual check**

Run:
```bash
docker run --rm --platform linux/amd64 --entrypoint "" \
  -v $(pwd):/work -w /work \
  ghcr.io/atopile/atopile-kicad:main \
  python3 hardware/scripts/export_manufacturing.py hardware/elec/layout/default/default.kicad_pcb hardware/manufacturing
```

Upload `hardware/manufacturing/requencer-gerbers.zip` to KiCanvas or JLCPCB for visual verification.

**Step 4: Update placement script for new components**

The `place_components.py` script needs the RST OUT jack address mapping. Add to `utility_addr_map`:

```python
"rst_out": "jacks.j_rst_out",
```

And add settings button placement (direct address, near the transport buttons area):

```python
place("btn_settings", 135.55, 43.00)
```
