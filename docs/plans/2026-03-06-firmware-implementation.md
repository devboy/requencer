# Firmware Implementation Roadmap

## Overview

Bring the requencer to life on the Pimoroni Pico Plus 2 (RP2350 + 8MB PSRAM). The hardware PCB design is complete. The Rust engine and renderer crates are shared with the WASM/web target. This document covers what firmware modules need to be built and in what order.

## Hardware Summary

| Component | Part | Qty | Interface | MCU Pins |
|-----------|------|-----|-----------|----------|
| MCU | Pico Plus 2 (RP2350 + 8MB PSRAM) | 1 | — | GP0-28 |
| LCD | ST7796 480×320 TFT | 1 | SPI | GP0,1,2,3,5 |
| DAC | DAC8568SPMR (8-ch 16-bit) | 2 | SPI | GP0,2,6,7 |
| Op-Amp | OPA4172ID (quad) | 4 | Analog | — |
| Button SR | 74HC165D (8-bit PISO) | 5 | GPIO/PIO | GP8,9,10 |
| LED Driver | TLC5947DAP (24-ch PWM) | 4 | SPI daisy | GP11,12,13,14 |
| Encoder | EC11E (rotary + push) | 2 | GPIO | GP15-20 |
| MIDI Opto | 6N138 | 1 | UART | GP21,22 |
| Jacks | PJ398SM (Thonkiconn) | 26 | Analog/GPIO | GP4,26,27,28 |
| Transistor | 2N3904 (clock output buffer) | 2 | GPIO | GP4,28 |

## GPIO Pin Map

```
GP0   SPI0 MOSI  → LCD, DAC1, DAC2 (shared bus)
GP1   GPIO        → LCD chip select
GP2   SPI0 SCK   → LCD, DAC1, DAC2 (shared bus)
GP3   GPIO        → LCD data/command
GP4   GPIO        → Reset output (via 2N3904)
GP5   PWM         → LCD backlight
GP6   GPIO        → DAC1 chip select
GP7   GPIO        → DAC2 chip select
GP8   GPIO/PIO    → Button SR clock
GP9   GPIO/PIO    → Button SR latch (SH/LD)
GP10  GPIO/PIO    → Button SR data out (QH)
GP11  GPIO        → LED driver serial data in (SIN)
GP12  GPIO        → LED driver serial clock (SCLK)
GP13  GPIO        → LED driver latch (XLAT)
GP14  GPIO        → LED driver blanking (BLANK)
GP15  GPIO        → Encoder A, pin A
GP16  GPIO        → Encoder A, pin B
GP17  GPIO        → Encoder A, push switch
GP18  GPIO        → Encoder B, pin A
GP19  GPIO        → Encoder B, pin B
GP20  GPIO        → Encoder B, push switch
GP21  UART0 TX    → MIDI out (via 220Ω)
GP22  UART0 RX    → MIDI in (via 6N138 optocoupler)
GP26  ADC0/GPIO   → External clock input (via BAT54S clamp)
GP27  ADC1/GPIO   → External reset input (via BAT54S clamp)
GP28  ADC2/GPIO   → Clock output (via 2N3904)
```

## SPI Bus Sharing

LCD, DAC1, and DAC2 share SPI0 (GP0 MOSI, GP2 SCK) with independent chip selects:
- GP1 = LCD CS
- GP6 = DAC1 SYNC
- GP7 = DAC2 SYNC

Only one device active at a time. Use a shared SPI bus abstraction (embassy `SpiDevice`).

## Shift Register Chain (Buttons)

5× 74HC165D daisy-chained, 40 bits total:

```
SR1 (bits 0-7):   Step buttons 1-8
SR2 (bits 8-15):  Step buttons 9-16
SR3 (bits 16-23): Track T1-T4, Subtrack GATE/PITCH/VEL/MOD
SR4 (bits 24-31): PAT, MUTE, ROUTE, DRIFT, XPOSE, VAR, PLAY, RESET
SR5 (bits 32-39): SETTINGS (bit 32), 7× spare
```

Scan sequence: pull GP9 (SH/LD) low to latch, then clock 40 bits out via GP8/GP10.

