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
- `make rust` — Test + lint + build firmware
- `make web` — Test + lint + build (WASM + bundle)
- `make hardware` — Full hardware pipeline (delegates to `hardware/Makefile`)
- `make dev` — Start Vite dev server
- `make test` — Run all tests (Rust + web + hardware)
- `make lint` — Lint all code (clippy + biome)
- `make flash` — Flash firmware to RP2350

## Conventions

- **TDD:** Write failing test first, then implement.
- **Engine purity:** Engine modules (both Rust and TS) must have zero imports from DOM/audio/platform APIs.
- **Immutable state:** Engine functions return new state objects, never mutate.
- **no_std by default:** Rust crates use `#![cfg_attr(not(feature = "std"), no_std)]` — must compile for embedded.
- **Layout source of truth:** KiCad PCB → `hardware/boards/scripts/export_layout.py` → `web/src/panel-layout.json`. UI metadata lives in `hardware/boards/component-map.json`.
- **Docs:** Research goes in `docs/research/`, designs in `docs/plans/`.
- **No commits:** Do NOT make git commits. Work on features and let the user decide when to commit or roll back.
- **No co-authored-by:** Never add `Co-Authored-By` trailers to commit messages.
- **No DRC workarounds:** Never add expected errors or warnings to `board-config.json`. DRC failures indicate real issues that need to be fixed in the design, not suppressed.

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
  Makefile             # Hardware pipeline with file-based dependencies
  boards/              # Atopile: Multi-board PCB project
    ato.yaml             # Build config (control + main + system entries)
    board-config.json    # Per-board placement/routing settings
    component-map.json   # UI metadata keyed by atopile address (source of truth for dims)
    design-rules.json    # Netclasses, clearances, net assignments
    elec/
      src/               # Atopile source (.ato files)
        components/      # Custom part definitions (symbols, footprints, 3D, docs)
        circuits/        # Reusable circuit modules (board-connector, dac-output, etc.)
        boards/          # Top-level board modules (control, main)
        parts/           # Auto-generated passives (atopile stdlib)
        system.ato       # Auto-generated cross-board validation
      layout/
        control/         # KiCad output for control board
        main/            # KiCad output for main board
    scripts/
      common/            # Shared: design_rules.py, kicad_env.py
      build/             # gen_validation.py, generate_footprints.py, preflight_check.py
      placement/         # place_components.py, export_layout.py
      routing/           # autoroute.py, import_ses.py, add_ground_pours.py
      export/            # export_manufacturing.py, export_3d_assembly.py, export_gltf.py
      models/            # KiCad 3D models: generate_3d_models.py, add_3d_models.py
  faceplate/           # Atopile: Front panel PCB
web/
  src/
    panel-layout.json # Generated layout (positions from PCB + metadata from component-map)
docs/
  plans/             # Design documents
  research/          # Research notes
Makefile             # Top-level build orchestration
```
