# PCB Design Validation Report — Requencer

**Date:** 2026-03-10
**Scope:** Full pre-manufacturing audit of atopile schematic, firmware pin assignments, circuit correctness, and component selection.
**Verdict:** **DO NOT MANUFACTURE** — 6 critical errors found that would make the board non-functional.

---

## Executive Summary

The Requencer PCB design has a solid architecture (multi-board sandwich, dedicated SPI buses, proper input protection, well-designed analog output stage). However, **the atopile schematic (`mcu.ato`) has not been updated to match the firmware's corrected GPIO assignments**. The RP2350's hardware peripheral function-select constraints require specific pins for SPI and UART — the schematic ignores these constraints in 5 places. Additionally, the MIDI IN optocoupler is wired backwards, and the 5V LDO regulator will overheat.

**If manufactured as-is:**
- Display: blank (SPI0 MOSI/MISO swapped on PCB traces)
- DAC outputs: garbage (SPI1 SCK/MOSI swapped)
- MIDI: completely dead (wrong UART pins + reversed opto)
- Encoder B push: conflicts with MIDI TX
- 5V regulator: thermal shutdown under load

---

## CRITICAL Issues (Board Will Not Function)

### C1. SPI0 MOSI/MISO Pin Swap — Display and SD Card Dead

| | mcu.ato (PCB traces) | Firmware (correct) | RP2350 hardware |
|---|---|---|---|
| GP0 | `spi0_mosi` (TX) | MISO (RX) | **SPI0_RX only** |
| GP3 | `lcd_dc` (GPIO) | MOSI (TX) | **SPI0_TX only** |

**Root cause:** RP2350 GPIO function select is fixed — GP0 can *only* be SPI0_RX, GP3 can *only* be SPI0_TX. The schematic has them backwards.

**Impact:** The PCB routes GP0 to the display MOSI and SD card MOSI lines. But GP0 outputs SPI0_RX (MISO). The display receives no data → blank screen. SD card writes fail.

The firmware already documents this:
```rust
// Note: PCB schematic says GP0=MOSI, GP3=DC but RP2350 GPIO function
// select requires GP3=MOSI. Schematic needs updating before manufacture.
```

**Fix in `mcu.ato`:**
```
pga.GP0 ~ spi0_miso    # was spi0_mosi — GP0 is SPI0_RX
pga.GP3 ~ spi0_mosi    # was lcd_dc — GP3 is SPI0_TX
```

### C2. LCD DC Pin Wrong — Display Cannot Distinguish Commands from Data

| | mcu.ato (PCB) | Firmware (correct) |
|---|---|---|
| LCD DC | GP3 | **GP7** |

**Root cause:** GP3 must be SPI0_TX (see C1), so LCD DC needs a different GPIO. Firmware uses GP7.

**Impact:** PCB routes GP3 to display DC pin, but GP3 is needed for SPI0 MOSI. Display has no valid data/command select.

**Fix in `mcu.ato`:**
```
pga.GP7 ~ lcd_dc       # was spare — GP7 is now LCD DC
```
Remove GP7 from spare list in comment on line 214.

### C3. SPI1 SCK/MOSI Pin Swap — All DAC Outputs Dead

| | mcu.ato (PCB traces) | Firmware (correct) | RP2350 hardware |
|---|---|---|---|
| GP30 | `spi1_mosi` (TX) | SCK | **SPI1_SCK only** |
| GP31 | `spi1_sck` (SCK) | MOSI (TX) | **SPI1_TX only** |

**Root cause:** Same as C1 — RP2350 function select is fixed. GP30=SPI1_SCK, GP31=SPI1_TX.

**Impact:** PCB routes GP30 (which outputs SPI1 clock) to the level shifter channel for DAC DIN (data). And GP31 (which outputs SPI1 data) to DAC SCLK (clock). Clock and data are crossed. DAC outputs are garbage — all 16 analog outputs (gate, pitch, velocity, mod) produce random voltages.

