# I/O Jacks

**Source:** [`io-jacks.ato`](./io-jacks.ato)
**Board:** Control

## Purpose

Breakout module for all 24 mono 3.5mm jacks on the Requencer panel (excluding the 2 MIDI jacks handled in `midi.ato`). This is a pure wiring module with no signal conditioning -- jacks connect directly to board connector signals. All voltage scaling, clamping, and buffering is performed on the main board.

## Design Decisions

### Jack Type (WQP518MA)

The WQP518MA is a standard Thonkiconn-compatible 3.5mm mono jack widely used in eurorack DIY. It is a PCB-mount THT (through-hole) part with two pins: TIP (signal) and SLEEVE (ground). No switch contacts are used.

### Wiring Convention

All jacks follow the same pattern:
- **TIP** connects to the signal line (routed through the board connector to/from the main board)
- **SLEEVE** connects to GND

No series resistors, filter caps, or protection components are on the control board side. This keeps the control board simple (pure breakout) and centralizes all analog conditioning on the main board near the MCU and DACs.

### Signal Flow

**Outputs (16 jacks):** DAC output stage on main board produces buffered analog signals with 470 ohm protection resistors. These signals cross the board connector (Header C) and arrive at the jack tips on the control board.

**CV Inputs (4 jacks):** Raw eurorack signals (0-10V) from jack tips pass through the board connector (Header C) to the main board, where `InputProtection` circuits scale and clamp them for the RP2350 ADC.

**Clock/Reset Inputs (2 jacks):** Same path as CV inputs, but with 10nF filter caps instead of 100nF for faster edge response.

**Clock/Reset Outputs (2 jacks):** NPN buffer circuits on the main board produce 5V gate signals that cross the board connector to these jacks.

## Key Parts

| Part | Role | Datasheet |
|------|------|-----------|
| WQP518MA (x24) | 3.5mm mono jack, PCB-mount THT | [Thonkiconn WQP518MA](https://www.thonk.co.uk/shop/thonkiconn/) |

## Signal Interface

| Signal | Direction | Description |
|--------|-----------|-------------|
| `gate1-4` | in (from main) | Gate output signals (0-5V) |
| `pitch1-4` | in (from main) | Pitch CV output (-2V to +8V, 1V/oct) |
| `vel1-4` | in (from main) | Velocity output (0-8V) |
| `mod1-4` | in (from main) | Mod output (+5V to -5V, bipolar) |
| `clk_in_gpio` | out (to main) | Raw clock input (0-10V eurorack gate) |
| `rst_in_gpio` | out (to main) | Raw reset input (0-10V eurorack gate) |
| `clk_out_gpio` | in (from main) | Buffered 5V clock output |
| `rst_out_gpio` | in (from main) | Buffered 5V reset output |
| `cv_a/b/c/d_gpio` | out (to main) | Raw CV inputs (0-10V) |
| `gnd` | power | Ground bus for all jack sleeves |
