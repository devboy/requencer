# Bypass Capacitor Placement Priority — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Place bypass/decoupling capacitors immediately after their associated IC and target them at the IC's power pins, not the centroid of all power net members.

**Architecture:** Three coordinated changes — (1) net-based detection of bypass caps and their IC association in `connectivity.py`, (2) ordering interleave helper in `wavefront.py`, (3) power-net neighbor filtering in `_best_position_and_rotation`. Threading via new `power_nets` field on `Board` → `PlacementContext.bypass_map()`.

**Tech Stack:** Python, placer library (`hardware/boards/scripts/placer/`)

**Spec:** `docs/superpowers/specs/2026-03-23-bypass-cap-placement-priority-design.md`

---

### File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `placer/dtypes.py` | Modify | Add `power_nets: frozenset[str]` field to `Board` |
| `placer/connectivity.py` | Modify | Add `identify_bypass_caps()` function |
| `placer/strategies/wavefront.py` | Modify | Add `_interleave_bypass_caps()` helper; modify `_best_position_and_rotation` and all 3 strategies |
| `placer/context.py` | Modify | Add `bypass_map()` method using lazy cache |
| `placer/kicad_bridge.py` | Modify | Accept and pass `power_nets` in `build_placer_board` |
| `placement/place_components.py` | Modify | Pass `power_nets` through to `build_placer_board` |
| `placer/tests/test_connectivity.py` | Modify | Add tests for `identify_bypass_caps` |
| `placer/tests/test_wavefront.py` | Create | Tests for `_interleave_bypass_caps` and bypass targeting |

---

### Task 1: Add `power_nets` field to `Board` dataclass

**Files:**
- Modify: `hardware/boards/scripts/placer/dtypes.py:112-123`

- [ ] **Step 1: Add field to Board**

In `placer/dtypes.py`, add `power_nets` field to the `Board` dataclass after `smd_side`:

```python
@dataclass
class Board:
    """The complete placement problem definition."""
    width: float   # mm
    height: float  # mm
    components: list[Component] = field(default_factory=list)
    nets: list[Net] = field(default_factory=list)
    rotation_nets: list[Net] = field(default_factory=list)  # includes power nets
    zones: list[BlockedZone] = field(default_factory=list)
    affinity_rules: list[AffinityRule] = field(default_factory=list)
    clearance: float = 0.5      # mm, minimum gap between components
    tht_clearance: float = 0.0  # mm, extra clearance around THT parts
    smd_side: str = "both"      # "front", "back", or "both"
    power_nets: frozenset[str] = field(default_factory=frozenset)  # power/bus net names
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `cd /Users/devboy/dev/devboy/requencer/hardware/boards/scripts && PYTHONPATH=. python -m pytest placer/tests/ -v`

Expected: All existing tests pass (new field has default `frozenset()` — backwards compatible).

---

### Task 2: Thread `power_nets` through bridge and orchestrator

**Files:**
- Modify: `hardware/boards/scripts/placer/kicad_bridge.py:204-229`
- Modify: `hardware/boards/scripts/placement/place_components.py:480-488`

- [ ] **Step 1: Add `power_nets` param to `build_placer_board`**

In `placer/kicad_bridge.py`, add `power_nets` parameter to `build_placer_board` and pass it to `Board`:

```python
def build_placer_board(
    board_w: float,
    board_h: float,
    bridges: dict[str, ComponentBridge],
    nets: list[Net],
    affinity_rules: list[AffinityRule] | None = None,
    zones: list[BlockedZone] | None = None,
    clearance: float = 0.5,
    tht_clearance: float = 0.0,
    smd_side: str = "both",
    rotation_nets: list[Net] | None = None,
    power_nets: frozenset[str] | None = None,
) -> Board:
    """Build a placer Board from extracted data."""
    components = [b.component for b in bridges.values()]
    return Board(
        width=board_w,
        height=board_h,
        components=components,
        nets=nets,
        rotation_nets=rotation_nets or [],
        zones=zones or [],
        affinity_rules=affinity_rules or [],
        clearance=clearance,
        tht_clearance=tht_clearance,
        smd_side=smd_side,
        power_nets=power_nets or frozenset(),
    )
```

- [ ] **Step 2: Pass `power_nets` from orchestrator**

In `placement/place_components.py`, around line 480-488 where `build_placer_board` is called, add the `power_nets` argument:

```python
    placer_board = build_placer_board(
        board_w, board_h, bridges, nets,
        affinity_rules=affinity_rules,
        zones=zones,
        clearance=0.5,
        tht_clearance=tht_extra,
        smd_side=placer_smd_side,
        rotation_nets=rotation_nets,
        power_nets=frozenset(power_nets),
    )
