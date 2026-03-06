# RP2350 Memory Constraints

## Hardware Limits

- **SRAM**: 520 KB total (stack + heap + static data)
- **Flash**: 2-16 MB (program code + read-only data, depends on board)
- **Stack**: Typically 8-64 KB depending on executor config (embassy/RTIC)
- **No virtual memory, no swap, no dynamic growth**

## Current Struct Sizes

| Type | Size | Notes |
|------|------|-------|
| `SequencerState` | **244 KB** | Too large to duplicate on stack |
| `Vec<SavedPattern, 32>` | 212 KB | 32 × 6.6 KB — dominates state size |
| `Vec<UserPreset, 32>` | 5 KB | Fine |
| `SavedPattern` | 6.6 KB | Contains full `TrackSlotData` |
| `TrackSlotData` | 6.6 KB | Dominated by `VariationPattern` (5.8 KB) |
| `VariationPattern` | 5.8 KB | Nested `heapless::Vec<VariationSlot, 16>` × 5 |
| `SequenceTrack` | 552 bytes | Fine |
| `RandomConfig` | 120 bytes | Fine |

### Where the bytes go

```
SequencerState (244 KB)
├── saved_patterns: Vec<SavedPattern, 32>  → 212 KB  (87%)
├── user_presets: Vec<UserPreset, 32>      →   5 KB  ( 2%)
├── variation_patterns: [VariationPattern; 4] → 23 KB ( 9%)
├── tracks: [SequenceTrack; 4]             →   2 KB  ( 1%)
└── everything else                        →   2 KB  ( 1%)
```

**The problem is `saved_patterns`.** 32 full track snapshots in RAM at all times.

## What Works on WASM (web)

- Full `SequencerState` lives in WASM linear memory (grows as needed)
- Postcard serialization needs ~4 MB WASM stack (set via `.cargo/config.toml`)
- localStorage can hold the full serialized state easily
- No constraints — just works

## What Will NOT Work on RP2350

1. **Holding 32 SavedPatterns in RAM** — 212 KB leaves only 308 KB for everything else (stack, heap, framebuffer, program state). The ST7796 480×320 framebuffer alone is ~614 KB at 32bpp (must use partial rendering or 16bpp = 307 KB).

2. **Deserializing SequencerState on the stack** — postcard creates temporaries during deserialization. A single `SequencerState` copy on stack = 244 KB = instant stack overflow with typical 8-64 KB stacks.

3. **Serializing all patterns at once** — even to SD card, building the full serialized blob requires the data in memory.

## Recommended Firmware Architecture

### Separate storage from working state

```rust
// What lives in RAM (firmware)
struct FirmwareState {
    // Working state — always in RAM (~26 KB without saved_patterns/user_presets)
    tracks: [SequenceTrack; 4],
    routing: [OutputRouting; 4],
    mute_patterns: [MuteTrack; 4],
    transport: Transport,
    random_configs: [RandomConfig; 4],
    // ... all the per-track configs ...

    // Pattern/preset HEADERS only — names + metadata, not full data
    pattern_index: Vec<PatternHeader, 32>,  // ~1 KB (just names + source track)
    preset_index: Vec<PresetHeader, 32>,    // ~1 KB (just names)
}

struct PatternHeader {
    name: String<32>,
    source_track: u8,
    // Full TrackSlotData lives on SD card: /patterns/00.bin, /patterns/01.bin, etc.
}
```

### Storage layout on SD card

```
/requencer/
  state.bin          # Working state (~26 KB, no patterns/presets)
  patterns/
    00.bin            # Individual SavedPattern (~6.6 KB each)
    01.bin
    ...
  presets/
    00.bin            # Individual UserPreset (~160 bytes each)
    01.bin
    ...
```

### Load/save individual patterns

```rust
// Load ONE pattern from SD when user selects it for restore
fn load_pattern(slot: u8, buf: &mut TrackSlotData) -> Result<(), Error> {
    // Read /patterns/{slot:02}.bin into buf (6.6 KB — fits on stack or in a static buffer)
}

// Save ONE pattern to SD when user saves
fn save_pattern(slot: u8, data: &TrackSlotData) -> Result<(), Error> {
    // Write to /patterns/{slot:02}.bin
}
```

