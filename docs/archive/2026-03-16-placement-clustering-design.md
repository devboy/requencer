# Placement Clustering, Orientation & Channel Assignment

**Date:** 2026-03-16
**Status:** Approved
**Goal:** Improve main board routing success rate by placing components as hierarchical clusters with pin-aware rotation and radial channel assignment for passives.

## Problem

The placement pipeline treats all components independently — strategies position each component based on generic connectivity pull and density repulsion. This produces placements where:
- Op-amps end up far from their DACs (grid-spread-b: opamp2 at 64mm from nearest DAC)
- Feedback resistors scatter randomly instead of forming clean signal chains
- Components are always placed at 0° rotation, even when a 90° rotation would align input/output pins with their connected neighbors
- Different channels' signal paths cross each other unnecessarily

Current results: main board 2/5 variants route, control board 1/5 (after adding LEDs).

## Design

### 1. Module-Aware Clustering

Group components into hierarchical clusters based on net connectivity and atopile address prefixes. Each cluster has an **anchor** (most-connected IC) and **satellites** (connected ICs and passives).

**Cluster detection algorithm:**
1. Identify anchor candidates: components with the most non-power net connections in their address-prefix group (first dotted segment, e.g. `dac.` prefix)
2. For each anchor, find satellite ICs: non-passive components sharing 2+ nets with the anchor
3. For each satellite IC, find its passives: components sharing nets with that satellite (and not directly with other ICs outside the cluster)
4. Remaining passives in the group: assign to the satellite they share the most nets with
5. **Bypass cap assignment:** Caps whose only nets are power/ground cannot be clustered via net connectivity (power nets are filtered out). Instead, assign them by **address proximity** — match the cap's address against anchor/satellite addresses (e.g. `dac.c_dac1_1` → `dac.dac1`, `dac.c_ref1` → nearest anchor by prefix). Bypass caps are placed adjacent to their assigned IC.

**DAC module cluster tree (auto-detected):**
```
dac.dac1 (anchor — QFN, most nets in dac.* group)
  ├── dac.opamp1 (satellite — shares OUT0-3 nets)
  │     └── dac.r_gate1..4 (passives — share opamp1 output nets)
  ├── dac.opamp2 (satellite — shares OUT4-7 nets)
  │     └── dac.r_pitch*_fb, dac.r_pitch*_ref, dac.r_pitch* (passives)
  └── bypass caps: dac.c_dac1_*, dac.c_ref1*, dac.c_vio1 (assigned by address prefix)

dac.dac2 (anchor)
  ├── dac.opamp3 → dac.r_vel* passives
  ├── dac.opamp4 → dac.r_mod* passives
  └── bypass caps: dac.c_dac2_*, dac.c_ref2*, dac.c_vio2 (assigned by address prefix)

dac.opamp5 (shared reference buffer — satellite of both DACs, assigned to nearest)
  └── dac.r_ref_top, dac.r_ref_bot, dac.c_pitch_ref
```

**Integration with strategies:** Clustering is a pre-processing step in the orchestrator. Clusters are passed to the post-processing pipeline via `params["clusters"]`. Strategies themselves are not modified — they continue to receive `components` and `board` as before. The `PlacementStrategy` protocol is unchanged.

**Implementation:** New `build_clusters()` function in `helpers.py`. New `Cluster` dataclass in `strategies/__init__.py`:
```python
@dataclass
class Cluster:
    anchor: str                          # anchor component address
    satellites: dict[str, list[str]]     # satellite_addr → [passive_addrs]
    bypass: list[str]                    # passives near anchor (caps, assigned by address)
```

### 2. Pin-Aware Orientation

When placing a satellite IC near its anchor, try all 4 rotations (0°/90°/180°/270°) and pick the one that minimizes total Manhattan distance from the satellite's signal pads to their connected components. **Position and rotation are evaluated together** — for each candidate position, all 4 rotations are scored, and the best (position, rotation) pair is chosen. This avoids the stale-collision-tracker problem of separating the two steps.