**Fix in `mcu.ato`:**
```
pga.GP30 ~ spi1_sck     # was spi1_mosi — GP30 is SPI1_SCK
pga.GP31 ~ spi1_mosi    # was spi1_sck — GP31 is SPI1_TX
```
Also swap the comments on lines 36-37.

### C4. MIDI UART Pins Wrong — MIDI Completely Non-Functional

| | mcu.ato (PCB) | Firmware (correct) | RP2350 hardware |
|---|---|---|---|
| MIDI TX | GP21 | **GP20** | GP20 = UART1_TX |
| MIDI RX | GP22 | **GP21** | GP21 = UART1_RX |
| Enc B Push | GP20 | **GP6** | (GPIO, no constraint) |

**Root cause:** mcu.ato comments say "UART0" but firmware uses UART1. GP22 has **no UART function at all** on RP2350. GP21 is UART1_RX, not TX. The firmware correctly uses GP20=UART1_TX and GP21=UART1_RX.

**Impact:** PCB routes GP21 (UART1_RX) to the MIDI TX output circuit. GP22 (no UART function) to MIDI RX input circuit. MIDI output sends nothing. MIDI input receives nothing.

Additionally, GP20 is routed to encoder B push on the PCB, but firmware needs GP20 for UART1_TX. So encoder B push and MIDI TX conflict on the same physical trace.

**Fix in `mcu.ato`:**
```
pga.GP6 ~ enc_b_sw      # was GP20 — moved to spare GPIO
pga.GP20 ~ midi_tx      # was enc_b_sw — GP20 is UART1_TX
pga.GP21 ~ midi_rx      # was midi_tx — GP21 is UART1_RX
# GP22 is now spare (was midi_rx — GP22 has no UART function)
```
Update comments on lines 65, 68-69 to say "UART1" not "UART0".

### C5. MIDI IN Optocoupler Wired Backwards — Cannot Receive MIDI Data

**File:** `midi.ato` lines 62-66

Current wiring:
```
jack_in.TIP → 220Ω → opto.ANODE
opto.CATHODE → jack_in.RING
```

**Analysis with MIDI TRS Type A standard:**
- Tip = DIN Pin 5 = Data (LOW when active, sender UART TX through 220Ω)
- Ring = DIN Pin 4 = Source (HIGH, sender VCC through 220Ω)

When sender transmits (TX LOW):
- Our Tip = LOW voltage, Our Ring = HIGH voltage
- Current path: Ring(HIGH) → opto.CATHODE → opto.ANODE → 220Ω → Tip(LOW)
- This is **reverse-biased** through the optocoupler LED (current must flow Anode→Cathode)
- The protection diode (B5819W anti-parallel) will conduct instead, shorting the signal

**Result:** Optocoupler never activates. MIDI IN is completely dead.

**Fix in `midi.ato`:**
```
# Input circuit: TRS ring (source/VCC) → opto LED anode
jack_in.RING ~ opto.ANODE

# TRS tip (data) → 220Ω → opto LED cathode
jack_in.TIP ~ r_in.unnamed[0]
r_in.unnamed[1] ~ opto.CATHODE

# Protection diode (reversed): across opto LED for reverse voltage protection
d_protect.cathode ~ opto.CATHODE    # was ANODE
d_protect.anode ~ opto.ANODE        # was CATHODE
```

### C6. 5V LDO Regulator Thermal Overload — Will Shut Down or Burn

**File:** `power.ato` — AZ1117IH-5.0 in SOT-223 package

**Power budget for +5V rail:**

| Consumer | Current (mA) |
|---|---|
| PGA2350 VB (MCU + flash + PSRAM) | ~150 |
| 34 RGB LEDs via TLC5947 (avg 25% PWM) | ~200 |
| 2× DAC8568 + 74HCT125 level shifter | ~25 |
| Clock/reset output buffers (2× 2N3904) | ~10 |
| **Total** | **~385 mA** |

**Power dissipation:** (12V - 5V) × 0.385A = **2.7W**

