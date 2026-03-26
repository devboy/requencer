# Power Supply

**Source:** [`power.ato`](./power.ato)
**Board:** Main

## Purpose

Converts eurorack bus power (+12V, -12V, +5V) into the regulated rails needed by the system. Provides reverse polarity protection on all three rails and generates a regulated +3.3V supply from the +5V bus rail.

## Design Decisions

### Reverse Polarity Protection (B5819W Schottky Diodes)

All three power rails (+12V, -12V, +5V) are protected by B5819W Schottky diodes in series. If the eurorack power cable is inserted backwards, the diodes block reverse current. Schottky diodes are chosen for their low forward voltage drop (~0.3-0.4V), minimizing power loss compared to standard silicon diodes (~0.7V).

- **+12V:** Anode from header pins POS12V_1/2, cathode to protected v12p rail.
- **-12V:** Cathode from header pins NEG12V_1/2, anode to protected v12n rail (reversed orientation for negative rail).
- **+5V:** Anode from header pins POS5V_1/2, cathode to protected v5v rail.

### Why 5V to 3.3V (Not 12V to 3.3V)

The AMS1117-3.3 LDO is fed from the +5V rail, not +12V. The thermal math makes this clear:

| Source | Dropout | Power @ 100mA |
|--------|---------|---------------|
| 12V | 12V - 3.3V = 8.7V | 8.7V x 0.1A = **0.87W** |
| 5V | 5V - 3.3V = 1.7V | 1.7V x 0.1A = **0.17W** |

Feeding from 5V dissipates 5x less heat. The AMS1117 in an SOT-223 package has limited thermal dissipation; 0.87W would require careful thermal management, while 0.17W is trivial.

The +5V bus rail is available on the eurorack 16-pin header (pins POS5V_1/2). Most eurorack power supplies provide +5V.

### AMS1117-3.3 LDO Regulator

The AMS1117 requires a minimum 10uF capacitor on the input and a minimum 22uF capacitor on the output for regulator loop stability (per datasheet). The design provides:

- **Input:** 10uF bulk (c_3v3_in), plus the shared 5V rail decoupling
- **Output:** 22uF bulk (c_3v3_out) + 100nF HF (c_3v3_out_hf)

The TAB pin is connected to VOUT (not GND), following the AMS1117 datasheet recommendation. This is a common gotcha -- some LDOs have TAB=GND, but the AMS1117 TAB is electrically connected to the output.

### 3.3V Rail Load Budget

The board 3.3V rail powers shift registers, LCD, MIDI interface, and input protection. The PGA2350 MCU has its own internal 3.3V regulator (300mA) fed from +5V via a separate Schottky in the MCU module. This keeps the MCU's digital noise off the board peripheral rail.

**Note:** A 10uF bulk capacitor should be added on the 3.3V rail at the control board connector entry point. The 3.3V rail travels from the AMS1117 on the main board across the board-to-board connector to the control board, where it powers shift registers, LCD, and MIDI logic. The connector introduces inductance, and transient current demands (e.g., shift register clocking, LCD SPI bursts) can cause voltage droops without local bulk decoupling at the connector landing.

### 5V Rail Load Budget

The +5V rail powers LED drivers (IS31FL3216A), DAC analog supply (via RC filter), clock output buffers, and the PGA2350 VB supply.

### Capacitor Values

| Capacitor | Value | Purpose |
|-----------|-------|---------|
| c_bulk_12p | 10uF | +12V bulk decoupling |
| c_bulk_12n | 10uF | -12V bulk decoupling |
| c_5v_bulk | 10uF | +5V bulk decoupling |
| c_5v_hf | 100nF | +5V high-frequency decoupling |
| c_3v3_in | 10uF | AMS1117 input stability (required) |
| c_3v3_out | 22uF | AMS1117 output stability (>=22uF required per datasheet) |
| c_3v3_out_hf | 100nF | 3.3V high-frequency decoupling |

## Key Parts

| Part | Role | Datasheet |
|------|------|-----------|
| AMS1117-3.3 | 1A LDO voltage regulator, 3.3V fixed output | [AMS1117 datasheet](http://www.advanced-monolithic.com/pdf/ds1117.pdf) |
| B5819W | 1A 40V Schottky barrier diode (x3) | [B5819W datasheet](https://www.diodes.com/assets/Datasheets/ds30146.pdf) |
| EurorackPowerHeader16 | Standard 16-pin eurorack power connector | -- |

## Signal Interface

| Signal | Direction | Description |
|--------|-----------|-------------|
| v12p | out | Protected +12V rail (~11.6V after Schottky drop) |
| v12n | out | Protected -12V rail (~-11.6V after Schottky drop) |
| v5v | out | Protected +5V rail (~4.6V after Schottky drop) |
| v3v3 | out | Regulated +3.3V rail |
| gnd | -- | Common ground |

## References

- AMS1117 datasheet: input/output capacitor requirements, TAB pin connection
- Eurorack power bus specification: 16-pin header pinout (Doepfer standard)