**KiCad rotation convention:** KiCad `SetOrientationDegrees()` uses positive degrees = counter-clockwise when viewed from the front. The rotation formulas below follow this convention.

**Rotation-correct geometry:**

New function `rotated_info(comp, degrees) → ComponentInfo` handles:
- **Width/height swap:** 90°/270° swap width and height; 0°/180° keep them
- **Pad sides rotation (CCW):** At 90° CCW: W→S, S→E, E→N, N→W. At 180°: N↔S, W↔E. At 270° CCW: W→N, N→E, E→S, S→W
- **Origin offset rotation (CCW):** `(cx_offset, cy_offset)` rotates as a 2D vector. At 90° CCW: `(cx, cy) → (cy, -cx)`. At 180°: `(-cx, -cy)`. At 270° CCW: `(-cy, cx)`

All code paths that register a placement with rotation ≠ 0 use `rotated_info` for collision checking. This includes `register_placement()`, `check_collision()`, and `find_legal_position()`.

**Combined position + rotation selection:**
```python
def place_and_orient_satellite(comp, candidate_positions, connected_positions,
                                pad_sides, board_state):
    """Try all positions × all rotations, return best (x, y, rotation)."""
    best = None
    best_cost = float('inf')
    for x, y in candidate_positions:
        for rot in (0, 90, 180, 270):
            rotated = rotated_info(comp, rot)
            if board_state.check_collision(..., rotated):
                continue
            cost = wirelength_cost(rotate_pad_sides(pad_sides, rot),
                                   (x, y), connected_positions)
            if cost < best_cost:
                best = (x, y, rot)
                best_cost = cost
    return best
```

**Scope:** Applied only to satellite ICs during cluster placement. Anchors (QFN DACs) have pins on all 4 sides so rotation matters less. Passives (2-pin) don't benefit. Fixed components keep their configured rotation.

**Test matrix:**
1. TSSOP (center origin, 5×3mm): rotate 90° → collision box becomes 3×5mm
2. SIP-9 (pin-1 origin, cx_offset=0, cy_offset=4): rotate 90° CCW → cx_offset=4, cy_offset=0
3. Two TSSOs side-by-side at 0° with 1mm gap: no collision. Rotate one 90° → collision detected (wider body overlaps)
4. Pad sides rotation (CCW): 0°→90°→180°→270° verifies W→S→E→N cycle
5. Full round-trip: rotate 360° returns original dimensions and offsets
6. Verify KiCad convention: place a TSSOP at 90° via `SetOrientationDegrees(90)`, read back bounding box, confirm width/height match `rotated_info` output

### 3. Radial Channel Assignment for Passives

After placing anchors and satellite ICs (with rotation), assign each passive to a channel and position it along the radial path from its opamp toward the board connector.

**Channel assignment:**
1. Each passive's nets are checked against the satellite IC it belongs to (from clustering)
2. A passive sharing nets with a specific opamp output channel gets assigned to that channel
3. Shared passives (reference dividers) stay unassigned → normal connectivity placement
4. Bypass caps (power-only nets) are positioned adjacent to their address-matched IC (from clustering step 5)

**Radial positioning:**
- Target position = point along the line from the satellite IC toward the board connector header
- Feedback resistors: close to the opamp (1-2× component width away)
- Output/gain resistors: further along the radial, between opamp and connector
- Distance ordering determined by signal chain depth (count of ICs between the passive and the DAC)

**Implementation:** New `place_cluster_passives()` function in `helpers.py`:
- Input: cluster tree, net_graph, current placements (anchors + satellites placed and oriented)
- Output: dict of passive_addr → target (x, y) positions
- These targets feed into `board.legalize()` for collision-free final placement

**What it doesn't do:**
- No global lane partitioning
- No rotation of passives
- Doesn't affect non-DAC passives (power supply, USB, etc.)

### 4. Orchestrator Integration

The placement post-processing pipeline becomes:

```
strategy.place()                → raw placements (all components)
enforce_anti_affinity()         → push apart violating pairs (existing)
place_cluster_satellites()      → position + orient satellite ICs near correct anchor edges (NEW)
                                  (combined position + rotation in one step)
place_cluster_passives()        → position passives along channel radials (NEW)
nudge_satellites()              → REMOVED (subsumed by cluster placement)
validate_placement()            → check bounds + overlaps (existing)
```

The existing `nudge_satellites()` is replaced by the more capable `place_cluster_satellites()` which uses the same edge-affinity logic but within the cluster context and with rotation support.

### 5. File Changes

**`hardware/boards/scripts/placement/strategies/__init__.py`:**
- New: `Cluster` dataclass
- New: `rotated_info(comp, degrees)` function
- Modified: `BoardState.register_placement()` — accept optional `rotation` parameter, apply `rotated_info` for collision dimensions
- Modified: `BoardState.check_collision()` — accept optional `rotation` parameter

**`hardware/boards/scripts/placement/helpers.py`:**
- New: `build_clusters(components, net_graph)` → list of Cluster
- New: `rotate_pad_sides(pad_sides, degrees)` → rotated pad_sides dict
- New: `place_cluster_satellites(clusters, placements, free_comps, board_state, net_graph)` → updated placements (combined position + rotation)
- New: `place_cluster_passives(clusters, placements, free_comps, net_graph, board_state)` → updated placements
- Removed: `nudge_satellites()` (replaced by cluster-aware placement)
- Removed: `_is_passive_addr()`, `_edge_offset()` (inlined or replaced)

**`hardware/boards/scripts/placement/place_components.py`:**
- Modified: orchestrator pipeline — build clusters, replace nudge_satellites with cluster steps
- Modified: `_extract_component_info()` — populate `ComponentInfo.group` field (currently unused, set from first address segment)

**`hardware/boards/scripts/tests/test_satellite_nudge.py`:**
- Removed or migrated to test the new `place_cluster_satellites()` function

**No changes to:** individual strategy files, board-config.json, firmware, schematics.

### 6. Success Criteria

- Main board: ≥4/5 variants route successfully (up from 2/5)
- Control board: ≥3/5 variants route (up from 1/5)
- All existing tests pass (minus removed `test_satellite_nudge.py`)
- New tests cover:
  - `build_clusters()` for DAC module and non-DAC modules
  - `build_clusters()` bypass cap assignment by address prefix
  - `rotated_info()` dimension swap, offset rotation, pad_sides rotation for all 4 angles
  - `rotated_info()` with non-center origin (pin-1 components)
  - `rotated_info()` round-trip (0→90→180→270→360 = identity)
  - KiCad convention verification (test 6 from matrix)
  - `place_cluster_satellites()` positions + orients opamps near correct DAC edges
  - `place_cluster_passives()` positions resistors along radials
  - Collision detection with rotated rectangular components

### 7. Risks

- **Rotation collision bugs:** Mitigated by comprehensive test matrix, `rotated_info` as single source of truth, and combined position+rotation evaluation (no stale collision data).
- **KiCad rotation convention mismatch:** Mitigated by test 6 in the matrix — verify against actual KiCad behavior before implementing rotation logic throughout.
- **Cluster detection false positives:** A non-DAC module might get incorrectly clustered. Mitigated by requiring 2+ shared nets for satellite detection.
- **Bypass cap address matching:** Address-based assignment is a heuristic — `dac.c_bulk_12p` doesn't clearly match either DAC. Mitigated by falling back to nearest anchor by Manhattan distance when prefix matching is ambiguous.
- **Over-constraining passives:** Radial positioning might push passives into crowded areas. Mitigated by using `legalize()` which falls back to nearest free position.
- **Backward compatibility:** Strategies are not modified. Cluster post-processing is a no-op when `build_clusters()` returns empty. The `PlacementStrategy` protocol is unchanged.
- **Position-rotation coupling cost:** Evaluating 4 rotations × N candidate positions is 4× more work than position-only search. For typical satellite counts (5-10 ICs), this is negligible.
