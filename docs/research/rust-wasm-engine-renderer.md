# Rust + WASM Engine & Renderer Research

**Date:** 2026-03-05
**Status:** Research
**Goal:** Port the Requencer engine and renderer to Rust, targeting both WASM (browser) and native embedded (RP2350 + 480x320 TFT).

---

## 1. Why Rust?

The current TypeScript engine is already designed for this port:
- **Pure functions, immutable state** — maps directly to Rust ownership semantics
- **Zero DOM/audio dependencies** — the engine layer has no browser imports
- **Fixed-size data** — 4 tracks x 4 subtracks x 16 steps = bounded memory

Rust gives us:
- **Single codebase** for browser (WASM) and embedded (ARM Cortex-M33)
- **no_std** compatibility — same engine compiles for MCU with zero heap allocation
- **Predictable performance** — no GC pauses, no JIT warmup
- **Memory safety** — critical for a real-time sequencer that must never crash on stage

---

## 2. Architecture: Cargo Workspace

```
requencer-rs/
├── Cargo.toml                    # workspace root
├── crates/
│   ├── engine/                   # no_std sequencer logic
│   │   ├── Cargo.toml           # [no_std, optional alloc]
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── types.rs         # SequencerState, NoteEvent, etc.
│   │       ├── sequencer.rs     # tick(), randomize, etc.
│   │       ├── lfo.rs           # waveform computation
│   │       ├── rng.rs           # deterministic PRNG (splitmix)
│   │       ├── clock.rs         # clock divider, PPQN
│   │       ├── routing.rs       # output resolution
│   │       ├── variation.rs     # transforms
│   │       ├── mutator.rs       # Turing machine drift
│   │       ├── arpeggiator.rs   # arp patterns
│   │       └── euclidean.rs     # Bjorklund algorithm
│   │
│   ├── renderer/                 # no_std abstract rendering
│   │   ├── Cargo.toml           # depends on engine, embedded-graphics-core
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── trait.rs         # DrawTarget abstraction
│   │       ├── screens/         # home, gate-edit, pitch-edit, etc.
│   │       ├── widgets/         # step grid, LFO curve, bar graph
│   │       └── colors.rs        # RGB565 color palette
│   │
│   ├── web/                      # WASM browser target
│   │   ├── Cargo.toml           # depends on engine, renderer, wasm-bindgen, web-sys
│   │   └── src/
│   │       ├── lib.rs           # wasm_bindgen entry point
│   │       ├── canvas_target.rs # DrawTarget impl for Canvas2D
│   │       ├── audio.rs         # Web Audio / Tone.js bridge
│   │       └── midi.rs          # Web MIDI bridge
│   │
│   └── firmware/                 # RP2350 embedded target
│       ├── Cargo.toml           # depends on engine, renderer, rp235x-hal, mipidsi
│       └── src/
│           ├── main.rs          # entry point, hardware init
│           ├── display.rs       # DrawTarget impl for ST7796 via SPI
│           ├── input.rs         # shift registers, encoder, buttons
│           ├── dac.rs           # DAC8568 CV output
│           └── midi.rs          # UART MIDI
```

### Workspace Cargo.toml

```toml
[workspace]
members = ["crates/*"]
resolver = "2"

[workspace.dependencies]
embedded-graphics-core = "0.4"
embedded-graphics = "0.8"
heapless = "0.8"
```

---

## 3. Engine Crate (`no_std`)

### 3.1 Feature Flags

```toml
[package]
name = "requencer-engine"
version = "0.1.0"
edition = "2021"

[features]
default = ["std"]
std = []
alloc = []

[dependencies]
heapless = "0.8"
```

```rust
#![cfg_attr(not(feature = "std"), no_std)]

#[cfg(feature = "alloc")]
extern crate alloc;
```

### 3.2 Type Mapping: TypeScript → Rust

