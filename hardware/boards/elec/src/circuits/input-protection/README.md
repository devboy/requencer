# Input Protection

**Source:** [`input-protection.ato`](./input-protection.ato)
**Board:** Main

## Purpose

Scales and clamps eurorack-level signals (up to +/-5V or 0-10V) down to the 0-3.3V range safe for the RP2350 ADC/GPIO inputs. Used for all CV inputs (4x) and clock/reset inputs (2x).

## Design Decisions

### Voltage Divider (22k / 10k)

The divider ratio is 10k / (10k + 22k) = 0.3125. This maps the full eurorack voltage range to a safe ADC window:

| Input | Output (divider only) |
|-------|-----------------------|
| +10V  | +3.125V               |
| +5V   | +1.5625V              |
| 0V    | 0V                    |
| -5V   | -1.5625V (clamped)    |

The +10V case produces 3.125V, safely below the 3.3V rail. Negative outputs are caught by the Schottky clamp.

1% tolerance resistors ensure consistent scaling across all 6 instances for accurate ADC readings.

### Schottky Clamp (BAT54S)

The BAT54S is a dual series Schottky diode in SOT-23. Its two diodes clamp the divided output:
- **D1 (anode to GND):** clamps below GND - Vf (~-0.3V), protecting against negative swings
- **D2 (cathode to 3.3V):** clamps above 3.3V + Vf (~3.6V), protecting against overvoltage

Schottky diodes are chosen over standard silicon for their low forward voltage (~0.3V vs ~0.7V), giving a tighter clamp window. The BAT54S reverse leakage is low enough to not disturb the voltage divider ratio.

### Filter Capacitor (per-instance)

The RC low-pass filter (R_bottom in parallel with C) rejects high-frequency noise. The capacitance is set per instance in `main.ato`:

| Signal type   | C_filter | f_3dB (with 10k parallel path) | Rationale |
|---------------|----------|-------------------------------|-----------|
| CV inputs     | 100nF    | ~159 Hz                       | CV changes slowly; heavy filtering removes noise without losing signal |
| Clock/Reset   | 10nF     | ~1.6 kHz                      | Must preserve fast clock edges; lighter filtering |

f_3dB = 1 / (2 * pi * R_bottom * C) = 1 / (2 * pi * 10k * C)

## Key Parts

| Part | Role | Datasheet |
|------|------|-----------|
| BAT54S | Dual Schottky clamp diode (SOT-23) | [Nexperia BAT54S](https://www.nexperia.com/products/diodes/schottky-barrier-rectifiers/BAT54S.html) |
| 22k 1% resistor | Top divider (series input) | - |
| 10k 1% resistor | Bottom divider (to GND) | - |
| 100nF / 10nF capacitor | Low-pass filter | - |

## Signal Interface

| Signal | Direction | Description |
|--------|-----------|-------------|
| `input` | in | Raw eurorack signal from jack (via connector) |
| `output` | out | Scaled + clamped signal to MCU ADC/GPIO |
| `vclamp` | in | +3.3V rail for upper Schottky clamp |
| `gnd` | power | Ground reference |
