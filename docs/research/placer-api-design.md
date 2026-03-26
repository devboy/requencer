# Placer Library — API Design & Migration Plan

## Motivation

The current placement pipeline (`hardware/boards/scripts/placement/`) works well but
has three structural problems:

1. **KiCad concepts leak into placement logic.** `BoardState` tracks `cx_offset` /
   `cy_offset` (footprint origin vs bbox center), uses `"F"` / `"B"` string
   literals for sides, and strategies must reason about B.Cu mirroring. This means
   you can't test a placement strategy without understanding KiCad's coordinate
   model.

2. **Strategies are hard to test in isolation.** Running any strategy requires
   constructing a `BoardState` with a `CollisionTracker`, net graph, anti-affinity
   rules, and cluster data — all assembled inside `place_components.py` from KiCad
   board objects. There's no way to feed in a simple list of rectangles and get
   positions back.

3. **Collision tracker is embedded in BoardState.** `CollisionTracker` is a
   standalone geometric engine but it's constructed and owned by `BoardState`,
   making it impossible to use independently or swap implementations.

### What the placer library solves

A standalone `placer/` module that:

- Works entirely with rectangles `(x, y, width, height, rotation)` — no KiCad
  concepts
- Takes data in, returns positions out — pure functions
- Lets strategies be tested with 5-line setup: create components, create board,
  call `place()`
- Moves KiCad ↔ rectangle conversion to a separate translation layer that lives
  in the pipeline, not in the library

---

## Core Data Types

All types are plain dataclasses. No methods beyond `__post_init__` validation.

### Pin

A connection point on a component, positioned relative to the component's
bounding box at rotation=0.

```python
@dataclass(frozen=True)
class Pin:
    id: str                    # Unique within parent component (e.g., "1", "VCC", "SDA")
    x: float                   # mm, relative to component rect origin (top-left corner)
    y: float                   # mm, relative to component rect origin (top-left corner)
```

Pin positions are always specified at rotation=0 on the front side. The library
handles rotation and mirroring internally when computing world positions.

### Component

A rectangle to be placed, with optional pins and metadata.

```python
@dataclass
class Component:
    id: str                    # Unique identifier (e.g., atopile address "dac.u1")
    width: float               # mm, bounding box width at rotation=0
    height: float              # mm, bounding box height at rotation=0
    pins: list[Pin]            # Connection points (may be empty for simple passives)
    tags: set[str]             # Freeform tags: {"tht"}, {"smd", "tall"}, {"ic"}, etc.
    padding: SidePadding       # Per-side routing clearance
    fixed: bool = False        # If True, position is pre-set and must not change
    x: float = 0.0            # mm, placement position (top-left of bbox)
    y: float = 0.0            # mm, placement position (top-left of bbox)
    rotation: float = 0.0     # Degrees (0, 90, 180, 270)
    side: Side = Side.FRONT   # Which board side this component is on
    group: str | None = None   # Logical grouping (e.g., "dac", "leds") for affinity
```

### SidePadding

Per-side asymmetric padding for routing clearance around a component.

```python
@dataclass(frozen=True)
class SidePadding:
    top: float = 0.0          # mm
    bottom: float = 0.0
    left: float = 0.0
    right: float = 0.0
```

### Side

```python
class Side(Enum):
    FRONT = "front"
    BACK = "back"
```

### Net

A signal connecting pins across components.

```python
@dataclass(frozen=True)
class Net:
    id: str                              # Net name (e.g., "SPI_MOSI", "net_42")
    connections: list[tuple[str, str]]    # List of (component_id, pin_id) pairs
```

Power nets and bus nets are excluded before constructing `Net` objects — the
library doesn't need to know which nets are "power". That's a pipeline decision.

### BlockedZone

A rectangular region where placement is restricted.

```python
@dataclass(frozen=True)
class BlockedZone:
    x: float                   # mm, top-left corner
    y: float                   # mm, top-left corner
    width: float               # mm
    height: float              # mm
    side: ZoneSide             # Which side(s) the zone blocks
    excluded_tags: set[str]    # Components with ANY of these tags cannot be placed here
    allowed_tags: set[str]     # Exception: components with ANY of these tags CAN be placed
                               # (empty = no exceptions, zone blocks all matching excluded_tags)
```

```python
class ZoneSide(Enum):
    FRONT = "front"
    BACK = "back"
    BOTH = "both"
```

