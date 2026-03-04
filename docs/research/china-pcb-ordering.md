# Ordering Requencer PCBs from China

Research on getting a physical panel + PCB built, with jacks and buttons pre-assembled. Buy MCU, LCD, and power separately — iterate on software without waiting for new boards.

## Strategy: Two-Board Sandwich

Order two separate PCBs from JLCPCB/PCBWay:

1. **Front panel** — 1.6mm aluminum or FR4 (painted matte black), holes for jacks/buttons/encoders/LCD/mounting
2. **Main PCB** — standard FR4, components soldered on, pin headers break out to dev board

The panel screws to the front, the PCB sits behind it, components poke through the panel holes. Standard eurorack construction.

---

## What Goes on the PCB (Pre-Built)

| Component | Qty | Footprint | Approx Unit Cost | Notes |
|-----------|-----|-----------|-----------------|-------|
| Thonkiconn PJ398SM (3.5mm mono jack) | 22 | Through-hole | $0.30 | All jacks: CLK×2, RST×2, MIDI×2, output×16 |
| Tactile switch 5mm (e.g. Omron B3F) | 32 | Through-hole | $0.05 | Track×4, subtrack×4, feature×5, PAT×1, step×16, transport×2 |
| LED 3mm (various colors) | 32 | Through-hole | $0.03 | One per button: red, orange, green, cyan for tracks; white for steps |
| EC11E rotary encoder w/ switch | 2 | Through-hole | $0.50 | Encoders A and B, with push-button click |
| 2×20 pin header (2.54mm) | 1 | Through-hole | $0.20 | Breakout to dev board (buttons, LEDs, encoders, jacks) |
| 1×4 pin header (for LCD) | 1 | Through-hole | $0.05 | SPI/I2C to display |
| 100nF bypass caps | 4 | 0805 SMD | $0.01 | Decoupling on power rails |
| 10k resistor arrays | 4 | 0805 SMD | $0.01 | Pull-ups/pull-downs for buttons |
| Eurorack power header (2×5 shrouded) | 1 | Through-hole | $0.30 | Standard 10-pin eurorack power |

**Total BOM per board: ~$15–20** (at qty 5)

### What You Solder In Yourself

| Component | Price | Notes |
|-----------|-------|-------|
| Raspberry Pi Pico (RP2040) | $4 | Solder flush to castellated pads on PCB |
| 3.5" ILI9488 LCD (480×320 SPI) | $8 | Solder to header/pads on PCB |
| Encoder knobs (14.5mm, D-shaft) | $2 | Press-fit onto EC11 shafts |
| Button caps (5mm, various colors) | $3 | Press-fit onto tactile switches |
| USB cable | $2 | Power + programming via Pico's USB |

---

## PCB Design Approach

### Scanning 32 Buttons + 32 LEDs

Don't run 64 wires to the dev board. Use a matrix or shift registers:

**Option A: Button/LED matrix (cheapest)**
- 8×4 button matrix = 12 GPIO pins for 32 buttons
- 8×4 LED matrix with constant-current drivers = 12 more pins
- Total: ~24 GPIO — tight but doable on Pico/Teensy

**Option B: Shift registers (recommended)**
- 4× 74HC165 (parallel-in serial-out) for button scanning = 3 GPIO (CLK, LATCH, DATA)
- 4× 74HC595 (serial-in parallel-out) for LED driving = 3 GPIO (CLK, LATCH, DATA)
- Total: 6 GPIO for all 32 buttons + 32 LEDs
- Shift registers are $0.05 each, add 8 chips = $0.40 total
- **This is what most eurorack modules do** — proven, reliable, fast enough at 1kHz scan rate

**Option C: I2C GPIO expanders**
- 2× MCP23017 (16 GPIO each) = 32 GPIO on 2 I2C pins
- $1 each, simplest wiring
- Slightly slower scan rate but fine for buttons

### Jack Connections

The 22 jacks need:
- **16 output jacks**: directly wired to DAC/digital outputs from dev board (accent on this later — for now, just break out to pin header)
- **4 utility jacks** (CLK IN/OUT, RST IN/OUT): break out to pin header
- **2 MIDI jacks**: break out to UART TX/RX pins

