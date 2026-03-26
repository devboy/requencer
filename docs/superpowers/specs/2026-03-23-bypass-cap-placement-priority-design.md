# Bypass Capacitor Placement Priority

## Problem

The placer treats bypass/decoupling capacitors as regular passives. Two issues:

1. **Ordering**: Caps have 2 pins, scoring `-20` in `_comp_priority_key` vs `-300` for ICs. They're placed last in their circuit wave, by which time the closest grid positions near their IC are taken.

2. **Targeting**: A bypass cap on `GND` + `AVDD` gets pulled toward the weighted centroid of *all* components on those power nets (20+ components), landing near the board center instead of next to its IC's supply pins.

## Solution

Three coordinated changes in the new placer (`hardware/boards/scripts/placer/`):

### 1. Detection — `identify_bypass_caps()`

New function in `connectivity.py`.

**Input**: `Board` (with `rotation_nets` containing power nets), power net set, component map.

**Output**: `dict[str, str]` — `{bypass_cap_id: associated_ic_id}`.

**Algorithm**:

1. Accept `power_nets: set[str]` as an explicit parameter (already computed by `identify_power_nets()` in the pipeline and available in scope at `place_components.py`).
2. For each component where `_is_passive_id()` is true and leaf starts with `c_`:
   a. Collect all nets this component appears on (from `rotation_nets`).
   b. If **all** of those nets are power nets → candidate bypass cap.
   c. Find non-passive components in the same address group (same first dotted segment) that share at least one power net with this cap. Components without a dotted prefix (`group = None`) cannot be bypass-classified — this is intentional since ungrouped caps have no clear IC affinity.
   d. Pick the IC sharing the most power nets. Tiebreak: most total pins.
3. Components that pass (a–b) but fail (c) — no same-group IC shares a power net — are not classified as bypass caps (they may be bulk decoupling with no specific IC affinity).

**Note on bus nets**: `identify_power_nets()` returns both power nets and bus signals (SDA, SCL, SPI_CLK, etc.). This is acceptable — a capacitor with connections exclusively on bus nets (no power, no signal) is a degenerate case that doesn't occur in practice. No filtering needed.

**Why net-based, not naming convention**: A cap in a low-pass filter connects to a signal net + power net, so it won't match (not all nets are power). Only caps with *exclusively* power-net connections qualify — the defining characteristic of bypass/decoupling caps.

### 2. Targeted Connectivity Override

Modify `_best_position_and_rotation()` in `wavefront.py`.

**New parameter**: `bypass_map: dict[str, str]` (default empty dict).

**Behavior change**: When computing pin-to-pin targets for a component that appears in `bypass_map`:

- **Power nets**: Only consider the associated IC (`bypass_map[comp_id]`) as a neighbor. Ignore all other components on that net.
- **Signal nets**: Normal behavior (all neighbors contribute). Unlikely for bypass caps but handles edge cases.

This ensures `dac.c_dac1_1` targets specifically `dac.dac1`'s AVDD and GND pin positions, not the centroid of everything on the power rail.

The existing pin-aware rotation scoring also benefits — the cap rotates so its pads align with the IC's specific power pin positions.

### 3. Placement Order Interleaving

New helper function `_interleave_bypass_caps()` in `wavefront.py`.

**Input**: Ordered component list (from existing wave/priority sorting), bypass map.

**Output**: Reordered list where each bypass cap follows immediately after its associated IC.

**Algorithm**:

1. Build a reverse map: `ic_id → [bypass_cap_ids]`.
2. Remove all bypass caps from the ordered list.
3. Walk the list. After each IC that has bypass caps in the reverse map, insert its caps immediately after it.
4. **Fixed IC fallback**: If a bypass cap's IC is a fixed component (not in the free list), the cap won't be reinserted during step 3. Append these orphaned bypass caps at the beginning of the ordered list — they target a fixed IC's position via connectivity, so placing them early gives them first pick of nearby spots.

**Result**:
```
Before: [dac.dac1, dac.opamp1, dac.opamp2, ..., dac.c_dac1_1, dac.c_vio1]
After:  [dac.dac1, dac.c_dac1_1, dac.opamp1, dac.c_vio1, dac.opamp2, ...]
```

Caps not in the bypass map (bulk decoupling, filter caps) keep their original position.

### Strategies Affected

All three active wavefront strategies share the same `_best_position_and_rotation` and sorting logic:

| Strategy | Ordering change | Targeting change |
|----------|----------------|-----------------|
| `wavefront` | Apply `_interleave_bypass_caps` after wave ordering | Pass `bypass_map` to `_best_position_and_rotation` |
| `wavefront_circuit` | Apply `_interleave_bypass_caps` after module ordering | Same |
| `wavefront_direct` | Apply `_interleave_bypass_caps` after wave ordering | Same |

### Power Net Identification

The `power_nets: set[str]` is already computed by `identify_power_nets()` in `place_components.py` and passed to `extract_nets()` and other functions. The same set is threaded through to `identify_bypass_caps()` as an explicit parameter — no new computation needed.

## Files Changed

| File | Change |
|------|--------|
| `placer/connectivity.py` | Add `identify_bypass_caps()` function |
| `placer/strategies/wavefront.py` | Add `_interleave_bypass_caps()` helper; modify all 3 strategies to call it; add `bypass_map` param to `_best_position_and_rotation` with power-net neighbor filtering |
| `placer/kicad_bridge.py` | Thread `power_nets` set into Board construction (if not already available) |
| `placement/place_components.py` | Pass `power_nets` to new placer Board construction |

## Tests

| Test | What it verifies |
|------|-----------------|
| `test_identify_bypass_caps` | Caps with all-power-net connections detected; filter/coupling caps excluded; correct IC association by shared net count and pin tiebreak |
| `test_interleave_bypass_caps` | IC-then-caps ordering; unassociated caps unchanged; ICs without caps unaffected; fixed-IC bypass caps prepended |
| `test_bypass_targeting` | `_best_position_and_rotation` for bypass cap only considers associated IC on power nets, not all power net members |

## Non-Goals

- No changes to the legacy placement path (`placement/strategies/`).
- No config-driven priority overrides (naming conventions, board-config fields). Net-based detection is automatic.
- No guaranteed minimum distance constraint — the cap targets the IC's pins and gets first pick of nearby positions, but the collision grid still governs actual placement.