SOT-223 thermal resistance (junction to ambient): ~60°C/W typical with thermal pad.
Junction temperature rise: 2.7W × 60°C/W = **162°C** above ambient.
At 25°C ambient: T_j = 187°C — **far exceeds 125°C max junction temperature.**

Even at 200mA (absolute minimum realistic load): (12-5) × 0.2 = 1.4W → 84°C rise → 109°C junction. Marginal.

**Fix options (choose one):**
1. **Replace with switching regulator** (e.g., TPS54331, MP2315, or LM2596) — recommended for eurorack
2. **Use TO-263 (D2PAK) package** for better thermal dissipation (~40°C/W → 2.7W = 108°C rise, still marginal)
3. **Cascade: 12V → 5V switching, 5V → 3.3V LDO** — most robust approach

---

## GPIO Pin Map — Full Audit

Every PGA2350 GPIO pin, cross-referenced across schematic, firmware, and RP2350 hardware constraints.

### Corrected Pin Assignment Table

| GPIO | RP2350 Function | mcu.ato (CURRENT) | Firmware main.rs | Match? | Board Connector Signal |
|------|----------------|-------------------|-----------------|--------|----------------------|
| GP0 | SPI0_RX | `spi0_mosi` | SPI0 MISO (RX) | **WRONG** | SD card MISO (via main board) |
| GP1 | SPI0_CSn | `lcd_cs` | LCD CS | OK | Display CS (main board direct) |
| GP2 | SPI0_SCK | `spi0_sck` | SPI0 SCK | OK | Display+SD SCK (main board direct) |
| GP3 | SPI0_TX | `lcd_dc` | SPI0 MOSI (TX) | **WRONG** | Display+SD MOSI (main board direct) |
| GP4 | GPIO | `rst_out` | Reset OUT | OK | `rst_out` → NPN buffer → connector |
| GP5 | GPIO | `lcd_bl` | LCD Backlight | OK | Display backlight (main board direct) |
| GP6 | GPIO | *(spare)* | Enc B Push | **WRONG** | Should be `enc_b_sw` via connector |
| GP7 | GPIO | *(spare)* | LCD DC | **WRONG** | Should be `lcd_dc` (main board direct) |
| GP8 | GPIO | `btn_clk` | Button SR CLK | OK | `sr_clk` via Header A pin 22 |
| GP9 | GPIO | `btn_latch` | Button SR Latch | OK | `sr_latch` via Header A pin 23 |
| GP10 | GPIO | `btn_data` | Button SR Data | OK | `sr_data` via Header A pin 24 |
| GP11 | GPIO | `led_sin` | LED SIN | OK | `led_sin` via Header A pin 25 |
| GP12 | GPIO | `led_sclk` | LED SCLK | OK | `led_sclk` via Header A pin 26 |
| GP13 | GPIO | `led_xlat` | LED XLAT | OK | `led_xlat` via Header A pin 27 |
| GP14 | GPIO | `led_blank` | LED BLANK | OK | `led_blank` via Header A pin 28 |
| GP15 | GPIO | `enc_a_a` | Enc A Phase A | OK | `enc_a_a` via Header A pin 29 |
| GP16 | GPIO | `enc_a_b` | Enc A Phase B | OK | `enc_a_b` via Header A pin 30 |
| GP17 | GPIO | `enc_a_sw` | Enc A Push | OK | `enc_a_sw` via Header A pin 31 |
| GP18 | GPIO | `enc_b_a` | Enc B Phase A | OK | `enc_b_a` via Header B pin 3 |
| GP19 | GPIO | `enc_b_b` | Enc B Phase B | OK | `enc_b_b` via Header B pin 4 |
| GP20 | **UART1_TX** | `enc_b_sw` | MIDI TX | **WRONG** | Should be `midi_tx` via Header A pin 18 |
| GP21 | **UART1_RX** | `midi_tx` | MIDI RX | **WRONG** | Should be `midi_rx` via Header A pin 19 |
| GP22 | GPIO (no UART) | `midi_rx` | *(not used)* | **WRONG** | Should be spare |
| GP23 | GPIO | `spi0_miso` | *(not used in main.rs)* | **CHECK** | See note below |
| GP24 | GPIO | `sd_cs` | SD CS | OK | SD card CS (main board direct) |
| GP25 | GPIO | `sd_detect` | SD Detect | OK | SD card detect (main board direct) |
| GP26 | ADC0 | `clk_in` | Clock IN | OK | `clk_in` via Header B pin 6 |
| GP27 | ADC1 | `rst_in` | Reset IN | OK | `rst_in` via Header B pin 7 |
| GP28 | ADC2 | `clk_out` | Clock OUT | OK | `clk_out` via Header B pin 8 |
| GP29 | ADC3 | *(spare)* | *(spare)* | OK | — |
| GP30 | **SPI1_SCK** | `spi1_mosi` | SPI1 SCK | **WRONG** | DAC SCK (main board direct) |
| GP31 | **SPI1_TX** | `spi1_sck` | SPI1 MOSI | **WRONG** | DAC MOSI (main board direct) |
| GP32 | GPIO | `dac1_cs` | DAC1 CS | OK | DAC1 CS (main board direct) |
| GP33 | GPIO | `dac2_cs` | DAC2 CS | OK | DAC2 CS (main board direct) |
| GP34-39 | GPIO | *(spare)* | *(spare)* | OK | — |
| GP40 | ADC4 | `cv_a` | CV A | OK | `cv_a` via Header B pin 10 |
| GP41 | ADC5 | `cv_b` | CV B | OK | `cv_b` via Header B pin 11 |
| GP42 | ADC6 | `cv_c` | CV C | OK | `cv_c` via Header B pin 12 |
| GP43 | ADC7 | `cv_d` | CV D | OK | `cv_d` via Header B pin 13 |
| GP44-47 | GPIO | *(spare)* | *(spare)* | OK | — |

