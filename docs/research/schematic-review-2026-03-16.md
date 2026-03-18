# Schematic Review — Pre-Production Audit (2026-03-16)

Full review of all atopile source files before JLCPCB submission.
Research validated against real eurorack modules and specs.

## Status Key
- [ ] Not started
- [~] In progress
- [x] Fixed
- [-] Accepted / Won't fix

---

## FIX — MIDI OUT (resistor values)

### 1. MIDI OUT Uses Wrong Resistor Values for 3.3V TX
**File:** `boards/elec/src/midi.ato:25-33`
**Status:** [x] Fixed

The circuit uses 5V-spec 220Ω resistors but with 3.3V UART TX. This is a hybrid
configuration not supported by any MIDI spec. During TX HIGH (idle), the 1.4V
difference between Ring and Tip may partially conduct the receiver's optocoupler.

**Research findings:**
- MIDI CA-033 spec explicitly addresses 3.3V: use 33Ω (Ring to VCC) + 10Ω (Tip to TX),
  both from 3.3V rail. Gives ~6mA loop current (above 5mA spec minimum).
- Teensy community confirms: 220Ω + 3.3V = insufficient current, documented failures.
- Mutable Instruments Yarns (STM32, 3.3V) uses level-shifting for MIDI OUT.
- No need for transistor buffer — just correct resistor values per CA-033.

**Fix:** Change both resistors to CA-033 values, both powered from 3.3V (vcc):
- `r_out_ring`: 220Ω → **33Ω**, connect to **vcc** (3.3V) instead of v5v
- `r_out_tip`: 220Ω → **10Ω**
- Ref: https://mitxela.com/other/ca33.pdf

---

## ACCEPT — DAC AVDD Headroom

### 2. DAC AVDD ~0.3V Below 5V Due to Schottky — Acceptable
**File:** `boards/elec/src/power.ato:51-54`, `boards/elec/src/dac-output.ato:69`
**Status:** [-] Accepted

**Research findings:**
- At DAC currents (~12mA), B5819W drop is ~0.25-0.35V → AVDD ≈ 4.65-4.75V
- DAC80508 swings to within 4mV of AVDD when unloaded → max output ~4.7V
- **Pitch:** -2V to +7.4V = 9.4 octaves. Metropolix only outputs 5 octaves. O&C does 9.
- **Gate:** 4.7V is far above the ~2V trigger threshold all eurorack modules use.
- **Velocity:** max 7.5V vs 8V — imperceptible.
- **Mod:** +5V to -4.4V instead of ±5V — minor asymmetry.
- Industry practice: most modules (O&C, NerdSEQ) regulate from +12V, but our range
  is already better than or equal to every commercial sequencer.

**No action needed.** Can revisit in rev2 with a dedicated 5V LDO from +12V if desired.

---

## FIX — Display Backlight (supply rail + resistor)

### 3. Display Backlight Severely Underpowered
**File:** `boards/elec/src/control.ato:316-318`
**Status:** [x] Fixed

33Ω from 3.3V gives 3-9mA. Panel specs 90-95mA for full brightness (6 internal LEDs).
Current circuit runs at ~5% of rated current.

**Research findings:**
- LCD Wiki 3.5" ST7796 IPS panel: backlight spec is 95mA at 5V.
- At 3-9mA the display will be barely visible even in a dark room.
- Eurorack users prefer dimmer displays (less blinding in studios), so we don't need
  full 95mA. 15-20mA is a good compromise for a prototype.
- PWM dimming via existing MOSFET + `lcd_bl` GPIO gives software control on top.

**Fix:** Change backlight anode supply from 3.3V to 5V, increase R from 33Ω to 82Ω:
- `r_lcd_leda` connected to `connector.v5v` instead of `connector.v3v3`
- `r_lcd_leda.resistance` = 82Ω (gives ~18mA at Vf=3.2V)
- 2N7002 MOSFET is rated 115mA continuous — handles this easily
- Can always reduce R later if brighter is needed

---

## FIX — LCD Reset GPIO

### 4. No Software-Controlled LCD Reset — Display Can Get Stuck
**File:** `boards/elec/src/control.ato:286-296`
**Status:** [x] Fixed

LCD reset is RC-only (10kΩ × 100nF = 1ms). No MCU GPIO.

**Research findings:**
- Well documented in ILI9341/ST7796 forums: displays get stuck after MCU soft-reset
  when hardware reset is not toggled. SPI command 0x01 (software reset) does NOT
  reliably recover from all failure modes (partial SPI transfer, bus contention).
- Bodmer/TFT_eSPI, EEVBlog, Teensy forums all confirm: GPIO reset is essential.
- Every ST7796/ILI9341 reference design uses GPIO-controlled reset.
- The RC circuit is correct for power-on timing but insufficient for runtime recovery.

**Fix:** Route spare GPIO through connector to LCD reset pin:
- Add `lcd_rst` signal to BoardConnectorInterface and BoardConnectorSocket
- Assign spare GPIO (GP22) in mcu.ato → connector → control board → FPC PIN27
- Keep RC circuit for power-on timing (belt-and-suspenders)
- GPIO drives open-drain LOW to reset, then releases (pull-up holds HIGH)
- Uses one of Header A's spare pins or reassign existing pinout