```

- [ ] **Step 3: Verify existing tests still pass**

Run: `cd /Users/devboy/dev/devboy/requencer/hardware/boards/scripts && PYTHONPATH=. python -m pytest placer/tests/ -v`

Expected: All pass — `power_nets` has a default.

---

### Task 3: Implement `identify_bypass_caps()` with TDD

**Files:**
- Modify: `hardware/boards/scripts/placer/connectivity.py:295` (append after `build_clusters`)
- Modify: `hardware/boards/scripts/placer/tests/test_connectivity.py` (append new test class)

- [ ] **Step 1: Write failing tests**

Append to `placer/tests/test_connectivity.py`:

```python
from placer.connectivity import identify_bypass_caps


class TestIdentifyBypassCaps:
    def _make_comp(self, cid, n_pins=2, group=None):
        """Helper: create component with n_pins dummy pins."""
        pins = [Pin(str(i), float(i), 0.0) for i in range(n_pins)]
        return Component(id=cid, width=2, height=1, pins=pins,
                         group=group)

    def test_basic_bypass_cap(self):
        """Cap with all connections on power nets → bypass, associated to IC."""
        comps = {
            "dac.u1": self._make_comp("dac.u1", n_pins=8, group="dac"),
            "dac.c_100n": self._make_comp("dac.c_100n", group="dac"),
        }
        # rotation_nets include power nets
        rot_nets = [
            Net("AVDD", (("dac.u1", "AVDD"), ("dac.c_100n", "AVDD"))),
            Net("GND", (("dac.u1", "GND"), ("dac.c_100n", "GND"))),
        ]
        power = frozenset(["AVDD", "GND"])
        board = Board(width=100, height=50, components=list(comps.values()),
                      rotation_nets=rot_nets, power_nets=power)

        result = identify_bypass_caps(board)
        assert result == {"dac.c_100n": "dac.u1"}

    def test_filter_cap_excluded(self):
        """Cap connected to a signal net is NOT bypass."""
        comps = {
            "dac.u1": self._make_comp("dac.u1", n_pins=8, group="dac"),
            "dac.c_filt": self._make_comp("dac.c_filt", group="dac"),
        }
        rot_nets = [
            Net("VREF", (("dac.u1", "VREF"), ("dac.c_filt", "VREF"))),
            Net("GND", (("dac.u1", "GND"), ("dac.c_filt", "GND"))),
        ]
        # VREF is a signal net, not in power_nets
        power = frozenset(["GND"])
        board = Board(width=100, height=50, components=list(comps.values()),
                      rotation_nets=rot_nets, power_nets=power)

        result = identify_bypass_caps(board)
        assert result == {}  # c_filt has signal net connection

    def test_resistor_excluded(self):
        """Resistors are passives but not caps — excluded."""
        comps = {
            "dac.u1": self._make_comp("dac.u1", n_pins=8, group="dac"),
            "dac.r_pullup": self._make_comp("dac.r_pullup", group="dac"),
        }
        rot_nets = [
            Net("VCC", (("dac.u1", "VCC"), ("dac.r_pullup", "VCC"))),
            Net("GND", (("dac.u1", "GND"), ("dac.r_pullup", "GND"))),
        ]
        power = frozenset(["VCC", "GND"])
        board = Board(width=100, height=50, components=list(comps.values()),
                      rotation_nets=rot_nets, power_nets=power)

        result = identify_bypass_caps(board)
        assert result == {}  # r_pullup starts with r_, not c_

    def test_no_group_excluded(self):
        """Cap without dotted address → no group → excluded."""
        comps = {
            "u1": self._make_comp("u1", n_pins=8),
            "c_100n": self._make_comp("c_100n"),
        }
        rot_nets = [
            Net("VCC", (("u1", "VCC"), ("c_100n", "VCC"))),
            Net("GND", (("u1", "GND"), ("c_100n", "GND"))),
        ]
        power = frozenset(["VCC", "GND"])
        board = Board(width=100, height=50, components=list(comps.values()),
                      rotation_nets=rot_nets, power_nets=power)

        result = identify_bypass_caps(board)
        assert result == {}  # no group prefix

    def test_tiebreak_by_pin_count(self):
        """When multiple ICs share same power nets, pick the one with most pins."""
        comps = {
            "dac.u1": self._make_comp("dac.u1", n_pins=28, group="dac"),
            "dac.opamp": self._make_comp("dac.opamp", n_pins=8, group="dac"),
            "dac.c_100n": self._make_comp("dac.c_100n", group="dac"),
        }
        rot_nets = [
            Net("AVDD", (("dac.u1", "AVDD"), ("dac.opamp", "AVDD"),
                         ("dac.c_100n", "AVDD"))),
            Net("GND", (("dac.u1", "GND"), ("dac.opamp", "GND"),
                        ("dac.c_100n", "GND"))),
        ]
        power = frozenset(["AVDD", "GND"])
        board = Board(width=100, height=50, components=list(comps.values()),
                      rotation_nets=rot_nets, power_nets=power)

        result = identify_bypass_caps(board)
        # Both ICs share 2 power nets with cap — tiebreak by pin count → u1 (28 > 8)
        assert result == {"dac.c_100n": "dac.u1"}

    def test_multiple_bypass_caps(self):
        """Multiple caps can be bypass for same or different ICs."""
        comps = {
            "dac.u1": self._make_comp("dac.u1", n_pins=28, group="dac"),
            "dac.opamp": self._make_comp("dac.opamp", n_pins=8, group="dac"),
            "dac.c_u1_100n": self._make_comp("dac.c_u1_100n", group="dac"),
            "dac.c_op_100n": self._make_comp("dac.c_op_100n", group="dac"),
        }
        rot_nets = [
            Net("AVDD", (("dac.u1", "AVDD"), ("dac.c_u1_100n", "AVDD"))),
            Net("DVDD", (("dac.opamp", "DVDD"), ("dac.c_op_100n", "DVDD"))),
            Net("GND", (("dac.u1", "GND"), ("dac.opamp", "GND"),
                        ("dac.c_u1_100n", "GND"), ("dac.c_op_100n", "GND"))),
        ]
        power = frozenset(["AVDD", "DVDD", "GND"])
        board = Board(width=100, height=50, components=list(comps.values()),
                      rotation_nets=rot_nets, power_nets=power)

        result = identify_bypass_caps(board)
        # c_u1_100n shares AVDD+GND with u1 (2 nets) and only GND with opamp (1 net)
        assert result["dac.c_u1_100n"] == "dac.u1"
        # c_op_100n shares DVDD+GND with opamp (2 nets) and only GND with u1 (1 net)
        assert result["dac.c_op_100n"] == "dac.opamp"

    def test_no_shared_power_net_excluded(self):
        """Cap on power net but no same-group IC shares it → not bypass."""
        comps = {
            "pwr.reg": self._make_comp("pwr.reg", n_pins=8, group="pwr"),
            "dac.c_100n": self._make_comp("dac.c_100n", group="dac"),
        }
        rot_nets = [
            Net("V3V3", (("pwr.reg", "V3V3"), ("dac.c_100n", "V3V3"))),
            Net("GND", (("pwr.reg", "GND"), ("dac.c_100n", "GND"))),
        ]
        power = frozenset(["V3V3", "GND"])
        board = Board(width=100, height=50, components=list(comps.values()),
                      rotation_nets=rot_nets, power_nets=power)

        result = identify_bypass_caps(board)
        assert result == {}  # pwr.reg is in "pwr" group, not "dac"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/devboy/dev/devboy/requencer/hardware/boards/scripts && PYTHONPATH=. python -m pytest placer/tests/test_connectivity.py::TestIdentifyBypassCaps -v`