| TypeScript | Rust (`no_std`) | Notes |
|---|---|---|
| `number` (MIDI note) | `u8` | 0-127 fits in u8 |
| `number` (velocity) | `u8` | 0-127 |
| `number` (0.0-1.0 CV) | `f32` | RP2350 has FPU for f32 |
| `GateStep` | `struct GateStep { on: bool, tie: bool, length: f32, ratchet: u8 }` | 8 bytes |
| `PitchStep` | `struct PitchStep { note: u8, slide: f32 }` | 5 bytes (padded to 8) |
| `ModStep` | `struct ModStep { value: f32, slew: f32 }` | 8 bytes |
| `Subtrack<T>` | `struct Subtrack<T, const N: usize>` with `[T; N]` | Const generic length |
| `SequenceTrack` | `struct SequenceTrack<const N: usize>` | Stack-allocated |
| `SequencerState` | `struct SequencerState` with `[SequenceTrack<MAX_STEPS>; 4]` | Fixed 4 tracks |
| `NoteEvent \| null` | `Option<NoteEvent>` | Zero-cost option for u8-sized types |
| `Array.from({length})` | `[T; N]` or `heapless::Vec<T, N>` | Compile-time or bounded |
| `structuredClone()` | `#[derive(Clone)]` | Explicit clone |
| `...spread` | `.clone()` or field-by-field | No implicit shallow copy |

### 3.3 Const Generics for Subtrack Length

```rust
pub const MAX_STEPS: usize = 64;  // future-proof (currently 16)
pub const NUM_TRACKS: usize = 4;
pub const NUM_OUTPUTS: usize = 4;

#[derive(Clone, Debug)]
pub struct Subtrack<T: Clone> {
    pub steps: heapless::Vec<T, MAX_STEPS>,
    pub length: u8,          // active length (1..=MAX_STEPS)
    pub clock_divider: u8,   // 1..=32
    pub current_step: u8,
}
```

Using `heapless::Vec<T, MAX_STEPS>` instead of `[T; MAX_STEPS]` because:
- Runtime-variable length within a fixed capacity
- `.push()`, `.truncate()`, `.len()` match our TS patterns
- Still stack-allocated, no heap

### 3.4 Memory Budget

With MAX_STEPS=64:

| Component | Size per track | x4 tracks |
|---|---|---|
| Gate subtrack (64 x GateStep) | 64 x 8 = 512 B | 2,048 B |
| Pitch subtrack (64 x PitchStep) | 64 x 8 = 512 B | 2,048 B |
| Velocity subtrack (64 x u8) | 64 B | 256 B |
| Mod subtrack (64 x ModStep) | 64 x 8 = 512 B | 2,048 B |
| RandomConfig | ~128 B | 512 B |
| LFOConfig + Runtime | ~64 B | 256 B |
| TransposeConfig | ~20 B | 80 B |
| VariationPattern | ~256 B | 1,024 B |
| **Track subtotal** | ~1,480 B | ~8,272 B |

**Total SequencerState: ~10 KB** (with all configs, routing, mutes)

RP2350 has **520 KB SRAM** — the engine state uses <2% of available memory.

### 3.5 Pure Function Pattern

The TypeScript `tick()` function maps directly:

```rust
/// Advance the sequencer by one tick. Pure function.
pub fn tick(state: &SequencerState) -> TickResult {
    let master_tick = state.transport.master_tick;
    let next_tick = master_tick + 1;

    // Resolve current steps
    let mut events: [Option<NoteEvent>; NUM_OUTPUTS] = [None; NUM_OUTPUTS];

    for (out_idx, route) in state.routing.iter().enumerate() {
        let gate_track = &state.tracks[route.gate as usize];
        let combined = TICKS_PER_STEP * gate_track.clock_divider as u32
                     * gate_track.gate.clock_divider as u32;

        if master_tick == 0 || master_tick % combined == 0 {
            events[out_idx] = Some(resolve_output(state, out_idx, master_tick));
        }
    }

    TickResult { events, next_tick }
}
```

Key differences from TS:
- No `map()` chains — use fixed arrays with index loops
- No spread operator — explicit field assignment or `Clone`
- `Option<NoteEvent>` instead of `NoteEvent | null`
- All mutations via return value (same pure pattern)

### 3.6 RNG: Splitmix (Direct Port)

The existing `createRng` is already a splitmix variant — ports to Rust trivially:

