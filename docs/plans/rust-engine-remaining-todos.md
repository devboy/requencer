# Rust Engine — Remaining TODOs

All 5 phases of the Rust engine port are complete (126 tests passing).
This doc tracks remaining work before the engine is production-ready.

## Storage (Stubbed)

Pattern save/restore (`patterns.rs`) works in-memory but has no persistence layer.

- [ ] Flash storage backend for RP2350 (external SPI flash or MCU flash sectors)
- [ ] `serde` serialization for `TrackSlotData`, `SavedPattern`, `UserPreset`
- [ ] WASM: IndexedDB or localStorage adapter
- [ ] Consider `postcard` crate for compact no_std-friendly binary serialization

## Cross-Language Validation

- [ ] Extract test vectors from TS tests (seed → expected output) and verify exact match in Rust
  - RNG: seed 42 → first 10 values
  - Euclidean: E(3,8), E(5,13)
  - Randomizer: specific gate/pitch patterns with known seeds
  - LFO waveforms at key phase points
- [ ] Add integration test that runs both TS and Rust engines and diff outputs

## WASM Bindings

- [ ] `wasm-bindgen` wrapper for `SequencerState` and `tick()`
- [ ] JS API to toggle between TS engine and Rust/WASM engine
- [ ] Benchmark: tick latency comparison TS vs WASM

## Firmware Integration

- [ ] RP2350 HAL integration (GPIO, DAC, MIDI UART)
- [ ] Continuous CV output processor (see `docs/research/continuous-cv-outputs.md`)
  - Render loop at ~4kHz for smooth LFO, pitch slides, mod slew
  - `CvOutput` struct interpolating between tick-based NoteEvents
- [ ] DMA-driven DAC output
- [ ] Hardware clock input (external sync)

## Engine Refinements

- [ ] Default random configs per track (T1=Bassline, T2=Acid, T3=Hypnotic, T4=Stab) — currently `SequencerState::new()` uses generic defaults; could use presets
- [ ] Page-scoped clear functions (clearGateStepsOnPage, etc.) — not yet ported
- [ ] Mute length/divider setters — partially covered via direct field access
- [ ] User preset save/delete — in-memory only, needs persistence

## Build / CI

- [ ] `make test` target that runs both `cargo test` and `npm test`
- [ ] CI: `cargo check --no-default-features` to catch accidental std usage
- [ ] CI: `cargo clippy -- -D warnings` as gate
