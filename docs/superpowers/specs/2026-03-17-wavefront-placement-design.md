# Wavefront Placement Strategy

## Problem

Current placement strategies (constructive, grid_spread, sa_refine) sort components by connectivity or size, but don't consider how far each component is from a fixed anchor. This leads to suboptimal placement where components that should be close to their fixed neighbors end up competing for space with unrelated parts.

## Algorithm

### 1. Build circuits

Compute connected components in the non-power net graph using union-find. Two components are in the same circuit if any path of non-power nets connects them. Each circuit is a set of component addresses. Union-find is a simple ~20-line inline implementation (no external dependency).

### 2. Compute wave distances

BFS from fixed components through the net graph. The distance is measured in net-hops — each shared non-power net is one hop.

- **Wave 0**: Free components that share a non-power net directly with any fixed component. (BFS distance 1 from fixed, but "wave 0" because they're the first free components to place.)
- **Wave 1**: Free components one net-hop further from fixed (reachable only through wave-0 components).
- **Wave N**: Free components reachable in N+1 BFS steps from the nearest fixed component.
- **Orphans**: Components not reachable from any fixed component (no shared non-power nets).

Returns `(dict[str, int], set[str])` — wave assignments for reachable components, and the set of orphan addresses.

### 3. Order circuits

Sort circuits by total footprint area (sum of w × h for all components in the circuit), largest first. Circuit ordering is a secondary sort key within each wave — it controls the iteration order so components from the same electrical group are placed consecutively, keeping them spatially close.

### 4. Place in waves

For each wave level (0, 1, 2, ..., max_wave):
- Iterate circuits in area order (largest first)
- Within a circuit at this wave level, sort components by footprint area (largest first) — big ICs need space, small passives fill gaps
- Compute target via `board.connectivity_target(addr, placements, group=info.group)` for module cohesion
- Optionally choose rotation via `best_rotation_at_position()` when `params.get("auto_rotate", False)` is set and component has >4 pins
- Place using `board.place_component()`

### 5. Orphans last

Any components with no path to a fixed component are placed at the end, sorted by footprint area (largest first). If all free components are orphans (no shared nets with fixed), the strategy degenerates to area-sorted constructive placement — this is correct behavior.

## Integration

### New file

`hardware/boards/scripts/placement/strategies/wavefront.py`

### Registration

```python
@register("wavefront")
class WavefrontStrategy:
    def place(self, components: list[ComponentInfo],
              board: BoardState, params: dict) -> dict[str, Placement]:
```

### Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `auto_rotate` | bool | `false` | Try 4 rotations per IC, pick best wirelength |

### Clusters

The orchestrator unconditionally injects `clusters` into params (via `build_clusters`). The wavefront strategy accepts but ignores clusters — the wave ordering from BFS hop distance provides a stronger placement priority than the anchor/satellite/passive hierarchy that clusters encode. Both address the same goal (keep related components together) but wavefront does it through topological distance from fixed anchors rather than schematic hierarchy. If clusters prove useful later, they can be integrated as a tiebreaker within a wave.

### Reused infrastructure

- `BoardState.place_component()` — collision-aware placement + registration
- `BoardState.connectivity_target(addr, placements, group=info.group)` — target position based on placed neighbors, with atopile module group pull
- `BoardState.net_graph` — non-power net graph (already built by orchestrator)
- `BoardState.fixed` — fixed component positions
- `best_rotation_at_position()` from helpers — opt-in rotation optimization
- Existing validation, rotation handling, standoff zones — all unchanged

### Helper functions

Two new pure functions in `helpers.py`:

**`build_circuits(net_graph, all_addrs)`** — Union-find over net graph to produce list of sets. Each set = one circuit. Components with no net connections form singleton circuits. Implementation: inline union-find (~20 lines), no external dependency.

**`compute_wave_distances(net_graph, fixed_addrs, free_addrs)`** — BFS from fixed components. Returns `(dict[str, int], set[str])` — wave-level assignments for reachable free components, and the set of orphan addresses not reachable from any fixed component.

Note: fixed components with no non-power net connections (e.g. mounting holes, power-only connectors) contribute no waves — this is expected since they provide no signal-routing affinity.

### Variant config

Add wavefront variants to `board-config.json` under each board's `placement.variants`:

```json
{
  "name": "wavefront-a",
  "algorithm": "wavefront",
  "params": {}
}
```

## Testing

### Unit tests (pure functions)

- `test_build_circuits`: known net graph → expected connected components
- `test_build_circuits_disconnected`: components with no nets → singleton circuits
- `test_compute_wave_distances`: verify BFS wave levels from fixed nodes
- `test_compute_wave_distances_all_orphans`: no shared nets with fixed → all orphans
- `test_compute_wave_distances_single_component`: one free component directly connected

### Strategy tests (using existing fixtures)

Following the pattern in existing strategy test files:

- `test_places_all_free_components`: all free components appear in placements dict
- `test_no_overlaps`: validate_placement returns ok=True
- `test_all_in_bounds`: no out-of-bounds components
- `test_fixed_components_unmoved`: fixed positions unchanged after placement
- `test_orphan_only`: all components disconnected from fixed → still placed
- `test_empty_components`: empty input → empty output

## Non-goals

- Multi-pass refinement (that's what sa_refine is for; wavefront is a single-pass constructive strategy)
- Cluster integration in v1 (wave ordering supersedes cluster heuristics; can be added as tiebreaker later)
