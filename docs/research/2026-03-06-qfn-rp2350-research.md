# QFN RP2350 Research: PGA2350 Module Selected

## Decision: Pimoroni PGA2350

**Date:** 2026-03-06

After evaluating bare RP2350B vs module options, we're going with the **Pimoroni PGA2350** as our MCU module. It gives us the RP2350B's 48 GPIO without the complexity of designing our own power/clock/flash circuitry.

### Why PGA2350

| Feature | Pico Plus 2 (old) | PGA2350 (new) |
|---|---|---|
| **GPIO** | 26 usable (0 spare) | **48** (15+ spare) |
| **ADC channels** | 3 usable | **8** |
| **Flash** | 4MB | **16MB** |
| **PSRAM** | 8MB | **8MB** |
| **Size** | 51 × 21mm | **25.4 × 25.4mm** (smaller!) |
| **USB connector** | Built-in Micro-B | **None** (we add USB-C to faceplate) |
| **BOOTSEL** | Physical button | **BS pin** (wire our own) |
| **3.3V regulator** | Built-in | **Built-in** (300mA) |
| **Mounting** | Castellated edge pads | **PGA** (pin grid, 2.54mm pitch) |
| **Price** | ~$8 | **~$10** |

### What This Enables

1. **4 CV inputs actually connected** — ADC4-7 on GP40-GP43, no more "future expansion" placeholder
2. **Dedicated DAC SPI bus** — SPI1 on GP30/GP31 for DACs, SPI0 stays with display + SD card. Eliminates bus contention.
3. **Front-panel USB-C** — for firmware updates without opening the rack
4. **Front-panel micro SD slot** — for preset import/export, pattern sharing
5. **Extra button (TBD)** — below T4, available for future features
6. **15+ spare GPIO** — room for expansion without a board respin

### Flashing Strategy

The PGA2350 has no BOOTSEL button — it has a **BS pin** that must be pulled to GND during power-up to enter UF2 bootloader mode.

**How we handle this:**

1. **First flash / recovery:** Small tactile BOOTSEL switch on the main PCB (accessible when module is removed from rack, or through a pinhole). Hold BS button → plug USB-C → appears as USB mass storage → drag UF2 file.
2. **Normal firmware updates:** Once initial firmware is loaded, use `picotool reboot -f -u` over USB-C to reboot into bootloader mode. **No physical button press needed.** The firmware can expose a "firmware update" menu option that triggers this automatically.
3. **SWD header:** 3-pin debug header (SWCLK, SWDIO, GND) on the main PCB for development with `probe-rs` / `cargo flash`. This is the primary development workflow.

**Summary: You do NOT need to push a button for normal updates.** Software-triggered reboot to bootloader works once any firmware is loaded. Physical button is only for initial flash or brick recovery.

### USB-C on Front Panel

The PGA2350 exposes U+ and U- pins (USB data lines) on the pin grid. We wire these to a USB-C connector mounted on the front panel faceplate:

- **USB-C receptacle** on faceplate (standard 16-pin through-hole or mid-mount)
- **27Ω series resistors** on D+/D- (USB spec)
- **ESD protection** TVS diode (PRTR5V0U2X or similar)
- **5.1kΩ pull-down resistors** on CC1/CC2 (required for USB-C as device)
- **VBUS** connected to PGA2350's VB pin through a Schottky diode (so USB power doesn't fight eurorack power)

USB is **only for programming/debug**. Normal operation is powered by eurorack ±12V.

### Micro SD Card on Front Panel

With SPI0 shared between display and SD card:

- **SPI0 MISO** on GP23 (new — not available on Pico 2)
- **SD CS** on GP24
- Display and SD card share MOSI (GP0) and SCK (GP2)
- Bus arbitration handled in firmware (never talk to both simultaneously)

Front-panel micro SD slot allows:
- **Preset backup/restore** — copy all patterns to SD as files
- **MIDI file import** — load .mid files for playback
- **Preset sharing** — swap SD cards between modules
- **Firmware backup** — store UF2 files on card

The module works fine without a card inserted. SD is purely for import/export.

---

## RP2350 Chip Variants (Reference)

