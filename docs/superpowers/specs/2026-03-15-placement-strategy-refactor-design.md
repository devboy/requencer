# Placement Strategy Interface Refactor

**Date:** 2026-03-15
**Status:** Draft

## Problem

The placement system has cross-cutting concerns (collision tracking, courtyard sizing, offset math, legalization, anti-affinity enforcement) duplicated across all four strategies. Adding or modifying any of these requires changes in every strategy file. Additionally, `place_components.py` has board-specific hardcoded logic (`place_main_board()`, `place_control_board()`) with address-mapping tables, rotations, and position computations baked into Python. A board-agnostic variant path (`place_variant()`) already exists but coexists with the legacy board-specific paths.

## Design

### Approach: Toolkit BoardState

Strategies receive a `BoardState` with shared mutable placement state and toolkit methods. The orchestrator owns all infrastructure; strategies focus on position-choosing logic.

```
board-config.json (source of truth for ALL fixed positions, both boards)
        |
   place_components.py (board-agnostic orchestrator)
   1. Load config for board_name
   2. Place fixed components from config (x, y, side, rotation, coords)
   3. Load KiCad PCB, build ComponentInfo for all components
   4. Set up board outline, standoffs, exclusion zones
   5. Build BoardState (collision tracker, anti-affinity, net graph, fixed)
   6. strategy.place(free_components, board_state, params) -> placements
   7. Apply all placements to KiCad (fixed + strategy results)
   8. Save PCB
        |
   export_layout.py (reads placed PCB -> panel-layout.json for web preview)
```

`panel-layout.json` is purely a downstream artifact for the web preview. It is never read by the placement system.

### ComponentInfo (extended)

Existing `ComponentInfo` dataclass extended with two pre-computed fields. Name kept to minimize churn. Existing field `nets` kept as-is.

```python
@dataclass(frozen=True)
class ComponentInfo:
    address: str                # atopile address (unique ID)
    width: float                # courtyard width (mm), includes all padding
    height: float               # courtyard height (mm), includes all padding
    cx_offset: float            # bbox center offset from footprint origin
    cy_offset: float            # bbox center offset from footprint origin
    is_tht: bool
    pin_count: int
    nets: list[str]             # non-power nets this component connects to
    routing_pressure: float     # width * height (area-based density metric)
    group: str | None           # first segment of atopile address (e.g., "dac" from "dac.output.opamp1")
```

- **Frozen**: strategies cannot mutate, orchestrator is source of truth.
- **`width`/`height` include all padding** (THT extra clearance, per-component overrides). Strategies never think about padding.
- **`routing_pressure`**: `width * height` — matches the existing `_routing_pressure()` implementation in grid_spread. Larger area = more routing pressure = should be spread apart.
- **`group`**: `address.split(".")[0]` — matches the existing `_module_grouped_sort()` in constructive. Used by strategies that want to cluster related components.
- **`nets`**: field name unchanged from current `ComponentInfo`.

### BoardState

Shared mutable placement state with a controlled API. Fixed positions and board dimensions are immutable; the collision tracker state evolves as strategies register placements.

**Coordinate contract:** All public methods accept and return **footprint-origin** coordinates. The bbox-center conversion (`cx_offset`/`cy_offset`) is always handled internally. Strategies never need to think about offset math.

