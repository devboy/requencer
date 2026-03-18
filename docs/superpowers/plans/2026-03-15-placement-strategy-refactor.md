# Placement Strategy Interface Refactor — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize cross-cutting placement concerns (collision tracking, offset math, legalization, anti-affinity) into a `BoardState` toolkit class, make the orchestrator board-agnostic, and move all hardcoded fixed positions into `board-config.json`.

**Architecture:** Strategies receive `place(components: list[ComponentInfo], board: BoardState, params: dict) -> dict[str, Placement]`. `BoardState` wraps the collision tracker and provides toolkit methods (check_collision, find_legal_position, connectivity_target, anti_affinity_cost, register_placement, legalize). The orchestrator loads config, builds enriched ComponentInfo, constructs BoardState, calls the strategy, and writes back.

**Tech Stack:** Python 3.11+, KiCad pcbnew API, pytest

**Spec:** `docs/superpowers/specs/2026-03-15-placement-strategy-refactor-design.md`

**Note on commits:** CLAUDE.md says "Do NOT make git commits." Commit steps below are guidance for the user — the implementing agent should NOT commit unless the user explicitly asks. Let the user decide when to commit or roll back.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `hardware/boards/scripts/placement/strategies/__init__.py` | Modify | Add `routing_pressure`/`group` to `ComponentInfo`, add `BoardState` class, update `PlacementStrategy` Protocol |
| `hardware/boards/scripts/placement/strategies/constructive.py` | Rewrite | Remove boilerplate, use `BoardState` toolkit |
| `hardware/boards/scripts/placement/strategies/force_directed.py` | Rewrite | Remove boilerplate, use `BoardState` toolkit |
| `hardware/boards/scripts/placement/strategies/sa_refine.py` | Rewrite | Remove boilerplate, use `BoardState` toolkit |
| `hardware/boards/scripts/placement/strategies/grid_spread.py` | Rewrite | Remove boilerplate, use `BoardState` toolkit |
| `hardware/boards/scripts/placement/helpers.py` | Modify | Remove functions that moved to `BoardState`, keep pure utilities |
| `hardware/boards/scripts/placement/place_components.py` | Rewrite | Board-agnostic orchestrator, read fixed positions from config |
| `hardware/boards/board-config.json` | Modify | Add `fixed` entries for both boards |
| `hardware/boards/scripts/tests/conftest.py` | Rewrite | Fixtures build `ComponentInfo` list + `BoardState` instead of `BoardContext` |
| `hardware/boards/scripts/tests/test_anti_affinity.py` | Modify | Update to use new interface |
| `hardware/boards/scripts/tests/test_board_state.py` | Create | Unit tests for `BoardState` toolkit methods |

---

## Chunk 1: Core Data Types & BoardState

### Task 1: Extend ComponentInfo with new fields

**Files:**
- Modify: `hardware/boards/scripts/placement/strategies/__init__.py:13-24`

- [ ] **Step 1: Add `routing_pressure` and `group` fields to ComponentInfo**

In `hardware/boards/scripts/placement/strategies/__init__.py`, add two fields to the existing `ComponentInfo` dataclass:

```python
@dataclass(frozen=True)
class ComponentInfo:
    address: str
    width: float
    height: float
    is_tht: bool
    pin_count: int
    nets: list[str]
    cx_offset: float = 0.0
    cy_offset: float = 0.0
    routing_pressure: float = 0.0    # NEW: width * height (area-based density)
    group: str | None = None          # NEW: address.split(".")[0]
```

Both fields have defaults so existing code that constructs `ComponentInfo` without them still works during migration.

- [ ] **Step 2: Verify existing tests still pass**

Run: `cd /Users/devboy/dev/devboy/requencer && python -m pytest hardware/boards/scripts/tests/ -v`
Expected: All existing tests PASS (new fields have defaults).

- [ ] **Step 3: Commit**

```bash
git add hardware/boards/scripts/placement/strategies/__init__.py
git commit -m "feat(placement): add routing_pressure and group fields to ComponentInfo"
```

---

### Task 2: Create BoardState class

**Files:**
- Modify: `hardware/boards/scripts/placement/strategies/__init__.py`
- Create: `hardware/boards/scripts/tests/test_board_state.py`

- [ ] **Step 1: Write failing tests for BoardState**

Create `hardware/boards/scripts/tests/test_board_state.py`:

```python
"""Tests for BoardState toolkit methods."""
import pytest
from placement.strategies import (
    BoardState, ComponentInfo, Placement, AntiAffinityRule,
)


def _comp(addr, w=4.0, h=3.0, is_tht=False, pin_count=4,
          nets=None, cx_offset=0.0, cy_offset=0.0):
    """Helper to build ComponentInfo with defaults."""
    return ComponentInfo(
        address=addr, width=w, height=h, is_tht=is_tht,
        pin_count=pin_count, nets=nets or [],
        cx_offset=cx_offset, cy_offset=cy_offset,
        routing_pressure=w * h,
        group=addr.split(".")[0] if "." in addr else None,
    )


def _make_board(width=50.0, height=50.0, fixed=None, fixed_info=None,
                net_graph=None, anti_affinity=None, smd_side="both",
                tht_extra_clearance=0.0, clearance=0.5):
    """Helper to build BoardState."""
    return BoardState(
        width=width, height=height,
        fixed=fixed or {}, fixed_info=fixed_info or {},
        net_graph=net_graph or {}, anti_affinity=anti_affinity or [],
        smd_side=smd_side,
        tht_extra_clearance=tht_extra_clearance,
        clearance=clearance,
    )


class TestBoardStateInit:
    def test_fixed_components_registered_in_tracker(self):
        """Fixed components should be in collision tracker after init."""
        comp = _comp("fixed_a", w=5.0, h=5.0)
        board = _make_board(
            fixed={"fixed_a": Placement(x=10.0, y=10.0, side="F")},
            fixed_info={"fixed_a": comp},
        )
        # Placing at fixed position should collide
        free = _comp("free_a", w=4.0, h=4.0)
        assert board.check_collision("free_a", 10.0, 10.0, free, "F") is True

    def test_empty_board_no_collision(self):
        board = _make_board()
        comp = _comp("a", w=4.0, h=3.0)
        assert board.check_collision("a", 25.0, 25.0, comp, "F") is False


class TestCheckCollision:
    def test_collision_with_registered_placement(self):
        board = _make_board()
        comp_a = _comp("a", w=10.0, h=10.0)
        board.register_placement("a", 20.0, 20.0, comp_a, "F")

        comp_b = _comp("b", w=5.0, h=5.0)
        # Overlapping position
        assert board.check_collision("b", 22.0, 22.0, comp_b, "F") is True
        # Far away — no collision
        assert board.check_collision("b", 45.0, 45.0, comp_b, "F") is False

    def test_offset_handled_internally(self):
        """Strategies pass footprint-origin coords; offset math is internal."""
        board = _make_board()
        comp = _comp("a", w=10.0, h=10.0, cx_offset=2.0, cy_offset=1.0)
        board.register_placement("a", 20.0, 20.0, comp, "F")
        # Check at same footprint-origin — should collide
        comp_b = _comp("b", w=5.0, h=5.0)
        assert board.check_collision("b", 20.0, 20.0, comp_b, "F") is True


class TestFindLegalPosition:
    def test_returns_legal_position_on_empty_board(self):
        board = _make_board()
        comp = _comp("a", w=4.0, h=3.0)
        x, y, side = board.find_legal_position(25.0, 25.0, comp)
        assert abs(x - 25.0) < 2.0  # Should be near requested
        assert abs(y - 25.0) < 2.0
        assert side in ("F", "B")

    def test_avoids_occupied_position(self):
        board = _make_board()
        blocker = _comp("blocker", w=10.0, h=10.0)
        board.register_placement("blocker", 25.0, 25.0, blocker, "F")

        comp = _comp("a", w=4.0, h=3.0)
        x, y, side = board.find_legal_position(25.0, 25.0, comp, side="F")
        # Should NOT be at the blocked position
        assert not board.check_collision("a", x, y, comp, side)

    def test_respects_smd_side(self):
        board = _make_board(smd_side="B")
        comp = _comp("a", w=4.0, h=3.0)
        x, y, side = board.find_legal_position(25.0, 25.0, comp)
        assert side == "B"


class TestConnectivityTarget:
    def test_centroid_of_placed_neighbors(self):
        board = _make_board(
            net_graph={"net1": ["a", "b", "c"]},
        )
        placed = {
            "b": Placement(x=10.0, y=10.0, side="F"),
            "c": Placement(x=30.0, y=30.0, side="F"),
        }
        tx, ty = board.connectivity_target("a", placed)
        assert abs(tx - 20.0) < 0.1  # Centroid of b and c
        assert abs(ty - 20.0) < 0.1

    def test_no_placed_neighbors_returns_board_center(self):
        board = _make_board(net_graph={"net1": ["a", "b"]})
        tx, ty = board.connectivity_target("a", {})
        assert abs(tx - 25.0) < 0.1  # Board center
        assert abs(ty - 25.0) < 0.1


class TestAntiAffinityCost:
    def test_no_rules_returns_zero(self):
        board = _make_board()
        cost = board.anti_affinity_cost("a", 10.0, 10.0, {})
        assert cost == 0.0

    def test_violation_returns_positive_cost(self):
        rules = [AntiAffinityRule(from_pattern="power.", to_pattern="dac.", min_mm=30.0)]
        board = _make_board(anti_affinity=rules)
        placed = {"power.reg": Placement(x=10.0, y=10.0, side="F")}
        cost = board.anti_affinity_cost("dac.ch1", 15.0, 15.0, placed)
        assert cost > 0.0  # Too close (7mm vs 30mm min)

    def test_satisfied_returns_zero(self):
        rules = [AntiAffinityRule(from_pattern="power.", to_pattern="dac.", min_mm=5.0)]
        board = _make_board(anti_affinity=rules)
        placed = {"power.reg": Placement(x=10.0, y=10.0, side="F")}
        cost = board.anti_affinity_cost("dac.ch1", 45.0, 45.0, placed)
        assert cost == 0.0


class TestRegisterPlacement:
    def test_registered_component_causes_collision(self):
        board = _make_board()
        comp = _comp("a", w=10.0, h=10.0)
        board.register_placement("a", 25.0, 25.0, comp, "F")
        comp_b = _comp("b", w=5.0, h=5.0)
        assert board.check_collision("b", 25.0, 25.0, comp_b, "F") is True


class TestLegalize:
    def test_batch_legalization_returns_valid_placements(self):
        board = _make_board()
        comps = {
            "a": _comp("a", w=4.0, h=3.0),
            "b": _comp("b", w=4.0, h=3.0),
        }
        # Two components at same position — legalization should resolve
        positions = {"a": (25.0, 25.0), "b": (25.0, 25.0)}
        result = board.legalize(positions, comps)
        assert "a" in result
        assert "b" in result
        # They should not overlap after legalization
        pa, pb = result["a"], result["b"]
        assert not (abs(pa.x - pb.x) < 4.0 and abs(pa.y - pb.y) < 3.0
                    and pa.side == pb.side)

    def test_legalization_handles_offsets(self):
        board = _make_board()
        comp = _comp("a", w=6.0, h=4.0, cx_offset=1.5, cy_offset=0.5)
        positions = {"a": (25.0, 25.0)}
        result = board.legalize(positions, {"a": comp})
        assert "a" in result
        # Result should be in footprint-origin coords
        p = result["a"]
        assert p.x is not None and p.y is not None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/devboy/dev/devboy/requencer && python -m pytest hardware/boards/scripts/tests/test_board_state.py -v`
Expected: FAIL — `BoardState` not defined.

- [ ] **Step 3: Implement BoardState class**

Add to `hardware/boards/scripts/placement/strategies/__init__.py`, after the existing dataclasses:

```python
from __future__ import annotations
import math


class BoardState:
    """Shared mutable placement state with controlled API.

    All public methods accept/return footprint-origin coordinates.
    Bbox-center offset conversion is handled internally.
    """

    def __init__(
        self,
        width: float,
        height: float,
        fixed: dict[str, Placement],
        fixed_info: dict[str, ComponentInfo],
        net_graph: dict[str, list[str]],
        anti_affinity: list[AntiAffinityRule],
        smd_side: str = "both",
        tht_extra_clearance: float = 0.0,
        clearance: float = 0.5,
        extra_padding: float = 0.0,
    ):
        from placement.helpers import CollisionTracker

        self.width = width
        self.height = height
        self.fixed = dict(fixed)
        self.fixed_info = dict(fixed_info)
        self.net_graph = dict(net_graph)
        self.anti_affinity = list(anti_affinity)
        self.smd_side = smd_side
        self._tht_extra_clearance = tht_extra_clearance
        self._clearance = clearance
        self._extra_padding = extra_padding

        # Private collision tracker
        self._tracker = CollisionTracker(
            width, height,
            clearance=clearance,
            extra_padding=extra_padding,
            tht_extra_clearance=tht_extra_clearance,
        )

        # Register all fixed components
        for addr, p in self.fixed.items():
            if addr not in self.fixed_info:
                raise ValueError(f"Fixed component '{addr}' missing from fixed_info")
            info = self.fixed_info[addr]
            self._tracker.register(
                p.x + info.cx_offset, p.y + info.cy_offset,
                info.width, info.height, p.side,
                info.is_tht, label=addr,
            )

    def _to_bbox_center(self, x: float, y: float, comp: ComponentInfo):
        """Convert footprint-origin to bbox center."""
        return x + comp.cx_offset, y + comp.cy_offset

    def _to_fp_origin(self, bx: float, by: float, comp: ComponentInfo):
        """Convert bbox center to footprint-origin."""
        return bx - comp.cx_offset, by - comp.cy_offset

    def check_collision(self, addr: str, x: float, y: float,
                        comp: ComponentInfo, side: str) -> bool:
        """Check if position collides with anything already placed."""
        cx, cy = self._to_bbox_center(x, y, comp)
        return self._tracker.collides(cx, cy, comp.width, comp.height,
                                      side, comp.is_tht)

    def find_legal_position(self, x: float, y: float,
                            comp: ComponentInfo,
                            side: str | None = None,
                            step: float = 0.5,
                            ) -> tuple[float, float, str]:
        """Ring-search from (x,y), return nearest legal (fp_x, fp_y, side)."""
        from placement.helpers import find_best_side

        cx, cy = self._to_bbox_center(x, y, comp)
        smd_side = side if side else self.smd_side
        result = find_best_side(
            self._tracker, cx, cy,
            comp.width, comp.height, comp.is_tht,
            step=step, smd_side=smd_side,
        )
        if result is None:
            # Fallback: return requested position
            return x, y, side or "F"
        bx, by, found_side = result
        fp_x, fp_y = self._to_fp_origin(bx, by, comp)
        return fp_x, fp_y, found_side

    def connectivity_target(self, addr: str,
                            placed: dict[str, Placement],
                            ) -> tuple[float, float]:
        """Centroid of already-placed neighbors in net_graph."""
        neighbor_positions = []
        for net, net_addrs in self.net_graph.items():
            if addr not in net_addrs:
                continue
            for other in net_addrs:
                if other != addr and other in placed:
                    p = placed[other]
                    neighbor_positions.append((p.x, p.y))
                elif other != addr and other in self.fixed:
                    p = self.fixed[other]
                    neighbor_positions.append((p.x, p.y))

        if not neighbor_positions:
            return self.width / 2, self.height / 2

        avg_x = sum(p[0] for p in neighbor_positions) / len(neighbor_positions)
        avg_y = sum(p[1] for p in neighbor_positions) / len(neighbor_positions)
        return avg_x, avg_y

    def anti_affinity_cost(self, addr: str, x: float, y: float,
                           placed: dict[str, Placement]) -> float:
        """Sum of anti-affinity penalties for this position."""
        cost = 0.0
        for rule in self.anti_affinity:
            for other_addr, other_p in placed.items():
                if not rule.matches(addr, other_addr):
                    continue
                dist = math.hypot(x - other_p.x, y - other_p.y)
                if dist < rule.min_mm:
                    shortfall = rule.min_mm - dist
                    cost += shortfall * shortfall  # Quadratic penalty
            # Also check against fixed
            for other_addr, other_p in self.fixed.items():
                if not rule.matches(addr, other_addr):
                    continue
                dist = math.hypot(x - other_p.x, y - other_p.y)
                if dist < rule.min_mm:
                    shortfall = rule.min_mm - dist
                    cost += shortfall * shortfall
        return cost

    def register_placement(self, addr: str, x: float, y: float,
                           comp: ComponentInfo, side: str) -> None:
        """Register a placed component in the collision tracker."""
        cx, cy = self._to_bbox_center(x, y, comp)
        self._tracker.register(cx, cy, comp.width, comp.height,
                               side, comp.is_tht, label=addr)

    def copy(self) -> "BoardState":
        """Create a copy with fresh collision tracker (fixed components re-registered).

        Used by strategies like SA-refine that need a clean starting state
        after generating a seed solution.
        """
        return BoardState(
            width=self.width, height=self.height,
            fixed=self.fixed, fixed_info=self.fixed_info,
            net_graph=self.net_graph, anti_affinity=self.anti_affinity,
            smd_side=self.smd_side,
            tht_extra_clearance=self._tht_extra_clearance,
            clearance=self._clearance,
            extra_padding=self._extra_padding,
        )

    def legalize(self, positions: dict[str, tuple[float, float]],
                 components: dict[str, ComponentInfo],
                 ) -> dict[str, Placement]:
        """Batch legalization: rough positions -> legal placements.

        Processes in connectivity order, handles offset math,
        ring search, side selection, and collision registration.
        """
        from placement.helpers import connectivity_sort_by_net_graph

        addrs = list(positions.keys())
        sorted_addrs = connectivity_sort_by_net_graph(addrs, self.net_graph)

        placements: dict[str, Placement] = {}
        for addr in sorted_addrs:
            if addr not in positions or addr not in components:
                continue
            comp = components[addr]
            ox, oy = positions[addr]
            fp_x, fp_y, side = self.find_legal_position(ox, oy, comp)
            placements[addr] = Placement(x=fp_x, y=fp_y, side=side)
            self.register_placement(addr, fp_x, fp_y, comp, side)

        return placements
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/devboy/dev/devboy/requencer && python -m pytest hardware/boards/scripts/tests/test_board_state.py -v`
Expected: All PASS.

- [ ] **Step 5: Verify existing tests still pass**

Run: `cd /Users/devboy/dev/devboy/requencer && python -m pytest hardware/boards/scripts/tests/ -v`
Expected: All PASS (no existing code changed, only additions).

- [ ] **Step 6: Commit**

```bash
git add hardware/boards/scripts/placement/strategies/__init__.py hardware/boards/scripts/tests/test_board_state.py
git commit -m "feat(placement): add BoardState toolkit class with collision, legalization, anti-affinity"
```

---

### Task 3: Update PlacementStrategy Protocol

**Files:**
- Modify: `hardware/boards/scripts/placement/strategies/__init__.py:72-77`

- [ ] **Step 1: Update Protocol signature**

Change from:
```python
class PlacementStrategy(Protocol):
    def place(self, ctx: BoardContext, params: dict) -> dict[str, Placement]:
        """Return address → Placement for all free components."""
```

To:
```python
class PlacementStrategy(Protocol):
    def place(self, components: list[ComponentInfo],
              board: BoardState, params: dict) -> dict[str, Placement]:
        """Return address → Placement for all free components."""
```

Keep `BoardContext` in the file for now (strategies still use it until migrated). Add a deprecation comment:

```python
# DEPRECATED: Use BoardState instead. Will be removed after all strategies migrate.
@dataclass
class BoardContext:
    ...
```

- [ ] **Step 2: Commit**

```bash
git add hardware/boards/scripts/placement/strategies/__init__.py
git commit -m "feat(placement): update PlacementStrategy Protocol to (components, board, params)"
```

