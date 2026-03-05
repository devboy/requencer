# Ordering Requencer PCBs from China

Full eurorack module: panel + PCB with jacks, RGB LED buttons, DACs, op-amp output buffers, and all analog circuitry. Plug in a Pico + LCD, flash firmware, drop into rack.

## Strategy: Two-Board Sandwich

1. **Front panel** — 1.6mm aluminum (black anodized) or FR4 (matte black soldermask). Holes for jacks, buttons, encoders, LCD cutout, mounting slots.
2. **Main PCB** — 2-layer FR4, 1.6mm. All electronics: Pico footprint, DACs, op-amps, shift registers, LED drivers, jacks, buttons, encoders, power regulation.

Panel screws to front. PCB sits behind. Through-hole components (jacks, buttons, encoders) poke through panel holes. Standard eurorack construction.

---

## Complete Bill of Materials

### Active ICs

| Component | Part Number | Qty | Package | Unit Cost | Purpose |
|-----------|------------|-----|---------|-----------|---------|
| 16-bit 8-ch DAC | DAC8568SPMR (TI) | 2 | TSSOP-16 | $8.00 | 16 CV output channels (pitch, gate, vel, mod × 4 tracks) |
| Quad rail-to-rail op-amp | OPA4172ID (TI) | 4 | SOIC-14 | $2.50 | Output buffers — gain/offset scaling for eurorack voltage |
| 24-ch LED driver | TLC5947DAP (TI) | 4 | HTSSOP-32 | $2.00 | 96 channels for 32 RGB LED buttons (3 per button) |
| 8-bit shift register (PISO) | 74HC165D (NXP) | 4 | SOIC-16 | $0.10 | Button scanning — 32 buttons on 3 GPIO |
| Optocoupler | 6N138 | 1 | DIP-8 | $0.50 | MIDI input isolation |
| 3.3V LDO regulator | AMS1117-3.3 | 1 | SOT-223 | $0.15 | +12V → 3.3V for Pico, LCD logic, DACs |
| 5V LDO regulator | LM7805 or AZ1117-5 | 1 | SOT-223 | $0.20 | +12V → 5V for LED drivers, MIDI |

### Through-Hole Components (Front-Panel Mounted)

| Component | Part Number | Qty | Unit Cost | Notes |
|-----------|------------|-----|-----------|-------|
| RGB tactile switch | Well Buying TC002-N11AS1XT-RGB | 32 | $1.00 | Integrated RGB LED, SPST momentary, Metropolix-style |
| 3.5mm mono jack | Thonkiconn PJ398SM | 26 | $0.30 | 6 utility + 4 CV input + 16 output |
| Rotary encoder w/ switch | Alps EC11E | 2 | $0.50 | Encoders A and B, quadrature + push |
| Eurorack power header | Shrouded 2×5 (2.54mm) | 1 | $0.30 | Standard 10-pin: +12V, -12V, +5V, GND |

### Passive Components (SMD 0805)

| Component | Value | Qty | Purpose |
|-----------|-------|-----|---------|
| Ceramic cap | 100nF | 24 | Bypass/decoupling on every IC (2 per DAC, 1 per op-amp, 1 per shift reg, 1 per LED driver, Pico, regulators) |
| Ceramic cap | 10µF | 4 | Bulk decoupling on +12V, -12V, +5V, +3.3V rails |
| Ceramic cap | 1µF | 2 | DAC8568 reference decoupling |
| Resistor | 1kΩ | 16 | Series protection on all CV/gate output jacks |
| Resistor | 10kΩ | 10 | Pull-ups: encoder A/B lines (4), encoder switches (2), button scan pull-ups (4) |
| Resistor | 22kΩ | 6 | Input voltage dividers — top leg (CLK IN, RST IN, CV A-D) |
| Resistor (0.1% precision) | Various | 32 | Gain/offset networks for DAC → op-amp scaling (see Output Stage) |
| Resistor | 220Ω | 4 | MIDI TX/RX series resistors |
| Resistor | 330Ω | 1 | MIDI optocoupler current limit |
| Resistor | 470Ω | 1 | MIDI optocoupler pull-up |
| Schottky diode | BAT54S (dual) | 3 | Input protection clamp on CLK IN, RST IN, and MIDI IN |
| Schottky diode | 1N5817 | 2 | Reverse polarity protection on power header |