Expected: FAIL — `ImportError: cannot import name 'identify_bypass_caps'`

- [ ] **Step 3: Implement `identify_bypass_caps()`**

Append to `placer/connectivity.py` after `estimate_hpwl` (after line 314):

```python
def identify_bypass_caps(board: Board) -> dict[str, str]:
    """Identify bypass/decoupling caps and map each to its associated IC.

    A component is a bypass cap if:
      1. It's a passive with leaf name starting with 'c_'
      2. ALL of its nets (in rotation_nets) are power nets
      3. A non-passive in the same address group shares ≥1 power net

    Returns {bypass_cap_id: associated_ic_id}.
    The IC is chosen by most shared power nets, tiebroken by pin count.
    """
    if not board.power_nets:
        return {}

    # Build rotation net graph (includes power nets)
    rot_graph = build_net_graph(board, use_rotation_nets=True)

    # Per-component: which nets it appears on
    comp_nets: dict[str, set[str]] = defaultdict(set)
    for net_id, comp_ids in rot_graph.items():
        for cid in comp_ids:
            comp_nets[cid].add(net_id)

    # Index components by id
    comp_map = {c.id: c for c in board.components}

    # Group by address prefix
    groups: dict[str, list[str]] = defaultdict(list)
    for c in board.components:
        if "." in c.id:
            prefix = c.id.split(".")[0]
            groups[prefix].append(c.id)

    bypass_map: dict[str, str] = {}

    for cid, comp in comp_map.items():
        # Must be a capacitor passive
        if "." not in cid:
            continue
        leaf = cid.rsplit(".", 1)[1]
        if not leaf.lower().startswith("c_"):
            continue

        # All nets must be power nets
        nets = comp_nets.get(cid, set())
        if not nets:
            continue
        if not nets.issubset(board.power_nets):
            continue

        # Find non-passive ICs in same group sharing power nets
        prefix = cid.split(".")[0]
        group_ids = groups.get(prefix, [])

        best_ic: str | None = None
        best_shared = 0
        best_pins = 0

        for other_id in group_ids:
            if other_id == cid:
                continue
            if _is_passive_id(other_id):
                continue
            other_nets = comp_nets.get(other_id, set())
            shared = len(nets & other_nets)
            if shared == 0:
                continue
            other_pins = len(comp_map[other_id].pins)
            if (shared > best_shared or
                    (shared == best_shared and other_pins > best_pins)):
                best_ic = other_id
                best_shared = shared
                best_pins = other_pins

        if best_ic is not None:
            bypass_map[cid] = best_ic

    return bypass_map
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/devboy/dev/devboy/requencer/hardware/boards/scripts && PYTHONPATH=. python -m pytest placer/tests/test_connectivity.py::TestIdentifyBypassCaps -v`