## LED Driver Chain

4× TLC5947DAP daisy-chained, 96 channels (32 RGB LEDs × 3):

```
TLC1 (ch 0-23):  Step LEDs 1-8 (RGB)
TLC2 (ch 0-23):  Step LEDs 9-16 (RGB)
TLC3 (ch 0-23):  Track T1-T4 + Subtrack GATE/PITCH/VEL/MOD (RGB)
TLC4 (ch 0-23):  Function buttons PAT/MUTE/ROUTE/DRIFT/XPOSE/VAR/PLAY/RESET (RGB)
```

12-bit PWM per channel. Clock 96×12 = 1152 bits via GP11 (data), GP12 (clock), then pulse GP13 (XLAT) to latch. GP14 (BLANK) controls output enable.

## DAC Output Stage

2× DAC8568 → 16 channels → 4× OPA4172 quad op-amps → 16 eurorack jacks:

```
DAC1 (GP6 CS):
  CH A-D: Gate 1-4      → unity gain buffer     → 0-5V
  CH E-H: Pitch 1-4     → gain=2, offset=-2V    → -2V to +8V (1V/oct)

DAC2 (GP7 CS):
  CH A-D: Velocity 1-4  → gain≈1.6              → 0-8V
  CH E-H: Mod 1-4       → gain=2, offset=-5V    → -5V to +5V
```

DAC8568 protocol: 32-bit SPI word = [prefix(4)][command(4)][address(4)][data(16)][feature(4)].

## MIDI Interface

- **MIDI OUT**: UART0 TX (GP21) at 31250 baud, via 220Ω resistor to TRS Type A jack
- **MIDI IN**: TRS Type A jack → 6N138 optocoupler → UART0 RX (GP22), 470Ω pull-up to 3.3V

## Clock/Reset I/O

- **Clock IN**: GP26 (ADC0 as digital), protected by BAT54S Schottky clamp + 220Ω series R
- **Reset IN**: GP27 (ADC1 as digital), same protection
- **Clock OUT**: GP28 → 1kΩ → 2N3904 base, collector pulled to +5V via 1kΩ (inverted logic)
- **Reset OUT**: GP4 → same circuit

---

## Firmware Modules

### Layer 1: BSP / Embassy Setup

```rust
#![no_std]
#![no_main]

// Embassy runtime with RP2350 HAL
// - System clock configuration
// - SPI0 bus setup (shared: LCD + DAC1 + DAC2)
// - UART0 setup (MIDI, 31250 baud)
// - GPIO pin configuration
// - PWM for backlight
// - PIO for shift register scanning (optional, can bit-bang)
```

**Dependencies**: `embassy-rp`, `embassy-executor`, `embassy-time`, `embassy-sync`, `embedded-hal-async`

### Layer 2: Hardware Drivers

#### Display (ST7796)
- SPI init sequence (software reset, sleep out, display on, pixel format 16bpp)
- `DrawTarget<Color = Rgb565>` implementation
- Framebuffer lives in PSRAM (307 KB for 480×320 Rgb565)
- Scanline DMA transfer: PSRAM framebuffer → internal SRAM line buffer (960 bytes) → SPI DMA
- Double-buffered scanlines: DMA sends line A while CPU copies line B from PSRAM
- Backlight PWM on GP5
- Existing crate option: `mipidsi` (supports ST7796)

#### DAC (DAC8568 × 2)
- 32-bit SPI command format
- Write to individual channels or all channels simultaneously
- Internal reference setup (2.5V × 2 = 5V full scale)
- `note_to_dac(note: u8) -> u16` already implemented in firmware stub
- Update all 16 channels from `NoteEvent` array after each engine tick

#### Button Scanner (74HC165 × 5)
- Latch-and-shift 40 bits at ~200 Hz (5ms scan interval)
- Debounce: track last N reads, require stable for ~20ms (4 consecutive identical reads)
- Map 40-bit word to `ControlEvent` enum (same as web `forwardEvent`)
- Detect press, release, and hold (for hold-start/hold-end events)
- Can use PIO for precise timing, or simple GPIO bit-bang in async task