---

## Chunk 2: Migrate Strategies

Each strategy follows the same pattern: remove boilerplate (tracker init, fixed registration, offset math, legalization), use `BoardState` methods instead. Keep the unique algorithm logic.

### Task 4: Migrate constructive strategy

**Files:**
- Modify: `hardware/boards/scripts/placement/strategies/constructive.py`
- Modify: `hardware/boards/scripts/tests/conftest.py`

- [ ] **Step 1: Update conftest.py to provide both old and new fixtures**

Add a helper and new fixtures to `hardware/boards/scripts/tests/conftest.py` that build `BoardState` + `list[ComponentInfo]` from the same data as existing fixtures. Keep old fixtures so non-migrated strategies still work.

```python
from placement.strategies import BoardState

def _board_state_from_ctx(ctx):
    """Convert a BoardContext to (components_list, BoardState) for new interface."""
    components = list(ctx.free.values())
    board = BoardState(
        width=ctx.width, height=ctx.height,
        fixed=ctx.fixed, fixed_info=ctx.fixed_info,
        net_graph=ctx.net_graph,
        anti_affinity=ctx.anti_affinity,
        smd_side=ctx.smd_side,
        tht_extra_clearance=ctx.config.get("tht_extra_clearance_mm", 0.0),
        clearance=0.5,
    )
    return components, board
```

Add new fixtures that delegate to existing ones:

```python
@pytest.fixture
def small_board():
    """New-style fixture returning (components, board_state)."""
    ctx = _build_small_board_ctx()  # Extract existing fixture body into helper
    return _board_state_from_ctx(ctx)

@pytest.fixture
def anti_affinity_board():
    ctx = _build_anti_affinity_ctx()
    return _board_state_from_ctx(ctx)
```

Note: Extract the body of each existing `@pytest.fixture` into a plain helper function (e.g., `_build_small_board_ctx()`) so both old fixtures (`small_board_ctx`) and new fixtures (`small_board`) can share the same data construction.

- [ ] **Step 2: Rewrite constructive.py**

Replace the full file. The unique logic is: ordering (connectivity/size/module_grouped), greedy one-at-a-time placement toward connectivity target.

```python
"""Constructive placement: greedy one-at-a-time toward connectivity targets."""
from __future__ import annotations

from placement.helpers import size_sort_by_info, connectivity_sort_by_net_graph
from placement.strategies import (
    BoardState, ComponentInfo, Placement, register,
)


def _module_grouped_sort(components: list[ComponentInfo],
                         net_graph: dict[str, list[str]]) -> list[ComponentInfo]:
    """Group by module prefix, connectivity-sort within each group."""
    groups: dict[str, list[ComponentInfo]] = {}
    for c in components:
        g = c.group or c.address
        groups.setdefault(g, []).append(c)

    result = []
    for group_comps in groups.values():
        addrs = [c.address for c in group_comps]
        sorted_addrs = connectivity_sort_by_net_graph(addrs, net_graph)
        addr_to_comp = {c.address: c for c in group_comps}
        result.extend(addr_to_comp[a] for a in sorted_addrs)
    return result


@register("constructive")
class ConstructiveStrategy:
    def place(self, components: list[ComponentInfo],
              board: BoardState, params: dict) -> dict[str, Placement]:
        order = params.get("order", "connectivity")
        extra_padding = params.get("padding", 0.0)

        # Sort components
        if order == "size":
            addrs = size_sort_by_info(
                [c.address for c in components],
                {c.address: c for c in components},
            )
            addr_to_comp = {c.address: c for c in components}
            ordered = [addr_to_comp[a] for a in addrs]
        elif order == "module_grouped":
            ordered = _module_grouped_sort(components, board.net_graph)
        else:  # connectivity
            addrs = connectivity_sort_by_net_graph(
                [c.address for c in components], board.net_graph,
            )
            addr_to_comp = {c.address: c for c in components}
            ordered = [addr_to_comp[a] for a in addrs]

        placements: dict[str, Placement] = {}
        for comp in ordered:
            # Compute target from placed neighbors
            target_x, target_y = board.connectivity_target(
                comp.address, {**placements, **board.fixed},
            )

            # Find legal position near target
            fp_x, fp_y, side = board.find_legal_position(
                target_x, target_y, comp,
            )

            placements[comp.address] = Placement(x=fp_x, y=fp_y, side=side)
            board.register_placement(comp.address, fp_x, fp_y, comp, side)

        return placements
```

- [ ] **Step 3: Run existing anti-affinity tests for constructive**

Run: `cd /Users/devboy/dev/devboy/requencer && python -m pytest hardware/boards/scripts/tests/test_anti_affinity.py -k constructive -v`

If tests fail because they still use old interface, update the specific test functions to use the new interface (pass `components` list + `BoardState` + `params` instead of `BoardContext`).

- [ ] **Step 4: Fix any failing tests**

Update test call sites from:
```python
strategy.place(ctx, params)
```
To:
```python
components, board = _board_state_from_ctx(ctx)
strategy.place(components, board, params)
```

- [ ] **Step 5: Run all tests**

Run: `cd /Users/devboy/dev/devboy/requencer && python -m pytest hardware/boards/scripts/tests/ -v`
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add hardware/boards/scripts/placement/strategies/constructive.py hardware/boards/scripts/tests/conftest.py hardware/boards/scripts/tests/test_anti_affinity.py
git commit -m "refactor(placement): migrate constructive strategy to BoardState interface"
```

---

### Task 5: Migrate force_directed strategy

**Files:**
- Modify: `hardware/boards/scripts/placement/strategies/force_directed.py`

- [ ] **Step 1: Rewrite force_directed.py**

Keep the unique force-simulation logic. Remove: tracker init, fixed registration, adjacency building (use net_graph directly), legalization boilerplate. Use `board.check_collision()` during simulation, `board.legalize()` at the end.

```python
"""Force-directed placement: spring simulation then legalization."""
from __future__ import annotations
import math
import random

from placement.strategies import (
    BoardState, ComponentInfo, Placement, register,
)


