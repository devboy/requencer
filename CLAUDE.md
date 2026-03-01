# Requencer

4-track eurorack-style sequencer prototype. Browser-based with Tone.js for audio preview.

## Architecture

Three layers:
- **Engine** (`src/engine/`) — Pure TypeScript, ZERO dependencies. No DOM, no audio, no Tone.js imports. Designed for future Rust port. All functions are pure: receive state, return new state.
- **I/O** (`src/io/`) — Connects engine to the outside world: Tone.js clock → engine ticks, engine events → Tone.js synths / Web MIDI.
- **UI** (`src/ui/`) — Canvas-based renderer. Reads engine state, forwards user actions.

## Commands

- `npm run dev` — Start Vite dev server
- `npm test` — Run tests (vitest)
- `npm run test:watch` — Run tests in watch mode
- `npm run build` — Type-check and build

## Conventions

- **TDD:** Write failing test first, then implement.
- **Engine purity:** Engine modules must have zero imports from DOM/audio/external libs.
- **Immutable state:** Engine functions return new state objects, never mutate.
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
src/
  engine/          # Pure sequencer logic (zero deps)
    __tests__/     # Engine tests
    types.ts       # Core data types
  io/              # Tone.js clock, audio output, MIDI
  ui/              # Canvas rendering
  main.ts          # Entry point, wires everything together
docs/
  plans/           # Design documents
  research/        # Research notes
```