#### LED Driver (TLC5947 × 4)
- Clock out 1152 bits (96 channels × 12-bit grayscale)
- Map `LedMode` (Off/On/Dim/Flash) + track color → RGB 12-bit PWM values
- Update at ~30 Hz (every other frame)
- BLANK pin: pulse high to reset PWM cycle

#### Encoders (EC11E × 2)
- Quadrature decode: gray code state machine on A/B pins
- Push switch: debounce ~30ms
- Generate `EncoderATurn { delta }`, `EncoderAPush`, `EncoderBTurn { delta }`, `EncoderBPush`
- Hardware has 100nF debounce caps, but firmware debounce still needed
- Can use PIO for interrupt-free quadrature, or GPIO interrupts

#### MIDI (UART)
- TX: serialize `NoteEvent` → note-on/note-off messages, CC for mod, clock messages
- RX: parse incoming MIDI (running status), extract clock/start/stop for external sync
- Ring buffer for TX queue (non-blocking sends during tick)

#### Clock I/O
- Clock IN: edge detection interrupt on GP26, count pulses for external PPQN
- Reset IN: edge detection on GP27, trigger `engine.reset_playheads()`
- Clock OUT: toggle GP28 on each tick (inverted: LOW = 5V output due to NPN)
- Reset OUT: pulse GP4 on pattern restart

### Layer 3: Main Loop

```rust
// Pseudo-code for the main firmware loop

#[embassy_executor::main]
async fn main(spawner: Spawner) {
    // Init hardware
    let spi_bus = init_spi0(gp0, gp2);
    let display = init_display(&spi_bus, gp1, gp3, gp5);
    let dac1 = init_dac(&spi_bus, gp6);
    let dac2 = init_dac(&spi_bus, gp7);
    let buttons = init_buttons(gp8, gp9, gp10);
    let leds = init_leds(gp11, gp12, gp13, gp14);
    let enc_a = init_encoder(gp15, gp16, gp17);
    let enc_b = init_encoder(gp18, gp19, gp20);
    let midi = init_midi(gp21, gp22);

    // Engine state (in PSRAM)
    let mut state = SequencerState::new();
    state.apply_default_presets();
    let mut ui = UiState::default();

    // Spawn async tasks
    spawner.spawn(button_scan_task(buttons)).unwrap();
    spawner.spawn(encoder_task(enc_a, enc_b)).unwrap();
    spawner.spawn(midi_rx_task(midi)).unwrap();

    // Main loop: tick → render → output
    loop {
        // 1. Process input events from button/encoder tasks
        while let Some(event) = event_queue.try_recv() {
            mode_machine::dispatch(&mut ui, &mut state, event, system_tick);
        }

        // 2. Tick engine (if playing, at PPQN rate)
        if state.transport.playing && tick_due() {
            let events = engine::tick(&mut state);
            output_to_dac(&dac1, &dac2, &events);
            output_to_midi(&midi, &events, &state.midi_configs);
        }

        // 3. Render display (~30 fps)
        if frame_due() {
            renderer::render(&mut display, &state, &ui);
            update_leds(&leds, &mode_machine::get_led_state(&ui, &state));
        }
    }
}
```

## Real-Time Timing Architecture

This is a sequencer — timing accuracy is everything. Sub-millisecond jitter is audible. The architecture must guarantee deterministic CV/gate output regardless of what else the firmware is doing (rendering display, scanning buttons, sending MIDI).

### The Golden Rule: Hardware Timer ISR for Engine Ticks

A hardware timer interrupt fires at the PPQN rate. The ISR does ONE thing: advance the engine tick and write to the DAC. Everything else runs at lower priority.

```
Priority 0 (highest): Hardware timer ISR → engine tick → DAC write
Priority 1:           External clock input ISR → sync tick counter
Priority 2:           Button scan, encoder read
Priority 3 (lowest):  Display render, LED update
```

The tick ISR must complete in <10 µs. No allocations, no display writes, no MIDI parsing — just `tick()` → write 16 DAC values.

### Internal Clock Timing