| | RP2350A | RP2354A | RP2350B | RP2354B |
|---|---|---|---|---|
| **Package** | QFN-60 (7×7mm) | QFN-60 (7×7mm) | QFN-80 (10×10mm) | QFN-80 (10×10mm) |
| **Pitch** | 0.4mm | 0.4mm | 0.4mm | 0.4mm |
| **GPIO** | 30 | 30 | **48** | **48** |
| **ADC channels** | 4 | 4 | **8** | **8** |
| **Internal flash** | None | **2MB** | None | **2MB** |
| **SRAM** | 520KB | 520KB | 520KB | 520KB |
| **PIO state machines** | 12 | 12 | 12 | 12 |
| **UART/SPI/I2C** | 2/2/2 | 2/2/2 | 2/2/2 | 2/2/2 |
| **USB** | 1 (FS) | 1 (FS) | 1 (FS) | 1 (FS) |
| **Price** | ~$0.80 | ~$0.80 | ~$0.90 | ~$0.90 |

**PGA2350 uses the RP2350B** (QFN-80, 48 GPIO). All variants share: Dual Cortex-M33 / dual RISC-V Hazard3 cores, 150MHz, 520KB SRAM, 12 PIO state machines, 3 PIO blocks, QSPI bus with secondary CS for PSRAM/flash, TrustZone, SHA-256, OTP.

---

## New GPIO Allocation (PGA2350)

### SPI0 — Display + SD Card
| GPIO | Function | Notes |
|---|---|---|
| GP0 | SPI0 TX (MOSI) | Shared: display + SD card |
| GP2 | SPI0 SCK | Shared: display + SD card |
| GP23 | SPI0 RX (MISO) | SD card reads (+ display MISO if needed) |
| GP1 | LCD CS | Display chip select |
| GP24 | SD CS | SD card chip select |

### Display Control
| GPIO | Function |
|---|---|
| GP3 | LCD DC (data/command) |
| GP5 | LCD backlight PWM |

### SPI1 — DACs (Dedicated Bus)
| GPIO | Function | Notes |
|---|---|---|
| GP30 | SPI1 TX (MOSI) | DAC data (no bus contention with display) |
| GP31 | SPI1 SCK | DAC clock |
| GP32 | DAC1 CS | DAC8568 #1 chip select |
| GP33 | DAC2 CS | DAC8568 #2 chip select |

### Button Scanning (74HC165 Chain)
| GPIO | Function |
|---|---|
| GP8 | Shift register CLK |
| GP9 | Shift register SH/LD (latch) |
| GP10 | Shift register QH (data out) |

### LED Drivers (TLC5947 Chain)
| GPIO | Function |
|---|---|
| GP11 | TLC SIN (serial data) |
| GP12 | TLC SCLK (serial clock) |
| GP13 | TLC XLAT (latch) |
| GP14 | TLC BLANK (output enable) |

### Encoders
| GPIO | Function |
|---|---|
| GP15 | Encoder A, phase A |
| GP16 | Encoder A, phase B |
| GP17 | Encoder A, push switch |
| GP18 | Encoder B, phase A |
| GP19 | Encoder B, phase B |
| GP20 | Encoder B, push switch |

### MIDI (UART0)
| GPIO | Function |
|---|---|
| GP21 | UART0 TX (MIDI OUT) |
| GP22 | UART0 RX (MIDI IN) |

### Clock/Reset I/O
| GPIO | Function |
|---|---|
| GP26 (ADC0) | Clock input |
| GP27 (ADC1) | Reset input |
| GP28 (ADC2) | Clock output |
| GP4 | Reset output |

### CV Inputs (NEW — previously unconnected)
| GPIO | Function |
|---|---|
| GP40 (ADC4) | CV input A |
| GP41 (ADC5) | CV input B |
| GP42 (ADC6) | CV input C |
| GP43 (ADC7) | CV input D |

### SD Card Detect
| GPIO | Function |
|---|---|
| GP25 | SD card detect (active low, 10kΩ pull-up) |

### Spare GPIO (14 pins)
| GPIO | Notes |
|---|---|
| GP6, GP7 | Freed from old DAC CS assignment |
| GP29 (ADC3) | Spare ADC channel |
| GP34-39 | General purpose |
| GP44-47 | GP47 has PSRAM CS trace (cuttable) |

**Total used: 34 of 48 GPIO. 14 spare.**

---

## PGA2350 Module Specifications

- **Chip:** RP2350B (QFN-80)
- **Package:** 25.4 × 25.4mm Pin Grid Array, 2.54mm pin pitch
- **64 total pins:** 48 GPIO + power + USB data + GND
- **Flash:** 16MB QSPI with XiP
- **PSRAM:** 8MB (on QSS_CS1, GP47 trace cuttable if not needed)
- **Onboard 3.3V regulator:** 300mA max output
- **Input voltage:** 3V to 5.5V on VB pin
- **No USB connector** — U+/U- exposed as pins
- **No BOOTSEL button** — BS pin exposed
- **No LEDs** — minimal module
- **RP2350-E9 erratum:** Early A2 stepping affected; A3+ stepping resolved. Current stock should be A3+.