---

## FIX — Encoder Debounce (reduce caps)

### 5. Encoder Debounce Caps Too Large — May Miss Steps
**File:** `boards/elec/src/main.ato:140-168`
**Status:** [x] Fixed

100nF + 10kΩ = 1ms time constant. ~3ms to cross logic threshold.

**Research findings:**
- Mutable Instruments (Braids, Plaits, etc.): **zero hardware debounce** — pure software.
- RP2040/RP2350 PIO-based quadrature decoding inherently rejects bounce via gray-code
  state machine. Multiple libraries: GitJer/Rotary_encoder, PicoEncoder, QuadratureDecoder.
- EEVBlog/Arduino forums: 100nF confirmed too large for fast rotation, causes missed steps.
- Standard recommendation: 10nF for basic noise filtering, real debounce in firmware/PIO.

**Fix:** Reduce all 6 encoder caps from 100nF to 10nF:
- `c_enc_a_a.capacitance` = 10nF +/- 20%
- `c_enc_a_b.capacitance` = 10nF +/- 20%
- `c_enc_b_a.capacitance` = 10nF +/- 20%
- `c_enc_b_b.capacitance` = 10nF +/- 20%
- `c_enc_a_sw.capacitance` = 10nF +/- 20%  (switch — could stay 100nF, but 10nF is fine)
- `c_enc_b_sw.capacitance` = 10nF +/- 20%
- τ = 10kΩ × 10nF = 0.1ms — provides RF filtering without slowing edges

---

## FIX — SWD Debug Access (add test pads)

### 6. SWD Debug Signals Not Routed — No Debug Access on Prototype
**File:** `boards/elec/src/mcu.ato:152-155`
**Status:** [x] Fixed

**Research findings:**
- PGA2350 module has NO exposed SWD pads — only accessible via carrier board routing.
- USB serial (printf) covers ~90% of debugging, UF2 flashing works over USB.
- BUT: if USB doesn't enumerate (power issue, bad config, secure boot mishap),
  SWD is the only way in. This is a first prototype — expect the unexpected.
- Industry standard: always include SWD on prototypes. Three pads cost nothing.

**Fix:** Add 3 test pads or 1.27mm header (SWCLK, SWDIO, GND) to main.ato:
- Connect `mcu.swd_clk` and `mcu.swd_dio` to test point footprints
- Add GND test point adjacent

---

## SKIP — DAC SDO

### 7. DAC SDO (MISO) Not Connected
**File:** `boards/elec/src/dac-output.ato:64-65, 72-73`
**Status:** [-] Accepted

Nice-to-have for register readback during bringup. Not worth adding a GPIO + connector
pin for a prototype. Can bodge if needed.

---

## VERIFIED CORRECT (No Action Needed)

- Eurorack 16-pin header pinout matches Doepfer standard
- Reverse polarity Schottky diodes correctly oriented on all three rails (+12V, -12V, +5V)
- AMS1117-3.3 TAB connected to VOUT (correct for SOT-223 thermal pad)
- AMS1117 input/output caps meet stability requirements (≥10µF)
- -12V bulk cap polarity correct (GND on positive terminal)
- PGA2350 VB fed through Schottky from +5V (correct)
- Separate 3.3V rails (PGA2350 internal vs AMS1117) — good noise isolation
- GPIO assignments respect RP2350 hardware function-select constraints
- ADC_VREF RC filter (200Ω + 2.2µF) — textbook Pico 2 reference
- Pitch feedback taps AFTER 470Ω protection resistor — opamp compensates for load drop, gain exact
- Pitch 0.1% resistors give ~5-6mV worst-case error (~1/14 semitone)
- Velocity/Mod/Gate feedback from opamp output (no precision needed) — correct
- Pitch reference divider: 5V × 10k/(15k+10k) = 2.000V (0.1% resistors)
- Mod reference divider: 5V × 10k/(20k+10k) = 1.667V
- Spare opamp channels tied as followers to GND (prevents oscillation)
- DAC bypass: 100nF + 10µF per chip, VREF decoupling per datasheet §9.3.1
- Op-amp bypass: 100nF per chip per rail + 10µF bulk per rail
- BAT54S clamping orientation correct (D1 to GND, D2 to 3.3V via common junction)
- Input protection math: 10k/(10k+22k) = 0.3125× → 10V → 3.125V (below 3.6V clamp)
- USB-C: 5.1kΩ CC pull-downs, 27Ω series resistors, ESD at connector side
- USB VBUS correctly left unconnected (data-only, eurorack-powered)
- TLC5947 BLANK pull-up prevents 624mA LED inrush at power-on
- 74HC165 chain: CLK_INH tied low, SER of first SR tied low, spare inputs to VCC
- Board-to-board Header C GND interleaving between analog signal groups
- SPI0 bus sharing (display + SD) with separate CS lines
- SD MISO 47kΩ pull-up prevents floating when no card inserted
- MIDI IN optocoupler circuit: correct 6N138 application with reverse protection diode
- 2N3904 clock/reset output buffers: correct common-emitter topology
- System validation module wires all connector signals between boards
- +5V power budget acceptable at ~284mA realistic (8 LEDs × 19.5mA + system overhead)
