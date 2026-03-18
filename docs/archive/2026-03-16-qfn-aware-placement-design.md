# QFN-Aware Placement for Improved Routing Success

**Date:** 2026-03-16
**Status:** Approved
**Goal:** Increase main board routing success rate from 40% (2/5 variants) to 100% (5/5) by teaching the placement pipeline about QFN pin-side geometry.

## Problem

The main board has two DAC80508ZRTER chips in WQFN-16 packages (3×3mm, pins on all 4 sides, 0.5mm pitch). The placement system treats all components as dumb bounding boxes — it has no awareness of which component edges carry signal pins. This causes placement strategies to position op-amps and bypass caps in locations that block QFN escape routes, resulting in FreeRouting leaving 1-2 nets unconnected.

**Current routing results (main board):**

| Variant | Status | Vias | Trace Length |
|---------|--------|------|-------------|
| constructive-a | pass | 132 | 5708mm |
| constructive-b | fail | — | 1 unconnected |
| grid-spread-a | pass | 138 | 7659mm |
| grid-spread-b | fail | — | 1 unconnected |
| sa-refine-a | fail | — | 2 unconnected |

The control board (no QFN parts) routes at 80% (4/5), confirming QFN DACs are the bottleneck.

## Design

### 1. Pin-Side Metadata in ComponentInfo

Extend `ComponentInfo` with pad-edge classification extracted from the KiCad footprint:

```python
@dataclass
class ComponentInfo:
    # ...existing fields...
    pad_sides: dict[str, list[str]]    # edge → [net_names]
    edge_signal_count: dict[str, int]  # edge → non-power pin count
```

Classification algorithm:
1. Read all pad positions from the footprint
2. Skip thermal/exposed pads (center pads equidistant from all edges — common in QFN packages)
3. For each remaining pad, determine which edge it's closest to (N/S/E/W) based on its position relative to the footprint bounding box center. **Note:** KiCad uses top-left origin with positive Y pointing down, so the "south" edge in KiCad coordinates (positive Y) corresponds to the bottom of the physical package.
4. Filter out power/ground nets
5. Group remaining signal nets by edge

For the DAC80508 WQFN-16 (in KiCad coordinates where +Y = down):
- **West** (pads 1-4, x=-1.45mm): OUT0, OUT1, OUT2, OUT3 → 4 signal pins
- **South** (pads 5-8, y=+1.45mm): OUT4, OUT5, OUT6, OUT7 → 4 signal pins
- **East** (pads 9-12, x=+1.45mm): VIO, SDO, SCLK, SYNC → 4 signal pins
- **North** (pads 13-16, y=-1.45mm): DIN, AVDD, VREF, GND → 1 signal pin (DIN), rest are power

For 2-sided parts (TSSOP, SOIC), only W and E are populated. The system degrades gracefully.

### 2. Uniform Padding from Pin Density (Simplified)

Rather than modifying `CollisionTracker` for per-edge clearance (which would require complex bidirectional pairwise calculations), compute directional padding from pin density but use the **maximum edge value as uniform padding**. This is simpler and still gives QFN parts more breathing room than the current fixed 3mm.

```
edge_padding = base_padding + (signal_pin_count × per_signal_pin)
uniform_padding = max(all edge paddings)
```

Configuration in `board-config.json`:

```json
"component_padding": {
  "dacs.dac": {
    "auto_from_pins": true,
    "base": 2.5,
    "per_signal_pin": 0.5
  }
}
```

For the DAC80508 this computes per-edge: W=5.0, S=5.0, E=4.5, N=3.0 → **uniform 5.0mm**.

Both the old explicit format (`left/right/top/bottom` in mm) and the new `auto_from_pins` format are supported. The `get_component_padding()` function checks for `auto_from_pins` first; if absent, falls back to the existing explicit format.

The per-edge values are still stored in `ComponentInfo` for use by the satellite placement algorithm (section 3), even though collision detection uses the uniform max.

### 3. Satellite Placement for Connected Components

After all strategies run, a **post-processing step in the orchestrator** assigns QFN satellite components to preferred placement zones. This runs regardless of which strategy produced the initial placement.

