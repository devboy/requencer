# Flux.ai Design Prompt — Requencer Eurorack Module

Use this prompt in Flux.ai's copilot to generate the schematic and PCB layout. Start with the JLCPCB 2-layer constraints template.

---

## Prompt

Design a 2-layer eurorack synthesizer module PCB with the following specifications. Use JLCPCB-compatible parts from LCSC where possible.

### Project Overview

4-track sequencer eurorack module. 3U height (128.5mm), approximately 55-60 HP wide (~279-305mm). The module has:
- 32 illuminated RGB tactile buttons
- 2 rotary encoders with push switches
- 26 Thonkiconn 3.5mm mono jacks
- A 3.5" TFT LCD display (480×320, SPI)
- A Raspberry Pi Pico (RP2040) as the main controller
- 16 channels of precision DAC output with op-amp buffers
- Eurorack ±12V power input

### Microcontroller: Raspberry Pi Pico (RP2040)

Use the castellated pad footprint for the Raspberry Pi Pico. It solders flush to the PCB. Pinout assignments:

- GP0: SPI0 TX (MOSI) — shared by LCD, DAC8568 #1, DAC8568 #2
- GP1: LCD CS (active low)
- GP2: SPI0 SCK — shared by LCD, DAC8568 #1, DAC8568 #2
- GP3: LCD DC (data/command select)
- GP4: LCD RST (reset)
- GP5: LCD Backlight enable
- GP6: DAC8568 #1 CS (active low)
- GP7: DAC8568 #2 CS (active low)
- GP8: 74HC165 CLK (button scan clock)
- GP9: 74HC165 SH/LD (parallel load latch)
- GP10: 74HC165 QH (serial data out)
- GP11: TLC5947 SIN (LED data in)
- GP12: TLC5947 SCLK (LED clock)
- GP13: TLC5947 XLAT (LED latch)
- GP14: TLC5947 BLANK (LED output enable, active high)
- GP15: Encoder A, channel A
- GP16: Encoder A, channel B
- GP17: Encoder A, push switch
- GP18: Encoder B, channel A
- GP19: Encoder B, channel B
- GP20: Encoder B, push switch
- GP21: UART1 TX (MIDI OUT)
- GP22: UART1 RX (MIDI IN)
- GP26: CLK IN (digital input with voltage divider)
- GP27: RST IN (digital input with voltage divider)
- GP28: CLK/RST OUT (digital output, directly drives gate buffer)
- VBUS: USB power (programming/debugging)
- 3V3: 3.3V regulated output (powers logic ICs)
- GND: Ground

Power the Pico's VSYS pin from the 3.3V LDO output via a Schottky diode (allows USB power OR eurorack power).

### SPI Bus

Shared SPI bus (SPI0) connects three devices:
1. LCD display (CS on GP1)
2. DAC8568 chip 1 (CS on GP6)
3. DAC8568 chip 2 (CS on GP7)

Only one CS is active at a time. SPI mode 1 (CPOL=0, CPHA=1) for DAC8568. SPI mode 0 for LCD. Maximum SPI clock: 50MHz for DAC8568, 62.5MHz for LCD.

### LCD Display Connector

Provide a pin header or FPC connector for a 3.5" ILI9488 SPI display module (480×320). Typical pinout:
1. VCC (3.3V)
2. GND
3. CS (from GP1)
4. RST (from GP4)
5. DC (from GP3)
6. MOSI (from GP0)
7. SCK (from GP2)
8. LED (backlight, from GP5 via MOSFET — backlight draws ~40mA at 3.3V)
9. MISO (not connected for write-only operation)

Place a small N-channel MOSFET (2N7002 or BSS138) to switch the LCD backlight from GP5:
- Gate: GP5 via 1kΩ resistor
- Source: GND
- Drain: LCD LED cathode

### DAC Output Stage (16 channels)

#### DAC8568 (×2)

TI DAC8568SPMR. 16-bit, 8-channel, voltage output DAC with internal 2.5V reference.

**Chip 1 (CS on GP6):**
- Channel A: Gate output 1
- Channel B: Gate output 2
- Channel C: Gate output 3
- Channel D: Gate output 4
- Channel E: Pitch CV output 1
- Channel F: Pitch CV output 2
- Channel G: Pitch CV output 3
- Channel H: Pitch CV output 4

