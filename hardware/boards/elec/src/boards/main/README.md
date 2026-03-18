# Main Board

**Source:** [`main.ato`](./main.ato)
**Board:** Main (bottom board in the sandwich stack)

## Purpose

The main board contains all processing and analog circuitry: the PGA2350 MCU, two DAC80508 16-bit DACs with op-amp output stages, input protection for 6 eurorack inputs, clock/reset output buffers, the power supply, and a USB-C port for firmware programming. It connects to the control board (which has all user-facing components) via two 2x16 shrouded headers.

## Analog Signal Chain

### DAC Outputs (16 channels)

```
MCU SPI1 (GP30/31) ──> DAC80508 x2 ──> OPA4171A op-amps x4 ──> 470ohm protection ──> Connector ──> Jacks
```

Four different output topologies serve different eurorack signal types:

| Output Type | Channels | Op-amp Config | Range | Resistor Values |
|------------|----------|---------------|-------|-----------------|
| Gate | 1-4 | Unity buffer (follower) | 0 to +5V | - |
| Pitch | 1-4 | Non-inv, gain=2, offset=-2V | -2V to +8V | Rf=Rg=10k (0.1%) |
| Velocity | 1-4 | Non-inv, gain=1.604 | 0 to +8V | Rf=6.04k, Rg=10k |
| Mod | 1-4 | Inverting, gain=-2, offset=+5V | +5V to -5V | Rin=10k, Rf=20k |

Pitch channels use 0.1% resistors for accurate 1V/oct tracking. Pitch feedback taps after the 470 ohm protection resistor so the op-amp compensates for voltage drop under load.

A 5th OPA4171A quad provides buffered reference voltages:
- **2V reference** (for pitch offset): 15k/10k divider from filtered 5V, buffered by ch1
- **1.667V reference** (for mod offset): 20k/10k divider from filtered 5V, buffered by ch2
- Ch3-4: spare, tied as GND followers to prevent oscillation

### DAC Power Filtering

The 5V rail is shared with LED drivers on the control board. A 10 ohm + 10uF RC filter (f_3dB ~1.6 kHz) isolates the DAC AVDD supply from LED PWM switching transients. Voltage drop at DAC quiescent current (~12mA) is only 0.12V.

### Input Protection (6 channels)

```
Jack (control board) ──> Connector ──> InputProtection (22k/10k divider + BAT54S clamp + filter cap) ──> MCU ADC
```

- CV inputs (4x): 100nF filter cap (f_3dB ~159 Hz)
- Clock/Reset inputs (2x): 10nF filter cap (f_3dB ~1.6 kHz) for fast edge response

### Clock/Reset Output Buffers (2 channels)

```
MCU GPIO ──> 1k base resistor ──> 2N3904 NPN (common-emitter) ──> 1k collector pull-up to 5V ──> Connector ──> Jack
```

These are inverting buffers. GPIO HIGH turns the transistor ON, pulling the output LOW. Firmware must drive the GPIO inverted relative to the desired output polarity.

## Power Distribution

```
Eurorack 16-pin header
  +12V ──> B5819W Schottky ──> v12p rail ──> Op-amp V+ / Connector
  -12V ──> B5819W Schottky ──> v12n rail ──> Op-amp V- / Connector
  +5V  ──> B5819W Schottky ──> v5v rail ──> AMS1117 / DAC AVDD / LED drivers (via connector) / MCU VB (via Schottky)
                                    |
                               AMS1117-3.3
                                    |
                               v3v3 rail ──> DAC VIO / Connector (LCD, shift regs, MIDI, etc.)
```

The AMS1117-3.3 LDO is fed from +5V (not +12V) to minimize power dissipation: (5-3.3) x 0.1A = 0.17W vs (12-3.3) x 0.1A = 0.87W from 12V.

All three eurorack rails have B5819W Schottky diodes for reverse polarity protection.

| Rail | Decoupling |
|------|------------|
| +12V | 10uF bulk + 100nF HF per op-amp (x5) + 10uF shared bulk |
| -12V | 10uF bulk + 100nF HF per op-amp (x5) + 10uF shared bulk |
| +5V | 10uF bulk + 100nF HF (power supply) + 10uF + 10uF (AMS1117 in/out) |
| +3.3V | 10uF + 100nF (AMS1117 output) + 100nF per VIO (x2 DACs) |
| MCU VB | 10uF + 100nF (in mcu.ato) |
| MCU 3V3 | 10uF + 100nF (in mcu.ato) |
| DAC AVDD | 10uF + 100nF per DAC (on filtered rail) |

## USB-C Integration

USB-C is edge-mounted on the main board, accessible from the rack side. It is data-only (no VBUS power draw).

| Component | Value | Purpose |
|-----------|-------|---------|
| USB_C_Receptacle | - | Physical connector |
| Series resistors | 27 ohm x2 | Signal integrity on DP/DM (near MCU) |
| PRTR5V0U2X | - | ESD protection on data lines (at connector) |
| CC pull-downs | 5.1k x2 (1%) | Required by USB-C spec for device mode |

VBUS is intentionally left unconnected (not tied to GND, which would short the host's supply).

## Encoder Signal Conditioning

Encoder pull-ups and debounce caps are placed on the main board (near MCU) rather than the control board to free control board space:
- 10k pull-ups to 3.3V on all 6 encoder signals (A/B/SW for both encoders)
- 10nF debounce caps (tau = 10k x 10nF = 0.1ms) for RF filtering; real debounce is handled by the RP2350 PIO gray-code state machine

## Circuits on This Board

| Circuit | Instance | Role |
|---------|----------|------|
| `BoardConnectorInterface` | `connector` | Male 2x16 headers (mates with control board sockets) |
| `PowerSupply` | `power` | Eurorack 16-pin header, Schottky protection, AMS1117-3.3 LDO |
| `PGA2350_MCU` | `mcu` | RP2350B module with all GPIO assignments |
| `DACOutputStage` | `dac` | 2x DAC80508 + 5x OPA4171A + reference generation |
| `InputProtection` | `prot_cv_a/b/c/d`, `prot_clk`, `prot_rst` | 6x voltage divider + Schottky clamp circuits |
| 2N3904 NPN buffers | `q_clk`, `q_rst` | Clock/reset output level shifting (3.3V to 5V) |
| USB_C_Receptacle | `usb` | USB-C data port with ESD (PRTR5V0U2X) |
| SWD debug pads | `swd_clk`, `swd_dio` | Test points for pogo-pin debug access |
