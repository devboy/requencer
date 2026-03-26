# DAC Output Stage

**Source:** [`dac-output.ato`](./dac-output.ato)
**Board:** Main

## Purpose

Converts 16 digital channels from two DAC80508 16-bit DACs into buffered analog CV outputs for a 4-track eurorack sequencer. Each track gets four output types: gate, pitch, velocity, and modulation, each with a different gain/offset topology tailored to eurorack voltage conventions.

## Design Decisions

### Channel Mapping and DAC Assignment

Two DAC80508 chips provide 8 channels each, split by output type:

| DAC | Channels | Output Type | Topology |
|-----|----------|-------------|----------|
| DAC1 | 0-3 | Gate 1-4 | Unity buffer (0-5V) |
| DAC1 | 4-7 | Pitch 1-4 | Non-inverting, gain=2, offset=-2V (-2V to +8V) |
| DAC2 | 0-3 | Velocity 1-4 | Non-inverting, gain=1.604 (0-8V) |
| DAC2 | 4-7 | Mod 1-4 | Inverting, gain=-2, offset=+5V (+5V to -5V) |

### AVDD Filter (10R + 10uF Low-Pass)

The +5V rail is shared with IS31FL3216A LED drivers (22 channels, ~23mA max each). A 10R + 10uF RC filter (f_3dB ~ 1.6kHz) isolates the DAC analog supply from switching transients. Voltage drop at DAC quiescent current (~12mA) is only 10R x 12mA = 0.12V, negligible for a 5V rail.

### SPI Bus Assignment

Both DACs share SPI1 (GP30 SCK, GP31 MOSI) with individual chip-select lines. This is a dedicated bus with no contention from the display or SD card. The DAC80508 VIO pin is tied to 3.3V, matching MCU GPIO levels directly -- no level shifter needed.

**SPI clock: 37.5 MHz (150 MHz / 4).** The DAC80508 datasheet rates SCLK at 50 MHz absolute maximum. Running at 37.5 MHz gives 25% margin for trace ringing and overshoot, with negligible impact on throughput: a full 16-channel update (2 DACs x 8 channels x 24-bit frames) takes ~10.2 us at 37.5 MHz vs ~7.7 us at 50 MHz, both well within the 250 us CV render period (4 kHz update rate). The extra 2.5 us is <1% of the render budget.

### Gate Outputs: Unity Buffer

`Vout = Vdac` (0-5V range)

Simple voltage follower on opamp1. DAC output drives the non-inverting input; output feeds back to the inverting input. No gain resistors needed.

### Pitch Outputs: Non-Inverting Gain=2 with -2V Offset

```
Vout = (1 + Rf/Rg) * Vdac - (Rf/Rg) * Vref_2V
Vout = 2 * Vdac - 2V
```

- Rf = Rg = 10k (0.1% tolerance)
- Vref = 2V (buffered voltage follower from 5V divider: 5V x 10k/(15k+10k))
- At Vdac=0V: Vout = -2V. At Vdac=5V: Vout = +8V. This gives a 10V span covering 10 octaves of 1V/oct pitch CV.

**Why 0.1% resistors for pitch:** 1V/oct pitch requires that each semitone (1/12V ~ 83.3mV) be accurate. A 1% resistor mismatch in the gain network introduces up to ~50mV error (half a semitone). 0.1% resistors reduce this to ~5mV, well within tuning tolerance. The reference divider resistors (15k/10k) are also 0.1% to keep the 2V offset accurate.

**Feedback taps after the protection resistor:** The feedback path connects to the output side of the 470R protection resistor (at the `pitch1-4` signal node), not directly at the op-amp output. This means the op-amp compensates for any voltage drop across the protection resistor under load, preserving accurate 1V/oct tracking regardless of load impedance.

### Velocity Outputs: Non-Inverting Gain=1.604

```
Vout = (1 + Rf/Rg) * Vin = (1 + 6.04k/10k) * Vin = 1.604 * Vin
```

- Rf = 6.04k, Rg = 10k (both 1%)
- At Vin=5V: Vout = 8.02V. Provides a 0-8V velocity range, common for eurorack.

### Mod Outputs: Inverting Gain=-2 with +5V Offset

```
Vout = -(Rf/Rin) * Vdac + (1 + Rf/Rin) * Vref_mod
Vout = -2 * Vdac + 3 * 1.667V = -2 * Vdac + 5V
```

- Rf = 20k, Rin = 10k (both 1%)
- Vref_mod = 1.667V (buffered from 5V divider: 5V x 10k/(20k+10k))
- At Vdac=0V: +5V. At Vdac=5V: -5V. Bipolar modulation output.

### Reference Voltage Generation

Both reference voltages are derived from the filtered 5V rail via resistor dividers, then buffered through dedicated voltage follower channels on opamp5:

| Reference | Divider | Value | Buffer | Tolerance |
|-----------|---------|-------|--------|-----------|
| Pitch offset | 15k/10k from 5V | 2.000V | opamp5 ch1 | 0.1% resistors |
| Mod offset | 20k/10k from 5V | 1.667V | opamp5 ch2 | 1% resistors |

Each divider has a 1uF filter cap to GND. Buffering eliminates loading effects from the op-amp summing networks. Opamp5 channels 3-4 are spare, configured as GND-referenced followers to prevent floating-input oscillation.

### Output Protection Resistors (470R)

All 16 outputs have a 470R series protection resistor. This limits current if an output is shorted or connected to a mismatched voltage. The value was reduced from 1k to minimize voltage divider effect with load impedance: at 470R + 10k load, the voltage drop is 4.5% (vs 9% with 1k).

### Decoupling Strategy

- **DAC AVDD:** 100nF HF + 10uF bulk per chip, on the filtered rail
- **DAC VREF:** 10uF + 100nF per chip (per DAC80508 datasheet section 9.3.1)
- **DAC VIO:** 100nF per chip
- **Op-amp power:** 100nF per chip per rail (+12V and -12V), plus 10uF bulk shared across the cluster

## Key Parts

| Part | Role | Datasheet |
|------|------|-----------|
| DAC80508ZRTER | 16-bit 8-channel voltage-output DAC (x2) | [TI DAC80508](https://www.ti.com/product/DAC80508) |
| OPA4171AIPWR | Quad rail-to-rail op-amp, low offset (x5) | [TI OPA4171](https://www.ti.com/product/OPA4171) |

## Signal Interface

| Signal | Direction | Description |
|--------|-----------|-------------|
| spi_mosi | in | SPI data (GP31, shared by both DACs) |
| spi_sck | in | SPI clock (GP30, shared by both DACs) |
| dac1_cs | in | DAC1 chip select (active low) |
| dac2_cs | in | DAC2 chip select (active low) |
| avdd | in | +5V analog supply (pre-filter) |
| v3v3 | in | +3.3V for DAC VIO logic level |
| v12p | in | +12V op-amp positive supply |
| v12n | in | -12V op-amp negative supply |
| gnd | in | Common ground |
| gate1-4 | out | Gate CV outputs (0-5V) |
| pitch1-4 | out | Pitch CV outputs (-2V to +8V, 1V/oct) |
| vel1-4 | out | Velocity CV outputs (0-8V) |
| mod1-4 | out | Modulation CV outputs (+5V to -5V, bipolar) |

## References

- DAC80508 datasheet, section 9.3.1: VREF decoupling requirements
- TI app note SLAU525: "DAC80508 Application Reference"
- OPA4171 datasheet: rail-to-rail output, 36V supply range, low offset voltage
