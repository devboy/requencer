# Requencer

4-track eurorack-style sequencer. Rust engine + renderer targeting both browser (WASM) and RP2350 hardware. TypeScript web preview with Tone.js for audio.

## Architecture

### Rust crates (`crates/`)
- **engine** — `no_std` pure sequencer logic. Zero platform dependencies. All functions are pure: receive state, return new state.
- **renderer** — `no_std` display rendering via `embedded-graphics` DrawTarget abstraction.
- **web** — WASM browser target. Canvas2D DrawTarget + wasm-bindgen bindings.
- **firmware** — RP2350 embedded target. SPI display, DAC output, button/encoder input.

### TypeScript web preview (`web/`)
- **engine** (`web/src/engine/`) — Pure TypeScript engine (active, will be toggleable with Rust WASM engine for comparison).
- **I/O** (`web/src/io/`) — Connects engine to browser: Tone.js clock, audio output, Web MIDI.
- **UI** (`web/src/ui/`) — Canvas-based renderer (active, will be toggleable with Rust WASM renderer).

### Hardware (`hardware/`)
- **boards** (`hardware/boards/`) — Atopile multi-board PCB project (control board + main board).
- **faceplate** (`hardware/faceplate/`) — Atopile front panel PCB project.

## Commands

### Top-level (Makefile)
- `make test` — Run all tests (Rust + web)
- `make dev` — Start Vite dev server
- `make build` — Build WASM + web bundle
- `make lint` — Lint all code (clippy + biome)
- `make build-firmware` — Build RP2350 firmware
- `make flash` — Flash firmware to RP2350
- `make hw-build` — Build Atopile schematic
- `make hw-all` — Full hardware pipeline (build → footprints → faceplate → place → route → export)
- `make hw-export-layout` — Export panel layout JSON from placed PCB
- `make hw-fetch-pcb` — Fetch latest placed PCB from GitHub Actions

### Rust (from repo root)
- `cargo test` — Run Rust tests
- `cargo clippy --workspace` — Lint Rust code
- `cargo check` — Type-check Rust code

### Web (from `web/`)
- `npm run dev` — Start Vite dev server
- `npm test` — Run tests (vitest)
- `npm run test:watch` — Run tests in watch mode
- `npm run build` — Type-check and build

## Conventions

- **TDD:** Write failing test first, then implement.
- **Engine purity:** Engine modules (both Rust and TS) must have zero imports from DOM/audio/platform APIs.
- **Immutable state:** Engine functions return new state objects, never mutate.
- **no_std by default:** Rust crates use `#![cfg_attr(not(feature = "std"), no_std)]` — must compile for embedded.
- **Layout source of truth:** KiCad PCB → `hardware/boards/scripts/export_layout.py` → `web/src/panel-layout.json`. UI metadata lives in `hardware/boards/component-map.json`.
- **Docs:** Research goes in `docs/research/`, designs in `docs/plans/`.
- **No commits:** Do NOT make git commits. Work on features and let the user decide when to commit or roll back.
- **No co-authored-by:** Never add `Co-Authored-By` trailers to commit messages.

## Panel Design Rules

This is a **real-life hardware prototype**. The browser rendering must match physical eurorack constraints:

- **Component sizes dictate spacing.** PCB-mounted components (jacks, buttons, encoders) have physical footprints that determine minimum distances between them. Estimate realistic clearances.
- **Text fits in gaps between components.** Silkscreen labels go in the space between physical parts — never overlapping components, never pushing components apart. If text doesn't fit in a gap, use shorter text or omit it.
- **Use as little panel space as possible.** Every mm of HP counts. Don't waste space on decorative padding or oversized labels.
- **Match neighbor modules.** Dimension constants (jacks, buttons, encoder, text) are measured from the Metropolix neighbor image displayed at the same browser scale. When in doubt, visually compare against the Metropolix to the right.
- **Rail zones are for silkscreen only.** The 10mm top/bottom buffer is where rack rails cover the panel. Physical components must stay outside this zone, but printed text/graphics can extend into it.

## Project Structure

```
crates/
  engine/            # Rust: no_std sequencer logic
  renderer/          # Rust: no_std display rendering (embedded-graphics)
  web/               # Rust: WASM browser target
  firmware/          # Rust: RP2350 embedded target
web/
  src/
    engine/          # TS: Pure sequencer logic (zero deps)
      __tests__/     # Engine tests
    io/              # TS: Tone.js clock, audio output, MIDI
    ui/              # TS: Canvas rendering
    main.ts          # Entry point
hardware/
  boards/            # Atopile: Multi-board PCB project
    ato.yaml           # Build config (control + main + system entries)
    component-map.json # UI metadata keyed by atopile address (source of truth for dims)
    elec/
      src/             # Atopile source (.ato files)
      layout/
        control/       # KiCad output for control board
        main/          # KiCad output for main board
    scripts/
      export_layout.py     # KiCad PCB → web/src/panel-layout.json exporter
      place_components.py  # Component placement (--board control|main)
      gen_validation.py    # Generate system.ato validation build
      preflight_check.py   # Fast pre-build validation
  faceplate/         # Atopile: Front panel PCB
  docker/            # Docker image for hardware build tools
web/
  src/
    panel-layout.json # Generated layout (positions from PCB + metadata from component-map)
docs/
  plans/             # Design documents
  research/          # Research notes
Makefile             # Top-level build orchestration
```