### What You Solder In Yourself

| Component | Price | Notes |
|-----------|-------|-------|
| Raspberry Pi Pico (RP2040) | $4 | Castellated pads — solder flush onto PCB footprint |
| 3.5" ILI9488 LCD (480×320 SPI) | $8 | Connects via FPC or pin header on PCB |
| Encoder knobs (14.5mm, D-shaft) | $2 | Press-fit onto Alps EC11 shafts |

---

## Analog Output Stage

### Architecture

```
DAC8568 (0–5V, 16-bit) → resistor gain/offset network → OPA4172 → 1kΩ → jack
                                                            ↑
                                                     powered from ±12V eurorack rails
```

### Output Voltage Ranges

The DAC8568 outputs 0–5V (with internal 2.5V reference, gain=2). The OPA4172 buffer applies gain and DC offset to reach eurorack standard ranges:

| Output Type | Voltage Range | DAC → Op-Amp Config | Notes |
|-------------|--------------|---------------------|-------|
| Pitch CV | -2V to +8V (10 octaves) | Gain=2, offset=-2V | 1V/oct, 16-bit = 1.5 cents/step |
| Gate | 0V to +5V | Unity gain, no offset | Digital gate, slew-limited by DAC update rate |
| Velocity | 0V to +8V | Gain=1.6, no offset | Unipolar, maps MIDI 0–127 |
| Mod | -5V to +5V (bipolar) | Gain=2, offset=-5V | Bipolar for LFO/mod routing |

### Gain/Offset Resistor Network

For each output channel, a standard inverting summing amplifier topology (keeps OPA4172 inputs near virtual ground, avoids TL074-style phase reversal issues):

```
          R_in (from DAC)
DAC out ──┤►├──┬── (–) OPA4172 ──┬── 1kΩ ── jack tip
                │                │
          R_offset               R_fb
                │                │
          V_ref (from           GND
          precision divider)
```

Exact resistor values depend on desired range. For pitch CV (-2V to +8V from 0–5V DAC):
- R_in = 10kΩ, R_fb = 20kΩ (gain = -2), R_offset = 10kΩ from +1V reference
- Use 0.1% tolerance resistors for pitch accuracy

### DAC8568 Configuration

- **2 chips** on SPI bus (shared MOSI/SCK with LCD, separate CS pins)
- **Chip 1:** GATE 1-4 (channels A-D) + PITCH 1-4 (channels E-H)
- **Chip 2:** VEL 1-4 (channels A-D) + MOD 1-4 (channels E-H)
- Internal 2.5V reference enabled, gain=2 → 0–5V output range
- Update rate: once per sequencer tick (typ. 500µs at 120BPM / 16th notes)

### Op-Amp Power

OPA4172 runs on ±12V directly from eurorack power header. No additional regulation needed. Output swings rail-to-rail (within ~200mV of rails).

---

## Button & LED System

### Button Scanning: 74HC165 Shift Registers

4× 74HC165 daisy-chained. 3 GPIO pins from Pico:
- **GP8** — CLK (shared clock for all shift registers)
- **GP9** — SH/LD (parallel load latch)
- **GP10** — QH (serial data out from last chip in chain)

Scan all 32 buttons in <5µs at 8MHz SPI clock. Poll at 1kHz in firmware.

Button assignment to shift register positions:
- SR1 (bits 0-7): Step buttons 1-8
- SR2 (bits 8-15): Step buttons 9-16
- SR3 (bits 16-23): Track T1-T4, Subtrack GATE/PITCH/VEL/MOD
- SR4 (bits 24-31): PAT, MUTE, ROUTE, DRIFT, XPOSE, VAR, PLAY, RESET