For the prototype phase, ALL jacks just break out to the pin header. The dev board decides what to do with them. When you're ready for real CV output, add a small DAC daughter board.

### Encoder Connections

2 encoders = 4 GPIO (A/B per encoder) + 2 GPIO (push switches) = 6 pins. Wire directly to pin header.

---

## JLCPCB Order Details

### Panel (Option 1: FR4 — cheapest)
- Material: FR4, 1.6mm, matte black soldermask both sides
- No copper layer needed (cosmetic only)
- White silkscreen for labels (REQUENCER, button names, jack labels, VILE TENSOR)
- Cost: **$2–5 for 5 panels**
- Looks great, but not metal

### Panel (Option 2: Aluminum — proper eurorack)
- JLCPCB does aluminum PCBs (single-sided, 1.6mm AL core)
- Black anodized or white soldermask finish
- Cost: **$8–15 for 5 panels**
- Real eurorack panel feel

### Main PCB
- Standard FR4, 1.6mm, 2-layer
- SMD assembly available for shift registers, resistors, caps
- Through-hole components (jacks, buttons, encoders): either hand-solder or pay for JLCPCB hand-solder service (~$0.02/joint extra)
- Cost: **$5–10 for 5 bare PCBs**, +$30–50 for full assembly (SMD + through-hole)

### Stencil (Optional)
- If you have SMD components, get a stencil ($8) for paste application
- Not needed if only through-hole + shift registers

---

## Total Cost Estimate

### Prototype Run (5 units)