Expected: All 7 tests PASS.

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `cd /Users/devboy/dev/devboy/requencer/hardware/boards/scripts && PYTHONPATH=. python -m pytest placer/tests/ -v`

Expected: All tests pass.

---

### Task 4: Add `bypass_map()` to `PlacementContext`

**Files:**
- Modify: `hardware/boards/scripts/placer/context.py:22-25` (imports)
- Modify: `hardware/boards/scripts/placer/context.py:69-71` (lazy cache init)
- Modify: `hardware/boards/scripts/placer/context.py:388-393` (after `clusters()` method)

- [ ] **Step 1: Add import**

In `placer/context.py` line 22-25, add `identify_bypass_caps` to the connectivity import:

```python
from .connectivity import (
    build_adjacency, build_circuits, build_clusters, build_net_graph,
    compute_wave_distances, connectivity_sort, estimate_hpwl,
    identify_bypass_caps,
)
```

- [ ] **Step 2: Add cache field**

In `PlacementContext.__init__`, after line 71 (`self._clusters`), add:

```python
        self._bypass_map: dict[str, str] | None = None
```

- [ ] **Step 3: Add `bypass_map()` method**

After the `clusters()` method (around line 393), add:

```python
    def bypass_map(self) -> dict[str, str]:
        """Return bypass cap → associated IC mapping."""
        if self._bypass_map is None:
            self._bypass_map = identify_bypass_caps(self.board)
        return self._bypass_map
```

- [ ] **Step 4: Reset cache in `reset()`**

In the `reset()` method (around line 443-450), add `self._bypass_map = None` alongside the other cache resets:

```python
    def reset(self) -> None:
        """Reset to initial state (only fixed components registered)."""
        new_ctx = PlacementContext(self.board)
        self._grid = new_ctx._grid
        self._circuits = None
        self._wave_distances = None
        self._clusters = None
        self._bypass_map = None
```

- [ ] **Step 5: Verify existing tests still pass**

Run: `cd /Users/devboy/dev/devboy/requencer/hardware/boards/scripts && PYTHONPATH=. python -m pytest placer/tests/ -v`

Expected: All pass.

---

### Task 5: Implement `_interleave_bypass_caps()` with TDD

**Files:**
- Create: `hardware/boards/scripts/placer/tests/test_wavefront.py`
- Modify: `hardware/boards/scripts/placer/strategies/wavefront.py:460-469` (before strategies section)

- [ ] **Step 1: Write failing tests**

Create `placer/tests/test_wavefront.py`:

```python
"""Tests for wavefront strategy helpers."""

from placer.strategies.wavefront import _interleave_bypass_caps


class TestInterleaveBypassCaps:
    def test_basic_interleave(self):
        """Bypass caps move to right after their IC."""
        ordered = ["dac.u1", "dac.opamp", "dac.c_u1_100n", "dac.c_op_100n"]
        bypass_map = {
            "dac.c_u1_100n": "dac.u1",
            "dac.c_op_100n": "dac.opamp",
        }
        result = _interleave_bypass_caps(ordered, bypass_map)
        assert result == [
            "dac.u1", "dac.c_u1_100n",
            "dac.opamp", "dac.c_op_100n",
        ]

    def test_multiple_caps_per_ic(self):
        """Multiple bypass caps follow their IC in original relative order."""
        ordered = ["dac.u1", "dac.c_hf", "dac.c_bulk"]
        bypass_map = {
            "dac.c_hf": "dac.u1",
            "dac.c_bulk": "dac.u1",
        }
        result = _interleave_bypass_caps(ordered, bypass_map)
        assert result == ["dac.u1", "dac.c_hf", "dac.c_bulk"]

    def test_non_bypass_caps_unchanged(self):
        """Caps not in bypass_map stay at original position."""
        ordered = ["dac.u1", "dac.c_filter", "dac.c_bypass"]
        bypass_map = {"dac.c_bypass": "dac.u1"}
        result = _interleave_bypass_caps(ordered, bypass_map)
        # c_filter not in bypass_map → stays in place
        # c_bypass → moves after u1
        assert result == ["dac.u1", "dac.c_bypass", "dac.c_filter"]

    def test_empty_bypass_map(self):
        """No bypass caps → order unchanged."""
        ordered = ["a", "b", "c"]
        result = _interleave_bypass_caps(ordered, {})
        assert result == ["a", "b", "c"]

    def test_ic_not_in_list_fixed(self):
        """Bypass cap whose IC is fixed (not in free list) → prepended."""
        ordered = ["dac.opamp", "dac.c_mcu_100n"]
        bypass_map = {"dac.c_mcu_100n": "mcu.pga"}  # mcu.pga is fixed
        result = _interleave_bypass_caps(ordered, bypass_map)
        # Cap's IC not in ordered → cap prepended
        assert result == ["dac.c_mcu_100n", "dac.opamp"]

    def test_mixed_fixed_and_free_ics(self):
        """Mix of bypass caps for fixed and free ICs."""
        ordered = ["dac.u1", "dac.c_free", "pwr.c_fixed"]
        bypass_map = {
            "dac.c_free": "dac.u1",       # u1 is in ordered (free)
            "pwr.c_fixed": "pwr.reg_5v",  # reg_5v not in ordered (fixed)
        }
        result = _interleave_bypass_caps(ordered, bypass_map)
        # pwr.c_fixed prepended (fixed IC), dac.c_free after dac.u1
        assert result == ["pwr.c_fixed", "dac.u1", "dac.c_free"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/devboy/dev/devboy/requencer/hardware/boards/scripts && PYTHONPATH=. python -m pytest placer/tests/test_wavefront.py -v`

Expected: FAIL — `ImportError: cannot import name '_interleave_bypass_caps'`

- [ ] **Step 3: Implement `_interleave_bypass_caps()`**

In `placer/strategies/wavefront.py`, insert before the strategies section (before line 460, after `_escape_padding`):

```python
# ---------------------------------------------------------------------------
# Bypass cap interleaving
# ---------------------------------------------------------------------------


def _interleave_bypass_caps(ordered: list[str],
                            bypass_map: dict[str, str],
                            ) -> list[str]:
    """Reorder so bypass caps follow immediately after their associated IC.

    Caps whose IC is not in the ordered list (e.g., fixed components)
    are prepended — they target a fixed position and benefit from
    being placed early.
    """
    if not bypass_map:
        return list(ordered)

    bypass_ids = set(bypass_map.keys())

    # Build reverse map: ic_id → [cap_ids] preserving original order
    ic_to_caps: dict[str, list[str]] = defaultdict(list)
    for cid in ordered:
        if cid in bypass_ids:
            ic_id = bypass_map[cid]
            ic_to_caps[ic_id].append(cid)

    # Strip bypass caps from ordered list
    stripped = [cid for cid in ordered if cid not in bypass_ids]

    # Find ICs whose caps exist but IC is not in stripped (fixed ICs)
    ics_in_list = set(stripped)
    orphan_caps: list[str] = []
    for ic_id, caps in ic_to_caps.items():
        if ic_id not in ics_in_list:
            orphan_caps.extend(caps)

    # Rebuild: insert each IC's caps after it
    result: list[str] = list(orphan_caps)  # prepend fixed-IC caps
    for cid in stripped:
        result.append(cid)
        if cid in ic_to_caps:
            result.extend(ic_to_caps[cid])

    return result
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/devboy/dev/devboy/requencer/hardware/boards/scripts && PYTHONPATH=. python -m pytest placer/tests/test_wavefront.py -v`

