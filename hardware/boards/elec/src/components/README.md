# Parts Catalog

All custom components used in the Requencer. Standard passives (resistors, capacitors) are handled by atopile's stdlib and not listed here.

## Active Parts

### ICs

| Part | Description | Package | Board | Docs |
|------|-------------|---------|-------|------|
| [PGA2350](PGA2350/) | RP2350B MCU module (Pimoroni) | Pin Grid Array | Main | [README](PGA2350/README.md) |
| [DAC80508ZRTER](DAC80508ZRTER/) | 16-bit 8-channel DAC | WQFN-24 | Main | [README](DAC80508ZRTER/README.md) |
| [OPA4171AIPWR](OPA4171AIPWR/) | Quad precision op-amp | TSSOP-14 | Main | [README](OPA4171AIPWR/README.md) |
| [IS31FL3216A](IS31FL3216A/) | 16-ch I2C LED driver | QFN-28 | Control | [README](IS31FL3216A/README.md) |
| [74HC165D](74HC165D/) | 8-bit shift register | SOIC-16 | Control | [README](74HC165D/README.md) |
| [H11L1S](H11L1S/) | Schmitt trigger optocoupler | SOP-6 | Control | [README](H11L1S/README.md) |
| [AMS1117-3.3](AMS1117-3.3/) | 3.3V LDO regulator | SOT-223 | Main | [README](AMS1117-3.3/README.md) |
| [PRTR5V0U2X](PRTR5V0U2X/) | USB ESD protection | SOT-143B | Main | [README](PRTR5V0U2X/README.md) |

### Connectors

| Part | Description | Type | Board | Docs |
|------|-------------|------|-------|------|
| [WQP518MA](WQP518MA/) | 3.5mm mono jack (Thonkiconn) | THT | Control | [README](WQP518MA/README.md) |
| [PJ366ST](PJ366ST/) | 3.5mm TRS stereo jack (MIDI) | THT | Control | [README](PJ366ST/README.md) |
| [PJS008U](PJS008U/) | Micro SD card socket | SMD | Control | [README](PJS008U/README.md) |
| [EC11E](EC11E/) | Rotary encoder with switch | THT | Control | [README](EC11E/README.md) |
| [FPC_32P_05MM](FPC_32P_05MM/) | 32-pin FPC connector (display) | SMD | Control | [README](FPC_32P_05MM/README.md) |
| [FPC_18P_05MM](FPC_18P_05MM/) | 18-pin FPC connector | SMD | — | [README](FPC_18P_05MM/README.md) |
| [ShroudedHeader2x16](ShroudedHeader2x16/) | 2×16 board-to-board header | THT | Both | [README](ShroudedHeader2x16/README.md) |
| [ShroudedSocket2x16](ShroudedSocket2x16/) | 2×16 board-to-board socket | THT | Both | [README](ShroudedSocket2x16/README.md) |
| [EurorackPowerHeader16](EurorackPowerHeader16/) | 16-pin eurorack power header | THT | Main | [README](EurorackPowerHeader16/README.md) |
| [USB_C_Receptacle](USB_C_Receptacle/) | USB Type-C connector | SMD | Main | [README](USB_C_Receptacle/README.md) |

### Switches & LEDs

| Part | Description | Type | Board | Docs |
|------|-------------|------|-------|------|
| [PB6149L](PB6149L/) | LED illuminated pushbutton | THT | Control | [README](PB6149L/README.md) |
| [TactileSwitch](TactileSwitch/) | Tactile push button (reset) | THT | Main | [README](TactileSwitch/README.md) |

### Discrete Semiconductors

| Part | Description | Package | Board | Docs |
|------|-------------|---------|-------|------|
| [BAT54S](BAT54S/) | Dual Schottky diode | SOT-23 | Main | [README](BAT54S/README.md) |
| [B5819W](B5819W/) | Schottky diode | SOD-123 | Both | [README](B5819W/README.md) |
| [2N3904](2N3904/) | NPN transistor | SOT-23 | Main | [README](2N3904/README.md) |
| [2N7002](2N7002/) | N-channel MOSFET | SOT-23 | Control | [README](2N7002/README.md) |

### Passive Arrays

| Part | Description | Package | Board | Docs |
|------|-------------|---------|-------|------|
| [ResArray4x0603](ResArray4x0603/) | 4-element resistor array | 0612 | Control | [README](ResArray4x0603/README.md) |
| [ResistorNetwork9](ResistorNetwork9/) | 9-element resistor network | SIP-10 | Control | [README](ResistorNetwork9/README.md) |

### Unused / Reference

| Part | Description | Notes |
|------|-------------|-------|
| [IS31FL3236A](IS31FL3236A/) | 36-ch I2C LED driver | Evaluated but not used; IS31FL3216A chosen instead |
| [6N138](6N138/) | Optocoupler | Replaced by H11L1S for MIDI |
| [TLC5947DAP](TLC5947DAP/) | 24-ch SPI LED driver | Replaced by IS31FL3216A (I2C) |
| [TC002-RGB](TC002-RGB/) | RGB tactile switch | Replaced by PB6149L |

## [Archived Parts](_archive/)

Parts fully replaced and removed from the design. See [archive README](_archive/README.md) for replacement history.