**Note on GP23:** mcu.ato routes GP23 to `spi0_miso` which goes to the SD card. The firmware uses `p.PIN_0` as the MISO pin for SPI0 (matching RP2350 hardware). GP23 is NOT a valid SPI0_RX pin. If mcu.ato is fixed so GP0=spi0_miso, then GP23 becomes spare. The SD card MISO trace must go to GP0.

**Total pin errors: 8 pins wrong out of 34 assigned (GP0, GP3, GP6, GP7, GP20, GP21, GP22, GP30, GP31) = 9 pins.**

### pins.rs vs main.rs Discrepancies

`crates/firmware/src/pins.rs` has the OLD (wrong) assignments matching mcu.ato, not main.rs:

| Type Alias | pins.rs (OLD) | main.rs (CORRECT) |
|---|---|---|
| `Spi0Mosi` | PIN_0 | PIN_3 |
| `LcdDc` | PIN_3 | PIN_7 |
| `Spi0Miso` | PIN_23 | PIN_0 |
| `EncBPush` | PIN_20 | PIN_6 |
| `MidiTx` | PIN_21 | PIN_20 |
| `MidiRx` | PIN_22 | PIN_21 |

**Fix:** Update `pins.rs` to match `main.rs`. These type aliases are not currently used by main.rs but they should be authoritative for documentation.

---

## SIGNIFICANT Issues (Functional Concerns)

### S1. No Bulk Decoupling on 5V LED Power Rail (Control Board)

The TLC5947 LED drivers can sink up to 19.5mA per channel across 108 active channels. LED switching causes current transients on the 5V rail. The 5V rail also powers the DAC analog supply.

**Current state:** Five 100nF caps on TLC5947 VCC (3.3V), but NO decoupling on the 5V LED anode supply on the control board. The only 5V decoupling is on the main board (power supply output caps).

**Risk:** Voltage droop and switching noise on the 5V rail coupling into DAC outputs via shared supply, potentially degrading pitch CV accuracy.

**Fix:** Add 10µF + 100nF bulk caps on the 5V rail on the control board, near the LED driver cluster.

### S2. 3.3V LDO Also Fed from 12V (Unnecessary Heat)

`power.ato`: AMS1117-3.3 VIN connected to +12V.