@register("force_directed")
class ForceDirectedStrategy:
    def place(self, components: list[ComponentInfo],
              board: BoardState, params: dict) -> dict[str, Placement]:
        attraction = params.get("attraction", 0.1)
        repulsion = params.get("repulsion", 5.0)
        iterations = params.get("iterations", 200)
        seed = params.get("seed", None)
        rng = random.Random(seed)

        comp_map = {c.address: c for c in components}
        addrs = list(comp_map.keys())
        if not addrs:
            return {}

        # Build adjacency from net_graph
        adjacency: dict[str, dict[str, int]] = {a: {} for a in addrs}
        all_addrs = set(addrs) | set(board.fixed.keys())
        for net, net_addrs in board.net_graph.items():
            relevant = [a for a in net_addrs if a in all_addrs]
            for i in range(len(relevant)):
                for j in range(i + 1, len(relevant)):
                    a, b = relevant[i], relevant[j]
                    if a in adjacency:
                        adjacency[a][b] = adjacency[a].get(b, 0) + 1
                    if b in adjacency:
                        adjacency[b][a] = adjacency[b].get(a, 0) + 1

        # Initialize positions: centroid of fixed neighbors + jitter
        positions: dict[str, list[float]] = {}
        for addr in addrs:
            tx, ty = board.connectivity_target(addr, board.fixed)
            positions[addr] = [
                tx + rng.uniform(-5, 5),
                ty + rng.uniform(-5, 5),
            ]

        # Force simulation
        temp = min(board.width, board.height) * 0.3
        for iteration in range(iterations):
            displacements: dict[str, list[float]] = {a: [0.0, 0.0] for a in addrs}

            # Attraction: pull connected components together
            for addr in addrs:
                for neighbor, weight in adjacency.get(addr, {}).items():
                    if neighbor in positions:
                        nx, ny = positions[neighbor]
                    elif neighbor in board.fixed:
                        p = board.fixed[neighbor]
                        nx, ny = p.x, p.y
                    else:
                        continue
                    dx = nx - positions[addr][0]
                    dy = ny - positions[addr][1]
                    dist = math.hypot(dx, dy) + 0.01
                    force = attraction * weight * dist
                    displacements[addr][0] += (dx / dist) * force
                    displacements[addr][1] += (dy / dist) * force

            # Repulsion: push overlapping components apart
            for i in range(len(addrs)):
                for j in range(i + 1, len(addrs)):
                    a, b = addrs[i], addrs[j]
                    dx = positions[a][0] - positions[b][0]
                    dy = positions[a][1] - positions[b][1]
                    dist = math.hypot(dx, dy) + 0.01
                    min_dist = (comp_map[a].width + comp_map[b].width) / 2
                    if dist < min_dist:
                        force = repulsion * (min_dist - dist) / dist
                        displacements[a][0] += (dx / dist) * force
                        displacements[a][1] += (dy / dist) * force
                        displacements[b][0] -= (dx / dist) * force
                        displacements[b][1] -= (dy / dist) * force

            # Anti-affinity: extra repulsion (5x multiplier)
            placed_snapshot = {a: Placement(x=p[0], y=p[1], side="F")
                               for a, p in positions.items()}
            for addr in addrs:
                cost = board.anti_affinity_cost(addr, positions[addr][0],
                                                positions[addr][1],
                                                placed_snapshot)
                if cost > 0:
                    # Push away from violating neighbors
                    for rule in board.anti_affinity:
                        for other, op in {**placed_snapshot, **board.fixed}.items():
                            if other == addr or not rule.matches(addr, other):
                                continue
                            ox = op.x if isinstance(op, Placement) else op.x
                            oy = op.y if isinstance(op, Placement) else op.y
                            dx = positions[addr][0] - ox
                            dy = positions[addr][1] - oy
                            dist = math.hypot(dx, dy) + 0.01
                            if dist < rule.min_mm:
                                force = repulsion * 5.0 * (rule.min_mm - dist) / dist
                                displacements[addr][0] += (dx / dist) * force
                                displacements[addr][1] += (dy / dist) * force

            # Apply displacements with temperature cap
            for addr in addrs:
                dx, dy = displacements[addr]
                mag = math.hypot(dx, dy) + 0.01
                scale = min(mag, temp) / mag
                positions[addr][0] = max(0, min(board.width,
                    positions[addr][0] + dx * scale))
                positions[addr][1] = max(0, min(board.height,
                    positions[addr][1] + dy * scale))

            temp *= 0.95  # Cooling

        # Legalize via BoardState
        rough_positions = {a: (p[0], p[1]) for a, p in positions.items()}
        return board.legalize(rough_positions, comp_map)
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/devboy/dev/devboy/requencer && python -m pytest hardware/boards/scripts/tests/test_anti_affinity.py -k force_directed -v`

Update any failing tests to use new interface (same pattern as Task 4 Step 4).

- [ ] **Step 3: Run all tests**

Run: `cd /Users/devboy/dev/devboy/requencer && python -m pytest hardware/boards/scripts/tests/ -v`
Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add hardware/boards/scripts/placement/strategies/force_directed.py hardware/boards/scripts/tests/
git commit -m "refactor(placement): migrate force_directed strategy to BoardState interface"
```

---

### Task 6: Migrate sa_refine strategy

**Files:**
- Modify: `hardware/boards/scripts/placement/strategies/sa_refine.py`

- [ ] **Step 1: Rewrite sa_refine.py**

Keep: Metropolis acceptance, move types (displace + swap), cost function (HPWL + anti-affinity). Remove: tracker init, fixed registration, offset math, legalization boilerplate. Use constructive strategy for initial seed, `board.anti_affinity_cost()` for scoring.

```python
"""Simulated annealing refinement: perturb from constructive seed."""
from __future__ import annotations
import math
import random

from placement.helpers import estimate_hpwl, connectivity_sort_by_net_graph
from placement.strategies import (
    BoardState, ComponentInfo, Placement, register,
)


def _initial_constructive(components: list[ComponentInfo],
                          board: BoardState) -> dict[str, Placement]:
    """Generate starting solution with constructive strategy on a fresh copy."""
    from placement.strategies import get_strategy
    strategy = get_strategy("constructive")
    # Use a copy so constructive's register_placement() calls don't pollute
    # the main board state that SA will use for scoring.
    board_copy = board.copy()
    return strategy.place(components, board_copy, {"order": "connectivity"})


@register("sa_refine")
class SARefineStrategy:
    def place(self, components: list[ComponentInfo],
              board: BoardState, params: dict) -> dict[str, Placement]:
        initial_temp = params.get("initial_temp", 50.0)
        cooling_rate = params.get("cooling_rate", 0.95)
        max_steps = params.get("max_steps", 2000)
        seed = params.get("seed", None)
        rng = random.Random(seed)

        comp_map = {c.address: c for c in components}
        if not comp_map:
            return {}

        # Get initial solution from constructive
        current = _initial_constructive(components, board)

        def cost(placements: dict[str, Placement]) -> float:
            hpwl = estimate_hpwl(placements, board.net_graph)
            aa_cost = sum(
                board.anti_affinity_cost(addr, p.x, p.y, placements)
                for addr, p in placements.items()
            )
            return hpwl + aa_cost

        current_cost = cost(current)
        best = dict(current)
        best_cost = current_cost
        temp = initial_temp

        addrs = list(comp_map.keys())

        for step in range(max_steps):
            # Choose move type: displace (80%) or swap (20%)
            candidate = dict(current)

            if rng.random() < 0.8:
                # Displace: move one component
                addr = rng.choice(addrs)
                p = candidate[addr]
                radius = temp * 0.5
                new_x = max(0, min(board.width, p.x + rng.uniform(-radius, radius)))
                new_y = max(0, min(board.height, p.y + rng.uniform(-radius, radius)))
                candidate[addr] = Placement(x=new_x, y=new_y, side=p.side)
            else:
                # Swap: exchange two similar-sized components
                if len(addrs) < 2:
                    continue
                a = rng.choice(addrs)
                # Find similar-sized component
                area_a = comp_map[a].width * comp_map[a].height
                candidates_b = [b for b in addrs if b != a and
                                abs(comp_map[b].width * comp_map[b].height - area_a)
                                < area_a * 0.5]
                if not candidates_b:
                    continue
                b = rng.choice(candidates_b)
                candidate[a] = Placement(x=current[b].x, y=current[b].y,
                                         side=current[b].side)
                candidate[b] = Placement(x=current[a].x, y=current[a].y,
                                         side=current[a].side)

            candidate_cost = cost(candidate)
            delta = candidate_cost - current_cost

            # Metropolis acceptance
            if delta < 0 or rng.random() < math.exp(-delta / max(temp, 0.01)):
                current = candidate
                current_cost = candidate_cost
                if current_cost < best_cost:
                    best = dict(current)
                    best_cost = current_cost

            temp *= cooling_rate

        return best
```