**Zone logic:** A component is blocked from a zone if:
1. The component's side matches the zone's side (or zone is `BOTH`), AND
2. The component has at least one tag in `excluded_tags`, AND
3. The component has no tags in `allowed_tags` (or `allowed_tags` is empty)

This replaces the current `placement_exclusions` with `allowed_prefixes` — tags
are more general than address prefix matching.

### AffinityRule

Minimum distance constraint between component groups.

```python
@dataclass(frozen=True)
class AffinityRule:
    from_pattern: str          # Component ID or prefix ("dac." matches "dac.u1", "dac.r1")
    to_pattern: str            # Component ID or prefix
    min_distance_mm: float     # Minimum center-to-center distance
    reason: str                # Human-readable explanation (e.g., "analog/digital separation")
```

Pattern matching: if pattern ends with `"."`, it's a prefix match. Otherwise,
exact match. Same semantics as current `AntiAffinityRule`.

### Board

The complete placement problem definition.

```python
@dataclass
class Board:
    width: float                         # mm
    height: float                        # mm
    components: list[Component]          # All components (fixed + free)
    nets: list[Net]                      # Signal connectivity
    zones: list[BlockedZone]             # Placement exclusion zones
    affinity_rules: list[AffinityRule]   # Distance constraints
    clearance: float = 0.5              # mm, minimum gap between components
    tht_clearance: float = 0.0          # mm, extra clearance around THT parts
```

Fixed components are just `Component` instances with `fixed=True` and pre-set
`x`, `y`, `rotation`, `side`. The library treats them identically to free
components for collision and connectivity — it just never moves them.

### PlacedComponent

Output: where a free component ended up.

```python
@dataclass(frozen=True)
class PlacedComponent:
    component_id: str
    x: float                   # mm, top-left of bbox
    y: float                   # mm, top-left of bbox
    rotation: float            # degrees
    side: Side
```

---

## Public API

### `place()`

The single entry point.

```python
def place(
    board: Board,
    strategy: str = "wavefront",
    params: dict | None = None,
    seed: int | None = None,
) -> list[PlacedComponent]:
    """
    Place all non-fixed components on the board.

    Args:
        board: Complete problem definition
        strategy: Registered strategy name
        params: Strategy-specific parameters
        seed: Random seed for reproducibility

    Returns:
        Positions for every non-fixed component. Fixed components are
        NOT included in the output.

    Raises:
        ValueError: Unknown strategy or invalid board
        PlacementError: Strategy failed to place all components
    """
```

### `register_strategy()`

Register a custom placement strategy.

```python
def register_strategy(name: str, fn: StrategyFn) -> None:
    """Register a placement strategy by name. Overwrites if name exists."""
```

### `StrategyFn`

The type signature every strategy must implement.

```python
StrategyFn = Callable[[Board, PlacementContext, dict], list[PlacedComponent]]
```

- `Board` — the full problem definition (read-only)
- `PlacementContext` — shared utilities (collision grid, geometry helpers)
- `dict` — strategy-specific params

### `PlacementContext`

Shared utilities provided to strategies. Not a data type — an interface to
precomputed structures.

```python
class PlacementContext:
    """Precomputed helpers available to all strategies."""

    def collides(self, comp: Component, x: float, y: float,
                 side: Side, rotation: float = 0.0) -> bool: ...

    def in_bounds(self, comp: Component, x: float, y: float,
                  rotation: float = 0.0) -> bool: ...

    def find_free(self, comp: Component, x: float, y: float,
                  side: Side, rotation: float = 0.0,
                  bounds: Rect | None = None,
                  step: float = 1.0) -> tuple[float, float] | None: ...

    def register(self, comp: Component, x: float, y: float,
                 side: Side, rotation: float = 0.0) -> None: ...

    def unregister(self, component_id: str) -> None: ...

    def connectivity_target(self, component_id: str,
                            placed: dict[str, PlacedComponent],
                            group_weight: float = 0.5) -> tuple[float, float]: ...

    def anti_affinity_cost(self, component_id: str,
                           x: float, y: float,
                           placed: dict[str, PlacedComponent]) -> float: ...

    def net_graph(self) -> dict[str, list[str]]: ...

    def wave_distances(self) -> tuple[dict[str, int], set[str]]: ...

    def circuits(self) -> list[set[str]]: ...

    def clusters(self) -> list[Cluster]: ...

    def largest_free_rects(self, side: Side, count: int = 5) -> list[Rect]: ...

    def pin_world_position(self, comp: Component, pin: Pin,
                           x: float, y: float,
                           rotation: float, side: Side) -> tuple[float, float]: ...

    def effective_dims(self, comp: Component,
                       rotation: float) -> tuple[float, float]: ...

    def copy(self) -> PlacementContext: ...

    def reset(self) -> None: ...
```

