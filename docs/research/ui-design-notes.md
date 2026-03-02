# UI Design Notes

**Date:** 2026-03-02
**Status:** Resolved — see `docs/plans/2026-03-02-ui-improvements-design.md` for approved design

---

## 1. Transpose Screen → Per-Track Menu Layout

The current transpose screen is a simple 4-row view (one row per track) with just semitone offset and quantize toggle. It should become a full per-track menu like the RAND screen — scrollable parameter list, per-track via T1-T4 buttons, enc A scrolls, enc B adjusts.

### Current parameters
- Semitones (-48 to +48)
- Quantize on/off

### Proposed parameters
| Param | Range | Description |
|-------|-------|-------------|
| **SEMI** | -48 to +48 | Pitch transposition in semitones |
| **NOTE LO** | 0-127 | Output note floor — notes below get clamped/wrapped |
| **NOTE HI** | 0-127 | Output note ceiling — notes above get clamped/wrapped |
| **WINDOW** | CLAMP / WRAP / FOLD | Behavior when transposed notes fall outside LO-HI range |
| **GL SCALE** | 25%-400% | Scale all gate lengths on this track (multiply existing GL values) |
| **VEL SCALE** | 25%-400% | Scale all velocities on this track |

### Design decisions needed
- **Note window vs. quantize:** Quantize snaps to scale after transpose. The note window (LO/HI) is a separate concern — it limits the output range. Both could coexist. Default quantize to ON and potentially hide behind a sub-param toggle?
- **Window mode:** CLAMP just pins to boundary. WRAP octave-wraps (note 73 with HI=72 becomes 61). FOLD mirrors back (73 → 71). WRAP is most musical for pitch.
- **GL/VEL scaling:** These are "performance" transforms — twist to open up or tighten a track's dynamics without re-randomizing. Applied as a multiplier on the output, not mutating the stored steps.
- **Section headers:** Could group as `PITCH` (semi, note lo, note hi, window) and `DYNAMICS` (GL scale, vel scale), matching the RAND screen's sectioned layout.

### Layout
Same as RAND: scrollable row list with section headers, cursor, values right-aligned. Per-track via T1-T4 buttons. Header shows `XPOSE — T1`.

---

## 2. T1-T4 Button Labels

The physical T1-T4 buttons serve dual purpose depending on screen context:
- **Most screens:** Select the **track** being edited (T1-T4)
- **Route screen:** Select the **output** being routed (O1-O4)

### Options
| Option | Label | Pros | Cons |
|--------|-------|------|------|
| **Numbers only** | `1  2  3  4` | Neutral, works for both T and O contexts | Less descriptive, harder to scan at a glance |
| **T/O labels** | `T1 T2 T3 T4` default, `O1 O2 O3 O4` on route screen | Clear context, matches mental model | Requires dynamic silkscreen or overlay — only works in software |
| **Dual label** | `T1/O1` stacked | Always shows both meanings | Cluttered, hard to read at eurorack scale |

### Recommendation
For the browser prototype: **dynamic labels** — show `T1-T4` by default, `O1-O4` on the route screen. The LCD or button area can change labels contextually.

For hardware: **numbers only** (`1 2 3 4`) — the silkscreen is static. The screen itself provides context (header says "ROUTE" or "GATE — T1" etc.). Users learn that 1-4 means "track" or "output" depending on mode.

---

## 3. Subtrack Length/Divider — Inline Display vs. Overlay

### The problem
Holding a subtrack button (GATE, PITCH, VEL, MOD) shows a full-screen overlay with length and divider values. This blocks the entire screen, including:
- The step pattern you were just looking at
- What the RAND button would randomize (you can't see the current pattern to judge whether to randomize)
- Any step selection state

### Current info already shown
The edit screens already show length and divider in the header area (right-aligned):
- Gate edit: `LEN 16` or `GL:50% R:2x  ÷2  P1/2`
- Pitch edit: `LEN 16  ÷1  P1/1`
- Vel edit: `LEN 16  ÷1  P1/1`
- Mod edit: same pattern

So **length and divider are already visible** on all edit screens — they're in the top-right info text.

### Proposed change
**Keep the overlay for adjustment (hold + encoder), but make it semi-transparent or partial-height** so the step grid remains partially visible underneath. Alternatively:

| Approach | Description | Tradeoff |
|----------|-------------|----------|
| **Status quo** | Full overlay on hold | Clean UI, but blocks pattern view |
| **Thinner overlay** | Only top portion overlays (header area + one row) | Pattern grid stays visible, but less room for overlay text |
| **Inline edit mode** | Hold changes the header area to show editable LEN/DIV with larger font, no overlay | Seamless, but header area is narrow (~42px) |
| **Bottom bar** | Overlay only covers bottom 20% of screen | Pattern fully visible, but small edit area |

### Recommendation
**Inline edit mode:** When holding a subtrack button, replace the header right-side info with a larger, highlighted `LEN:16 ÷1` that responds to encoder turns. No overlay needed — the step grid stays fully visible. The user can see their pattern while adjusting length (and watch it truncate/extend in real time).

The hold overlay remains useful for the **track-level** hold (hold T1 + encoder) which shows all four subtrack lengths at once — that one legitimately needs more space.

### Home screen
The track overview (home) already shows gate/pitch/velocity rows per track. Adding length/divider info per-subtrack would be very tight — the info footer already has `L16 ÷2 G÷2 P÷4` etc. This is probably sufficient. The home screen's role is overview, not editing.

For home, the existing footer line works. If a subtrack button is held on the home screen, the overlay is fine since there's no step-level editing happening.