```rust
pub struct Rng {
    state: u32,
}

impl Rng {
    pub fn new(seed: u32) -> Self {
        Self { state: seed }
    }

    pub fn next_f32(&mut self) -> f32 {
        self.state = self.state.wrapping_add(0x6d2b79f5);
        let mut r = (self.state ^ (self.state >> 15)).wrapping_mul(1 | self.state);
        r = (r.wrapping_add((r ^ (r >> 7)).wrapping_mul(61 | r))) ^ r;
        ((r ^ (r >> 14)) >> 0) as f32 / 4294967296.0
    }
}
```

No external crate needed. Deterministic, `no_std`, identical output to the TS version.

---

## 4. Renderer Crate (Cross-Platform Abstraction)

### 4.1 The Problem

We need the same screen drawing code to work on:
- **Browser**: Canvas 2D API (through `web-sys`)
- **RP2350**: 480x320 SPI TFT (through `mipidsi` + `embedded-graphics`)

### 4.2 Approach: `embedded-graphics` as the Common Abstraction

The `embedded-graphics` crate defines a `DrawTarget` trait that abstracts over any pixel-addressable surface:

```rust
pub trait DrawTarget {
    type Color: PixelColor;
    type Error;

    fn draw_iter<I>(&mut self, pixels: I) -> Result<(), Self::Error>
    where
        I: IntoIterator<Item = Pixel<Self::Color>>;

    fn fill_contiguous<I>(&mut self, area: &Rectangle, colors: I) -> Result<(), Self::Error>
    where
        I: IntoIterator<Item = Self::Color>;

    fn fill_solid(&mut self, area: &Rectangle, color: Self::Color) -> Result<(), Self::Error>;
    fn clear(&mut self, color: Self::Color) -> Result<(), Self::Error>;
}
```

**This is the key insight:** We write all our screen rendering code against `DrawTarget`, and provide two implementations:

1. **Embedded**: `mipidsi::Display<SPI, DC, RST, ST7796>` already implements `DrawTarget<Color = Rgb565>`
2. **Browser**: We implement `DrawTarget<Color = Rgb565>` for a wrapper around `CanvasRenderingContext2d`

### 4.3 Browser DrawTarget Implementation

```rust
// In crates/web/src/canvas_target.rs
use embedded_graphics_core::prelude::*;
use embedded_graphics_core::pixelcolor::Rgb565;
use web_sys::CanvasRenderingContext2d;

pub struct CanvasTarget {
    ctx: CanvasRenderingContext2d,
    width: u32,
    height: u32,
    // Optional: pixel buffer for batch rendering
    buffer: Vec<u8>,  // RGBA pixel buffer
}

impl DrawTarget for CanvasTarget {
    type Color = Rgb565;
    type Error = core::convert::Infallible;

    fn draw_iter<I>(&mut self, pixels: I) -> Result<(), Self::Error>
    where
        I: IntoIterator<Item = Pixel<Rgb565>>,
    {
        for Pixel(point, color) in pixels {
            let (r, g, b) = rgb565_to_rgb888(color);
            let idx = ((point.y as u32 * self.width + point.x as u32) * 4) as usize;
            self.buffer[idx] = r;
            self.buffer[idx + 1] = g;
            self.buffer[idx + 2] = b;
            self.buffer[idx + 3] = 255;
        }
        Ok(())
    }

    fn fill_solid(&mut self, area: &Rectangle, color: Rgb565) -> Result<(), Self::Error> {
        let (r, g, b) = rgb565_to_rgb888(color);
        let style = format!("rgb({},{},{})", r, g, b);
        self.ctx.set_fill_style_str(&style);
        self.ctx.fill_rect(
            area.top_left.x as f64,
            area.top_left.y as f64,
            area.size.width as f64,
            area.size.height as f64,
        );
        Ok(())
    }
}
```

**Performance note:** For the browser, `fill_solid()` is the hot path (we draw lots of filled rectangles). Calling `ctx.fill_rect()` directly is faster than pixel-by-pixel `putImageData`. The Canvas 2D calls go through the WASM→JS boundary but each call is GPU-accelerated.

### 4.4 Embedded DrawTarget