```python
class BoardState:
    # -- Immutable state --
    width: float
    height: float
    fixed: dict[str, Placement]
    fixed_info: dict[str, ComponentInfo]
    net_graph: dict[str, list[str]]       # net -> [addresses]
    anti_affinity: list[AntiAffinityRule]
    smd_side: str                         # "F", "B", "both"

    # -- Toolkit methods (all coordinates are footprint-origin) --

    def check_collision(self, addr: str, x: float, y: float,
                        comp: ComponentInfo, side: str) -> bool:
        """Does this position overlap anything already placed?"""

    def find_legal_position(self, x: float, y: float,
                            comp: ComponentInfo, side: str | None = None
                            ) -> tuple[float, float, str]:
        """Ring-search from (x,y), return nearest legal (x, y, side).
           Side=None uses smd_side preference."""

    def connectivity_target(self, addr: str,
                            placed: dict[str, Placement]) -> tuple[float, float]:
        """Centroid of already-placed neighbors in net_graph."""

    def anti_affinity_cost(self, addr: str, x: float, y: float,
                           placed: dict[str, Placement]) -> float:
        """Sum of anti-affinity violations for this position."""

    def register_placement(self, addr: str, x: float, y: float,
                           comp: ComponentInfo, side: str) -> None:
        """Update collision tracker with a placed component.
           Strategies that place incrementally call this as they go."""

    def legalize(self, positions: dict[str, tuple[float, float]],
                 components: dict[str, ComponentInfo]
                 ) -> dict[str, Placement]:
        """Batch legalization: rough positions -> legal placements.
           Handles offset math, ring search, side selection, collision registration."""
```

- **Two legalization paths**: `find_legal_position()` for incremental strategies, `legalize()` for batch strategies.
- **Collision tracker is private**: strategies interact only through these methods.
- **No raw `config` access**: strategies no longer read `ctx.config` directly. All config-derived values (THT clearance, padding) are baked into `BoardState` internals or into `ComponentInfo` dimensions.

### Strategy Interface

```python
class PlacementStrategy(Protocol):
    def place(self, components: list[ComponentInfo],
              board: BoardState, params: dict) -> dict[str, Placement]:
        ...
```

- **`components`**: full list of free components. Strategies can sort/order them however they want. Strategies that need O(1) address lookup build `{c.address: c for c in components}` internally.
- **`board`**: shared state + toolkit. Simple strategies iterate and call `board.find_legal_position()`. Advanced strategies (force-directed, SA) use `board.check_collision()` and `board.anti_affinity_cost()` during inner loops.
- **`params`**: per-variant tuning knobs (`order`, `padding`, `seed`, `iterations`, `cooling_rate`, `density_weight`, etc.) from `board-config.json` variants. Strategies read what they need.
- **Rotation**: strategies return `Placement` which already has `rotation: float = 0.0`. For strategy-placed SMD components rotation is typically 0 — only fixed components from config have non-zero rotations.

Registration via `@register("name")` decorator is unchanged.

### Fixed Positions Config

`board-config.json` is the single source of truth for all fixed positions on both boards. Same format for both.

```json
{
  "boards": {
    "control": {
      "placement": {
        "fixed": {
          "button_scan.track_btn_1": { "x": 7.0, "y": 19.5, "side": "F", "rotation": 0, "coords": "faceplate" },
          "button_scan.track_btn_2": { "x": 7.0, "y": 30.2, "side": "F", "rotation": 0, "coords": "faceplate" },
          "jacks.j_clk_in": { "x": 15.0, "y": 108.0, "side": "F", "rotation": 0, "coords": "faceplate" },
          "jacks.j_gate_1": { "x": 120.0, "y": 108.0, "side": "F", "rotation": 0, "coords": "faceplate" },
          "lcd_fpc": { "x": 45.0, "y": 30.0, "side": "F", "rotation": 90, "coords": "pcb" },
          "...all other THT components...": "..."
        },
        "smd_side": "B",
        "tht_extra_clearance_mm": 1.5,
        "anti_affinity": [...]
      }
    },
    "main": {
      "placement": {
        "fixed": {
          "board_connector.header_a": { "x": 25.0, "y": 10.0, "side": "F", "rotation": 0, "coords": "pcb" },
          "board_connector.header_b": { "x": 65.0, "y": 10.0, "side": "F", "rotation": 0, "coords": "pcb" },
          "usb": { "x": 5.0, "y": 42.0, "side": "F", "rotation": 270, "coords": "pcb" },
          "lcd_fpc": { "x": 45.0, "y": 30.0, "side": "F", "rotation": 90, "coords": "pcb" }
        },
        "smd_side": "B",
        "tht_extra_clearance_mm": 1.5,
        "anti_affinity": [...]
      }
    }
  }
}
```