Expected: All 6 tests PASS.

---

### Task 6: Modify `_best_position_and_rotation` for bypass targeting

**Files:**
- Modify: `hardware/boards/scripts/placer/strategies/wavefront.py:218-345`
- Modify: `hardware/boards/scripts/placer/tests/test_wavefront.py` (append test)

- [ ] **Step 1: Write failing test**

Append to `placer/tests/test_wavefront.py`:

```python
from placer.dtypes import Board, Component, Net, Pin, PlacedComponent, Side
from placer.context import PlacementContext
from placer.strategies.wavefront import _best_position_and_rotation


class TestBypassTargeting:
    def test_bypass_cap_targets_ic_not_centroid(self):
        """Bypass cap on GND+AVDD should target its IC, not all GND members."""
        # IC at (50, 25) center, other component at (10, 25)
        ic = Component(id="dac.u1", width=10, height=10,
                       pins=[Pin("AVDD", 5, 0), Pin("GND", 5, 10)],
                       fixed=True, x=45, y=20, group="dac")
        other = Component(id="pwr.reg", width=5, height=5,
                          pins=[Pin("GND", 2.5, 5)],
                          fixed=True, x=7.5, y=22.5, group="pwr")
        cap = Component(id="dac.c_100n", width=2, height=1,
                        pins=[Pin("AVDD", 0, 0.5), Pin("GND", 2, 0.5)],
                        group="dac")

        # Power nets connect cap to IC and other
        rot_nets = [
            Net("AVDD", (("dac.u1", "AVDD"), ("dac.c_100n", "AVDD"))),
            Net("GND", (("dac.u1", "GND"), ("pwr.reg", "GND"),
                        ("dac.c_100n", "GND"))),
        ]
        power = frozenset(["AVDD", "GND"])
        board = Board(width=100, height=50,
                      components=[ic, other, cap],
                      rotation_nets=rot_nets,
                      power_nets=power)
        ctx = PlacementContext(board)

        rot_net_graph = ctx.rotation_net_graph()
        bypass_map = {"dac.c_100n": "dac.u1"}

        # With bypass_map: should target IC, not centroid
        cx_bypass, cy_bypass, _ = _best_position_and_rotation(
            cap, rot_net_graph, {}, ctx, bypass_map=bypass_map)

        # Without bypass_map: would target centroid of IC + pwr.reg on GND
        cx_normal, cy_normal, _ = _best_position_and_rotation(
            cap, rot_net_graph, {}, ctx)

        # Bypass targeting should place cap closer to IC (x=50) than
        # normal targeting (which averages with pwr.reg at x=10)
        assert abs(cx_bypass - 50) < abs(cx_normal - 50), (
            f"Bypass cx={cx_bypass:.1f} should be closer to IC (50) "
            f"than normal cx={cx_normal:.1f}")

    def test_signal_net_not_filtered(self):
        """Bypass cap with a signal net: filtering only on power nets."""
        # IC at x=70, other at x=10. Cap has signal net to both + power to IC.
        ic = Component(id="dac.u1", width=10, height=10,
                       pins=[Pin("AVDD", 5, 0), Pin("GND", 5, 10),
                             Pin("sig", 0, 5)],
                       fixed=True, x=65, y=20, group="dac")
        other = Component(id="dac.opamp", width=4, height=4,
                          pins=[Pin("sig", 2, 0)],
                          fixed=True, x=8, y=23, group="dac")
        cap = Component(id="dac.c_100n", width=2, height=1,
                        pins=[Pin("AVDD", 0, 0.5), Pin("GND", 2, 0.5),
                              Pin("sig", 1, 0)],
                        group="dac")

        rot_nets = [
            Net("AVDD", (("dac.u1", "AVDD"), ("dac.c_100n", "AVDD"))),
            Net("GND", (("dac.u1", "GND"), ("dac.c_100n", "GND"))),
            Net("sig", (("dac.u1", "sig"), ("dac.opamp", "sig"),
                        ("dac.c_100n", "sig"))),
        ]
        power = frozenset(["AVDD", "GND"])
        board = Board(width=100, height=50,
                      components=[ic, other, cap],
                      rotation_nets=rot_nets,
                      power_nets=power)
        ctx = PlacementContext(board)
        rot_net_graph = ctx.rotation_net_graph()

        # Cap is in bypass_map (even though it has a signal net —
        # identify_bypass_caps would exclude it, but we test the
        # filtering behavior directly)
        bypass_map = {"dac.c_100n": "dac.u1"}

        cx, cy, _ = _best_position_and_rotation(
            cap, rot_net_graph, {}, ctx, bypass_map=bypass_map)

        # Power nets filtered to IC only. But signal net "sig" still
        # considers both dac.u1 AND dac.opamp — so cap is pulled
        # somewhat toward opamp (x=10), not purely at IC (x=70).
        # Cap should NOT be at IC center — the signal net pull proves
        # signal-net neighbors are not filtered.
        assert cx < 70, (
            f"Cap at cx={cx:.1f} should be pulled away from IC (70) "
            f"by signal net to opamp at x=10")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/devboy/dev/devboy/requencer/hardware/boards/scripts && PYTHONPATH=. python -m pytest placer/tests/test_wavefront.py::TestBypassTargeting -v`

