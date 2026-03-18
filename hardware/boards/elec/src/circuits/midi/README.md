# MIDI Interface

**Source:** [`midi.ato`](./midi.ato)
**Board:** Control

## Purpose

Provides MIDI IN and MIDI OUT via TRS Type A (stereo 3.5mm) jacks, following the MIDI Manufacturers Association CA-033 specification for 3.3V operation. Uses an H11L1S optocoupler for galvanic isolation on the input side.

## Design Decisions

### TRS Type A Pinout (CA-033 Spec)

The CA-033 specification defines TRS Type A wiring for MIDI over 3.5mm jacks:

| TRS Pin | MIDI Pin | Function |
|---------|----------|----------|
| Tip | Pin 5 | Data (source/sink) |
| Ring | Pin 4 | Current source (+V) |
| Sleeve | Pin 2 | Shield/GND |

Both jacks use PJ366ST stereo 3.5mm connectors. Mono jacks will not work -- the ring connection is required for the MIDI current loop.

### MIDI OUT: 3.3V Transmitter (CA-033 Compliant)

The CA-033 spec defines reduced resistor values for 3.3V transmitters (vs the traditional 5V 220R/220R circuit):

```
TX path:  UART_TX → 10R → TIP
Ring path: +3.3V → 33R → RING
```

Current calculation when receiver pulls current (opto LED Vf ~ 1.7V):
```
I = (3.3V - 1.7V) / (33R + 10R + 220R_receiver) = 1.6V / 263R = ~6mA
```

This exceeds the MIDI spec minimum of 5mA. The reduced resistor values (10R + 33R instead of 220R + 220R) compensate for the lower supply voltage.

### MIDI IN: H11L1S Optocoupler (vs 6N138)

The H11L1S was chosen over the traditional 6N138 for several reasons:

1. **Built-in Schmitt trigger output:** The H11L1S integrates a Schmitt trigger on the phototransistor output, producing clean digital edges without external components. The 6N138 requires a base resistor and careful biasing for sharp transitions.
2. **Fewer external components:** No base resistor, no pull-down resistor on the emitter. Just a single pull-up on the open-collector output.
3. **SOP-6 SMD package:** Smaller footprint than the 6N138 DIP-8 or even its SMD variants.
4. **Logic-compatible output:** Direct 3.3V logic levels with the 1k pull-up.

### MIDI IN Circuit

```
Ring (source) → opto ANODE
Tip (data)    → 220R → opto CATHODE
```

The 220R input resistor limits current through the optocoupler LED. The protection diode (B5819W Schottky, reverse-biased across the opto LED) clamps reverse voltage when the sender drives the line high, protecting the optocoupler from damage.

The H11L1S output is open-collector with a Schmitt trigger. A 1k pull-up to 3.3V provides the logic high level. When MIDI data arrives (current flows through opto LED), the output pulls low, producing the inverted UART signal expected by the MCU's UART RX.

### Bypass Capacitor

A 100nF capacitor on the optocoupler VCC pin filters high-frequency noise from the logic supply.

## Key Parts

| Part | Role | Datasheet |
|------|------|-----------|
| H11L1S | Optocoupler with Schmitt trigger output, SOP-6 | [Vishay H11L1S](https://www.vishay.com/docs/81018/h11l1.pdf) |
| B5819W | Schottky diode, reverse protection across opto LED | [B5819W datasheet](https://www.diodes.com/assets/Datasheets/ds30146.pdf) |
| PJ366ST | 3.5mm stereo TRS jack (x2, MIDI IN + MIDI OUT) | -- |

## Signal Interface

| Signal | Direction | Description |
|--------|-----------|-------------|
| uart_tx | in | UART1 TX from MCU (GP20) |
| uart_rx | out | UART1 RX to MCU (GP21), active-low via opto |
| vcc | in | +3.3V supply |
| gnd | in | Common ground |

## References

- MIDI Manufacturers Association CA-033: "TRS Adapter for MIDI 1.0" (Type A pinout, 3.3V transmitter resistor values)
- Vishay H11L1S datasheet: Schmitt trigger thresholds, CTR, recommended circuits
- MIDI 1.0 Electrical Specification: minimum 5mA loop current