On RP2350, `mipidsi` already provides the `DrawTarget` implementation:

```rust
use mipidsi::models::ST7796;
use mipidsi::Display;
use rp235x_hal::spi::Spi;

// mipidsi::Display already implements DrawTarget<Color = Rgb565>
// No wrapper needed!
let display = mipidsi::Builder::new(ST7796, di)
    .display_size(480, 320)
    .orientation(Orientation::Landscape(false))
    .init(&mut delay)
    .unwrap();

// Pass directly to renderer
render_home_screen(&mut display, &sequencer_state, &ui_state);
```

### 4.5 Screen Rendering Functions

All screen rendering is generic over `DrawTarget`:

```rust
// In crates/renderer/src/screens/home.rs
use embedded_graphics::prelude::*;
use embedded_graphics::primitives::{Rectangle, PrimitiveStyle};
use embedded_graphics::text::{Text, TextStyle};
use embedded_graphics::mono_font::MonoTextStyle;

pub fn render_home_screen<D>(
    display: &mut D,
    state: &SequencerState,
    ui: &UIState,
) where
    D: DrawTarget<Color = Rgb565>,
{
    // Clear background
    display.fill_solid(
        &Rectangle::new(Point::zero(), Size::new(480, 320)),
        COLORS.background,
    ).ok();

    // Draw track overview bars
    for (i, track) in state.tracks.iter().enumerate() {
        draw_track_bar(display, track, i, ui.selected_track == i);
    }

    // Draw status bar
    draw_status_bar(display, &state.transport, ui);

    // Draw softkey labels
    draw_softkeys(display, &get_softkey_labels(ui.mode));
}
```

### 4.6 Text Rendering

`embedded-graphics` includes bitmap font support:

```rust
use embedded_graphics::mono_font::{ascii::FONT_6X10, MonoTextStyle};
use embedded_graphics::text::Text;

let style = MonoTextStyle::new(&FONT_6X10, Rgb565::WHITE);
Text::new("TRK1", Point::new(4, 12), style)
    .draw(display)?;
```

For the browser, this means text is rendered as bitmap pixels (matching the LCD exactly). No web fonts, no font loading — pixel-perfect match between browser and hardware.

Available built-in fonts:
- `FONT_4X6` — tiny labels
- `FONT_5X7` — compact text
- `FONT_6X10` — default body text
- `FONT_6X13` — headers
- `FONT_8X13` — large headers
- `FONT_10X20` — display-size numbers

Custom fonts can be added via the `embedded-graphics` BDF/PCF font tools.

### 4.7 Widgets Library

Reusable components in `crates/renderer/src/widgets/`:

```rust
// Step grid — the core UI element across all edit screens
pub fn draw_step_grid<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    steps: &[impl StepRenderable],
    active_step: u8,
    page: u8,
    area: Rectangle,
);

// LFO waveform preview
pub fn draw_lfo_curve<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    config: &LFOConfig,
    area: Rectangle,
);

// Bar graph (velocity, mod values)
pub fn draw_bar_graph<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    values: &[f32],  // 0.0-1.0
    active: u8,
    area: Rectangle,
    color: Rgb565,
);

// Encoder value display (parameter name + value)
pub fn draw_param_row<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    label: &str,
    value: &str,
    y: i32,
    selected: bool,
);
```

---

## 5. WASM Browser Target

### 5.1 Toolchain

```bash
# Install
rustup target add wasm32-unknown-unknown
cargo install wasm-pack

# Build
wasm-pack build crates/web --target web --out-dir ../../pkg

# Or use trunk for dev server with hot reload
cargo install trunk
trunk serve crates/web/index.html
```

### 5.2 wasm-bindgen Entry Point