At 100mA load: (12-3.3) × 0.1 = 0.87W. Manageable but wasteful.

**Better approach:** Feed the 3.3V LDO from the 5V rail: (5-3.3) × 0.1 = 0.17W. 5× less heat. Many eurorack modules cascade regulators this way.

**Risk if unchanged:** Not critical, SOT-223 can handle 0.87W, but the board runs hotter than necessary.

### S3. USB VBUS Not Connected — No Standalone Programming

USB-C VBUS is deliberately not connected (data-only USB). This means the module cannot be powered via USB for firmware programming without eurorack power connected.

The docs mention a planned `mcu.d_usb` (USB VBUS protection diode) that was never implemented.

**Impact:** Development inconvenience. Must have eurorack PSU to program via USB. SWD debug header works as alternative.

**Recommendation:** Add a B5819W from USB VBUS to PGA2350 VB (same as the existing 5V→VB diode). This allows USB-powered development without affecting eurorack operation.

---

## Design Review — What's Good

### Power Supply
- Reverse polarity protection with Schottky diodes on both ±12V rails: correctly wired ✓
- Bulk caps on raw ±12V rails (10µF each) ✓
- Input + output caps on both LDOs ✓
- Regulator TAB pins connected to VOUT ✓

### DAC Output Stage
- 74HCT125 level shifter for 3.3V→5V SPI: correct choice, VIH=2.0V accepts 3.3V ✓
- All 4 OE pins tied to GND (always enabled) ✓
- DAC8568 CLR tied to AVDD (no accidental clear), LDAC tied to GND (immediate update) ✓
- VREF decoupling: 1µF on each DAC VREFIN/VREFOUT pin ✓
- Extensive decoupling: 100nF + 10µF per DAC, 100nF per rail per op-amp, 10µF bulk per rail ✓
- Pitch reference: 0.1% resistors in divider (15k/10k) and feedback network (10k/10k) ✓
- Reference buffers (opamp5 ch1/ch2) eliminate loading on precision dividers ✓
- Spare opamp5 channels tied as followers to GND (prevents oscillation) ✓
- 470Ω output protection resistors: acceptable for eurorack impedances ✓

### DAC Output Voltage Ranges (Verified)
| Output | Formula | Range | Eurorack Standard |
|--------|---------|-------|-------------------|
| Gate | Unity buffer | 0–5V | 5V gate ✓ |
| Pitch | 2×Vdac - 2V | -2V to +8V | 10 octaves, 1V/oct ✓ |
| Velocity | 1.604×Vdac | 0–8V | 0–8V CV ✓ |
| Mod | -2×Vdac + 5V | -5V to +5V | Bipolar ±5V ✓ |

### Input Protection
- 22k/10k voltage divider: 10V → 3.1V (within 3.3V ADC range) ✓
- BAT54S dual Schottky clamp to GND and 3.3V ✓ (circuit correct despite pin naming issue in .ato)
- 100nF filter cap for noise rejection ✓
- 6 instances: 4× CV inputs + clock + reset ✓

### Button Scanning
- 5× 74HC165D daisy-chained correctly (SR1.SER→GND, chain: QH→SER, SR5.QH→MCU) ✓
- CLK_INH tied low on all (always enabled) ✓
- Shared clock and latch lines ✓
- SIP-9 resistor networks replace 40 discrete pull-ups (smart BOM optimization) ✓
- Spare SR5 inputs tied to VCC (no floating inputs) ✓
- 100nF bypass cap per shift register ✓
- Bit ordering matches firmware `bit_to_event()` mapping ✓

### LED Drivers
- 5× TLC5947 daisy-chained correctly (SIN→SOUT chain) ✓
- VCC from 3.3V (SPI level compatibility with PGA2350 GPIO) ✓
- LED anodes from separate 5V supply ✓
- 2kΩ IREF resistors → ~19.5mA max per channel ✓
- TLC5947 operates correctly with VCC=3.3V (min 3.0V per datasheet) ✓
- BLANK active-high (outputs enabled when LOW) — firmware starts with HIGH (outputs off) then enables ✓