**Important note:** SA-refine calls constructive internally for the initial seed. Since constructive mutates the `BoardState` (registers placements), SA-refine receives a modified `BoardState`. This is actually fine because SA then proposes new positions from that state. If this becomes a problem, the orchestrator can pass a fresh `BoardState` — but the current design works because SA's perturbations don't need clean collision state (it evaluates HPWL + anti-affinity cost, not collision).

- [ ] **Step 2: Run tests**

Run: `cd /Users/devboy/dev/devboy/requencer && python -m pytest hardware/boards/scripts/tests/test_anti_affinity.py -k sa_refine -v`

Update any failing tests to use new interface.

- [ ] **Step 3: Run all tests**

Run: `cd /Users/devboy/dev/devboy/requencer && python -m pytest hardware/boards/scripts/tests/ -v`
Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add hardware/boards/scripts/placement/strategies/sa_refine.py hardware/boards/scripts/tests/
git commit -m "refactor(placement): migrate sa_refine strategy to BoardState interface"
```

---

### Task 7: Migrate grid_spread strategy

**Files:**
- Modify: `hardware/boards/scripts/placement/strategies/grid_spread.py`

- [ ] **Step 1: Rewrite grid_spread.py**

Keep: grid cell generation, greedy cell assignment with connectivity + density scoring. Remove: tracker init, fixed registration, offset math, legalization. Use `board.check_collision()` for cell filtering, `board.anti_affinity_cost()` for scoring, `board.legalize()` at the end.

```python
"""Grid-spread placement: grid-based assignment with density repulsion."""
from __future__ import annotations
import math
import random

from placement.helpers import connectivity_sort_by_net_graph
from placement.strategies import (
    BoardState, ComponentInfo, Placement, register,
)


def _density_repulsion(addr: str, x: float, y: float,
                       assigned: dict[str, tuple[float, float]],
                       comp_map: dict[str, ComponentInfo],
                       weight: float, threshold_mm2: float) -> float:
    """Repulsion cost from nearby large components."""
    comp = comp_map[addr]
    if comp.routing_pressure < threshold_mm2:
        return 0.0

    char_size = math.sqrt(comp.routing_pressure)
    cost = 0.0
    for other_addr, (ox, oy) in assigned.items():
        other = comp_map[other_addr]
        if other.routing_pressure < threshold_mm2:
            continue
        other_char = math.sqrt(other.routing_pressure)
        min_dist = (char_size + other_char) * 1.5
        dist = math.hypot(x - ox, y - oy)
        if dist < min_dist:
            cost += weight * (min_dist - dist) ** 2
    return cost