### Key rules for firmware

1. **Never hold all 32 patterns in RAM** — load one at a time from SD
2. **Never duplicate SequencerState on the stack** — deserialize in-place or use a static buffer
3. **Use streaming serialization if possible** — postcard supports `serialize_with_flavor` for writing directly to an I/O sink
4. **Display rendering must be partial** — can't hold full 480×320 RGBA framebuffer (614 KB). Use 16bpp Rgb565 (307 KB) or tile-based rendering
5. **Profile stack usage** — use `probe-rs` stack painting or `defmt` to monitor high-water mark

## Preferred Board: Pimoroni Pico Plus 2 (RP2350 + 8MB PSRAM)

The Pimoroni Pico Plus 2 uses the **same Pico footprint** (drop-in replacement) but adds 8 MB QSPI PSRAM. This changes the memory picture dramatically.

### Memory map with PSRAM

| Region | Size | Contents |
|--------|------|----------|
| Internal SRAM | 520 KB | Stack, heap, DMA buffers, hot data |
| PSRAM | 8 MB | `SequencerState` (244 KB), framebuffer (307 KB), patterns |
| Flash | 16 MB | Program code, read-only data |

With PSRAM, the full `SequencerState` including all 32 saved patterns fits comfortably. No need for the slim `FirmwareState` / SD-card-per-pattern architecture described above (though SD card is still useful for import/export/backup).

### PSRAM performance

- **Bus**: QSPI at up to ~150 MHz, accessed through XIP cache
- **Cached sequential access**: fast enough for 30-60 fps rendering
- **Random access**: cache-miss latency ~100-200 ns (fine for state access, not for tight inner loops)
- **DMA cannot access PSRAM** — this is the key constraint

### Framebuffer strategy with PSRAM

The Rgb565 framebuffer (480×320×2 = **307 KB**) lives in PSRAM. Since DMA can't read from PSRAM directly, use scanline double-buffering for SPI transfer to the display:

```
PSRAM framebuffer (307 KB)
  ↓ CPU copy (one scanline = 960 bytes)
Internal SRAM scanline buffer A (960 bytes)
Internal SRAM scanline buffer B (960 bytes)
  ↓ SPI DMA to ST7796
Display
```

While DMA transfers scanline A to the display, CPU copies the next scanline from PSRAM into buffer B. Ping-pong. Total internal SRAM cost: ~2 KB for the double buffer.

At 62.5 MHz SPI, a full frame transfer takes ~40 ms (25 fps). The PSRAM→SRAM copy is much faster than the SPI transfer, so PSRAM is never the bottleneck.

### Internal SRAM budget with PSRAM board

| Purpose | Size |
|---------|------|
| Stack (embassy executor) | 32 KB |
| DMA buffers (SPI, UART) | 4 KB |
| Scanline double buffer | 2 KB |
| Heap / misc | 16 KB |
| **Total used** | **~54 KB** |
| **Available** | **520 KB** |

Very comfortable. All the heavy data (state, framebuffer, patterns) lives in PSRAM.

### Implications for engine crate

With PSRAM, the current `SequencerState` with `Vec<SavedPattern, 32>` works as-is. No feature gates, no trait abstractions, no reduced `MAX_SAVED` needed. The same code runs on WASM and firmware.

Postcard deserialization still needs care — deserialize into a static PSRAM buffer, not on the stack. But 8 MB of PSRAM means plenty of room for temporaries.

## Impact on Engine Crate

The engine crate (`crates/engine/`) currently uses `Vec<SavedPattern, 32>` and `Vec<UserPreset, 32>` directly in `SequencerState`. For firmware compatibility, we'll eventually need to:

- **Option A**: Feature-gate the in-memory pattern storage (`#[cfg(feature = "std")]` or `#[cfg(feature = "full-storage")]`). Firmware uses a slimmer state struct.
- **Option B**: Make pattern storage a trait that the engine is generic over. Web impl holds all in RAM, firmware impl reads from SD.
- **Option C**: Keep current `SequencerState` but reduce `MAX_SAVED` for firmware builds (e.g. 4 patterns instead of 32).

Decision deferred until firmware development begins. The current architecture works fine for WASM/web.
