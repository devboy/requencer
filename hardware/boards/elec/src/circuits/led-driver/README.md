# LED Driver Chain

**Source:** [`led-driver.ato`](./led-driver.ato)
**Board:** Control

## Purpose

Drives the LEDs inside 22 illuminated pushbuttons using three IS31FL3216A I2C constant-current LED driver ICs. Each chip provides 16 channels with 8-bit PWM brightness control. The three chips are distributed across the panel to minimize cathode trace lengths to their respective button groups.

## Design Decisions

### Chip Distribution Strategy

The three IS31FL3216A chips are physically placed near the button groups they drive, keeping LED cathode traces short (important for consistent brightness and reduced EMI from PWM switching):

| Chip | Position | Button Group | Channels Used |
|------|----------|-------------|---------------|
| led_a | Left side | Step 1-4, Step 9-12, T1-T4 | 12 of 16 |
| led_b | Right-center | Step 5-8, Step 13-16, Clr | 9 of 16 |
| led_c | Right side | Play + future expansion | ~2 of 16 |

This leaves 26 spare channels across the three chips for future LED additions without new ICs.

### I2C Addressing Scheme (AD Pin)

The IS31FL3216A uses a single AD pin to select from four addresses based on what it is connected to:

| Chip | AD Connection | Address | Routing Note |
|------|--------------|---------|-------------|
| led_a | GND | 0x68 | AD pin to GND plane, trivial |
| led_b | VCC | 0x6B | Pins AD(25) and VCC(26) are adjacent on the QFN package -- zero-length trace |
| led_c | SDA | 0x6A | Pins SDA(24) and AD(25) are adjacent on the QFN package -- zero-length trace |

The address assignments were chosen to exploit the QFN-28 pin ordering (SDB-SCL-SDA-AD-VCC are consecutive pins 22-26 on the top edge). Connecting AD to an adjacent pin avoids routing a separate address trace across the board.

### R_EXT Current Calculation

The R_EXT resistor sets the maximum output sink current per channel. From the IS31FL3216A datasheet:

```
I_max = 76.5 / R_EXT (kohm)
I_max = 76.5 / 3.3 = ~23mA per channel
```

R_EXT = 3.3k (1% tolerance) on each chip. The actual LED current is further controlled by the 8-bit PWM register (0-255), so 23mA is the ceiling. Typical LED button operation will use lower duty cycles for dimming.

### QFN-28 Thermal Pad

All three chips have their exposed thermal pad (PAD) connected to GND. This provides both the required electrical ground connection and thermal dissipation path through the PCB ground plane. The IS31FL3216A dissipates modest power (max ~16 channels x 23mA x ~0.5V_sat = ~184mW per chip), but the thermal pad connection is still required per datasheet for reliable operation.

### Power Architecture

The IS31FL3216A VCC (logic supply) runs from +3.3V, while the LED anodes connect to +5V via the `led_vcc` signal. This split allows the LEDs to operate at higher forward voltage (typical LED Vf = 2-3V) with more current headroom, while the I2C logic stays at MCU voltage levels.

### SDB (Shutdown Bar) Pin

All three chips have SDB tied to VCC (always enabled). Software can disable individual channels or enter standby via I2C commands, so hardware shutdown control is not needed.

### CLK Pin (Audio Cascade)

The CLK pin is for audio synchronization cascading between multiple IS31FL3216A chips. This feature is unused here, so CLK is tied to GND on all chips.

### C_FILT (Audio Filter)

The C_FILT pin connects to an internal audio filter for sound-reactive LED modes. Unused here, but a 100nF cap to GND is placed on each chip for noise filtering per datasheet recommendation.

### Decoupling

- 100nF per chip on 3.3V VCC
- 10uF bulk on 3.3V VCC (shared)
- 10uF bulk + 100nF HF on 5V LED anode supply

## Key Parts

| Part | Role | Datasheet |
|------|------|-----------|
| IS31FL3216A | 16-channel I2C LED driver, QFN-28, 8-bit PWM (x3) | [ISSI IS31FL3216A](https://www.lumissil.com/assets/pdf/core/IS31FL3216A_DS.pdf) |

## Signal Interface

| Signal | Direction | Description |
|--------|-----------|-------------|
| sda | bidir | I2C data (shared bus with MCU) |
| scl | in | I2C clock (shared bus with MCU) |
| vcc | in | +3.3V logic supply |
| v5v | in | +5V LED anode supply |
| gnd | in | Common ground |

Note: LED cathode connections (IS31FL3216A output pins to button LED cathodes) are wired in `control.ato`, not in this module, because they cross between the button-scan module (which owns the PB6149L button instances) and this module.

## References

- IS31FL3216A datasheet: R_EXT formula (section on current setting), I2C address table, QFN-28 pin assignments
- IS31FL3216A application circuit: recommended decoupling, SDB/CLK/C_FILT pin handling