### Clock/Reset I/O
- NPN common-emitter buffer: 1kΩ base + 1kΩ collector resistors ✓
- Inverted logic (GPIO HIGH → output LOW) — firmware handles inversion ✓
- Base current: (3.3V - 0.7V) / 1kΩ = 2.6mA → sufficient saturation ✓
- Output current: 5V / 1kΩ = 5mA → safe for eurorack inputs ✓
- Interrupt-driven clock input (embassy tasks) — no missed pulses ✓

### Encoders
- Pull-up resistors (10kΩ to 3.3V) on all 6 encoder signals ✓
- Debounce caps (100nF) on all 6 encoder signals ✓
- RC time constant: 10kΩ × 100nF = 1ms — appropriate for 1kHz polling ✓
- Active-low push buttons (connect to GND, pull-up to 3.3V) ✓

### Board-to-Board Connector
- 2× ShroudedHeader2x16 = 64 pins total ✓
- Pinout identical between Interface (male/main) and Socket (female/control) ✓
- Power pins doubled for current (2× GND, 2× 3.3V, 2× 5V) ✓
- Analog signals (16 DAC outputs) grouped on Header B ✓
- 10 spare pins on Header A for future expansion ✓

### MCU Block
- All 6 GND pins connected ✓
- Bypass caps: 10µF on VB, 100nF + 10µF on 3.3V ✓
- BOOTSEL switch with 10kΩ pull-up ✓
- RUN pin 10kΩ pull-up (prevents spurious resets) ✓
- ADC_VREF 100nF decoupling ✓
- Schottky diode on VB input (power OR-ing ready) ✓
- USB D+/D- exposed for USB-C ✓
- SWD debug signals exposed ✓

### Display
- RC power-on reset (10kΩ × 100nF = 1ms > 10µs required by ST7796) ✓
- N-channel MOSFET backlight control with gate resistor (100Ω) and pull-down (100kΩ) ✓
- 100nF bypass cap on LCD power ✓

### MIDI OUT (circuit correct, pin assignment wrong)
- 220Ω series resistors on Tip and Ring per MIDI spec ✓
- TRS Type A: Tip = data, Ring = VCC ✓
- 3.3V source → ~5mA loop current (within MIDI spec tolerance) ✓

### USB-C
- 27Ω series resistors on D+/D- (signal integrity) ✓
- 5.1kΩ CC pull-downs (required for USB-C device mode) ✓
- PRTR5V0U2X ESD protection on data lines ✓
- Shield connected to GND ✓

### Firmware Architecture
- Drift-compensating tick scheduler (accumulates exact intervals) ✓
- 4kHz CV output interpolation (gate length, ratchets, pitch slide, mod slew) ✓
- Chunked display flush (16-scanline bands) to reduce timing jitter ✓
- Watchdog timer (8s timeout) ✓
- SD card state persistence with dirty tracking ✓
- Embassy async runtime for cooperative multitasking ✓

---

## MINOR Issues (Polish Before Manufacturing)

### M1. BAT54S Part Definition Pin Naming

`parts/BAT54S/BAT54S.ato` labels pin 3 as `ANODE2`, but in the BAT54S (series dual), pin 3 is actually Cathode2. The circuit connections are correct (pin numbers are right), so this is cosmetic. However, it makes the schematic confusing to review.

### M2. Comments Say "UART0" — Firmware Uses UART1

`mcu.ato` lines 68-69 comment `# GP21 — UART0 TX` and `# GP22 — UART0 RX`. The firmware uses UART1 on GP20/GP21. Update comments after fixing C4.

### M3. Encoder Debounce Location

Debounce RC filters are on the main board (near MCU), but the encoders are on the control board. The noise source (mechanical encoder contacts) is ~11mm away through the board connector. For the 1kHz polling rate this works fine, but the filter would be more effective on the control board near the source.

### M4. Missing Display SPI0 MISO Connection

