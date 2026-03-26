# Button Scanner

**Source:** [`button-scan.ato`](./button-scan.ato)
**Board:** Control

## Purpose

Reads 36 pushbuttons using only 3 MCU GPIO pins via a daisy-chained shift register topology. Five 74HC165 parallel-in/serial-out shift registers capture the state of all buttons in a single 40-bit serial read (36 buttons + 4 spare).

## Design Decisions

### Shift Register Chain Topology

The five 74HC165 chips are daisy-chained: SR1 -> SR2 -> SR3 -> SR4 -> SR5. The MCU reads serial data from SR5.QH (the last register in the chain). A single scan requires:

1. Pulse SH/LD low to latch all 40 parallel inputs simultaneously
2. Clock out 40 bits on CLK, reading QH on each rising edge
3. First bit out is SR5.D7, last is SR1.D0

Only 3 GPIO pins are needed regardless of button count:

| GPIO | Signal | Function |
|------|--------|----------|
| GP8 | CLK | Shift clock (shared by all 5 SRs) |
| GP9 | SH/LD | Parallel load (shared by all 5 SRs) |
| GP10 | QH | Serial data out (from SR5 only) |

CLK_INH is tied to GND on all chips (clock always enabled). SR1.SER (serial input of the first register) is tied to GND since there is no preceding register.

### Physical Grouping Strategy

The registers are split into two physical groups matching the panel layout for short button-to-register traces:

**Left side (SR1-SR3):** placed near the left button cluster
| Register | Bits | Buttons |
|----------|------|---------|
| SR1 (D0-D7) | 0-7 | Step 1-8 |
| SR2 (D0-D7) | 8-15 | Step 9-16 |
| SR3 (D0-D7) | 16-23 | T1-T4, Settings, Back, Rand, Clr |

**Right side (SR4-SR5):** placed near the right button cluster
| Register | Bits | Buttons |
|----------|------|---------|
| SR4 (D0-D7) | 24-31 | Gate, Pitch, Vel, Mod, Pat, Mute, Route, Drift |
| SR5 (D0-D3) | 32-35 | Xpose, Var, Play, Reset |
| SR5 (D4-D7) | 36-39 | Spare (tied to VCC) |

This grouping minimizes trace length from each button to its shift register input, reducing susceptibility to noise pickup on the button lines.

### Pull-Up Array Sizing (10k x4 Resistor Networks)

Each shift register input has a 10k pull-up to VCC via ResArray4x0603 (4-resistor 0603 SMD arrays). The buttons connect between the SR input and GND, so:

- **Button released:** 10k pull-up holds input HIGH (logic 1)
- **Button pressed:** Button shorts input to GND (logic 0)

10k was chosen as a standard value that balances:
- **Low enough** to provide a solid logic high against noise pickup on the PCB traces from the buttons
- **High enough** to limit current draw when buttons are pressed (3.3V / 10k = 0.33mA per pressed button, negligible even with all 36 pressed)

Using 4x resistor arrays instead of discrete resistors reduces component count from 36 individual resistors to 9 array packages (two per SR for D0-D3 and D4-D7, with SR5 needing only one for D0-D3 since D4-D7 are tied to VCC directly).

The array pinout is "convex": R1 = pin1-pin8, R2 = pin2-pin7, R3 = pin3-pin6, R4 = pin4-pin5. One side of each resistor goes to VCC, the other to the SR input.

### Spare Inputs

SR5 inputs D4-D7 are tied directly to VCC (not through pull-ups). This provides a low-impedance logic high on unused inputs, preventing noise from being clocked into the data stream. These read as constant 1s and can be masked in firmware, or connected to future buttons by cutting the VCC tie and adding a pull-up + button.

### Scan Timing

At 3.3V, the 74HC165 supports clock frequencies up to ~20MHz. A practical scan rate of 1kHz (reading all 40 bits every 1ms) requires only 40 clock cycles per scan -- trivially fast. Even at a conservative 1MHz clock, a complete scan takes 40us, leaving 960us per scan cycle for other tasks.

### Button Hardware

All 36 buttons are PB6149L illuminated pushbuttons. Each button has two switch pins (SW1, SW2): SW1 connects to the shift register input, SW2 connects to GND. The LED inside each button is driven separately by the LED driver module.

## Key Parts

| Part | Role | Datasheet |
|------|------|-----------|
| 74HC165D | 8-bit parallel-in/serial-out shift register, SOIC-16 (x5) | [NXP 74HC165](https://www.nexperia.com/products/analog-logic-ics/asynchronous-interface-logic/shift-registers/74HC165D.html) |
| ResArray4x0603 | 10k x4 resistor array, 0603 SMD (x9) | -- |
| PB6149L | Illuminated pushbutton with integrated LED (x36) | -- |

## Signal Interface

| Signal | Direction | Description |
|--------|-----------|-------------|
| clk | in | Shift clock from MCU (GP8) |
| latch | in | SH/LD parallel load from MCU (GP9, active low) |
| data_out | out | Serial data to MCU (GP10, from SR5.QH) |
| vcc | in | +3.3V supply |
| gnd | in | Common ground |

## References

- NXP 74HC165 datasheet: timing diagrams, max clock frequency at 3.3V, parallel load operation
- Application note: "Using 74HC165 Shift Registers for Button Matrices" -- standard parallel load + serial readout pattern
