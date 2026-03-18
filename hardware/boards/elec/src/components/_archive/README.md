# Archived Parts

Parts that were replaced during the design process. Kept for reference in case we need to revert or reuse footprints.

## Replacement History

| Archived Part | Replaced By | Reason |
|---------------|-------------|--------|
| **RaspberryPiPico** | [PGA2350](../PGA2350/) | Pico lacks enough GPIO for this project; PGA2350 (RP2350B) has 48 GPIO in a castellated module |
| **RaspberryPiPico2** | [PGA2350](../PGA2350/) | Same GPIO limitation as Pico; PGA2350 is pin-grid array with 48 GPIO |
| **DAC8568SPMR** | [DAC80508ZRTER](../DAC80508ZRTER/) | DAC80508 has better linearity specs for 1V/oct pitch CV; same TI family but newer |
| **OPA4172ID** | [OPA4171AIPWR](../OPA4171AIPWR/) | OPA4171A has tighter offset voltage (±150uV max) for better pitch accuracy; TSSOP-14 for easier routing |
| **TLC5947RHBT** | [IS31FL3216A](../IS31FL3216A/) | Switched from SPI LED driver to I2C; IS31FL3216A frees SPI bus for DAC, QFN-28 saves board space |
| **PJ301M12** | [WQP518MA](../WQP518MA/) | WQP518MA is the standard Thonkiconn jack used across eurorack; cheaper via AliExpress direct |
| **PJ398SM** | [WQP518MA](../WQP518MA/) | PJ398SM is the older vertical version; WQP518MA is the horizontal version better suited for our PCB stack |
| **6N138** | [H11L1S](../H11L1S/) | H11L1S has built-in Schmitt trigger — simpler MIDI IN circuit (no base resistor or emitter pin needed), SOP-6 SMD |
| **PinHeader1x9** | [FPC_32P_05MM](../FPC_32P_05MM/) | Display connection moved from pin header to FPC connector when switching to 32-pin bare panel |
| **MicroSD_Slot** | [PJS008U](../PJS008U/) | PJS008U is a push-push micro SD socket with better PCB footprint; moved to control board |
| **USB_C_Vertical** | [USB_C_Receptacle](../USB_C_Receptacle/) | Switched to horizontal/edge-mount USB-C for side-panel access on main board |
| **EurorackPowerHeader** | [EurorackPowerHeader16](../EurorackPowerHeader16/) | Updated to standard 16-pin shrouded header for eurorack power bus |
| **74HCT125D** | — | Buffer IC was planned for clock output but removed; clock outputs driven directly from DAC |
| **AZ1117IH-5.0** | [AMS1117-3.3](../AMS1117-3.3/) | Replaced 5V regulator with 3.3V LDO; 5V comes from eurorack bus directly |
| **TPS54331DR** | — | Switching regulator removed; linear regulation (AMS1117) is simpler and adequate for current draw |
| **SWPA4030S220MT** | — | Inductor for TPS54331; removed with the switching regulator |
| **TLC5947DAP** | [IS31FL3216A](../IS31FL3216A/) | DAP package variant also replaced by I2C LED drivers |
| **FPC_18P_05MM** | [FPC_32P_05MM](../FPC_32P_05MM/) | 18-pin connector was for JC3248A035N-1 round display option; project uses 32-pin ST7796 panel instead |
| **ResistorNetwork9** | [ResArray4x0603](../ResArray4x0603/) | SIP-9 bussed network was planned for pull-ups but 0603x4 convex arrays used instead |