`display.ato` header PIN9 (MISO) connects to a floating signal. This is correct for write-only ST7796, but if a display module with readable status register is ever used, MISO would need routing through SPI0.

### M5. Pitch Output Accuracy with Low-Impedance Loads

470Ω output protection resistors cause 4.5% voltage divider error with 10kΩ loads. With standard 100kΩ eurorack inputs, error is 0.47% (negligible). Document this limitation for users connecting to low-impedance inputs.

---

## Action Items — Priority Order

### Must Fix Before Manufacturing

1. **Fix `mcu.ato` GPIO assignments** (C1-C4): Swap GP0/GP3, add GP7=lcd_dc, swap GP30/GP31, move enc_b_sw to GP6, move MIDI to GP20/GP21
2. **Fix `midi.ato` opto wiring** (C5): Swap ANODE/CATHODE connections on 6N138
3. **Replace 5V regulator** (C6): Switch to buck converter or larger package
4. **Update `pins.rs`** to match corrected assignments
5. **Update `board-connector.ato`** if enc_b_sw connector pin assignment changes
6. **Re-run `ato build` + validation** after all fixes to verify no broken nets

### Should Fix Before Manufacturing

7. Add 5V bulk decoupling on control board (S1)
8. Cascade 3.3V LDO from 5V rail instead of 12V (S2)
9. Add USB VBUS → VB diode for development (S3)

### Nice to Have

10. Fix BAT54S pin naming in part definition (M1)
11. Update comments throughout (M2)
12. Consider adding `spi0_miso` to display connector for future use (M4)

---

## Appendix: Complete Signal Path Traces

### Pitch CV Output (Track 1) — End to End

```
MCU GP31 (SPI1_TX)
  → mcu.spi1_mosi
  → main.ato: dac.spi_mosi
  → dac-output.ato: spi_mosi → lvl.A1 (74HCT125 input, 3.3V)
  → lvl.Y1 (74HCT125 output, 5V level-shifted)
  → spi5v_mosi → dac1.DIN (DAC8568 #1 data input)
  → dac1.VOUTE (DAC channel E analog output, 0-5V)
  → opamp2.IN1_P (OPA4172 non-inverting input)
  → opamp2.OUT1 (gain=2, offset=-2V → -2V to +8V)
  → r_pitch1 (470Ω protection)
  → dac.pitch1
  → main.ato: connector.pitch1
  → Header B PIN18
  → Socket B PIN18
  → control.ato: connector.pitch1 → jacks.pitch1
  → io-jacks.ato: j_pitch1.TIP (Thonkiconn output jack)
```
*Note: After C3 fix, GP30=SCK and GP31=MOSI correctly map to DAC signals.*

### Button Press (Step 1) — End to End

```
User presses TC002_RGB btn_step1 on control board
  → btn_step1.SW1 shorts to GND (through btn_step1.SW2)
  → sr1.D0 goes LOW (was pulled HIGH by rn1.R1 → VCC)
  → MCU pulses sr_clk (GP8), latches sr_latch (GP9)
  → 40 bits shift out through SR chain
  → sr5.QH → data_out signal
  → control.ato: connector.sr_data
  → Socket A PIN24 → Header A PIN24
  → main.ato: connector.sr_data → mcu.btn_data
  → MCU GP10 reads serial data
  → firmware buttons.rs: bit 0 = step1 → ControlEvent::StepButton(0)
```

### External Clock Input — End to End

```
Eurorack clock signal (0-10V) at jack
  → io-jacks.ato: j_clk_in.TIP → clk_in_gpio
  → control.ato: connector.clk_in
  → Socket B PIN6 → Header B PIN6
  → main.ato: connector.clk_in → prot_clk.input
  → input-protection.ato: 22kΩ divider → 0-3.1V
  → BAT54S clamp (limits to -0.3V..3.6V)
  → 100nF filter
  → prot_clk.output → mcu.clk_in
  → MCU GP26 (ADC0, used as digital GPIO with interrupt)
  → firmware clock_io.rs: rising edge sets AtomicBool flag
  → main loop detects flag → engine tick
```