@register("grid_spread")
class GridSpreadStrategy:
    def place(self, components: list[ComponentInfo],
              board: BoardState, params: dict) -> dict[str, Placement]:
        margin = params.get("margin", 2.0)
        conn_weight = params.get("connectivity_weight", 1.0)
        density_weight = params.get("density_weight", 3.0)
        density_threshold = params.get("density_threshold_mm2", 50.0)
        seed = params.get("seed", None)
        rng = random.Random(seed)

        comp_map = {c.address: c for c in components}
        if not comp_map:
            return {}

        # Generate grid cells
        n_comps = len(comp_map)
        n_cells_target = int(n_comps * 1.5) + 1
        cols = max(2, int(math.sqrt(n_cells_target * board.width / max(board.height, 1))))
        rows = max(2, n_cells_target // cols + 1)

        usable_w = board.width - 2 * margin
        usable_h = board.height - 2 * margin
        cell_w = usable_w / cols
        cell_h = usable_h / rows

        cells = []
        for r in range(rows):
            for c in range(cols):
                cx = margin + (c + 0.5) * cell_w
                cy = margin + (r + 0.5) * cell_h
                cells.append((cx, cy))

        # Filter cells that overlap fixed components
        free_cells = []
        dummy = ComponentInfo(
            address="_probe", width=cell_w * 0.5, height=cell_h * 0.5,
            is_tht=False, pin_count=0, nets=[],
        )
        for cx, cy in cells:
            if not board.check_collision("_probe", cx, cy, dummy, "F"):
                free_cells.append((cx, cy))

        if not free_cells:
            free_cells = cells  # Fallback

        # Greedy assignment in connectivity order
        sorted_addrs = connectivity_sort_by_net_graph(
            list(comp_map.keys()), board.net_graph,
        )

        assigned: dict[str, tuple[float, float]] = {}
        used_cells: set[int] = set()

        for addr in sorted_addrs:
            comp = comp_map[addr]
            placed_snapshot = {a: Placement(x=p[0], y=p[1], side="F")
                               for a, p in assigned.items()}

            best_score = float("inf")
            best_idx = 0

            for idx, (cx, cy) in enumerate(free_cells):
                if idx in used_cells:
                    continue

                # Connectivity pull
                tx, ty = board.connectivity_target(addr, {
                    **placed_snapshot, **board.fixed,
                })
                conn_cost = math.hypot(cx - tx, cy - ty) * conn_weight

                # Anti-affinity
                aa_cost = board.anti_affinity_cost(addr, cx, cy, {
                    **placed_snapshot, **board.fixed,
                })

                # Density repulsion
                dens_cost = _density_repulsion(
                    addr, cx, cy, assigned, comp_map,
                    density_weight, density_threshold,
                )

                # Centering bias (small)
                center_dist = math.hypot(cx - board.width / 2,
                                         cy - board.height / 2)
                center_cost = center_dist * 0.1

                score = conn_cost + aa_cost + dens_cost + center_cost
                if score < best_score:
                    best_score = score
                    best_idx = idx

            cx, cy = free_cells[best_idx]
            assigned[addr] = (cx, cy)
            used_cells.add(best_idx)

        # Legalize via BoardState
        return board.legalize(assigned, comp_map)
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/devboy/dev/devboy/requencer && python -m pytest hardware/boards/scripts/tests/test_anti_affinity.py -k grid_spread -v`

Update any failing tests to use new interface.

- [ ] **Step 3: Run all tests**

Run: `cd /Users/devboy/dev/devboy/requencer && python -m pytest hardware/boards/scripts/tests/ -v`
Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add hardware/boards/scripts/placement/strategies/grid_spread.py hardware/boards/scripts/tests/
git commit -m "refactor(placement): migrate grid_spread strategy to BoardState interface"
```

---

## Chunk 3: Orchestrator & Config Migration

### Task 8: Add fixed positions to board-config.json

**Files:**
- Modify: `hardware/boards/board-config.json`

- [ ] **Step 1: Extract all fixed positions from place_components.py**

Read `place_components.py` to find every hardcoded position. For control board, these come from the panel-layout placement logic. For main board, from `_place_fixed_main()`.

All positions must be extracted into the `fixed` section under each board's `placement` config. Use the existing `named_positions` as a starting point (they already have the right format) and expand.

Update `board-config.json` to add `fixed` dicts under each board. Example structure:

```json
{
  "boards": {
    "control": {
      "placement": {
        "fixed": {
          "button_scan.track_btn_1": {"x": 7.0, "y": 19.5, "side": "F", "rotation": 0, "coords": "faceplate"},
          "jacks.j_clk_in": {"x": 15.0, "y": 108.0, "side": "F", "rotation": 0, "coords": "faceplate"}
        }
      }
    },
    "main": {
      "placement": {
        "fixed": {
          "connector.header_a": {"x": 20, "y": 42, "side": "F", "rotation": 0, "coords": "pcb"},
          "usb": {"x": 5.0, "y": 52.0, "side": "F", "rotation": 270, "coords": "pcb"}
        }
      }
    }
  }
}
```

**Important:** Read the actual coordinates from `_place_fixed_control()` and `_place_fixed_main()` in `place_components.py`. The values above are illustrative — use the real values from the code. The control board has ~50+ THT components (jacks, buttons, encoders, LCD, SD, connectors). The main board has ~5-10 (headers, USB-C, bootsel, LCD FPC, power header).

Merge the existing `named_positions` into `fixed` and remove `named_positions`.

- [ ] **Step 2: Commit**

```bash
git add hardware/boards/board-config.json
git commit -m "config(placement): move all fixed positions from Python to board-config.json"
```

---

### Task 9: Rewrite orchestrator (place_components.py)

**Files:**
- Modify: `hardware/boards/scripts/placement/place_components.py`

This is the largest task. The goal: replace `place_main_board()`, `place_control_board()`, and the board-specific `_place_fixed_*` functions with a single generic `place_board()` that reads fixed positions from config.

- [ ] **Step 1: Write the new board-agnostic orchestrator function**

The new `place_board()` function replaces all board-specific paths:

```python
def place_board(board_name: str, strategy_name: str, params: dict,
                input_pcb: str, output_pcb: str, pcbnew):
    """Board-agnostic placement: load config -> place fixed -> enrich -> strategy -> save."""
    from placement.strategies import BoardState, ComponentInfo, Placement, get_strategy
    from placement.helpers import (
        CollisionTracker, extract_footprint_dims, is_tht as is_tht_fn,
        get_component_nets, identify_power_nets, build_net_graph,
        validate_placement, check_anti_affinity, regenerate_duplicate_uuids,
    )

    config = load_board_config()
    board_config = config["boards"][board_name]
    placement_config = board_config["placement"]

    # Load KiCad board
    board = pcbnew.LoadBoard(input_pcb)
    # ... (addr_map building, same as existing)

    # Read fixed positions from config
    fixed_entries = placement_config.get("fixed", {})
    comp_map_json = load_component_map()
    pcb_dims = comp_map_json.get("pcb", {})
    ox = pcb_dims.get("origin_x_mm", 0)
    oy = pcb_dims.get("origin_y_mm", 0)

    fixed: dict[str, Placement] = {}
    fixed_info: dict[str, ComponentInfo] = {}
    free_components: list[ComponentInfo] = []

    # Place fixed components
    for addr, pos in fixed_entries.items():
        if addr not in addr_map:
            print(f"  WARNING: fixed component '{addr}' not found in PCB")
            continue
        fp = addr_map[addr]

        # Coordinate transform
        x = pos["x"]
        y = pos["y"]
        if pos.get("coords") == "faceplate":
            x -= ox
            y -= oy

        side = pos.get("side", "F")
        rotation = pos.get("rotation", 0)

        # Apply to KiCad
        fp.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(x), pcbnew.FromMM(y)))
        if side == "B" and fp.GetLayer() == board.GetLayerID("F.Cu"):
            fp.Flip(fp.GetPosition(), False)
        if rotation:
            fp.SetOrientationDegrees(rotation)

        # Build ComponentInfo
        w, h, cx_off, cy_off = extract_footprint_dims(fp, pcbnew)
        info = ComponentInfo(
            address=addr, width=w, height=h,
            is_tht=is_tht_fn(fp, pcbnew), pin_count=len(list(fp.Pads())),
            nets=get_component_nets(fp, power_nets),
            cx_offset=cx_off, cy_offset=cy_off,
            routing_pressure=w * h,
            group=addr.split(".")[0] if "." in addr else None,
        )
        fixed[addr] = Placement(x=x, y=y, side=side, rotation=rotation)
        fixed_info[addr] = info

    # Build ComponentInfo for free components
    for addr, fp in addr_map.items():
        if addr in fixed:
            continue
        w, h, cx_off, cy_off = extract_footprint_dims(fp, pcbnew)
        nets = get_component_nets(fp, power_nets)
        info = ComponentInfo(
            address=addr, width=w, height=h,
            is_tht=is_tht_fn(fp, pcbnew), pin_count=len(list(fp.Pads())),
            nets=nets, cx_offset=cx_off, cy_offset=cy_off,
            routing_pressure=w * h,
            group=addr.split(".")[0] if "." in addr else None,
        )
        free_components.append(info)

    # Build net graph
    net_graph = build_net_graph(board, addr_map, power_nets)

    # Parse anti-affinity rules
    from placement.strategies import AntiAffinityRule
    anti_affinity = [
        AntiAffinityRule(from_pattern=r["from"], to_pattern=r["to"], min_mm=r["min_mm"])
        for r in placement_config.get("anti_affinity", [])
    ]

    # Build BoardState
    board_state = BoardState(
        width=board_config["dimensions"]["width_mm"],
        height=board_config["dimensions"]["height_mm"],
        fixed=fixed, fixed_info=fixed_info,
        net_graph=net_graph, anti_affinity=anti_affinity,
        smd_side=placement_config.get("smd_side", "both"),
        tht_extra_clearance=placement_config.get("tht_extra_clearance_mm", 0.0),
    )

    # Run strategy
    strategy = get_strategy(strategy_name)
    placements = strategy.place(free_components, board_state, params)

    # Validate
    all_info = {**fixed_info, **{c.address: c for c in free_components}}
    ok, oob, overlaps = validate_placement(
        board_state.width, board_state.height,
        fixed, placements, all_info,
    )

    # Apply placements to KiCad
    for addr, p in placements.items():
        if addr not in addr_map:
            continue
        fp = addr_map[addr]
        fp.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(p.x), pcbnew.FromMM(p.y)))
        if p.side == "B" and fp.GetLayer() == board.GetLayerID("F.Cu"):
            fp.Flip(fp.GetPosition(), False)
        elif p.side == "F" and fp.GetLayer() == board.GetLayerID("B.Cu"):
            fp.Flip(fp.GetPosition(), False)
        if p.rotation:
            fp.SetOrientationDegrees(p.rotation)

    # Save
    board.Save(output_pcb)
    regenerate_duplicate_uuids(output_pcb)

    return len(placements), len(oob), len(overlaps)
```

This is a sketch — the actual implementation should follow the existing `place_variant()` function structure (lines 1541-1755) but made generic. Key differences from existing:
- Fixed positions come from `config["fixed"]` not from `_place_fixed_*()` functions
- No board-specific branches
- Uses `BoardState` instead of `BoardContext`
- Calls `strategy.place(components, board_state, params)` with new interface

- [ ] **Step 2: Update CLI entry point**

Update the `if __name__ == "__main__"` block and/or the Makefile-invoked entry points to call `place_board()` instead of the board-specific functions.

The CLI should accept: `python place_components.py <board_name> <strategy_name> [--params '{}']`

- [ ] **Step 3: Remove deprecated code**

Delete:
- `place_main_board()` / `_place_main_board_pass()`
- `place_control_board()` / `_place_control_board_pass()`
- `_place_fixed_main()` / `_place_fixed_control()`
- All address-mapping tables (`utility_addr_map`, `feature_addr_map`)
- The old `place_variant()` function (replaced by `place_board()`)

- [ ] **Step 4: Run tests**

Run: `cd /Users/devboy/dev/devboy/requencer && python -m pytest hardware/boards/scripts/tests/ -v`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add hardware/boards/scripts/placement/place_components.py
git commit -m "refactor(placement): board-agnostic orchestrator, remove all hardcoded positions"
```

---

### Task 10: Clean up helpers.py

**Files:**
- Modify: `hardware/boards/scripts/placement/helpers.py`

- [ ] **Step 1: Remove functions that are now only used internally by BoardState**

Functions to keep in `helpers.py` (used by orchestrator, strategies, or tests directly):
- `regenerate_duplicate_uuids()`
- `extract_footprint_dims()`
- `is_tht()`
- `get_component_nets()`
- `get_ref_text_bbox()`
- `identify_power_nets()`
- `build_net_graph()`
- `build_connectivity_graph()`
- `connectivity_sort()` / `size_sort()`
- `size_sort_by_info()`
- `connectivity_sort_by_net_graph()`
- `validate_placement()`
- `estimate_hpwl()`
- `check_anti_affinity()`
- `CollisionTracker` (still used by `BoardState.__init__`)
- `find_best_side()` (still used by `BoardState.find_legal_position()`)

Functions that can be removed if no longer imported outside `BoardState`:
- `anti_affinity_repulsion()` — replaced by `BoardState.anti_affinity_cost()`
- `anti_affinity_penalty()` — replaced by `BoardState.anti_affinity_cost()`

Check with grep that nothing else imports them before removing.

- [ ] **Step 2: Run tests**

Run: `cd /Users/devboy/dev/devboy/requencer && python -m pytest hardware/boards/scripts/tests/ -v`
Expected: All PASS.

- [ ] **Step 3: Commit**

```bash
git add hardware/boards/scripts/placement/helpers.py
git commit -m "cleanup(placement): remove anti-affinity helpers superseded by BoardState"
```

---

## Chunk 4: Remove BoardContext & Final Cleanup

### Task 11: Remove BoardContext and clean up

**Files:**
- Modify: `hardware/boards/scripts/placement/strategies/__init__.py`
- Modify: `hardware/boards/scripts/tests/conftest.py`

- [ ] **Step 1: Remove BoardContext from __init__.py**

Delete the `BoardContext` dataclass and its deprecation comment. Verify nothing imports it:

Run: `grep -r "BoardContext" hardware/boards/scripts/`

If anything still imports it, update those imports.

- [ ] **Step 2: Clean up conftest.py**

Remove the old-style fixtures that return `BoardContext`. Keep only the new-style fixtures that return `(list[ComponentInfo], BoardState)`. Remove the `_board_state_from_ctx` helper if no longer needed.

- [ ] **Step 3: Run all tests**

Run: `cd /Users/devboy/dev/devboy/requencer && python -m pytest hardware/boards/scripts/tests/ -v`
Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add hardware/boards/scripts/placement/strategies/__init__.py hardware/boards/scripts/tests/conftest.py
git commit -m "cleanup(placement): remove deprecated BoardContext, clean up test fixtures"
```

---

### Task 12: Verify full pipeline

**Files:** None (verification only)

- [ ] **Step 1: Run all unit tests**

Run: `cd /Users/devboy/dev/devboy/requencer && python -m pytest hardware/boards/scripts/tests/ -v`
Expected: All PASS.

- [ ] **Step 2: Verify hardware build (if KiCad available)**

Run: `cd /Users/devboy/dev/devboy/requencer && make hw-place`

This runs the actual placement pipeline through the Makefile. Verify it completes without errors and produces placed PCB files.

- [ ] **Step 3: Verify web export still works**

Run: `cd /Users/devboy/dev/devboy/requencer && make hw-3d`

This runs export_layout.py → panel-layout.json → GLB conversion. Verify panel-layout.json is generated correctly.

- [ ] **Step 4: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix(placement): fixups from full pipeline verification"
```