---

## Shared Utilities

### Collision Grid

AABB collision detection with clearance margins.

- **Side-aware rules:** Components on the same side collide. THT-tagged components
  collide with both sides (pins penetrate the board).
- **Zone enforcement:** `BlockedZone` regions registered at init, checked during
  `collides()` using tag matching.
- **Expanding ring search:** `find_free()` spirals outward from a target position
  to find the nearest legal spot.
- **Largest free rectangles:** Histogram-based algorithm to find open regions for
  wavefront grid allocation.

Implementation: internal `_CollisionGrid` class, not exported. Strategies access
it only through `PlacementContext`.

### Geometry Transforms

Pure functions for coordinate math.

```python
def rotated_dims(w: float, h: float, rotation: float) -> tuple[float, float]:
    """Return (width, height) after rotation (0/90/180/270)."""

def rotate_point(x: float, y: float, w: float, h: float,
                 rotation: float) -> tuple[float, float]:
    """Rotate a point relative to a rect's origin."""

def mirror_x_point(x: float, w: float) -> float:
    """Mirror a point horizontally (for back-side flip)."""

def padded_rect(x: float, y: float, w: float, h: float,
                padding: SidePadding, rotation: float) -> tuple[float, float, float, float]:
    """Return (x, y, w, h) expanded by rotated padding."""
```

### Connectivity Helpers

Built from `Board.nets` at `PlacementContext` construction.

- **Net graph:** `dict[str, list[str]]` — net name → connected component IDs
- **Connectivity sort:** Greedy BFS ordering by connection strength
- **Wave distances:** BFS from fixed components
- **Circuit detection:** Union-find connected components
- **Cluster building:** Group → anchor → satellite → passive hierarchy

### Pin Classification

```python
def classify_pins_by_edge(comp: Component) -> dict[str, list[Pin]]:
    """Classify pins into N/S/E/W edges based on position within bbox."""

def pin_edge_position(comp: Component, pin: Pin,
                      x: float, y: float,
                      rotation: float, side: Side) -> tuple[float, float]:
    """World position of a pin after rotation and optional mirror."""
```

---

## Module Structure

```
hardware/boards/scripts/placer/
    __init__.py          # Public API: place(), register_strategy(), types
    types.py             # All dataclasses: Component, Pin, Net, Board, etc.
    context.py           # PlacementContext implementation
    collision.py         # _CollisionGrid (internal)
    geometry.py          # Pure coordinate math functions
    connectivity.py      # Net graph, waves, circuits, clusters
    strategies/
        __init__.py      # Strategy registry, StrategyFn type
        constructive.py
        force_directed.py
        grid_spread.py
        wavefront.py     # All 3 wavefront variants
        sa_refine.py
```

**Dependency rules:**

- `types.py` — no internal imports (leaf module)
- `geometry.py` — imports only `types`
- `collision.py` — imports `types`, `geometry`
- `connectivity.py` — imports `types`
- `context.py` — imports all internal modules
- `strategies/*` — import only `types` and receive `PlacementContext` as argument
- **No module imports `pcbnew`, `kicad`, or anything outside the package**

---

## Translation Layer

Lives **outside** the placer library, in the existing pipeline code
(`place_components.py` or a new `kicad_bridge.py`).

### KiCad → Placer

Convert KiCad footprints into `Component` objects.

```python
def footprint_to_component(fp, pcbnew, power_nets: set[str]) -> Component:
    """
    Extract a Component from a KiCad footprint.

    1. Position fp at origin, read GetBoundingBox(False, False)
    2. width = bbox.GetWidth() in mm, height = bbox.GetHeight() in mm
    3. x, y = bbox top-left corner (NOT footprint origin)
    4. Iterate pads:
       - Skip power nets
       - Pin.x = (pad_pos.x - bbox_left) in mm
       - Pin.y = (pad_pos.y - bbox_top) in mm
       - Pin.id = pad net name or pad number
    5. tags: {"tht"} if any pad is PAD_ATTRIB_PTH, else {"smd"}
    6. group: first segment of atopile address
    7. Store footprint-origin-to-bbox-origin offset for back-conversion

    The cx_offset / cy_offset from the current system becomes unnecessary —
    positions are bbox-relative, not origin-relative.
    """
```

