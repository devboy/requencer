# Padding Separation & Correct Pin Positions

## Problem

Per-pin routing-escape padding is baked into `comp.width`/`comp.height` in `place_components.py`. This corrupts `pin_world_position()` everywhere — pin positions shift outward by the asymmetric padding amount. For the MCU (PGA2350), the VBUS pin position is 3.8mm off in Y from its actual KiCad pad position.

This causes bypass caps to be placed 5-8mm from IC pads instead of the target <2mm, and affects all placement targeting that uses pin positions.

## Solution

### 1. Component Data Model

Add per-side padding as separate fields. Never modify `width`/`height` after extraction:

```python
@dataclass
class Component:
    width: float    # mm, original footprint (never modified)
    height: float   # mm, original footprint (never modified)
    # ... existing fields ...
    pad_left: float = 0.0
    pad_right: float = 0.0
    pad_top: float = 0.0
    pad_bottom: float = 0.0
```

Remove `raw_width`/`raw_height` (no longer needed).

### 2. Collision Grid

`PlacementContext._register_component` computes collision rect from padded dimensions:
- `collision_w = width + pad_left + pad_right`
- `collision_h = height + pad_top + pad_bottom`
- Center shifted by `(pad_right - pad_left) / 2, (pad_bottom - pad_top) / 2`

`PlacedComponent.x/y` remains the original bbox top-left (no padding shift).

### 3. place_components.py

Stop mutating `comp.width/height`. Instead set `comp.pad_left/right/top/bottom`:

```python
comp.pad_left = edge_signal_count.get("W", 0) * per_pin_padding
comp.pad_right = edge_signal_count.get("E", 0) * per_pin_padding
comp.pad_top = edge_signal_count.get("N", 0) * per_pin_padding
comp.pad_bottom = edge_signal_count.get("S", 0) * per_pin_padding
```

Remove the bypass candidate padding skip (caps naturally get near-zero padding from their low edge signal counts).

### 4. Bypass Cap Satellite Placement

With correct pin positions, simplify `_place_bypass_satellite`:
- Target `pin_world_position()` directly (no padding correction, no offset hack)
- Place cap center 0.5mm outward from the IC's supply pin position
- IC unregister/re-register keeps caps inside padding zone
- Caps on different supply pins naturally go to different positions
- HF + bulk pairs on same pin stack with ~2mm perpendicular spacing

### 5. Files Changed

| File | Change |
|------|--------|
| `placer/dtypes.py` | Add `pad_left/right/top/bottom`, remove `raw_width`/`raw_height` |
| `placement/place_components.py` | Set padding fields instead of mutating dims, remove bypass candidate skip |
| `placer/context.py` | `_register_component` uses padded dims for collision, original for position |
| `placer/strategies/wavefront.py` | Simplify satellite placement — use pin positions directly |
| `placer/geometry.py` | No changes needed |

### 6. Success Criteria

- Pin positions in placer match KiCad pad positions (verified)
- Bypass caps < 2mm pad-to-pad from IC supply pin (first cap per pin)
- Bypass cap pairs < 4mm (HF + bulk on same pin)
- No component overlaps (DRC clean)
- All existing tests pass or are updated