```rust
use wasm_bindgen::prelude::*;
use web_sys::{CanvasRenderingContext2d, HtmlCanvasElement};

#[wasm_bindgen]
pub struct App {
    state: SequencerState,
    ui: UIState,
    canvas_target: CanvasTarget,
}

#[wasm_bindgen]
impl App {
    #[wasm_bindgen(constructor)]
    pub fn new(canvas: HtmlCanvasElement) -> Result<App, JsValue> {
        let ctx = canvas.get_context("2d")?.unwrap()
            .dyn_into::<CanvasRenderingContext2d>()?;

        Ok(App {
            state: SequencerState::default(),
            ui: UIState::default(),
            canvas_target: CanvasTarget::new(ctx, 480, 320),
        })
    }

    pub fn tick(&mut self) -> js_sys::Array {
        let result = engine::tick(&self.state);
        self.state = result.next_state;
        // Convert events to JS array for audio output
        events_to_js(&result.events)
    }

    pub fn render(&mut self) {
        renderer::render(&mut self.canvas_target, &self.state, &self.ui);
    }

    pub fn handle_input(&mut self, event_type: &str, value: i32) {
        let control = parse_control_event(event_type, value);
        self.ui = mode_machine::handle_event(&self.state, &self.ui, control);
    }
}
```

### 5.3 Web-sys Features Required

```toml
[dependencies.web-sys]
version = "0.3"
features = [
    "CanvasRenderingContext2d",
    "HtmlCanvasElement",
    "Document",
    "Window",
    "ImageData",
    "Performance",
    "KeyboardEvent",
    "Navigator",
    "MidiAccess",
    "MidiOutput",
    "MidiOutputMap",
]
```

### 5.4 Audio Integration

Two approaches for audio:

**Option A: Keep Tone.js in JS, call from WASM**
- WASM exports `tick()` which returns `NoteEvent[]`
- JS wrapper feeds events to Tone.js synths
- Simplest, reuses existing audio code
- Latency: ~5ms round-trip (acceptable for sequencer)

**Option B: Web Audio API from Rust**
- Use `web-sys` to create `AudioContext`, oscillators, gain nodes
- More complex but no JS dependency
- Better for eventual standalone WASM app

**Recommendation:** Start with Option A. The audio layer is thin and Tone.js handles cross-browser quirks well.

### 5.5 Performance: WASM Canvas 2D vs JS Canvas 2D

Based on benchmarks and real-world data:

- **Canvas 2D API calls** (fillRect, fillText, etc.) go through the WASM→JS FFI boundary
- Each call has ~50-100ns overhead vs native JS
- For our UI (~200-500 draw calls per frame), this adds ~10-50μs total — negligible
- The **compute-heavy parts** (LFO calculation, randomization, routing) are faster in WASM
- Net effect: **roughly equivalent performance**, with WASM winning on complex state updates

The real win isn't speed — it's **code sharing with embedded**.

---

## 6. Embedded Firmware Target (RP2350)

### 6.1 Target Setup

```bash
# ARM Cortex-M33 with hardware FPU
rustup target add thumbv8m.main-none-eabihf

# Build
cargo build --release -p requencer-firmware --target thumbv8m.main-none-eabihf

# Flash via probe-rs
cargo install probe-rs-tools
probe-rs run --chip RP2350 target/thumbv8m.main-none-eabihf/release/requencer-firmware
```

### 6.2 Key Dependencies

```toml
[dependencies]
rp235x-hal = { version = "0.2", features = ["rt", "critical-section-impl"] }
cortex-m = "0.7"
cortex-m-rt = "0.7"
embedded-hal = "1.0"
mipidsi = "0.9"
display-interface-spi = "0.5"
requencer-engine = { path = "../engine", default-features = false }
requencer-renderer = { path = "../renderer" }
panic-halt = "0.2"
```

### 6.3 Main Loop Architecture