Expected: FAIL — `_best_position_and_rotation() got an unexpected keyword argument 'bypass_map'`

- [ ] **Step 3: Modify `_best_position_and_rotation` signature**

In `placer/strategies/wavefront.py`, update the function signature (line 218-225) to accept `bypass_map`:

```python
def _best_position_and_rotation(
    comp: Component,
    net_graph: dict[str, list[str]],
    placed: dict[str, PlacedComponent],
    ctx: PlacementContext,
    side: Side = Side.FRONT,
    group_weight: float = 0.5,
    bypass_map: dict[str, str] | None = None,
) -> tuple[float, float, float]:
```

- [ ] **Step 4: Add neighbor filtering logic**

In `_best_position_and_rotation`, in the inner loop that iterates over neighbors on each net (around line 270-285), add filtering for bypass caps. Replace the neighbor iteration block:

The current code at lines 270-285:
```python
        # Find neighbor pin positions on this net
        for other_id in addrs:
            if other_id == comp.id:
                continue
```

Add bypass filtering after the `comp.id` check:

```python
        # Find neighbor pin positions on this net
        for other_id in addrs:
            if other_id == comp.id:
                continue
            # Bypass cap filtering: on power nets, only target the
            # associated IC, ignore all other components.
            if (bypass_map and comp.id in bypass_map and
                    net_id in ctx.board.power_nets):
                if other_id != bypass_map[comp.id]:
                    continue
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/devboy/dev/devboy/requencer/hardware/boards/scripts && PYTHONPATH=. python -m pytest placer/tests/test_wavefront.py -v`

Expected: All tests PASS (both interleave and targeting tests).

- [ ] **Step 6: Run full test suite**

Run: `cd /Users/devboy/dev/devboy/requencer/hardware/boards/scripts && PYTHONPATH=. python -m pytest placer/tests/ -v`

Expected: All pass.

---

### Task 7: Wire bypass map into all three wavefront strategies

**Files:**
- Modify: `hardware/boards/scripts/placer/strategies/wavefront.py:472-554` (wavefront)
- Modify: `hardware/boards/scripts/placer/strategies/wavefront.py:557-640` (wavefront_circuit)
- Modify: `hardware/boards/scripts/placer/strategies/wavefront.py:643-716` (wavefront_direct)

- [ ] **Step 1: Update `wavefront` strategy**

In the `wavefront` function, after building the ordered list (around line 528) and before the placement loop (line 530):

```python
    ordered.extend(sorted(orphans,
                          key=lambda a: _comp_priority_key(comp_map[a])))

    # Bypass cap priority: interleave caps after their ICs
    bypass_map = ctx.bypass_map()
    ordered = _interleave_bypass_caps(ordered, bypass_map)

    # Place
    auto_rotate = params.get("auto_rotate", False)
```

Then in the placement loop (line 540-541), pass `bypass_map`:

```python
        tx, ty, rotation = _best_position_and_rotation(
            comp, rot_net_graph, placements, ctx, bypass_map=bypass_map)
```

- [ ] **Step 2: Update `wavefront_circuit` strategy**

In `wavefront_circuit`, there are two placement loops — the module loop and the orphan loop. Add bypass map before the module loop (after line 600):

```python
    rot_net_graph = ctx.rotation_net_graph()
    bypass_map = ctx.bypass_map()
```

Add interleaving inside the module loop — after sorting `module_ids` (line 606) and before the placement loop (line 608):