| Item | Cost |
|------|------|
| Panel PCB (FR4 black, qty 5) | $5 |
| Main PCB (bare, qty 5) | $8 |
| SMD assembly (shift registers + passives) | $30 |
| Through-hole components (jacks, buttons, encoders, headers) | $80 ($16/board × 5) |
| Shipping (DHL to US, 5-7 days) | $20 |
| **Subtotal: PCB + assembly** | **~$143** |
| Dev board (Teensy 4.1 × 1) | $30 |
| LCD (3.5" SPI × 1) | $12 |
| Encoder knobs × 2 | $3 |
| Button caps × 32 | $5 |
| **Total for 1 working unit** | **~$80** |
| **Total for 5 panels + 1 working unit** | **~$190** |

### If You Hand-Solder Through-Hole Yourself

| Item | Cost |
|------|------|
| Panel + main PCBs (qty 5) | $13 |
| SMD assembly | $30 |
| Through-hole parts (DigiKey/LCSC) | $16 |
| Shipping | $20 |
| **Total for 5 boards + parts for 1** | **~$80** |

---

## Dimensions for Panel File

All from `faceplate.ts` at 4.5 px/mm scale:

```
Scale: 4.5 px/mm
Panel height: 128.5mm (3U standard)
Panel width: measure from rendered panel (currently ~55-60 HP)

Component positions (convert px → mm by dividing by 4.5):
- Jack holes: 6.0mm drill
- Button holes: 5.0mm drill (or 3.2mm for switch shaft + separate LED hole)
- Encoder holes: 7.0mm drill (EC11E shaft)
- LCD cutout: 73.44 × 48.96mm rectangular
- Mounting slots: 7.0 × 3.5mm oval, positioned at 7.2mm from edges

Jack center-to-center: 14.0mm (output grid: 12.4mm)
Button center-to-center: 10.7mm
Step button center-to-center: 7.0mm
Encoder center-to-center: spread across control strip
```

To generate exact coordinates, we'd run the browser renderer at 1:1 scale and extract absolute positions from the DOM.

---

## Chosen Components

### Dev Board: Raspberry Pi Pico (RP2040)

- **Price:** $4 (Pico) or $5 (Pico W with WiFi)
- **Mounting:** Castellated pads — solder flush directly onto main PCB
- **Footprint:** 21 × 51mm
- **GPIO:** 26 pins — sufficient with shift registers for button/LED scanning
- **PIO:** 2× programmable I/O blocks — hardware-level timing for gate outputs and clock sync
- **USB:** Native USB via TinyUSB — USB MIDI device, no external chip needed
- **SPI:** Up to 62.5 MHz — fast LCD updates
- **Rust:** Excellent support via embassy-rs (async embedded framework)
- **Why not Teensy:** $30 vs $4, more pins than we need, no PIO equivalent

### LCD: ILI9488 3.5" SPI Module (480×320)

- **Price:** ~$8 (AliExpress/LCSC)
- **Active area:** 73.44 × 48.96mm — matches faceplate design exactly
- **Interface:** SPI (MOSI, SCK, CS, DC) + backlight enable + reset = 6 pins total
- **Driver:** ILI9488 or ST7796S — both have mature Rust/C libraries
- **Mounting:** Solder directly to PCB pads or via FPC connector
- **Pixel pitch:** 0.153mm — readable text at 12px+ (1.84mm+)

### Button/LED Scanning: 74HC165 + 74HC595 Shift Registers

- **4× 74HC165** (parallel-in, serial-out) for 32 button inputs = 3 GPIO
- **4× 74HC595** (serial-in, parallel-out) for 32 LED outputs = 3 GPIO
- **Total GPIO for all buttons + LEDs:** 6 pins
- **Scan rate:** 8MHz SPI clock → 32 buttons read in 4µs → >1kHz polling trivially
- **Cost:** $0.40 for all 8 chips

### Single-Board Design

No flying wires. Everything on one PCB:

```
┌─────────────────────────────────────────────┐
│  FRONT PANEL (aluminum or black FR4)        │
│  holes: jacks, buttons, encoders, LCD       │
├─────────────────────────────────────────────┤
│  MAIN PCB (2-layer FR4, 1.6mm)             │
│                                             │
│  ┌─ LCD module ─┐  ┌── Pico ──┐            │
│  │ soldered to  │  │ flush    │  [74HC165] │
│  │ PCB pads     │  │ castella │  [74HC165] │
│  └──────────────┘  │ ted pads │  [74HC165] │
│                    └──────────┘  [74HC165] │
│  [Thonkiconn jacks — through-hole]         │
│  [Tactile switches — through-hole]          │
│  [EC11 encoders — through-hole]             │
│  [74HC595 ×4 — SMD, for LED drive]         │
│  [Eurorack power header 2×5]               │
│  [3.3V regulator from +12V rail]            │
└─────────────────────────────────────────────┘
```

Pico solders flat. LCD connects via header or FPC. All through-hole parts
poke through panel from behind. Shift registers are SMD on back side.

---

## Next Steps

1. **Export panel dimensions** — write a script to extract all component XY positions in mm from the faceplate layout
2. **Draw schematic** — EasyEDA (free, exports directly to JLCPCB) or KiCad
3. **Order test panel** — just the faceplate first ($5), verify fit with real Thonkiconn jacks and tactile switches
4. **Order full PCB** — once panel verified, add the main board with Pico footprint and shift registers
5. **Port engine to Rust** — embassy-rs on RP2040, pure engine functions translate directly

---

## Services

| Service | URL | Best For |
|---------|-----|----------|
| JLCPCB | jlcpcb.com | Cheapest PCB + SMT assembly, fast |
| PCBWay | pcbway.com | Better for aluminum panels, box-build |
| LCSC | lcsc.com | Components (JLCPCB's parts warehouse) |
| DigiKey | digikey.com | Components if LCSC doesn't have it |
| AllPCB | allpcb.com | Alternative, sometimes cheaper for prototypes |

JLCPCB + LCSC is the path of least resistance — order PCBs and components from the same ecosystem, they handle assembly in-house.

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Jack/button holes misaligned | Order panel-only first ($5), test fit before committing to full PCB |
| LCD doesn't fit cutout | Buy the specific LCD first, measure, then cut panel |
| Shift register scan too slow | 74HC165 at 8MHz SPI = 32 buttons in 4µs — not a real risk |
| Dev board doesn't have enough pins | Teensy 4.1 has 55 digital pins; Pico has 26. Both sufficient with shift registers |
| Through-hole assembly quality | JLCPCB hand-soldering is reliable; or just do it yourself in 30 min |

**Lowest risk first step:** Order 5 panels ($5) + buy a handful of Thonkiconn jacks ($7) + tactile switches ($2). Test physical fit. Total: $14 + shipping.
