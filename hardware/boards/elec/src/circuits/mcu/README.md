# MCU (PGA2350)

**Source:** [`mcu.ato`](./mcu.ato)
**Board:** Main

## Purpose

Central processing unit for the Requencer. Uses a Pimoroni PGA2350, a castellated module containing an RP2350B microcontroller with 16MB flash and 8MB PSRAM in a Pin Grid Array form factor. Manages two SPI buses (display/SD and DACs), I2C for LED drivers, UART for MIDI, GPIO for button scanning and encoders, and ADC inputs for CV and clock/reset signals.

## Design Decisions

### GPIO Assignment Rationale

The RP2350 has hardware function-select constraints: each peripheral function is only available on specific GPIO pins. The assignments are driven by these hard constraints first, then by routing convenience.

**Hardware-constrained pins (no alternatives):**

| GPIO | Function | Constraint |
|------|----------|------------|
| GP0  | SPI0_RX (MISO) | Only pin for SPI0_RX |
| GP3  | SPI0_TX (MOSI) | Only pin for SPI0_TX |
| GP20 | UART1_TX (MIDI TX) | Only pin for UART1_TX |
| GP21 | UART1_RX (MIDI RX) | Only pin for UART1_RX |
| GP30 | SPI1_SCK (DAC clock) | Only pin for SPI1_SCK |
| GP31 | SPI1_TX (DAC MOSI) | Only pin for SPI1_TX |

**ADC-constrained pins (must use ADC-capable GPIOs):**

| GPIO | Function | Constraint |
|------|----------|------------|
| GP26 (ADC0) | Clock input | ADC channel for analog threshold detection |
| GP27 (ADC1) | Reset input | ADC channel for analog threshold detection |
| GP28 (ADC2) | Clock output | ADC-capable, used as digital GPIO |
| GP40 (ADC4) | CV A input | RP2350B extended ADC channels |
| GP41 (ADC5) | CV B input | RP2350B extended ADC channels |
| GP42 (ADC6) | CV C input | RP2350B extended ADC channels |
| GP43 (ADC7) | CV D input | RP2350B extended ADC channels |

**Freely assigned pins (chosen for routing convenience):**

| GPIO | Function | Notes |
|------|----------|-------|
| GP1  | LCD CS | Near SPI0 group |
| GP2  | SPI0 SCK | Near SPI0 group |
| GP5  | LCD backlight PWM | Near LCD group |
| GP6  | Encoder B switch | Moved from GP20 when UART1_TX claimed it |
| GP7  | LCD DC | Near LCD group |
| GP8-10 | Button scan (CLK/LATCH/DATA) | Contiguous for PIO |
| GP11-12 | I2C0 SDA/SCL (LED drivers) | I2C0 function-select compatible |
| GP15-19 | Encoders A+B (A/B/SW) | Contiguous block |
| GP22 | LCD reset | General GPIO |
| GP24 | SD card CS | Near SPI0 group |
| GP25 | SD card detect | General GPIO |
| GP32-33 | DAC1/DAC2 chip selects | Near SPI1 group |

**Spare GPIOs:** GP13, GP14, GP23, GP29, GP34-39, GP44-47 (unconnected, available for future use).

### Dual SPI Bus Allocation

Two independent SPI buses eliminate contention between time-critical peripherals:

- **SPI0** (GP0/2/3): Display + SD card. Shared bus with separate chip selects (LCD_CS on GP1, SD_CS on GP24). Both peripherals are on the control board, signals route through the board connector.
- **SPI1** (GP30/31): DACs only. Dedicated bus stays entirely on the main board. No contention ensures deterministic DAC update timing for audio-rate CV output.

### Power: Schottky OR on VB

The PGA2350 VB pin accepts 1.8-5.5V and feeds the module's internal buck regulator. A B5819W Schottky diode (Vf ~0.3V) in series from the +5V rail provides:
- Reverse polarity protection
- OR-ing with USB VBUS (the PGA2350 has its own internal USB power path)

Bypass capacitors: 10uF bulk + 100nF HF on VB, 10uF bulk + 100nF HF on 3V3 output.

### ADC Reference Filtering

An RC low-pass filter (200 ohm + 2.2uF, f_3dB ~362 Hz) on ADC_VREF isolates the ADC analog reference from digital 3V3 noise, per the Pico 2 reference design. This is critical for accurate CV reading on the 12-bit ADC.

### BOOTSEL and RUN Pull-ups

- **BS pin:** 10k pull-up to 3.3V with a tactile switch to GND. Pressing the switch during reset enters USB bootloader mode for firmware flashing.
- **RUN pin:** 10k pull-up to 3.3V prevents spurious resets from noise on the line.

### SWD Debug

SWCLK and SWDIO are broken out to test pads on the main board. Accessible when the module is removed from the rack, providing a fallback debug interface if USB fails to enumerate on first boot.

## Key Parts

| Part | Role | Datasheet |
|------|------|-----------|
| PGA2350 (Pimoroni) | RP2350B module (48 GPIO, 16MB flash, 8MB PSRAM) | [Pimoroni PGA2350](https://shop.pimoroni.com/products/pga2350) |
| B5819W | Schottky diode for VB power OR (SOD-123) | [B5819W](https://www.diodes.com/assets/Datasheets/ds30153.pdf) |
| Tactile switch | BOOTSEL button | - |

## Signal Interface

| Signal | Direction | Description |
|--------|-----------|-------------|
| `v5v` | in | +5V power input (to VB via Schottky) |
| `v3v3` | out | +3.3V from PGA2350 onboard regulator |
| `spi0_mosi/sck/miso` | out/out/in | SPI0 bus (display + SD card, routed to control board) |
| `lcd_cs/dc/bl/rst` | out | Display control signals |
| `sd_cs/sd_detect` | out/in | SD card select and detect |
| `spi1_mosi/sck` | out | SPI1 bus (DACs, stays on main board) |
| `dac1_cs/dac2_cs` | out | DAC chip selects |
| `btn_clk/latch/data` | out/out/in | 74HC165 button scan chain |
| `i2c_sda/scl` | bidir | I2C0 for LED drivers |
| `enc_a_a/b/sw` | in | Encoder A quadrature + switch |
| `enc_b_a/b/sw` | in | Encoder B quadrature + switch |
| `midi_tx/rx` | out/in | UART1 MIDI |
| `clk_in/rst_in` | in | Clock/reset inputs (from protection circuits) |
| `clk_out/rst_out` | out | Clock/reset outputs (to NPN buffers) |
| `cv_a/b/c/d` | in | CV inputs (from protection circuits, to ADC4-7) |
| `usb_dp/dm` | bidir | USB 2.0 data lines |
| `swd_clk/dio` | bidir | SWD debug port |
