# Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist sequencer state and pattern/preset library across browser sessions using postcard serialization in Rust, exposed via WASM, stored in localStorage by TS.

**Architecture:** Rust engine serializes `SequencerState` and library (patterns + presets) to compact binary via postcard. WASM exposes export/import methods returning `Vec<u8>`. TS stores raw bytes as base64 in localStorage. Two keys: `requencer:state` (full session) and `requencer:library` (patterns + presets). Auto-save triggers on navigation to home screen.

**Tech Stack:** Rust (serde + postcard, no_std), wasm-bindgen, TypeScript (localStorage, base64)

---

### Task 1: Add serde + postcard dependencies

**Files:**
- Modify: `Cargo.toml` (workspace)
- Modify: `crates/engine/Cargo.toml`

**Step 1: Add workspace deps**

In `Cargo.toml` (workspace root), add to `[workspace.dependencies]`:

```toml
serde = { version = "1", default-features = false, features = ["derive"] }
postcard = { version = "1", default-features = false, features = ["alloc"] }
```

**Step 2: Add engine deps**

In `crates/engine/Cargo.toml`, add to `[dependencies]`:

```toml
serde = { workspace = true }
postcard = { workspace = true }
```

**Step 3: Verify it compiles**

Run: `cargo check --workspace`
Expected: compiles successfully

---

### Task 2: Custom serde for Scale type

**Files:**
- Modify: `crates/engine/src/scales.rs`

The `Scale` struct has `&'static str` and `&'static [u8]` fields that can't round-trip through serde. Serialize as a scale index (u8) into `Scales::ALL`.

**Step 1: Write test for scale serialization round-trip**

Add to the existing `#[cfg(test)] mod tests` in `scales.rs`:

```rust
#[test]
fn scale_serde_round_trip() {
    use postcard::{from_bytes, to_allocvec};
    for (i, scale) in Scales::ALL.iter().enumerate() {
        let bytes = to_allocvec(scale).unwrap();
        let restored: Scale = from_bytes(&bytes).unwrap();
        assert_eq!(restored.name, Scales::ALL[i].name);
        assert_eq!(restored.intervals, Scales::ALL[i].intervals);
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cargo test -p requencer-engine scales::tests::scale_serde_round_trip`
Expected: FAIL — Scale doesn't implement Serialize/Deserialize

**Step 3: Implement custom serde for Scale**

Add to `scales.rs`, above the `Scale` struct:

```rust
use serde::{Serialize, Deserialize, Serializer, Deserializer};
```

Replace the `Scale` struct definition with:

```rust
#[derive(Clone, Debug, PartialEq)]
pub struct Scale {
    pub name: &'static str,
    pub intervals: &'static [u8],
}

impl Serialize for Scale {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let index = Scales::ALL
            .iter()
            .position(|s| core::ptr::eq(s.intervals, self.intervals))
            .unwrap_or(0) as u8;
        serializer.serialize_u8(index)
    }
}

impl<'de> Deserialize<'de> for Scale {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let index = u8::deserialize(deserializer)? as usize;
        if index < Scales::ALL.len() {
            Ok(Scales::ALL[index].clone())
        } else {
            Ok(Scales::CHROMATIC.clone())
        }
    }
}
```

**Step 4: Run test to verify it passes**

Run: `cargo test -p requencer-engine scales::tests::scale_serde_round_trip`
Expected: PASS

---

### Task 3: Add serde derives to all engine types

**Files:**
- Modify: `crates/engine/src/types.rs`

Add `Serialize, Deserialize` to every `#[derive(...)]` in `types.rs`. Every struct and enum in the serialization graph needs it.

**Step 1: Add serde import**

At the top of `types.rs`, add:

```rust
use serde::{Serialize, Deserialize};
```

**Step 2: Add derives to all types**

Add `Serialize, Deserialize` to the derive macro of every type:

- `GateStep` (line 8)
- `PitchStep` (line 27)
- `ModStep` (line 42)
- `Subtrack<T>` (line 59) — needs bound: `#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]` and add `#[serde(bound = "T: Serialize + serde::de::DeserializeOwned")]` attribute
- `PitchMode` (line 84)
- `PitchArpDirection` (line 93)
- `GateAlgo` (line 101)
- `VelocityMode` (line 109)
- `ModMode` (line 119)
- `ArpDirection` (line 130)
- `LfoWaveform` (line 138)
- `LfoSyncMode` (line 148)
- `ClockSource` (line 154)
- `MutateTrigger` (line 161)
- `ModSource` (line 167)
- `SequenceTrack` (line 175)
- `PitchConfig` (line 218)
- `GateConfig` (line 229)
- `VelocityConfig` (line 238)
- `GateLengthConfig` (line 245)
- `RatchetConfig` (line 251)
- `SlideConfig` (line 257)
- `ModGenConfig` (line 262)
- `TieConfig` (line 273)
- `RandomConfig` (line 279)
- `OutputRouting` (line 344)
- `MuteTrack` (line 367)
- `NoteEvent` (line 392)
- `Transport` (line 409)
- `LfoConfig` (line 430)
- `LfoRuntime` (line 457)
- `TransposeConfig` (line 478)
- `ArpConfig` (line 501)
- `MutateConfig` (line 520)
- `MidiOutputConfig` (line 545)
- `TransformType` (line 558)
- `Transform` (line 609)
- `VariationSlot` (line 621)
- `SubtrackKey` (line 634)
- `OverridePattern` (line 643)
- `SubtrackOverride` (line 668)
- `VariationPattern` (line 675)
- `TrackSlotData` (line 710)
- `LayerFlags` (line 721)
- `SavedPattern` (line 746)
- `UserPreset` (line 755)
- `SequencerState` (line 766)

**Step 3: Write round-trip test**

Add to the existing `#[cfg(test)] mod tests` in `types.rs`:

```rust
#[test]
fn sequencer_state_serde_round_trip() {
    let state = SequencerState::new();
    let bytes = postcard::to_allocvec(&state).unwrap();
    let restored: SequencerState = postcard::from_bytes(&bytes).unwrap();
    assert_eq!(state, restored);
}
```

**Step 4: Run tests**

Run: `cargo test -p requencer-engine types::tests::sequencer_state_serde_round_trip`
Expected: PASS

Run: `cargo test -p requencer-engine`
Expected: All existing tests still pass

---

### Task 4: Create storage module

**Files:**
- Create: `crates/engine/src/storage.rs`
- Modify: `crates/engine/src/lib.rs`

**Step 1: Write tests first**

Create `crates/engine/src/storage.rs`:

```rust
//! Serialization for persistence — state and library (patterns + presets).

extern crate alloc;
use alloc::vec::Vec;

use crate::types::{SavedPattern, SequencerState, UserPreset, MAX_SAVED};

/// Serialize full sequencer state to bytes.
pub fn serialize_state(state: &SequencerState) -> Result<Vec<u8>, postcard::Error> {
    postcard::to_allocvec(state)
}

/// Deserialize sequencer state from bytes.
pub fn deserialize_state(data: &[u8]) -> Result<SequencerState, postcard::Error> {
    postcard::from_bytes(data)
}

/// Library container for patterns + presets.
#[derive(serde::Serialize, serde::Deserialize)]
struct Library {
    patterns: heapless::Vec<SavedPattern, MAX_SAVED>,
    presets: heapless::Vec<UserPreset, MAX_SAVED>,
}

/// Serialize saved patterns and user presets to bytes.
pub fn serialize_library(
    patterns: &heapless::Vec<SavedPattern, MAX_SAVED>,
    presets: &heapless::Vec<UserPreset, MAX_SAVED>,
) -> Result<Vec<u8>, postcard::Error> {
    let lib = Library {
        patterns: patterns.clone(),
        presets: presets.clone(),
    };
    postcard::to_allocvec(&lib)
}

/// Deserialize patterns and presets from bytes.
pub fn deserialize_library(
    data: &[u8],
) -> Result<
    (
        heapless::Vec<SavedPattern, MAX_SAVED>,
        heapless::Vec<UserPreset, MAX_SAVED>,
    ),
    postcard::Error,
> {
    let lib: Library = postcard::from_bytes(data)?;
    Ok((lib.patterns, lib.presets))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_round_trip() {
        let state = SequencerState::new();
        let bytes = serialize_state(&state).unwrap();
        let restored = deserialize_state(&bytes).unwrap();
        assert_eq!(state, restored);
    }

    #[test]
    fn library_round_trip_empty() {
        let patterns = heapless::Vec::new();
        let presets = heapless::Vec::new();
        let bytes = serialize_library(&patterns, &presets).unwrap();
        let (p, u) = deserialize_library(&bytes).unwrap();
        assert!(p.is_empty());
        assert!(u.is_empty());
    }

    #[test]
    fn library_round_trip_with_data() {
        let mut patterns: heapless::Vec<SavedPattern, MAX_SAVED> = heapless::Vec::new();
        let state = SequencerState::new();
        let pattern = crate::patterns::create_saved_pattern(&state, 0, "Test");
        let _ = patterns.push(pattern);

        let mut presets: heapless::Vec<UserPreset, MAX_SAVED> = heapless::Vec::new();
        let _ = presets.push(UserPreset {
            name: {
                let mut n = heapless::String::new();
                let _ = core::fmt::Write::write_str(&mut n, "My Preset");
                n
            },
            config: crate::types::RandomConfig::default(),
        });

        let bytes = serialize_library(&patterns, &presets).unwrap();
        let (p, u) = deserialize_library(&bytes).unwrap();
        assert_eq!(p.len(), 1);
        assert_eq!(u.len(), 1);
        assert_eq!(p[0].name.as_str(), "Test");
        assert_eq!(u[0].name.as_str(), "My Preset");
    }

    #[test]
    fn deserialize_invalid_data_returns_error() {
        let result = deserialize_state(&[0xFF, 0xFF, 0xFF]);
        assert!(result.is_err());
    }
}
```