**Passive detection:** Components with designator prefix R, C, or L are classified as passives and excluded from satellite assignment (they follow normal placement).

**Rotation handling:** `extract_pad_sides()` operates on the footprint's canonical orientation (rotation=0). The satellite zone positions are computed relative to the QFN's actual placed position and rotation — if the DAC is rotated 90°, the zones rotate with it.

Algorithm:
1. For each QFN component (identified by having signal pins on 3+ edges), find all directly connected non-passive components
2. For each satellite, count shared nets per QFN edge
3. Assign the satellite to the edge with the most shared nets
4. Compute a **target position**: the centroid of the zone extending outward from that edge, offset by `edge_padding + satellite_half_width`
5. If the satellite is already within a tolerance radius of its target (e.g., 3mm), leave it. Otherwise, nudge it toward the target using `find_legal_position()`
6. If two satellites compete for the same edge, offset them along the edge axis

Return type: `dict[str, SatelliteZone]` where `SatelliteZone` contains `edge: str`, `target_x: float`, `target_y: float`, `tolerance_mm: float`.

For DAC1:
- **opamp1** (gates, shares nets with OUT0-3) → west zone
- **opamp2** (pitch, shares nets with OUT4-7) → south zone
- Bypass caps → not moved (passives excluded)

### 4. File Changes

**`hardware/boards/scripts/placement/helpers.py`:**
- New: `extract_pad_sides(footprint, pcbnew, power_nets) → dict[str, list[str]]` — classifies pads by edge, skips thermal pads
- New: `compute_directional_padding(pad_sides, config) → dict[str, float]` — per-edge padding from pin density
- New: `nudge_satellites(placements, qfn_components, net_graph, board_state) → dict` — post-processing step that moves misplaced satellites

**`hardware/boards/scripts/placement/place_components.py`:**
- Modified: `ComponentInfo` dataclass — add `pad_sides: dict[str, list[str]]` and `edge_signal_count: dict[str, int]` fields (default to empty dicts)
- Modified: `_extract_component_info()` — populate new fields by calling `extract_pad_sides()`
- Modified: `get_component_padding()` — support `auto_from_pins` config format alongside existing explicit format
- Modified: orchestrator — call `nudge_satellites()` after strategy placement, before validation

**`hardware/boards/board-config.json`:**
- Modified: replace DAC padding with `auto_from_pins` config

**Strategy files:** No changes required. Satellite nudging runs as a post-processing step.

**No firmware changes. No schematic changes. No new dependencies.**

### 5. Success Criteria

- All 5 main board placement variants route successfully (0 unconnected nets)
- Control board routing success rate unchanged or improved (currently 4/5)
- Existing unit tests in `hardware/boards/scripts/tests/` pass
- New tests cover:
  - `extract_pad_sides()` for QFN (4-sided) and TSSOP (2-sided) footprints
  - `extract_pad_sides()` correctly skips thermal/exposed center pads
  - `compute_directional_padding()` produces correct per-edge values
  - `nudge_satellites()` assigns op-amps to correct DAC edges
  - Rotation handling: satellite zones rotate with the QFN component
- Fallback: if only 4/5 variants pass, that's still a significant improvement (80% vs 40%) and acceptable for a first iteration

### 6. Risks

- **Over-constraining**: 5.0mm uniform padding (up from 3.0mm) reduces available board space. Mitigation: only apply `auto_from_pins` to components explicitly configured for it; other components keep their existing padding.
- **Nudging conflicts**: Moving a satellite toward its preferred zone may push it into another component. Mitigation: `nudge_satellites()` uses `find_legal_position()` which respects collision detection; if no legal position exists near the target, the satellite stays where it is.
- **Rotation edge cases**: If the QFN is placed at a non-90° rotation, edge classification becomes ambiguous. Mitigation: the placement system only uses 0°/90°/180°/270° rotations; the zone rotation logic handles these 4 cases.
- **Strategy coupling**: None — satellite nudging is a post-processing step that doesn't modify strategy internals.