---

## Errata Notes

### RP2350-E9 (GPIO Input Leakage)
- **Affects:** A2 stepping only (shipping pre-July 2025)
- **Fixed in:** A3 and A4 stepping
- **Impact:** ~120μA leakage when input voltage is between thresholds
- **Mitigation:** If on A2, use pull-down resistors ≤8.2kΩ on affected inputs
- **Current PGA2350 stock:** Should be A3+ stepping. Verify on receipt.

---

## Hardware Audit Results (2026-03-06)

Post-migration audit identified and fixed several reliability issues:

### Level Shifting (DAC SPI)
DAC8568 VIH = 0.7×AVDD = 3.5V at 5V supply. PGA2350 GPIO outputs 3.3V — out of spec. **Fix:** 74HCT125 quad bus buffer on SPI1 MOSI, SCK, CS1, CS2. TTL input (VIH=2.0V) accepts 3.3V, outputs 5V CMOS.

### Reference Voltage Buffering
Pitch (2V) and mod (1.667V) reference dividers were loaded by 4× summing network resistors each, pulling references off-target. **Fix:** OPA4172 quad op-amp (opamp5) configured as voltage follower buffers. Two channels buffer references, two spare channels tied to GND.

### Pitch CV Topology
Original inverting summing topology produced wrong output range. **Fix:** Non-inverting topology. Vout = 2×Vdac - 2V, range -2V to +8V. Uses 0.1% resistors (Rf=Rg=10kΩ) for 1V/oct precision.

### TLC5947 Logic Levels
TLC5947 at 5V VCC had same VIH issue as DAC. **Fix:** Power TLC5947 VCC from 3.3V. IREF is internal bandgap-based (independent of VCC). LED anodes powered separately from 5V rail.

### MIDI Jacks
PJ398SM is mono (TIP/SLEEVE/SWITCH) — cannot implement TRS Type A MIDI. **Fix:** Created PJ301M12 stereo TRS jack part (TIP/RING/SLEEVE/TIP_SW/RING_SW).

### MCU Pin Completion
- **RUN pin:** 10kΩ pull-up to 3.3V (prevents spurious resets from noise)
- **ADC_VREF:** 100nF decoupling cap to GND (clean reference for CV ADC channels)
- **SD card detect:** CD pin wired to GP25 (firmware can detect card insertion)

### Input Protection Tolerance
Upgraded voltage divider resistors (22kΩ/10kΩ) from 5% to 1% tolerance for better CV input accuracy.

### Output Protection
Reduced from 1kΩ to 470Ω. At 470Ω + 10kΩ load: 4.5% voltage drop (vs 9% with 1kΩ). Acceptable for pitch 1V/oct.

### Decoupling
- 100nF HF + 10µF bulk per DAC chip on AVDD
- 1µF on each DAC VREFIN/VREFOUT
- 100nF per op-amp per rail (±12V) — 10 caps total for 5 quad op-amps
- 10µF bulk on each ±12V rail near op-amp cluster
- 100nF on 74HCT125 level shifter VCC

### BOM/Layout Notes
- Verify PGA2350 is A3+ stepping (RP2350-E9 errata affects A2 only)
- OPA4172: LCSC stocks TSSOP-14 (OPA4172IPWR, C1849436), not SOIC-14 — verify footprint
- TLC5947DAP: Low LCSC stock (7 units, C1554203) — source early or use alternative supplier
- Consider 4-layer PCB for mixed-signal density (2-layer may have routing congestion)

---

## Sources

- [Pimoroni PGA2350 Product Page](https://shop.pimoroni.com/en-us/products/pga2350)
- [Pimoroni PGA GitHub Repository](https://github.com/pimoroni/pga)
- [Raspberry Pi RP2350 Hardware Design Guide (PDF)](https://datasheets.raspberrypi.com/rp2350/hardware-design-with-rp2350.pdf)
- [RP2350 Product Brief (PDF)](https://datasheets.raspberrypi.com/rp2350/rp2350-product-brief.pdf)
- [RP2350B QFN-80 Pinout](https://rp2350b.pinout.xyz/)