### LED Driving: TLC5947 Constant-Current Drivers

4× TLC5947 daisy-chained. 4 GPIO pins from Pico:
- **GP11** — SIN (serial data in)
- **GP12** — SCLK (serial clock)
- **GP13** — XLAT (latch — transfers shift register to output)
- **GP14** — BLANK (all outputs off when high — used for global brightness/PWM)

Each TLC5947 has 24 channels with 12-bit PWM brightness control. 4 chips = 96 channels.

RGB LED assignment (3 channels per button):
- TLC1 (ch 0-23): Step buttons 1-8 (8 × 3 = 24 channels)
- TLC2 (ch 24-47): Step buttons 9-16 (8 × 3 = 24 channels)
- TLC3 (ch 48-71): Track T1-T4 (12ch) + Subtrack GATE/PITCH/VEL/MOD (12ch)
- TLC4 (ch 72-95): PAT (3ch) + MUTE/ROUTE/DRIFT/XPOSE/VAR (15ch) + PLAY (3ch) + RESET (3ch)

### LED Colors (Software-Defined)

| Button Group | Active Color | Dim/Off Color | Flash Color |
|-------------|-------------|---------------|-------------|
| Track 1 | Red (#c8566e) | Dark gray | — |
| Track 2 | Orange (#c89040) | Dark gray | — |
| Track 3 | Green (#5aaa6e) | Dark gray | — |
| Track 4 | Cyan (#5aabb4) | Dark gray | — |
| Step (on) | Red | Dark purple | Green (playhead) |
| Subtrack/Feature (active) | White | Off | — |
| PLAY | Green | Off | Green pulse |
| RESET | White | Off | — |

---

## Input Protection

### Clock & Reset Inputs (CLK IN, RST IN)

Eurorack gate signals can be 0–10V. Pico GPIO is 3.3V max.

```
Jack tip ── 22kΩ ──┬── Pico GPIO (GP26/GP27)
                   │
                  10kΩ
                   │
                  GND
                   │
              BAT54S (clamp to 3.3V and GND)
              100nF (filter cap)
```

Voltage divider: 10k/(10k+22k) = 0.31× → 10V input → 3.1V at GPIO (safe)

### CV Inputs (A, B, C, D)

Same circuit as clock/reset. These are future-use inputs, but the protection circuit ensures nothing damages the Pico if patched.

---

## MIDI I/O (TRS Type A)

### MIDI OUT

```
Pico GP21 (UART TX) ── 220Ω ── TRS tip (source)
+3.3V ── 220Ω ── TRS ring (sink)
TRS sleeve ── GND
```

### MIDI IN

```
TRS tip ── 220Ω ──┐
                   ├── 6N138 optocoupler ── 470Ω pull-up to 3.3V ── Pico GP22 (UART RX)
TRS ring ── 220Ω ──┘
TRS sleeve ── GND (isolated side)
```

---

## Power

### Eurorack Power Header (2×5, keyed)

```
Pin 1: -12V     Pin 2: -12V
Pin 3: GND      Pin 4: GND
Pin 5: GND      Pin 6: GND
Pin 7: GND      Pin 8: GND
Pin 9: +12V     Pin 10: +12V
```

(Some headers include +5V on pins — we generate our own 5V.)

### Regulation

| Rail | Regulator | Source | Load |
|------|-----------|--------|------|
| +3.3V | AMS1117-3.3 | +12V | Pico (50mA), LCD logic (20mA), DAC8568 ×2 (10mA), 74HC165 ×4 (5mA) |
| +5V | AZ1117-5.0 | +12V | TLC5947 ×4 LED drivers (up to 200mA total for 32 RGB LEDs) |
| ±12V | Direct from header | Eurorack PSU | OPA4172 ×4 (40mA), MIDI (5mA) |

**Total +12V draw:** ~85mA + 200mA LEDs + 40mA op-amps = ~325mA (well within eurorack PSU capacity)
**Total -12V draw:** ~40mA (op-amps only)

---

## GPIO Pin Budget (RP2040 Pico — 26 GPIO)

| Function | Pins | GPIO Assignment |
|----------|------|-----------------|
| LCD SPI: MOSI | 1 | GP0 (SPI0 TX) |
| LCD SPI: SCK | 1 | GP2 (SPI0 SCK) |
| LCD SPI: CS | 1 | GP1 |
| LCD: DC | 1 | GP3 |
| LCD: RST | 1 | GP4 |
| LCD: Backlight | 1 | GP5 |
| DAC8568 #1: CS | 1 | GP6 |
| DAC8568 #2: CS | 1 | GP7 |
| 74HC165: CLK | 1 | GP8 |
| 74HC165: SH/LD | 1 | GP9 |
| 74HC165: QH (data) | 1 | GP10 |
| TLC5947: SIN | 1 | GP11 |
| TLC5947: SCLK | 1 | GP12 |
| TLC5947: XLAT | 1 | GP13 |
| TLC5947: BLANK | 1 | GP14 |
| Encoder A: A | 1 | GP15 |
| Encoder A: B | 1 | GP16 |
| Encoder A: SW | 1 | GP17 |
| Encoder B: A | 1 | GP18 |
| Encoder B: B | 1 | GP19 |
| Encoder B: SW | 1 | GP20 |
| MIDI TX | 1 | GP21 (UART) |
| MIDI RX | 1 | GP22 (UART) |
| CLK IN | 1 | GP26 |
| RST IN | 1 | GP27 |
| CLK/RST OUT | 1 | GP28 |
| **Total** | **26** | **All assigned** |

Note: DAC8568 SPI shares MOSI (GP0) and SCK (GP2) with LCD. Separate CS pins select the target device.

---

## Panel Dimensions

All from `faceplate.ts` at 4.5 px/mm scale:

```
Panel height: 128.5mm (3U standard)
Panel width: TBD from rendered layout (~55-60 HP)

Drill holes:
- Jack holes: 6.0mm drill (Thonkiconn PJ398SM)
- Button holes: per TC002 datasheet (shaft + LED window)
- Encoder holes: 7.0mm drill (EC11E shaft)
- LCD cutout: 73.44 × 48.96mm rectangular
- Mounting slots: 7.0 × 3.5mm oval (Intellijel standard)

Spacing:
- Jack c-c: 14.0mm horizontal, 12.4mm vertical (output grid)
- Button c-c: 10.7mm (track/subtrack/feature columns)
- Step button c-c: 7.0mm (step grid)
```

---

## Jack Inventory (26 total)

| Jack | Signal Type | Direction | Voltage Range |
|------|------------|-----------|---------------|
| CLK IN | Digital gate | Input | 0–10V → divided to 3.3V |
| CLK OUT | Digital gate | Output | 0–5V from DAC |
| RST IN | Digital gate | Input | 0–10V → divided to 3.3V |
| RST OUT | Digital gate | Output | 0–5V from DAC |
| MIDI IN | MIDI serial | Input | Optocoupler isolated |
| MIDI OUT | MIDI serial | Output | 3.3V UART via resistors |
| CV IN A | Analog CV | Input | 0–10V → divided to 3.3V (future use) |
| CV IN B | Analog CV | Input | 0–10V → divided (future) |
| CV IN C | Analog CV | Input | 0–10V → divided (future) |
| CV IN D | Analog CV | Input | 0–10V → divided (future) |
| GATE 1-4 | Digital gate | Output | 0–5V from DAC + OPA4172 |
| PITCH 1-4 | 1V/oct CV | Output | -2V to +8V from DAC + OPA4172 |
| VEL 1-4 | Unipolar CV | Output | 0–8V from DAC + OPA4172 |
| MOD 1-4 | Bipolar CV | Output | -5V to +5V from DAC + OPA4172 |

---

## Cost Estimate (Full Module)

### Per-Unit Cost (qty 5 PCBs, 1 assembled)

| Item | Cost |
|------|------|
| Front panel (black FR4, qty 5) | $8 |
| Main PCB (2-layer FR4, qty 5) | $12 |
| SMD assembly (DACs, op-amps, LED drivers, shift regs, passives) | $60 |
| Through-hole parts: 26 jacks ($8), 32 RGB buttons ($32), 2 encoders ($1), power header ($0.30) | $42 |
| Shipping (DHL, 5-7 days) | $25 |
| **Subtotal: PCBs + assembly for 1 unit** | **~$147** |
| Raspberry Pi Pico | $4 |
| 3.5" ILI9488 LCD | $8 |
| Encoder knobs × 2 | $3 |
| **Total for 1 working module** | **~$162** |

### Per-Unit at Higher Quantities

| Qty | Estimated per-unit | Notes |
|-----|-------------------|-------|
| 1 | ~$162 | Prototype |
| 5 | ~$120 | PCB costs amortized |
| 25 | ~$85 | Volume component pricing |
| 100 | ~$65 | Full production pricing |

---

## Manufacturing: JLCPCB

### Panel
- Material: FR4, 1.6mm, matte black soldermask both sides
- White silkscreen for labels
- Alternative: aluminum core (black anodized) for $8-15/5pcs

### Main PCB
- 2-layer FR4, 1.6mm, HASL or ENIG finish
- SMD assembly: JLCPCB handles all 0805 passives + TSSOP/SOIC ICs
- Through-hole: JLCPCB hand-solder service or self-solder
- Stencil: $8 (included with SMT assembly order)

### Component Sourcing
- **LCSC** (JLCPCB's warehouse): most passives, 74HC165, regulators
- **Mouser/DigiKey**: DAC8568, OPA4172, TLC5947, Well Buying TC002 buttons
- **AliExpress**: Thonkiconn jacks (or Thonk UK for genuine PJ398SM)

---

## PCB Design Tool: Atopile → EasyEDA Pro

**Previous approach:** Flux.ai browser-based PCB design with AI copilot. Abandoned — the copilot was unreliable (wrong topologies, misassigned pins) and expensive (credits burned on bad results). See `flux-ai-prompt.md` for the archived prompts.

**Current approach:** Code-first schematic in atopile (`.ato` files in `hardware/`), compiled to KiCad format, imported into EasyEDA Pro for PCB layout, exported to JLCPCB. See `hardware-strategy.md` for full details.

- Schematic source: `hardware/elec/src/*.ato` (version controlled, CI-tested)
- Component library: `hardware/parts/` (14 component definitions)
- CI: GitHub Actions runs `ato build` on every push to `hardware/`
- Layout: done in EasyEDA Pro after importing KiCad output

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| TC002 button holes misaligned | Download SnapEDA footprint, verify against datasheet before panel design |
| DAC output voltage inaccuracy | Use 0.1% precision resistors in gain/offset network; add trim pots for calibration |
| LCD doesn't fit cutout | Buy specific LCD module first, measure actual dimensions |
| Op-amp oscillation | 100nF bypass caps close to OPA4172 power pins; keep traces short |
| Power budget exceeds supply | 325mA on +12V is conservative; most eurorack PSUs supply 1A+ |
| SPI bus contention | Separate CS pins for LCD, DAC1, DAC2; proper chip select sequencing in firmware |
| GPIO exhaustion | All 26 pins assigned; RST OUT shares pin with CLK OUT (software-multiplexed) |

## Next Steps

1. **Build atopile schematic** — ✅ Complete. See `hardware/elec/src/requencer.ato`
2. **Run `ato create part`** — import LCSC footprints for Tier 2 ICs
3. **Source through-hole footprints** — PJ398SM, TC002-RGB, EC11E, Pico module
4. **`ato build`** — verify full compilation to KiCad
5. **PCB layout in EasyEDA Pro** — component placement and routing
6. **Order test panel** — just the faceplate first ($5), verify fit with TC002 buttons and Thonkiconn jacks
7. **Order full PCB** — once panel verified
8. **Port engine to Rust** — embassy-rs on RP2040