```
Hardware Timer configured for BPM-derived period:
  period_µs = 60_000_000 / (BPM × PPQN)

  At 120 BPM, 24 PPQN: period = 20,833 µs (~48 Hz per tick)
  At 120 BPM, 96 PPQN: period = 5,208 µs (~192 Hz per tick)

Timer ISR fires → tick engine → update DAC → done in <10 µs
Jitter: ~0 (hardware timer is crystal-driven, deterministic)
```

### External Clock Timing

```
GPIO interrupt on clock input rising edge (GP26)
  → ISR captures timestamp
  → Advances tick counter
  → tick engine → update DAC

Jitter: determined by input signal + interrupt latency (~1-2 µs on Cortex-M33)
```

### PIO for Cycle-Accurate Timing (Optional Enhancement)

The RP2350's PIO can handle timing-critical I/O without CPU involvement:

- **Clock input**: PIO state machine watches GP26, captures edges with cycle-accurate timing (~6.7 ns at 150 MHz), pushes timestamps to FIFO
- **DAC output**: PIO state machine clocks out SPI data to DACs on a precise schedule
- **Clock output**: PIO generates perfectly timed output pulses on GP28

PIO eliminates interrupt latency entirely. Consider for clock I/O if jitter from GPIO interrupts proves insufficient.

### Execution Model

```
┌─────────────────────────────────────────────┐
│ TIMER ISR (highest priority, <10 µs)        │
│  1. engine::tick(&mut state) → NoteEvents   │
│  2. DAC SPI write (16 channels, ~8 µs)      │
│  3. Toggle clock output GPIO if needed       │
│  4. Queue MIDI bytes for TX (non-blocking)   │
└─────────────────────────────────────────────┘
         ↓ (returns immediately)
┌─────────────────────────────────────────────┐
│ MAIN LOOP (lower priority, ~30 fps)         │
│  1. Scan buttons (shift register read)      │
│  2. Read encoders                           │
│  3. Process events → mode_machine::dispatch │
│  4. MIDI TX (drain queue via DMA)           │
│  5. Render display (DMA, non-blocking)      │
│  6. Update LEDs                             │
└─────────────────────────────────────────────┘
```

### SPI Bus Contention

LCD and DACs share SPI0. This works IF:

1. **DAC writes happen in the tick ISR** — short transaction (~32 bits × 16 channels = ~8 µs at 50 MHz)
2. **Display writes happen in the main loop via DMA** — pauses when tick ISR takes the bus
3. **Tick ISR has highest interrupt priority** — preempts everything

Worst case: if a display DMA transfer is in progress when the tick ISR fires, the ISR waits for the current SPI byte to finish (~160 ns at 50 MHz) before grabbing the bus. This adds <1 µs jitter — acceptable.

Alternative: use PIO to bit-bang DAC SPI on separate pins, fully decoupling DAC from display. Would require PCB changes (dedicated DAC SPI pins).

### What Can Go Wrong

| Problem | Cause | Fix |
|---------|-------|-----|
| Timing jitter | Display SPI blocks during tick ISR | Use DMA for display, never block in tick ISR |
| Missed ticks | ISR takes too long | Keep tick ISR <10 µs, defer work to main loop |
| Clock drift | Software timing (`delay()`, `millis()`) | Use hardware timer driven by crystal oscillator |
| External clock jitter | Polling instead of interrupt | Use GPIO interrupt or PIO for edge capture |
| Priority inversion | Button scan ISR preempts tick ISR | Set tick ISR to highest NVIC priority |
| DAC glitch | SPI bus contention | Dedicated CS pins, short DAC writes in ISR |

### Reference Implementations

