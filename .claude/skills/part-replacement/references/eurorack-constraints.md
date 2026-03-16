# Eurorack-Specific Part Constraints

## Signal Types and Precision Requirements

### Pitch CV (1V/octave)
- **Accuracy matters most here.** 1 semitone = 83.3mV. A 1 LSB error on a 16-bit DAC at 5V range = 76µV — well below threshold. But INL errors accumulate across octaves.
- **DAC requirements**: INL ≤ 4 LSB max (≤ 1 LSB preferred), DNL ≤ ±1 LSB, 16-bit resolution minimum
- **Reference drift**: ≤ 5 ppm/°C (2 ppm/°C preferred) — a 10°C swing at 5 ppm shifts pitch ~0.25 cents
- **Op-amp requirements**: Low offset voltage (< 1mV), low drift (< 5 µV/°C), rail-to-rail output not required (±12V rails, 0-5V DAC output)
- **Resistor tolerance**: 0.1% for gain-setting resistors in pitch path, 1% acceptable elsewhere
- **Output range**: -2V to +8V (10 octaves) via gain=2 offset=-2V op-amp stage

### Gate CV
- **Binary signal**: 0V (off) or +5V (on). No precision requirements.
- **Threshold**: Most modules trigger at ~2.5V rising edge
- **Op-amp**: Unity buffer, no precision needed
- **Timing matters more than voltage**: Gate length accuracy affects musical feel

### Velocity CV
- **Unipolar**: 0V to ~8V (gain=1.6 from 5V DAC)
- **Moderate precision**: 7-bit equivalent (128 levels) is sufficient
- **Op-amp**: Non-inverting, gain tolerance ±5% acceptable

### Modulation CV
- **Bipolar**: +5V to -5V (inverting op-amp with offset)
- **Moderate precision**: Smooth sweeps matter more than absolute accuracy
- **Op-amp**: Inverting topology, ±12V rails required for negative swing

## Power Supply Constraints

| Rail | Typical Current Budget | Used For |
|------|----------------------|----------|
| +12V | 150-200mA total module | Op-amp V+, LED drivers |
| -12V | 50-100mA | Op-amp V- |
| +5V | 200-300mA | DAC AVDD, logic, LED drivers |
| +3.3V | 100-200mA | MCU, DAC VIO, shift registers |

- **Eurorack power connector**: 10-pin or 16-pin shrouded header, keyed
- **Decoupling**: 100nF per IC per rail (close to pins), 10µF bulk per rail cluster
- **Regulation**: On-module LDO from ±12V eurorack bus to +5V/+3.3V

## Physical Constraints

- **Panel width**: 1 HP = 5.08mm. Typical complex module = 20-30 HP
- **PCB depth**: Max ~25mm behind panel (rack rails + cables)
- **Component height**: THT components (jacks, buttons) extend ~10mm above PCB
- **Board stacking**: Multi-board sandwich (faceplate + control + main) connected via pin headers
- **Assembly**: SMD parts → JLCPCB assembly. THT parts → hand-soldered

## SPI Bus Considerations

- **DAC SPI**: Dedicated bus (no sharing) for deterministic timing. Clock ≤ 50 MHz typical.
- **Logic levels**: MCU outputs 3.3V GPIO. DACs may need 5V logic (VIH > 3.3V) — check datasheet. Parts with VIO pin or TTL-compatible inputs avoid level shifters.
- **Bus sharing**: Display + SD card can share SPI if firmware arbitrates. DACs must not share (jitter-sensitive).

## Common Eurorack ICs and Their Roles

| Function | Current Part | Key Spec | Replacement Criteria |
|----------|-------------|----------|---------------------|
| DAC (pitch/gate/vel/mod) | DAC80508ZRTER | 16-bit, 8-ch, 1 LSB INL | Must be 16-bit, ≤ 4 LSB INL, SPI |
| Op-amp (pitch buffer) | OPA4172ID | Quad, 0.3µV/°C drift | Must be low-drift (< 5µV/°C), quad preferred |
| Op-amp (gate/vel/mod) | OPA4172ID | Same | Lower drift spec acceptable, quad preferred |
| LED driver | TLC5947DAP | 24-ch, 12-bit PWM | Must be SPI daisy-chainable, ≥ 24 channels |
| Shift register (buttons) | 74HC165D | 8-bit PISO | Any 74HC165 variant (packaging may vary) |
| MCU | PGA2350 | RP2350B, 48 GPIO | No replacement (project-specific) |

## Cost Benchmarks (per board, 2024-2026 pricing)

| Category | Typical Range | Notes |
|----------|--------------|-------|
| DAC (16-bit, 8-ch) | $8-25 | Newer parts trend cheaper |
| Quad op-amp (precision) | $2-5 | OPA4172 class |
| LED driver (24-ch) | $2-4 | TLC5947 class |
| JLCPCB assembly fee | $8-15 per board | + $0.50/basic part, $3+/extended part |
| Total BOM (SMD only) | $60-120 | Excluding THT, PCB, assembly |

When evaluating replacements, compare against these ranges. A $10 saving on a DAC is significant; a $0.20 saving on a bypass cap is not worth the risk of supply issues.