**Key insight:** The current system stores positions as footprint origin
coordinates and tracks `cx_offset` / `cy_offset` to convert to/from bbox center.
The placer library uses bbox top-left directly, eliminating this offset entirely.
The translation layer handles the conversion in one place.

### Placer → KiCad

Apply `PlacedComponent` positions back to KiCad footprints.

```python
def apply_placement(fp, placed: PlacedComponent, pcbnew,
                    bbox_to_origin_offset: tuple[float, float]) -> None:
    """
    Set a KiCad footprint's position from a PlacedComponent.

    1. Convert bbox top-left → footprint origin:
       origin_x = placed.x + offset_x (accounting for rotation)
       origin_y = placed.y + offset_y (accounting for rotation)
    2. fp.SetPosition(VECTOR2I(FromMM(origin_x), FromMM(origin_y)))
    3. Handle side:
       - If placed.side != current side: fp.Flip(fp.GetPosition(), False)
    4. Handle rotation:
       - fp.SetOrientationDegrees(placed.rotation)
       - B.Cu note: KiCad applies rotation after flip, same as our model
    """
```

### Coordinate Mapping Summary

| Concept | Current system | Placer library |
|---------|---------------|----------------|
| Position reference | Footprint origin | Bbox top-left corner |
| Center offset | `cx_offset`, `cy_offset` | Not needed |
| Side | `"F"`, `"B"` strings | `Side.FRONT`, `Side.BACK` enum |
| Rotation | Degrees (float) | Degrees (float) — same |
| Pin positions | Edge classification (N/S/E/W) | Explicit (x, y) coordinates |
| THT detection | `PAD_ATTRIB_PTH` check | `"tht"` tag |
| Dimensions | Width/height with padding baked in | Raw width/height + separate `SidePadding` |

---

## Migration Plan

### Phase 1: Types + Geometry (no strategy changes)

1. Create `placer/types.py` with all dataclasses
2. Create `placer/geometry.py` — port pure functions from `helpers.py`
3. Create `placer/collision.py` — port `CollisionTracker` from `helpers.py`
4. Create `placer/connectivity.py` — port net graph, waves, circuits, clusters
5. Write tests for each module using simple rectangle inputs

### Phase 2: Context + API

1. Create `placer/context.py` — `PlacementContext` wrapping collision grid +
   connectivity
2. Create `placer/__init__.py` with `place()` and strategy registry
3. Write integration test: create a `Board` with a few components, call
   `place()` with a trivial strategy, verify output

### Phase 3: Port Strategies (one at a time)

Port order (simplest → most complex):

1. **constructive** — greedy, most straightforward
2. **grid_spread** — grid generation + scoring
3. **sa_refine** — simulated annealing (mostly self-contained)
4. **force_directed** — spring simulation
5. **wavefront** (all 3 variants) — most complex, port last

For each strategy:
1. Copy to `placer/strategies/`, rewrite to use `Component` / `PlacementContext`
2. Add tests using synthetic boards
3. Run both old and new on the same board config, compare output quality
4. Remove old strategy once new one is validated

### Phase 4: Translation Layer + Switchover

1. Create `kicad_bridge.py` with `footprint_to_component()` and
   `apply_placement()`
2. Update `place_components.py` to:
   - Build `Board` from KiCad data via bridge
   - Call `placer.place()`
   - Apply results via bridge
3. Remove old `placement/` directory
4. Update `Makefile` if any paths changed

### Phase 5: Cleanup

1. Remove `BoardState`, `CollisionTracker`, strategy code from old location
2. Update imports across the pipeline
3. Verify full hardware build pipeline: `make hardware`

### What stays in place_components.py

- Board outline creation
- Standoff placement
- Address mapping (atopile → footprint)
- Fixed component coordinate conversion (faceplate → PCB coords)
- UUID deduplication
- Config file parsing (`board-config.json`, `component-map.json`)

These are KiCad pipeline concerns, not placement concerns.