**Step 2: Register module**

In `crates/engine/src/lib.rs`, add:

```rust
pub mod storage;
```

**Step 3: Run tests**

Run: `cargo test -p requencer-engine storage`
Expected: All 4 tests pass

---

### Task 5: Add WASM export/import bindings

**Files:**
- Modify: `crates/web/src/lib.rs`

**Step 1: Add export/import methods to WasmSequencer**

Add these methods inside the existing `#[wasm_bindgen] impl WasmSequencer` block:

```rust
/// Export full sequencer state as serialized bytes.
pub fn export_state(&self) -> Vec<u8> {
    requencer_engine::storage::serialize_state(&self.state).unwrap_or_default()
}

/// Import sequencer state from serialized bytes. Returns true on success.
pub fn import_state(&mut self, data: &[u8]) -> bool {
    match requencer_engine::storage::deserialize_state(data) {
        Ok(mut state) => {
            // Reset ephemeral state
            state.transport.playing = false;
            state.transport.master_tick = 0;
            state.lfo_runtimes = core::array::from_fn(|_| {
                requencer_engine::types::LfoRuntime::default()
            });
            state.reset_playheads();
            self.state = state;
            true
        }
        Err(_) => false,
    }
}

/// Export saved patterns and user presets as serialized bytes.
pub fn export_library(&self) -> Vec<u8> {
    requencer_engine::storage::serialize_library(
        &self.state.saved_patterns,
        &self.state.user_presets,
    )
    .unwrap_or_default()
}

/// Import saved patterns and user presets from serialized bytes. Returns true on success.
pub fn import_library(&mut self, data: &[u8]) -> bool {
    match requencer_engine::storage::deserialize_library(data) {
        Ok((patterns, presets)) => {
            self.state.saved_patterns = patterns;
            self.state.user_presets = presets;
            true
        }
        Err(_) => false,
    }
}
```

**Step 2: Verify it compiles**

Run: `cargo check -p requencer-web`
Expected: compiles successfully

---

### Task 6: Rewrite TS persistence module

**Files:**
- Modify: `web/src/io/persistence.ts`

**Step 1: Rewrite persistence.ts**

Replace the entire file with:

```typescript
/**
 * Persistence — stores opaque byte blobs from Rust serialization in localStorage.
 * Rust owns all serialization (postcard). TS just stores/retrieves raw bytes.
 */

const STATE_KEY = 'requencer:state'
const LIBRARY_KEY = 'requencer:library'

/** Encode bytes to base64 string for localStorage. */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/** Decode base64 string from localStorage to bytes. */
function fromBase64(str: string): Uint8Array {
  const binary = atob(str)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function saveState(bytes: Uint8Array): void {
  try {
    localStorage.setItem(STATE_KEY, toBase64(bytes))
  } catch {
    // localStorage full or unavailable
  }
}

export function loadState(): Uint8Array | null {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (!raw) return null
    return fromBase64(raw)
  } catch {
    return null
  }
}

export function saveLibrary(bytes: Uint8Array): void {
  try {
    localStorage.setItem(LIBRARY_KEY, toBase64(bytes))
  } catch {
    // localStorage full or unavailable
  }
}

export function loadLibrary(): Uint8Array | null {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY)
    if (!raw) return null
    return fromBase64(raw)
  } catch {
    return null
  }
}
```

**Step 2: Verify types compile**

Run: `cd web && npx tsc --noEmit`
Expected: no errors

---

### Task 7: Add WASM adapter functions