```rust
#![no_std]
#![no_main]

use rp235x_hal as hal;
use hal::Timer;

#[hal::entry]
fn main() -> ! {
    let mut pac = hal::pac::Peripherals::take().unwrap();

    // Init clocks, SPI, GPIO, timer
    let spi = init_spi(&mut pac);
    let display = init_display(spi);
    let mut input = init_input(&mut pac);  // shift registers, encoder
    let mut dac = init_dac(&mut pac);      // DAC8568
    let mut midi = init_midi(&mut pac);    // UART MIDI

    let mut state = SequencerState::default();
    let mut ui = UIState::default();
    let timer = Timer::new(pac.TIMER0, &mut pac.RESETS, &clocks);

    // Generate initial patterns
    for i in 0..4 {
        state = engine::randomize_track_pattern(&state, i, i as u32 * 12345);
    }

    loop {
        // 1. Read inputs (shift registers, encoder)
        if let Some(event) = input.poll() {
            ui = mode_machine::handle_event(&state, &ui, event);
        }

        // 2. Tick engine at clock rate
        if clock_tick_due(&timer, &state.transport) {
            let result = engine::tick(&state);
            state = result.next_state;

            // Output CV via DAC
            for event in result.events.iter().flatten() {
                dac.output_event(event);
            }

            // Output MIDI
            for event in result.events.iter().flatten() {
                midi.output_event(event);
            }
        }

        // 3. Render display (dirty-rect, not every loop)
        if display_needs_update(&ui) {
            renderer::render(&mut display, &state, &ui);
        }
    }
}
```

### 6.4 SPI DMA for Display

The RP2350 has DMA channels that can drive SPI transfers without CPU involvement:

```rust
use rp235x_hal::dma::{DMAExt, SingleChannel};

// After rendering to a scanline buffer:
let scanline: [u16; 480] = render_scanline(...);

// Start DMA transfer — CPU is free to compute next scanline
dma_channel.write_to_spi(&spi, &scanline);

// While DMA transfers, compute next scanline on CPU
let next_scanline = render_scanline(...);

// Wait for DMA to finish, then swap
dma_channel.wait();
```

This **double-buffered scanline** approach maximizes throughput:
- SPI pushes pixels at 62.5 MHz while CPU renders the next line
- At 480 pixels × 2 bytes × 62.5 MHz SPI = 65 μs per scanline
- 320 scanlines × 65 μs = 20.8 ms per full frame = **~48 FPS** theoretical max
- With dirty-rect updates (typical 20-40% of screen), effective rate is **60+ FPS**

### 6.5 Dirty Rectangle Tracking

```rust
pub struct DirtyTracker {
    regions: heapless::Vec<Rectangle, 16>,  // max 16 dirty regions
}

impl DirtyTracker {
    pub fn mark_dirty(&mut self, rect: Rectangle) {
        // Merge overlapping regions
        self.regions.push(rect).ok();
        self.merge_overlapping();
    }

    pub fn take_regions(&mut self) -> heapless::Vec<Rectangle, 16> {
        core::mem::take(&mut self.regions)
    }
}
```

What triggers dirty regions:
- Playhead advance → dirty: step grid active column (2 columns: old + new)
- Encoder turn → dirty: parameter value area
- Track select → dirty: entire screen (rare)
- LFO preview → dirty: waveform area only

---

## 7. Cross-Platform UI Framework Alternatives

### 7.1 Slint