- **`coords`**: `"faceplate"` or `"pcb"` — orchestrator handles the transform using PCB origin offset from component-map.json.
- **`rotation`**: always in config, never in code.
- Both boards use the identical `fixed` dict format. No special cases.

### Orchestrator Responsibilities

Beyond strategy dispatch, the orchestrator handles:

- **Board outline**: `Edge.Cuts` setup (currently in `_setup_board_outline()`), runs before strategy.
- **Standoffs and exclusion zones**: M3 NPTH footprints and their exclusion zones, registered as fixed obstacles before strategy runs.
- **Iterative padding**: The existing padding sequence system (trying decreasing clearance until zero overlaps) stays as an orchestrator concern, wrapping strategy calls. Each padding level rebuilds `BoardState` with different clearance values.
- **Faceplate-to-PCB coordinate transform**: Applied when resolving `coords: "faceplate"` fixed positions, using PCB origin offset from component-map.json.

### CLI Interface

Unchanged. Makefile controls which strategies with which params to run, and parallelism.

```
python place_components.py <board_name> <strategy_name> [--params '{"key":"value"}']
```

Single board, single strategy per invocation. `select_best.py` runs separately after all variants complete.

### What Changes

| File | Change |
|------|--------|
| `board-config.json` | Add `fixed` entries for both boards with all positions currently hardcoded in Python. |
| `strategies/__init__.py` | Extend `ComponentInfo` (add `routing_pressure`, `group`), add `BoardState` class, update `PlacementStrategy` Protocol. |
| `strategies/*.py` | Rewrite to `place(components, board, params)` — remove all duplicated boilerplate. |
| `place_components.py` | Board-agnostic orchestrator: load config → place fixed → enrich → build state → call strategy → apply → save. Remove `place_main_board()`, `place_control_board()`, keep `place_variant()` as the single path. |
| `helpers.py` | Move into `BoardState`: `CollisionTracker`, `find_best_side`, `anti_affinity_repulsion`, `anti_affinity_penalty`, `connectivity_sort_by_net_graph`. Keep as standalone utilities: `extract_footprint_dims`, `is_tht`, `get_component_nets`, `get_ref_text_bbox`, `regenerate_duplicate_uuids`, `identify_power_nets`, `build_net_graph`, `validate_placement`, `estimate_hpwl`. |
| `tests/test_anti_affinity.py` | Update fixtures to use new interface: build `ComponentInfo` list + `BoardState` instead of `BoardContext` + `params`. |

### What Stays Unchanged

| File | Reason |
|------|--------|
| `export_layout.py` | Reads placed KiCad PCB → `panel-layout.json`. Purely downstream. |
| `select_best.py` | Compares variants after routing. Not affected. |
| `component-map.json` | UI metadata for web preview. Not affected. |
| `Makefile` | Same targets, same CLI pattern. |

### Deleted Code

- `place_main_board()` / `_place_main_board_pass()` and `place_control_board()` / `_place_control_board_pass()` — replaced by single generic orchestrator path
- All hardcoded position/rotation assignments in Python
- All address-mapping tables and category iteration loops (`utility_addr_map`, `feature_addr_map`, jack/button/encoder loops)
- Duplicated tracker init, fixed registration, legalization, offset math across 4 strategies
- `BoardContext` dataclass (replaced by `BoardState`)

### Migration

1. Extract all fixed positions from both `_place_main_board_pass()` and `_place_fixed_control()` into `board-config.json` `fixed` entries with `{x, y, side, rotation, coords}`.
2. For control board: flatten all THT positions (jacks, buttons, encoders, LCD FPC, connectors, standoffs) into static entries. These were previously derived from panel-layout.json categories via address-mapping tables — now they're explicit values in config.
3. Update test fixtures to build `ComponentInfo` + `BoardState` instead of `BoardContext`.
