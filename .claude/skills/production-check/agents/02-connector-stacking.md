# Agent: Connector & Stacking — Sections 2 & 16

## Purpose

Verify that board-to-board connector signals match pin-for-pin between the main board and control board, and that the sandwich stack assembly is mechanically feasible.

## Inputs

- `hardware/boards/elec/src/circuits/board-connector/board-connector.ato` — connector interface and socket definitions
- `hardware/boards/elec/src/components/ShroudedHeader2x16/ShroudedHeader2x16.ato` — header pin definitions
- `hardware/boards/elec/src/components/ShroudedSocket2x16/ShroudedSocket2x16.ato` — socket pin definitions
- `hardware/boards/elec/src/components/ShroudedHeader2x16/README.md` — datasheet link
- `hardware/boards/elec/src/components/ShroudedSocket2x16/README.md` — datasheet link
- `hardware/boards/board-config.json` — board dimensions and spacing
- `hardware/boards/elec/src/boards/control/control.ato` — control board top-level (how connectors are instantiated)
- `hardware/boards/elec/src/boards/main/main.ato` — main board top-level (how connectors are instantiated)

## Procedure

### Section 2: Board-to-Board Connector Pin Matching

#### Step 1: Read connector definitions

Read `board-connector.ato` and identify the two sides:

- **BoardConnectorInterface** (or similar) — used on the main board side, instantiates ShroudedHeader2x16
- **BoardConnectorSocket** (or similar) — used on the control board side, instantiates ShroudedSocket2x16

There are two connectors (header_a / header_b, or similar naming) providing 2 x 32 = 64 total pins.

#### Step 2: Extract pin-to-signal mapping

For each connector (a and b), for each pin (1 through 32):

- Extract the signal name assigned on the **interface** (main board) side.
- Extract the signal name assigned on the **socket** (control board) side.

Build a comparison table:

| Connector | Pin | Main Board Signal | Control Board Signal | Match? |
|-----------|-----|-------------------|----------------------|--------|

#### Step 3: Verify 1:1 signal matching

- Every pin must carry the same signal on both sides.
- A mismatch means the boards will malfunction when connected.
- Pay special attention to signals that cross between circuits (e.g., SPI from MCU on main board to display connector on control board).

#### Step 4: Verify power pin placement

- **Power pins (GND, 3V3, 5V, +12V, -12V)** should be doubled (appear on at least 2 pins each) to handle current requirements.
- Power pins should be located at or near the edges of the connector for thermal and current distribution reasons.
- No signal pin should map to a power pin on the opposite board.

#### Step 5: Verify signal completeness

Cross-check that all signals needed between boards actually appear on the connectors:

- SPI buses (display, DAC)
- I2C bus (LED drivers)
- Button scan signals (CLK, LATCH, DATA)
- Encoder signals (A, B, SW for each encoder)
- MIDI UART signals
- Clock/reset I/O signals
- CV input signals (ADC channels)
- USB signals (D+, D-)
- SD card signals (if SD socket is on control board)

Flag any signal that a circuit on one board needs from a circuit on the other board but that does not appear on the connector.

### Section 16: Sandwich Stack Assembly

#### Step 6: Connector keying

- Read the ShroudedHeader2x16 and ShroudedSocket2x16 datasheets (from README.md links).
- Shrouded headers have a polarization key. Verify the key faces the same direction on both boards so the connector can only be inserted one way.
- If the `.ato` files or datasheets mention a key/notch pin, verify it is consistently placed.

#### Step 7: Pin 1 alignment

- When header and socket mate, pin 1 on the header must align with pin 1 on the socket.
- A board flip (one board is face-up, the other face-down in a sandwich) can mirror the pin numbering. Verify this is accounted for.
- Check if the board-connector.ato or board .ato files contain any comments about orientation/mirroring.

#### Step 8: Silkscreen markings

- Check if `.kicad_mod` footprint files for both header and socket include silkscreen indicators for pin 1 and/or key direction.
- If not present, flag as WARN — assemblers need visible orientation markers.

#### Step 9: Board dimensions and spacing

- Read `board-config.json` for board dimensions (width, height) and any stacking-related parameters.
- Verify both boards have the same outline dimensions (they must align in the sandwich).
- Note the connector standoff height if available — this determines component clearance between boards.

#### Step 10: Assembly order feasibility

Consider the assembly sequence:

1. SMD components are placed first (reflow soldered).
2. THT components (jacks, buttons, encoders) are soldered after SMD.
3. Board-to-board connectors must be accessible after THT assembly.
4. Verify that no THT component on the control board blocks access to the board-to-board connectors.

If assembly order cannot be determined from the files alone, flag as "manual verification recommended."

#### Note on STEP files

STEP files are binary and cannot be parsed by this agent. Any check requiring physical measurement of 3D clearances should be flagged as "manual 3D verification recommended" rather than skipped silently.

## Pass Criteria

- **PASS:** All 64 pins match between interface and socket, power pins are doubled and at edges, keying prevents wrong insertion, board dimensions align.
- **WARN:** Tight clearances flagged for manual 3D check, missing silkscreen pin 1 marker, assembly order unclear from files alone.
- **FAIL:** Any signal mismatch between boards, power pin in wrong position (signal where power should be or vice versa), keying allows wrong-orientation insertion, missing critical signal on connector.

## Output Format

```
## Connector & Stacking — Sections 2, 16
**Verdict: PASS / WARN / FAIL**

| Check | Status | Detail |
|-------|--------|--------|
| ... | PASS/WARN/FAIL | ... |

**Issues found:**
- [FAIL] Description — file:line — suggested fix
- [WARN] Description — file:line — suggested fix
```

Include the full pin comparison table (Step 2) in the output so the reader can see every pin mapping at a glance. For large tables, group by connector (a and b).