[Slint](https://slint.dev/) is a Rust UI framework that targets both desktop/web and embedded MCUs.

**Pros:**
- Declarative `.slint` markup language
- Targets WASM, native desktop, and bare-metal MCU
- Built-in software renderer for embedded (no GPU needed)
- Actively maintained, commercial backing

**Cons:**
- GPL license for open source (royalty-free commercial license available)
- Adds significant binary size (~200-400 KB on MCU)
- Learning curve for `.slint` markup
- Less control over pixel-level rendering
- May be over-engineered for our 480x320 sequencer UI

**Verdict:** Interesting but overkill. Our UI is simple enough that `embedded-graphics` + custom widgets gives us more control with less overhead.

### 7.2 egui

[egui](https://github.com/emilk/egui) is an immediate-mode GUI library.

**Pros:**
- Immediate mode — simple, no retained state
- Great WASM support (eframe)
- Active community

**Cons:**
- **No embedded MCU support** — requires GPU or software rasterizer with `std`
- High memory usage for embedded
- Not `no_std` compatible

**Verdict:** Not suitable for cross-platform web+embedded.

### 7.3 embedded-graphics (Our Choice)

**Pros:**
- `no_std` by design
- Widely used in embedded Rust
- Simple `DrawTarget` trait = easy to implement for any backend
- Bitmap fonts included (pixel-perfect for LCD)
- Zero allocation for primitive drawing
- Actively maintained, mature

**Cons:**
- No layout system (manual positioning)
- No animation framework
- Text rendering is bitmap-only (no TrueType)

**Verdict:** Best fit. Manual positioning matches our current Canvas 2D approach, and we're already doing pixel-level layout for hardware accuracy.

---

## 8. Build & CI Strategy

### 8.1 Multi-Target Build Script

```bash
#!/bin/bash
# build-all.sh

# Engine tests (host)
cargo test -p requencer-engine

# WASM build
wasm-pack build crates/web --target web --release

# Firmware build
cargo build --release -p requencer-firmware --target thumbv8m.main-none-eabihf

# Size check
arm-none-eabi-size target/thumbv8m.main-none-eabihf/release/requencer-firmware
```

### 8.2 CI Pipeline

```yaml
# GitHub Actions
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: wasm32-unknown-unknown, thumbv8m.main-none-eabihf
      - run: cargo test -p requencer-engine
      - run: cargo test -p requencer-renderer
      - run: cargo build -p requencer-web --target wasm32-unknown-unknown
      - run: cargo build -p requencer-firmware --target thumbv8m.main-none-eabihf --release
```

### 8.3 probe-rs for Flashing/Debugging

```bash
# Install
cargo install probe-rs-tools

# Flash and run
probe-rs run --chip RP2350 target/thumbv8m.main-none-eabihf/release/requencer-firmware

# Debug with RTT (Real-Time Transfer) logging
probe-rs attach --chip RP2350

# GDB debugging
probe-rs gdb --chip RP2350
```

probe-rs supports the RP2350 via its SWD debug interface (the 3-pin debug header on Pico 2). No need for OpenOCD.

---

## 9. Performance Expectations

### 9.1 Engine `tick()` Performance

| Platform | Clock | Expected tick() time | Ticks/sec needed |
|---|---|---|---|
| Browser (WASM) | ~2 GHz (JIT) | < 1 μs | 960 (at 200 BPM, 24 PPQN) |
| RP2350 (native) | 150 MHz | < 10 μs | 960 |

Our tick function does:
- 4 tracks × 4 subtracks = 16 step lookups (array index)
- 4 routing resolutions (addition/comparison)
- 4 LFO evaluations (sin/cos with FPU)
- 4 mutation checks (conditional, rare)

This is trivially fast on both platforms.

### 9.2 Rendering Performance

| Platform | Full screen (480x320) | Partial update (typical) |
|---|---|---|
| Browser (Canvas 2D) | ~5 ms | ~1-2 ms |
| RP2350 (SPI 62.5 MHz) | ~21 ms | ~4-8 ms |

The RP2350 can maintain 30+ FPS for full screen redraws and 60+ FPS for typical partial updates (playhead movement, parameter changes).

### 9.3 RP2350 Cortex-M33 vs C/C++

Rust on Cortex-M33 compiles to the same ARM instructions as C/C++. With `--release` and LTO:
- **Integer math**: identical performance to C
- **Float math**: uses hardware FPU (same as C with `-mfpu=fpv5-sp-d16`)
- **Memory**: no runtime overhead (no GC, no allocator for `no_std`)
- **Binary size**: comparable to C with `-Os` (~100-200 KB for our firmware)

---

## 10. Migration Strategy

### Phase 1: Engine Port
1. Port `types.ts` → `crates/engine/src/types.rs`
2. Port `rng.ts` → `rng.rs` (verify identical output with TS tests)
3. Port `clock-divider.ts` → `clock.rs`
4. Port `euclidean.ts`, `scales.ts` → direct translations
5. Port `randomizer.ts` → `randomizer.rs`
6. Port `lfo.ts` → `lfo.rs`
7. Port `sequencer.ts` → `sequencer.rs` (the big one)
8. Port `routing.ts`, `variation.ts`, `mutator.ts`, `arpeggiator.ts`
9. **Validate**: Run TS tests and Rust tests with identical seeds, verify identical output

### Phase 2: Renderer Port
1. Define color palette in RGB565
2. Port screen layouts (home, gate-edit, pitch-edit, etc.)
3. Implement `CanvasTarget` for browser
4. Validate visual output matches current Canvas 2D rendering

### Phase 3: WASM Integration
1. Wire up `wasm-bindgen` entry point
2. Connect to existing Tone.js audio (JS side)
3. Connect Web MIDI
4. Replace TS engine with WASM engine in the web app

### Phase 4: Firmware
1. Hardware bring-up: Pico 2 + ST7796 display + shift registers
2. Wire up `mipidsi` display driver
3. Implement input scanning (shift registers, encoder)
4. Implement DAC output (DAC8568 over SPI)
5. Implement UART MIDI
6. Main loop integration

---

## 11. Key Crates Reference

| Crate | Version | Purpose | no_std |
|---|---|---|---|
| `heapless` | 0.8 | Fixed-capacity collections | Yes |
| `embedded-graphics` | 0.8 | Drawing primitives, fonts | Yes |
| `embedded-graphics-core` | 0.4 | DrawTarget trait | Yes |
| `mipidsi` | 0.9 | MIPI display driver (ST7796, ILI9486, etc.) | Yes |
| `display-interface-spi` | 0.5 | SPI display interface adapter | Yes |
| `rp235x-hal` | 0.2 | RP2350 hardware abstraction | Yes |
| `cortex-m` | 0.7 | ARM Cortex-M low-level access | Yes |
| `cortex-m-rt` | 0.7 | Runtime/startup for Cortex-M | Yes |
| `wasm-bindgen` | 0.2 | Rust↔JS bindings for WASM | N/A (web only) |
| `web-sys` | 0.3 | Web API bindings | N/A (web only) |
| `wasm-pack` | (CLI) | Build tool for WASM packages | N/A |
| `probe-rs` | (CLI) | Flash/debug tool for MCUs | N/A |
| `defmt` | 0.3 | Efficient logging for embedded | Yes |
| `panic-halt` | 0.2 | Minimal panic handler | Yes |

---

## 12. Open Questions

1. **State ownership in tick()**: Should we return a new state (like TS) or mutate in place? Returning new state is cleaner but means copying ~10 KB per tick. At 960 ticks/sec on RP2350, that's ~9.6 MB/s of memcpy — well within bandwidth but worth benchmarking.

2. **Font choice**: `embedded-graphics` built-in fonts are adequate but limited. Should we use a custom bitmap font that matches the current web rendering more closely? Tools like `bdf-to-embedded-graphics` can convert any BDF font.

3. **WASM binary size**: With `wasm-opt -Oz`, expect ~100-200 KB for engine+renderer. Acceptable for web, but worth tracking.

4. **Dual-core usage on RP2350**: Core 0 runs engine + input scanning, Core 1 runs display rendering? Or single-core with interrupt-driven input? Need to prototype both.

5. **PSRAM**: The RP2350B variant supports external QSPI PSRAM (up to 16 MB). If we ever need more memory (e.g., sample playback, more tracks), this is an upgrade path without changing the MCU.

---

## References

- [embedded-graphics documentation](https://docs.rs/embedded-graphics/latest/embedded_graphics/)
- [mipidsi crate — ST7796 model](https://docs.rs/mipidsi/latest/mipidsi/models/struct.ST7796.html)
- [rp235x-hal on crates.io](https://crates.io/crates/rp235x-hal)
- [Rust on RP2350 — official Raspberry Pi announcement](https://www.raspberrypi.com/news/rust-on-rp2350/)
- [gb-rp2350 — Game Boy emulator using mipidsi + RP2350](https://github.com/Altaflux/gb-rp2350)
- [wasm-bindgen documentation](https://rustwasm.github.io/docs/wasm-bindgen/)
- [wgpu — cross-platform GPU library](https://wgpu.rs/)
- [heapless crate](https://docs.rs/heapless/latest/heapless/)
- [Nine Rules for Running Rust on the Web and Embedded](https://towardsdatascience.com/nine-rules-for-running-rust-on-the-web-and-on-embedded-94462ef249a2/)
- [Rust no_std Playbook](https://hackmd.io/@alxiong/rust-no-std)
- [Slint UI framework](https://slint.dev/)
- [probe-rs debugging tool](https://probe.rs/)