**Chip 2 (CS on GP7):**
- Channel A: Velocity output 1
- Channel B: Velocity output 2
- Channel C: Velocity output 3
- Channel D: Velocity output 4
- Channel E: Mod output 1
- Channel F: Mod output 2
- Channel G: Mod output 3
- Channel H: Mod output 4

Each DAC8568:
- AVDD: +5V (from 5V regulator)
- DGND, AGND: connect to ground plane
- VREFH/VREFL: internal reference enabled (2.5V, gain=2 → 0-5V output)
- SYNC (active low CS): from Pico GP6/GP7
- SCLK: from Pico GP2 (shared SPI SCK)
- DIN: from Pico GP0 (shared SPI MOSI)
- LDAC: tie to GND (synchronous update on SYNC rising edge)
- CLR: tie to AVDD via 10kΩ (active low, don't clear)

Bypass: 100nF + 1µF ceramic caps on AVDD, close to pins. 100nF on DGND.

#### OPA4172 Op-Amp Buffers (×4)

TI OPA4172ID. Quad rail-to-rail output op-amp. Powered from ±12V eurorack rails.

Each OPA4172 handles 4 output channels. 4 chips = 16 channels total.

**Op-amp 1:** Gate outputs 1-4 (channels from DAC1 A-D)
**Op-amp 2:** Pitch outputs 1-4 (channels from DAC1 E-H)
**Op-amp 3:** Velocity outputs 1-4 (channels from DAC2 A-D)
**Op-amp 4:** Mod outputs 1-4 (channels from DAC2 E-H)

**Gate output circuit (unity gain, 0-5V):**
```
DAC out ── 10kΩ ──┬── (–) OPA4172 ──┬── 1kΩ ── jack tip
                  │                 │
                 10kΩ (feedback)    │
                  │                 │
                  └─────────────────┘
(+) input: GND
```
Inverting unity gain. DAC 0-5V → output 0 to -5V. Then a second inverting stage recovers 0-5V. Alternatively, use non-inverting unity buffer:
```
DAC out ── (+) OPA4172 ──┬── 1kΩ ── jack tip
                         │
                    (–) ─┘ (100% feedback)
```
Non-inverting buffer is simpler for gate. Use this.

**Pitch CV output circuit (-2V to +8V from 0-5V DAC):**
Inverting summing amplifier:
```
DAC out ── R1 (10kΩ) ──┬── (–) OPA4172 ──┬── 1kΩ ── jack tip
                       │                 │
V_offset ── R2 (10kΩ) ─┤            Rf (20kΩ)
                       │                 │
                       └─────────────────┘
(+) input: GND
```
V_offset = +1V precision reference (from resistor divider off 3.3V: 10kΩ + 23.2kΩ).
Output = -(DAC × 2 + 1 × 2) + offset correction. Trim with precision resistors.
Use 0.1% tolerance metal film resistors for R1, R2, Rf.

**Velocity output circuit (0-8V from 0-5V DAC):**
Non-inverting amplifier:
```
DAC out ── (+) OPA4172 ──┬── 1kΩ ── jack tip
                         │
                    (–) ─┤
                         │
                    R1 (10kΩ) to GND
                         │
                    Rf (6.2kΩ) feedback
```
Gain = 1 + Rf/R1 = 1.62 → 0-5V becomes 0-8.1V.

**Mod output circuit (-5V to +5V from 0-5V DAC):**
Inverting amplifier with offset:
```
DAC out ── R1 (10kΩ) ──┬── (–) OPA4172 ──┬── 1kΩ ── jack tip
                       │                 │
+2.5V ref ── R2 (10kΩ)┤            Rf (20kΩ)
                       │                 │
                       └─────────────────┘
(+) input: GND
```
Output = -(DAC × 2 + 2.5 × 2) = -(2×DAC + 5). When DAC=0V: output=-5V. When DAC=5V: output=-15V... needs adjustment. Better: gain=2, offset from -2.5V reference.

Simpler approach — use DAC midpoint as zero:
- DAC = 0V → output = -5V
- DAC = 2.5V → output = 0V
- DAC = 5V → +5V
- Circuit: output = (DAC - 2.5V) × 2
- Non-inverting differential: Rf = 10kΩ, R1 = 10kΩ, offset = -2.5V (from DAC internal reference pin)

**All outputs:** add 1kΩ series protection resistor between op-amp output and jack tip.

**Bypass caps:** 100nF ceramic on each V+ and V- pin of every OPA4172, placed close to IC.

### Button Scanning: 74HC165 Shift Registers (×4)

4× 74HC165D (SOIC-16) daisy-chained for 32 button inputs.

Connections:
- All VCC: +3.3V
- All GND: ground
- CLK (pin 2): shared, from GP8
- SH/LD (pin 1): shared, from GP9
- Chain: QH of chip 1 → SER of chip 2 → QH of chip 2 → SER of chip 3 → etc.
- Final QH (chip 4) → GP10

Each chip's 8 parallel inputs (D0-D7) connect to one button each. Buttons connect between input pin and GND. Add 10kΩ pull-up resistors on each input (or use internal pull-ups if available; safer to add external).

**Button-to-shift-register assignment:**
- Chip 1 (D0-D7): Step buttons 1-8
- Chip 2 (D0-D7): Step buttons 9-16
- Chip 3 (D0-D7): T1, T2, T3, T4, GATE, PITCH, VEL, MOD
- Chip 4 (D0-D7): PAT, MUTE, ROUTE, DRIFT, XPOSE, VAR, PLAY, RESET

Bypass: 100nF on VCC of each chip.

### LED Driving: TLC5947 Constant-Current Drivers (×4)

4× TLC5947DAP (HTSSOP-32) daisy-chained for 96 LED channels (32 buttons × 3 RGB channels).

Connections:
- All VCC: +5V (from 5V regulator)
- All GND: ground
- SIN (pin 26): GP11 on first chip; subsequent chips receive SOUT from previous
- SCLK (pin 25): shared, from GP12
- XLAT (pin 24): shared, from GP13
- BLANK (pin 23): shared, from GP14
- Chain: SOUT of chip 1 → SIN of chip 2 → etc.

Each chip has 24 constant-current sink outputs (OUT0-OUT23). Each output sinks up to 30mA.

Set maximum current with IREF resistor on each chip:
- IREF pin to GND via resistor
- R_IREF = 1.21kΩ for ~20mA max per channel (bright RGB LEDs)
- Actual brightness controlled by 12-bit PWM value per channel (0-4095)

**LED wiring:** Each RGB LED button (Well Buying TC002-N11AS1XT-RGB) has common anode. Connect:
- Common anode: +5V via current-limiting is handled by TLC5947 (constant current sink)
- Red cathode: TLC5947 output channel
- Green cathode: TLC5947 output channel
- Blue cathode: TLC5947 output channel

**Channel assignment:**
- TLC1 (OUT0-OUT23): Step 1 R/G/B, Step 2 R/G/B, ..., Step 8 R/G/B
- TLC2 (OUT0-OUT23): Step 9 R/G/B, Step 10 R/G/B, ..., Step 16 R/G/B
- TLC3 (OUT0-OUT23): T1 R/G/B, T2 R/G/B, T3 R/G/B, T4 R/G/B, GATE R/G/B, PITCH R/G/B, VEL R/G/B, MOD R/G/B
- TLC4 (OUT0-OUT23): PAT R/G/B, MUTE R/G/B, ROUTE R/G/B, DRIFT R/G/B, XPOSE R/G/B, VAR R/G/B, PLAY R/G/B, RESET R/G/B

Bypass: 100nF on VCC of each chip. 10µF bulk cap near first chip.

### Rotary Encoders (×2)

Alps EC11E series, through-hole, with push switch.

**Encoder A:**
- Channel A → GP15 (10kΩ pull-up to 3.3V)
- Channel B → GP16 (10kΩ pull-up to 3.3V)
- Push switch → GP17 (10kΩ pull-up to 3.3V, switch connects to GND)
- Common: GND
- Add 100nF debounce caps on A and B channels (to GND)

**Encoder B:**
- Channel A → GP18 (10kΩ pull-up to 3.3V)
- Channel B → GP19 (10kΩ pull-up to 3.3V)
- Push switch → GP20 (10kΩ pull-up to 3.3V)
- Common: GND
- Add 100nF debounce caps on A and B channels (to GND)

### Jacks (26× Thonkiconn PJ398SM)

All jacks are Thonkiconn PJ398SM, 3.5mm mono, through-hole. Tip = signal, sleeve = GND.

**Output jacks (16):** Each connects from its OPA4172 buffer output through a 1kΩ series resistor to the jack tip. Sleeve to GND.

**Clock/Reset input jacks (2):**
```
Jack tip ── 22kΩ ──┬── Pico GPIO
                   ├── 10kΩ to GND (voltage divider: ×0.31)
                   ├── 100nF to GND (noise filter)
                   └── BAT54S dual Schottky (clamp to 3.3V and GND)
```

**Clock/Reset output jack (1):** From GP28 through transistor buffer:
```
GP28 ── 1kΩ ── base of 2N3904
                collector ── 1kΩ ── +5V
                collector ── jack tip
                emitter ── GND
```
Output: 0V (low) / ~4V (high). Standard eurorack gate level.

**CV input jacks (4, A-D):** Same protection circuit as clock/reset inputs. Currently unused in firmware, but protected for future use.

**MIDI jacks (2):** TRS Type A. See MIDI section above.

### Power Section

**Eurorack power header:** Shrouded 2×5 male header, 2.54mm pitch, keyed. Standard eurorack pinout:
- Pins 1-2: -12V
- Pins 3-8: GND
- Pins 9-10: +12V

**Reverse polarity protection:** 1N5817 Schottky diodes in series with +12V and -12V lines.

**+3.3V regulator:** AMS1117-3.3 (SOT-223)
- Input: +12V (after protection diode)
- Output: 3.3V
- Bypass: 10µF + 100nF on input, 10µF + 100nF on output
- Load: ~85mA (Pico, LCD logic, DACs, shift registers)

**+5V regulator:** AZ1117-5.0 (SOT-223) or LM7805 (TO-220)
- Input: +12V (after protection diode)
- Output: 5V
- Bypass: 10µF + 100nF on input, 10µF + 100nF on output
- Load: ~200mA (TLC5947 LED drivers, DAC AVDD)

**-12V:** Used directly from eurorack power (after protection diode) for OPA4172 V- pins.
- Bypass: 10µF + 100nF near first op-amp.

**+12V:** Used directly (after protection) for OPA4172 V+ pins.
- Bypass: 10µF + 100nF near first op-amp.

### Physical Layout Constraints

**Panel dimensions:**
- Height: 128.5mm (3U eurorack standard)
- Width: approximately 55-60 HP (279-305mm)
- Rail clearance: 10mm top and bottom (no components in rail zones)

**Component placement (front side, through-hole, poking through panel):**
- All jacks, buttons, and encoders mount on the front side of the PCB
- Components protrude through corresponding panel holes
- LCD mounts behind the panel, visible through rectangular cutout

**Component spacing:**
- Jack center-to-center: 14.0mm horizontal, 12.4mm vertical in output grid
- Button center-to-center: 10.7mm for track/subtrack/feature columns
- Step button center-to-center: 7.0mm in 2×8 grid
- Minimum component clearance: 5.3mm from LCD bezel

**SMD components (back side):**
- All ICs (DAC8568, OPA4172, TLC5947, 74HC165), regulators, and passives mount on back side
- Pico solders flush to back side via castellated pads
- Keep analog (DAC, op-amp) section separate from digital (shift registers, LED drivers) section
- Ground plane should be continuous; avoid splitting

**Mounting holes:**
- 4 Intellijel-style oval mounting slots: 7.0mm × 3.5mm
- Position: 7.2mm from left/right edges, 3.4mm from top/bottom edges
- M3 screws

### PCB Specifications (JLCPCB)

- Layers: 2
- Material: FR4
- Thickness: 1.6mm
- Copper weight: 1oz
- Surface finish: HASL (lead-free) or ENIG
- Soldermask: black (both sides)
- Silkscreen: white (front side — component labels, module name)
- Min trace width: 0.2mm (8mil)
- Min clearance: 0.2mm
- Min via: 0.3mm drill / 0.6mm pad

### Design Notes

1. **Ground plane:** Use bottom layer as continuous ground plane. Route signal traces on top layer. Use vias to connect to ground plane for bypassing.

2. **Analog routing:** Keep DAC output traces and op-amp circuits away from digital switching noise (SPI clock, LED driver clock). Route analog traces on opposite side of board from digital traces where possible.

3. **Power traces:** Use wider traces (0.5mm+) for +12V, -12V, +5V, +3.3V power distribution. Star-ground topology from power header.

4. **SPI bus:** Keep SPI traces (MOSI, SCK) short and direct. Route CS lines separately to each device.

5. **LED driver placement:** TLC5947 chips should be near their respective button groups to minimize trace length to LED cathodes.

6. **Bypass cap placement:** Every IC must have a 100nF ceramic cap within 5mm of its power pins.