- **[µClock](https://github.com/midilab/uClock)** — hardware timer BPM clock generator library (Arduino/PlatformIO). Demonstrates the timer ISR pattern for sequencer timing on AVR, Teensy, STM32, ESP32, RP2040.
- **[Mutable Instruments firmware](https://pichenettes.github.io/mutable-instruments-documentation/modules/braids/firmware/)** — gold standard for eurorack firmware architecture. STM32-based, timer-driven audio/CV output, DMA for display, carefully prioritized interrupts. Open source (Braids, Peaks, Grids, Marbles).
- **[Embassy RP PIO I2S](https://docs.embassy.dev/embassy-rp/git/rp2040/pio_programs/i2s/index.html)** — example of PIO-driven deterministic audio timing on RP2040/RP2350.

### Key Timing Numbers

| Parameter | Value |
|-----------|-------|
| Cortex-M33 interrupt latency | 12 cycles (~80 ns at 150 MHz) |
| PIO instruction cycle | 6.7 ns (at 150 MHz) |
| DAC8568 SPI write (32 bits at 50 MHz) | ~640 ns |
| DAC8568 settling time | ~10 µs |
| 16-channel DAC update (worst case) | ~8 µs |
| MIDI byte (31250 baud, 8N1) | ~320 µs |
| MIDI 3-byte note message | ~1 ms |
| Display full frame SPI (480×320×16 at 62.5 MHz) | ~40 ms |
| Acceptable sequencer jitter | <100 µs (inaudible) |
| Our expected jitter (timer ISR) | <2 µs |

## Build Order

| Phase | Module | Why First |
|-------|--------|-----------|
| 1 | Embassy + blinky | Prove toolchain, flash, debug probe work |
| 2 | Display (ST7796) | Visual feedback for everything else |
| 3 | Encoders + buttons | Navigate the UI, full interaction |
| 4 | DAC output | Hear actual CV/gate — it's a sequencer |
| 5 | LEDs | Button feedback, mode indicators |
| 6 | MIDI | External connectivity |
| 7 | Clock I/O | External sync |
| 8 | Storage | Persistence (SD card or PSRAM-backed flash) |

## Memory Layout (Pico Plus 2 with PSRAM)

```
Internal SRAM (520 KB):
├── Stack (embassy executor)         32 KB
├── DMA buffers (SPI, UART)           4 KB
├── Scanline double buffer            2 KB
├── Event queue, misc heap           16 KB
└── Available                       466 KB

PSRAM (8 MB):
├── SequencerState                  244 KB
├── Rgb565 framebuffer              307 KB
├── Deserialization buffer          244 KB (temporary, for loading state)
└── Available                      ~7.2 MB

Flash (16 MB):
├── Program code + read-only data    ~1 MB (estimate)
└── Available for storage           ~15 MB
```

See `docs/plans/2026-03-06-rp2350-memory-constraints.md` for detailed struct sizes and PSRAM considerations.

## Key Dependencies (Cargo.toml)

```toml
[dependencies]
# Embassy (RP2350)
embassy-executor = { version = "0.7", features = ["arch-cortex-m", "executor-thread"] }
embassy-rp = { version = "0.4", features = ["rp2350"] }
embassy-time = { version = "0.4" }
embassy-sync = { version = "0.7" }

# Embedded HAL
embedded-hal = "1.0"
embedded-hal-async = "1.0"

# Display
mipidsi = "0.9"  # ST7796 support
display-interface-spi = "0.5"

# Our crates
requencer-engine = { path = "../engine" }
requencer-renderer = { path = "../renderer" }

# Runtime
cortex-m = "0.7"
cortex-m-rt = "0.7"
panic-probe = "0.3"
defmt = "0.3"
defmt-rtt = "0.4"
```

## Notes

- **SPI clock speed**: ST7796 supports up to 80 MHz SPI read, 62.5 MHz write. DAC8568 supports up to 50 MHz. Use 50 MHz for shared bus or switch speeds per device.
- **Encoder debounce**: Hardware has 10kΩ pull-ups + 100nF caps (~1ms RC). Firmware should still debounce ~20-30ms.
- **LED refresh**: TLC5947 has no internal PWM clock — BLANK must be toggled by firmware to advance the PWM cycle. Typical: 4 kHz BLANK toggle rate for smooth dimming.
- **MIDI timing**: 31250 baud, 10 bits per byte (8N1 + start), ~320 µs per byte. 3-byte note message = ~1ms.
- **DAC settling**: DAC8568 settles in ~10 µs. Safe to update all 16 channels within one tick.
