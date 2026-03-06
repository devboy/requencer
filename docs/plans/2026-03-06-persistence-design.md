# Persistence via Postcard Serialization

## Goal

Persist sequencer state and pattern/preset library across browser sessions via WASM + localStorage. Rust owns all serialization (postcard, no_std). TS handles storage I/O only. Firmware gets serialization for free (future: write same bytes to SD/flash).

## Architecture

```
Rust engine (postcard serialize/deserialize)
    | Vec<u8> blobs
WASM bindings (export/import methods)
    | Uint8Array
TS glue (localStorage read/write, base64 encode)
    | strings
localStorage: requencer:state, requencer:library
```

## Two Storage Keys

- `requencer:state` — full SequencerState (tracks, routing, mutes, configs, transport settings)
- `requencer:library` — saved patterns + user presets (separate for firmware path: different files/folders on SD)

## Rust Engine Changes

### Dependencies (`crates/engine/Cargo.toml`)

- `serde = { version = "1", default-features = false, features = ["derive"] }`
- `postcard = { version = "1", default-features = false, features = ["alloc"] }`

### Derive macros

Add `#[derive(Serialize, Deserialize)]` to all types in the serialization graph:
- `SequencerState`, `SequenceTrack`, `SubTrack`, `Step`
- `OutputRouting`, `MuteTrack`, `Transport`, `ClockSource`
- `RandomConfig`, `TransposeConfig`, `LfoConfig`, `ArpConfig`, `MutateConfig`
- `MidiOutputConfig`, `VariationPattern`
- `SavedPattern`, `UserPreset`, `TrackSlotData`, `LayerFlags`
- All enums: `Scale`, `RandShape`, `LfoShape`, `ArpMode`, etc.

### New module: `crates/engine/src/storage.rs`

```rust
pub fn serialize_state(state: &SequencerState) -> Result<Vec<u8>, postcard::Error>
pub fn deserialize_state(data: &[u8]) -> Result<SequencerState, postcard::Error>
pub fn serialize_library(patterns: &[SavedPattern], presets: &[UserPreset]) -> Result<Vec<u8>, postcard::Error>
pub fn deserialize_library(data: &[u8]) -> Result<(Vec<SavedPattern, MAX_SAVED>, Vec<UserPreset, MAX_SAVED>), postcard::Error>
```

Library serialization wraps both collections in a `Library` struct for versioning.

## WASM Bindings (`crates/web/src/lib.rs`)

```rust
pub fn export_state(&self) -> Vec<u8>
pub fn import_state(&mut self, data: &[u8]) -> bool
pub fn export_library(&self) -> Vec<u8>
pub fn import_library(&mut self, data: &[u8]) -> bool
```

Returns `bool` for success/failure (deserialization errors = false, start fresh).

## TS Glue (`web/src/io/persistence.ts`)

Rewrite existing file:
- `saveState(bytes: Uint8Array): void` — base64 encode, write to `requencer:state`
- `loadState(): Uint8Array | null` — read + base64 decode
- `saveLibrary(bytes: Uint8Array): void` — same for `requencer:library`
- `loadLibrary(): Uint8Array | null`

## TS Integration (`web/src/main.ts`)

### On startup (after initWasm)
1. Load state bytes from localStorage
2. If exists, call `import_state(bytes)`
3. Load library bytes from localStorage
4. If exists, call `import_library(bytes)`

### Auto-save trigger
- Track screen mode in render loop
- When mode transitions to Home: call `export_state()` + `export_library()`, write to localStorage

## What's NOT persisted

- `transport.playing` — always starts stopped
- `transport.master_tick` — reset to 0
- `lfo_runtimes` — reset on load
- Playhead positions (`current_step`) — reset on load

## Firmware (future, not this PR)

Same `serialize_state`/`deserialize_state` from engine crate. Firmware writes bytes to SD card or flash. No changes needed in engine serialization — just different I/O backend.