```python
        module_ids.sort(key=_priority)
        module_ids = _interleave_bypass_caps(module_ids, bypass_map)
```

Pass `bypass_map` to `_best_position_and_rotation` in both loops (lines 610-611 and 629-630):

```python
            tx, ty, rotation = _best_position_and_rotation(
                comp, rot_net_graph, placements, ctx, bypass_map=bypass_map)
```

Also interleave the orphan list (around line 624-626). Bypass caps connected only to power nets are excluded from the signal net graph, so they become orphans in `compute_wave_distances`. Without this, `wavefront_circuit` would miss most bypass caps:

```python
    # Orphans last
    orphan_ids = sorted(orphans,
                        key=lambda a: _comp_priority_key(comp_map[a]))
    orphan_ids = _interleave_bypass_caps(orphan_ids, bypass_map)
```

- [ ] **Step 3: Update `wavefront_direct` strategy**

Same pattern as `wavefront`. After building `ordered` (line 694-695), add interleaving:

```python
    ordered.extend(sorted(orphans,
                          key=lambda a: _comp_priority_key(comp_map[a])))

    # Bypass cap priority
    bypass_map = ctx.bypass_map()
    ordered = _interleave_bypass_caps(ordered, bypass_map)

    auto_rotate = params.get("auto_rotate", False)
```

And pass `bypass_map` to `_best_position_and_rotation` (lines 705-706):

```python
        tx, ty, rotation = _best_position_and_rotation(
            comp, rot_net_graph, placements, ctx, bypass_map=bypass_map)
```

- [ ] **Step 4: Run full test suite**

Run: `cd /Users/devboy/dev/devboy/requencer/hardware/boards/scripts && PYTHONPATH=. python -m pytest placer/tests/ -v`

Expected: All pass.

---

### Task 8: Integration smoke test

**Files:**
- Modify: `hardware/boards/scripts/placer/tests/test_wavefront.py` (append)

- [ ] **Step 1: Write integration test**

Append to `placer/tests/test_wavefront.py`:

```python
from placer import place


class TestBypassCapIntegration:
    def test_bypass_cap_placed_near_ic(self):
        """End-to-end: bypass cap lands closer to its IC than board center."""
        ic = Component(id="dac.u1", width=10, height=10,
                       pins=[Pin("AVDD", 5, 0), Pin("GND", 5, 10),
                             Pin("sig1", 0, 5), Pin("sig2", 10, 5)],
                       fixed=True, x=70, y=20, group="dac")
        cap = Component(id="dac.c_100n", width=2, height=1,
                        pins=[Pin("AVDD", 0, 0.5), Pin("GND", 2, 0.5)],
                        group="dac")

        signal_nets = [
            Net("sig1", (("dac.u1", "sig1"),)),  # single-component, filtered out
        ]
        rot_nets = [
            Net("AVDD", (("dac.u1", "AVDD"), ("dac.c_100n", "AVDD"))),
            Net("GND", (("dac.u1", "GND"), ("dac.c_100n", "GND"))),
        ]
        power = frozenset(["AVDD", "GND"])
        board = Board(width=100, height=50,
                      components=[ic, cap],
                      nets=signal_nets,
                      rotation_nets=rot_nets,
                      power_nets=power)

        results = place(board, strategy="wavefront")
        assert len(results) == 1
        cap_result = results[0]
        assert cap_result.component_id == "dac.c_100n"

        # Cap should be near IC (center at 75, 25), not at board center (50, 25)
        ic_cx, ic_cy = 75, 25
        cap_cx = cap_result.x + 1  # cap width=2, center offset
        cap_cy = cap_result.y + 0.5
        dist_to_ic = abs(cap_cx - ic_cx) + abs(cap_cy - ic_cy)
        dist_to_center = abs(cap_cx - 50) + abs(cap_cy - 25)

        assert dist_to_ic < 20, (
            f"Cap at ({cap_cx:.1f}, {cap_cy:.1f}) too far from IC: "
            f"dist={dist_to_ic:.1f}mm")
```

- [ ] **Step 2: Run integration test**

Run: `cd /Users/devboy/dev/devboy/requencer/hardware/boards/scripts && PYTHONPATH=. python -m pytest placer/tests/test_wavefront.py::TestBypassCapIntegration -v`

Expected: PASS.

- [ ] **Step 3: Run all placer tests**

Run: `cd /Users/devboy/dev/devboy/requencer/hardware/boards/scripts && PYTHONPATH=. python -m pytest placer/tests/ -v`

Expected: All pass.
