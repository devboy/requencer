# Board-to-Board Connector

**Source:** [`board-connector.ato`](./board-connector.ato)
**Board:** Both (main board uses `BoardConnectorInterface` with male headers, control board uses `BoardConnectorSocket` with female sockets)

## Purpose

Defines the physical and logical interface between the main board and control board via two 2x16 shrouded headers (64 pins total). All signals crossing between boards are explicitly pinned here. The two modules (`BoardConnectorInterface` and `BoardConnectorSocket`) use different physical connectors (male headers vs female sockets). The socket's pin assignments have odd/even pairs swapped to compensate for KiCad's X-axis mirror when placing components on the B (back) side — this ensures signals connect correctly when the boards mate face-to-face in the sandwich stack.

## Design Decisions

### Signal Grouping: Header A (Digital + Power) vs Header B (Analog)

The two headers are separated by function to minimize crosstalk between digital and analog signals:

**Header A — Digital + Power (32 pins):**
- Power rails: GND (pins 1-2, 27-28, 32), +3.3V (pins 3-4), +5V (pins 5-6), +12V (pin 7), -12V (pin 8)
- SPI0 bus: MOSI/SCK/MISO/LCD_CS/LCD_DC/LCD_BL (pins 9-14)
- SD card: CS/CD (pins 15-16)
- MIDI: TX/RX (pins 17-18)
- Encoder B: A/B/SW (pins 19-21)
- Button scan: CLK/LATCH/DATA (pins 22-24)
- I2C: SDA/SCL (pins 25-26)
- Encoder A: A/B/SW (pins 29-31)

**Header B — Analog + Clock/Reset (32 pins):**
- Clock/Reset I/O: CLK_IN/OUT, RST_IN/OUT (pins 3-6)
- LCD reset: pin 7 (repurposed from spare GND)
- CV inputs: A/B/C/D (pins 8-11)
- DAC outputs grouped by type with GND separators:
  - Gate 1-4 (pins 13-16)
  - Pitch 1-4 (pins 18-21)
  - Velocity 1-4 (pins 23-26)
  - Mod 1-4 (pins 28-31)
- GND pins between each group (pins 1-2, 12, 17, 22, 27, 32) provide shielding between analog signal groups

### Power Pin Doubling

+3.3V and +5V each use two pins (doubled) to handle current capacity. The control board draws significant current on these rails: up to ~700mA on +5V (LED drivers) and ~100mA on +3.3V (shift registers, LCD, MIDI logic). Two pins per rail halve the contact resistance and provide redundancy.

### Connector Selection (ShroudedHeader2x16 / ShroudedSocket2x16)

2x16 shrouded headers (32 pins, 2.54mm pitch) were chosen for:
- **Keying:** Shrouded housing prevents reversed insertion
- **Pin count:** 32 pins per header, 64 total across two headers, accommodating all ~55 signals plus dedicated power and GND pins
- **Standard pitch:** 2.54mm is mechanically robust for board-to-board stacking and easy to hand-solder for prototyping

### GND Pin Placement

GND pins are strategically placed as shields:
- Header A: pins 1-2 (entry), 27-28 (spare/shield), 32 (termination)
- Header B: pins 1-2, 12, 17, 22, 27, 32 — one GND between each group of 4 analog outputs, providing return current paths and reducing crosstalk between DAC output groups

## Key Parts

| Part | Role | Datasheet |
|------|------|-----------|
| ShroudedHeader2x16 | Male 2x16 pin header on main board | Standard 2.54mm shrouded header |
| ShroudedSocket2x16 | Female 2x16 IDC socket on control board | Standard 2.54mm shrouded socket |

## Signal Interface

| Signal Group | Count | Direction (main -> control) | Description |
|-------------|-------|----------------------------|-------------|
| Power (GND, 3V3, 5V, 12P, 12N) | 5 rails | main -> control | All power originates from main board power supply |
| SPI0 (MOSI, SCK, MISO, LCD_CS, LCD_DC, LCD_BL, LCD_RST) | 7 | main -> control | Display + SD card SPI bus and control |
| SD card (CS, CD) | 2 | CS: main->ctrl, CD: ctrl->main | SD chip select and card detect |
| Button scan (CLK, LATCH, DATA) | 3 | CLK/LATCH: main->ctrl, DATA: ctrl->main | 74HC165 shift register chain |
| I2C (SDA, SCL) | 2 | bidirectional | LED driver communication |
| MIDI (TX, RX) | 2 | main -> control | UART1 to MIDI jacks |
| Encoders (A_A/B/SW, B_A/B/SW) | 6 | control -> main | Quadrature + switch signals |
| Clock/Reset I/O | 4 | CLK_IN/RST_IN: ctrl->main, CLK_OUT/RST_OUT: main->ctrl | Raw eurorack levels (conditioned on main board) |
| CV inputs (A, B, C, D) | 4 | control -> main | Raw eurorack levels (conditioned on main board) |
| DAC outputs (gate/pitch/vel/mod x4) | 16 | main -> control | Buffered analog from DAC output stage |
