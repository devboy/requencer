# UI Improvements Design

**Date:** 2026-03-02
**Status:** Approved

Three UI changes: transpose screen redesign, T1-T4 button labels, thin subtrack overlay.

---

## 1. Transpose Screen → Per-Track XPOSE Menu

### Summary
Replace the simple 4-row transpose view with a per-track scrollable parameter menu (same pattern as RAND screen). Adds note window and dynamics scaling.

### Parameters

| Section | Param | Range | Default | Description |
|---------|-------|-------|---------|-------------|
| **PITCH** | SEMI | -48 to +48 | 0 | Semitone transposition |
| | NOTE LO | C0-G10 (MIDI 0-127) | C0 (0) | Output note floor |
| | NOTE HI | C0-G10 (MIDI 0-127) | G10 (127) | Output note ceiling |
| **DYNAMICS** | GL SCALE | 25%-400% (5% steps) | 100% | Multiply gate lengths |
| | VEL SCALE | 25%-400% (5% steps) | 100% | Multiply velocities |

### Decisions
- **All output overlays** — non-destructive, stored steps never change. Applied in routing at output time.
- **Quantize always on** — removed from UI. Transposed pitch snaps to the track's active scale automatically.
- **Note window: WRAP only** — notes outside LO-HI octave-wrap. No mode selector needed.
- **GL/VEL scaling** — percentage multipliers applied to resolved gate length / velocity in routing.

### Types
`TransposeConfig` changes from `{semitones, quantize}` to:
```typescript
interface TransposeConfig {
  semitones: number     // -48 to +48
  noteLow: number       // 0-127 (MIDI note)
  noteHigh: number      // 0-127 (MIDI note)
  glScale: number       // 0.25 to 4.0 (1.0 = 100%)
  velScale: number      // 0.25 to 4.0 (1.0 = 100%)
}
```

### UI Layout
Same as RAND: scrollable row list with section headers, cursor, values right-aligned. Per-track via T1-T4. Header: `XPOSE — T1`. Enc A scrolls, enc B adjusts. New `xpose-rows.ts` defines the row layout.

### Routing
In `resolveOutputs()`, after reading base values:
1. Add `semitones` to pitch (existing)
2. Octave-wrap pitch into `noteLow..noteHigh` range
3. Multiply `gateLength` by `glScale` (clamp 0.0-1.0)
4. Multiply `velocity` by `velScale` (clamp 1-127)

---

## 2. T1-T4 Button Labels

### Summary
Panel buttons change from `T1`/`T2`/`T3`/`T4` to `T/O 1`/`T/O 2`/`T/O 3`/`T/O 4`. Indicates dual purpose (track/output) on the static panel.

### Changes
- **`faceplate.ts`**: Button label text changes from `T${i+1}` to `T/O ${i+1}`
- **LCD**: No changes needed — status bar already shows `T1` in edit modes, `O1` on route screen contextually.

---

## 3. Thin Subtrack Overlay

### Summary
On edit screens (gate-edit, pitch-edit, vel-edit), the hold overlay shrinks to header-height only (~42px) so the step grid stays fully visible. Home/menu screens keep the full overlay.

### Behavior by screen type

| Screen | Subtrack hold overlay | Track hold overlay |
|--------|----------------------|-------------------|
| **gate-edit, pitch-edit, vel-edit** | Thin (header-height) | Thin (header-height) |
| **home** | Full | Full |
| **rand, xpose, route** | Full (no step grid to protect) | Full |

### Thin overlay spec
- Covers `LCD_CONTENT_Y` to `LCD_CONTENT_Y + HEADER_H` (~42px)
- Semi-transparent background (`rgba(8,8,20,0.92)`)
- Shows `LEN 16  ÷1` in larger text (24px)
- Hint text: `ENC A: length  ENC B: divider` (16px, fits in header)
- Step grid beneath remains fully visible and reflows in real-time as length changes

### Implementation
- `hold-overlay.ts`: Add thin mode path, controlled by screen mode
- `main.ts`: Pass current mode to overlay renderer to determine thin vs full