**Files:**
- Modify: `web/src/engine/wasm-adapter.ts`

**Step 1: Add export/import wrappers**

Add these functions at the end of `wasm-adapter.ts`:

```typescript
/** Export full sequencer state as serialized bytes. */
export function exportWasmState(): Uint8Array {
  if (!wasmSeq) return new Uint8Array(0)
  return wasmSeq.export_state()
}

/** Import sequencer state from serialized bytes. Returns true on success. */
export function importWasmState(data: Uint8Array): boolean {
  if (!wasmSeq) return false
  return wasmSeq.import_state(data)
}

/** Export saved patterns and user presets as serialized bytes. */
export function exportWasmLibrary(): Uint8Array {
  if (!wasmSeq) return new Uint8Array(0)
  return wasmSeq.export_library()
}

/** Import saved patterns and user presets from serialized bytes. Returns true on success. */
export function importWasmLibrary(data: Uint8Array): boolean {
  if (!wasmSeq) return false
  return wasmSeq.import_library(data)
}
```

**Step 2: Verify types compile**

Run: `cd web && npx tsc --noEmit`
Expected: no errors

---

### Task 8: Wire persistence into main.ts

**Files:**
- Modify: `web/src/main.ts`

**Step 1: Add imports**

Add to the imports in `main.ts`:

```typescript
import { loadLibrary, loadState, saveLibrary, saveState } from './io/persistence'
import {
  exportWasmLibrary,
  exportWasmState,
  importWasmLibrary,
  importWasmState,
} from './engine/wasm-adapter'
```

(Merge the wasm-adapter imports into the existing import block.)

**Step 2: Load state on startup**

In the `initWasm().then(...)` callback, after the success check, add:

```typescript
initWasm().then((ok) => {
  if (!ok) {
    console.error('[WASM] Failed to initialize — sequencer will not work')
    return
  }
  // Restore persisted state
  const stateBytes = loadState()
  if (stateBytes) {
    if (importWasmState(stateBytes)) {
      console.log('[Persistence] State restored')
    }
  }
  const libBytes = loadLibrary()
  if (libBytes) {
    if (importWasmLibrary(libBytes)) {
      console.log('[Persistence] Library restored')
    }
  }
})
```

**Step 3: Auto-save on navigation to home**

Add a variable to track previous screen mode, and save logic in the render loop. Add near the top of the file (after transport declaration):

```typescript
let prevScreenMode = 0
```

In the `render()` function, after `const modeIndex = getWasmScreenMode()`, add:

```typescript
  // Auto-save when navigating to home screen
  if (modeIndex === 0 && prevScreenMode !== 0) {
    const stateBytes = exportWasmState()
    if (stateBytes.length > 0) saveState(stateBytes)
    const libBytes = exportWasmLibrary()
    if (libBytes.length > 0) saveLibrary(libBytes)
    console.log('[Persistence] Auto-saved (returned to home)')
  }
  prevScreenMode = modeIndex
```

**Step 4: Verify types compile**

Run: `cd web && npx tsc --noEmit`
Expected: no errors

---

### Task 9: Clean up unused TS types

**Files:**
- Modify: `web/src/engine/types.ts`

Remove `SavedPattern`, `UserPreset`, `TrackSlotData`, `LayerFlags`, `RandomConfig`, and all their sub-types from `types.ts` since persistence is now fully handled in Rust. Only keep types still used by I/O glue: `NoteEvent`, `ClockSource`, `MIDIOutputConfig`.

Check all remaining imports of these types across `web/src/` before deleting — if nothing imports them, remove them.

Run: `cd web && npx tsc --noEmit`
Expected: no errors

---

### Task 10: Full build and verify

**Step 1: Rust tests**

Run: `cargo test --workspace`
Expected: All tests pass (including new storage tests)

**Step 2: Clippy**

Run: `cargo clippy --workspace`
Expected: Zero warnings

**Step 3: TypeScript check**

Run: `cd web && npx tsc --noEmit`
Expected: Zero errors

**Step 4: Full WASM + web build**

Run: `make build`
Expected: Builds successfully

---

## Verification

1. `cargo test --workspace` — all tests pass including storage round-trips
2. `cargo clippy --workspace` — zero warnings
3. `cd web && npx tsc --noEmit` — zero type errors
4. `make build` — full WASM + web build succeeds
5. Browser test: edit tracks, navigate to home, refresh — state persists
6. Browser test: save a pattern, refresh — pattern still in list
7. Browser test: clear localStorage, refresh — starts fresh with defaults
