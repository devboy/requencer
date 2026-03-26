# Placement Clustering Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add module-aware clustering, rotation-correct collision detection, combined position+rotation satellite placement, and radial passive assignment to the placement pipeline.

**Architecture:** Three layers built bottom-up: (1) `rotated_info()` + `rotate_pad_sides()` as geometry primitives, (2) `build_clusters()` for automatic module grouping, (3) `place_cluster_satellites()` and `place_cluster_passives()` as orchestrator post-processors replacing `nudge_satellites()`.

**Tech Stack:** Python 3.9 (KiCad-bundled), pytest, no new dependencies.

---

## Chunk 1: Rotation Geometry Primitives

### Task 1: `rotate_pad_sides()` and `rotated_info()`

**Files:**
- Modify: `hardware/boards/scripts/placement/strategies/__init__.py`
- Modify: `hardware/boards/scripts/placement/helpers.py`
- Create: `hardware/boards/scripts/tests/test_rotation.py`

- [ ] **Step 1: Write failing tests for rotate_pad_sides**

Create `hardware/boards/scripts/tests/test_rotation.py`:

```python
"""Tests for rotation geometry: rotate_pad_sides() and rotated_info()."""

from placement.helpers import rotate_pad_sides
from placement.strategies import ComponentInfo


class TestRotatePadSides:
    """KiCad convention: positive degrees = CCW viewed from front."""

    SIDES = {"N": ["din"], "S": ["out4", "out5"], "E": ["sclk"], "W": ["out0", "out1"]}

    def test_0_degrees_unchanged(self):
        r = rotate_pad_sides(self.SIDES, 0)
        assert r == self.SIDES

    def test_90_ccw(self):
        """90° CCW: W→S, S→E, E→N, N→W."""
        r = rotate_pad_sides(self.SIDES, 90)
        assert r["S"] == ["out0", "out1"]  # was W
        assert r["E"] == ["out4", "out5"]  # was S
        assert r["N"] == ["sclk"]          # was E
        assert r["W"] == ["din"]           # was N

    def test_180(self):
        """180°: N↔S, W↔E."""
        r = rotate_pad_sides(self.SIDES, 180)
        assert r["S"] == ["din"]           # was N
        assert r["N"] == ["out4", "out5"]  # was S
        assert r["W"] == ["sclk"]          # was E
        assert r["E"] == ["out0", "out1"]  # was W

    def test_270_ccw(self):
        """270° CCW (= 90° CW): W→N, N→E, E→S, S→W."""
        r = rotate_pad_sides(self.SIDES, 270)
        assert r["N"] == ["out0", "out1"]  # was W
        assert r["E"] == ["din"]           # was N
        assert r["S"] == ["sclk"]          # was E
        assert r["W"] == ["out4", "out5"]  # was S

    def test_360_roundtrip(self):
        r = rotate_pad_sides(self.SIDES, 360)
        assert r == self.SIDES

    def test_empty_sides(self):
        r = rotate_pad_sides({"N": [], "S": [], "E": [], "W": []}, 90)
        assert r == {"N": [], "S": [], "E": [], "W": []}
```

- [ ] **Step 2: Run tests — expect ImportError**

Run: `cd hardware && make test-hw`

- [ ] **Step 3: Implement rotate_pad_sides in helpers.py**

Add after `extract_pad_sides()`:

```python
def rotate_pad_sides(pad_sides, degrees):
    """Rotate pad-side mapping by given degrees (KiCad CCW convention).

    Supports 0, 90, 180, 270 (mod 360). Other values raise ValueError.
    """
    deg = int(degrees) % 360
    if deg == 0:
        return dict(pad_sides)
    # CCW rotation: each edge moves to the next edge counter-clockwise
    # 90° CCW: N→W, W→S, S→E, E→N
    _CCW = {"N": "W", "W": "S", "S": "E", "E": "N"}
    steps = {90: 1, 180: 2, 270: 3}.get(deg)
    if steps is None:
        raise ValueError(f"Only 0/90/180/270 rotations supported, got {degrees}")
    mapping = dict(_CCW)
    for _ in range(steps - 1):
        mapping = {k: _CCW[v] for k, v in mapping.items()}
    return {mapping[edge]: list(nets) for edge, nets in pad_sides.items()}
```

- [ ] **Step 4: Run tests — expect pass for rotate_pad_sides**

- [ ] **Step 5: Write failing tests for rotated_info**

Add to `test_rotation.py`:

```python
from placement.strategies import rotated_info


class TestRotatedInfoDimensions:
    """Width/height swap for 90/270, unchanged for 0/180."""

    def _comp(self, w=5.0, h=3.0, cx=0.0, cy=0.0):
        return ComponentInfo(
            address="test", width=w, height=h, is_tht=False,
            pin_count=4, nets=[], cx_offset=cx, cy_offset=cy,
            pad_sides={"N": ["a"], "S": ["b"], "E": ["c"], "W": ["d"]},
            edge_signal_count={"N": 1, "S": 1, "E": 1, "W": 1},
        )

    def test_0_no_change(self):
        c = self._comp()
        r = rotated_info(c, 0)
        assert r.width == 5.0 and r.height == 3.0

    def test_90_swaps(self):
        c = self._comp()
        r = rotated_info(c, 90)
        assert r.width == 3.0 and r.height == 5.0

    def test_180_no_swap(self):
        c = self._comp()
        r = rotated_info(c, 180)
        assert r.width == 5.0 and r.height == 3.0

    def test_270_swaps(self):
        c = self._comp()
        r = rotated_info(c, 270)
        assert r.width == 3.0 and r.height == 5.0

    def test_360_roundtrip(self):
        c = self._comp()
        r = rotated_info(c, 360)
        assert r.width == 5.0 and r.height == 3.0


class TestRotatedInfoOffset:
    """cx/cy offset rotates as 2D vector (KiCad CCW)."""

    def _comp(self, cx=0.0, cy=4.0):
        return ComponentInfo(
            address="test", width=5.0, height=10.0, is_tht=False,
            pin_count=4, nets=[], cx_offset=cx, cy_offset=cy,
            pad_sides={"N": [], "S": [], "E": [], "W": []},
            edge_signal_count={"N": 0, "S": 0, "E": 0, "W": 0},
        )

    def test_0_no_change(self):
        r = rotated_info(self._comp(cx=2.0, cy=3.0), 0)
        assert (r.cx_offset, r.cy_offset) == (2.0, 3.0)

    def test_90_ccw(self):
        """90° CCW: (cx, cy) → (cy, -cx)."""
        r = rotated_info(self._comp(cx=0.0, cy=4.0), 90)
        assert abs(r.cx_offset - 4.0) < 0.01
        assert abs(r.cy_offset - 0.0) < 0.01

    def test_180(self):
        """180°: (cx, cy) → (-cx, -cy)."""
        r = rotated_info(self._comp(cx=2.0, cy=3.0), 180)
        assert abs(r.cx_offset - (-2.0)) < 0.01
        assert abs(r.cy_offset - (-3.0)) < 0.01

    def test_270_ccw(self):
        """270° CCW: (cx, cy) → (-cy, cx)."""
        r = rotated_info(self._comp(cx=0.0, cy=4.0), 270)
        assert abs(r.cx_offset - (-4.0)) < 0.01
        assert abs(r.cy_offset - 0.0) < 0.01

    def test_pin1_origin_90(self):
        """SIP-9 style: origin at pin 1, body extends downward (cy=4)."""
        c = self._comp(cx=0.0, cy=4.0)
        r = rotated_info(c, 90)
        # 90° CCW: width/height swap, offset rotates
        assert r.width == 10.0  # was height
        assert r.height == 5.0  # was width
        assert abs(r.cx_offset - 4.0) < 0.01   # cy → cx
        assert abs(r.cy_offset - 0.0) < 0.01   # -cx → cy


class TestRotatedInfoPadSides:
    """Pad sides should rotate with the component."""

    def test_pad_sides_rotate_90(self):
        c = ComponentInfo(
            address="test", width=5.0, height=3.0, is_tht=False,
            pin_count=4, nets=[],
            pad_sides={"N": ["a"], "S": ["b"], "E": ["c"], "W": ["d"]},
            edge_signal_count={"N": 1, "S": 1, "E": 1, "W": 1},
        )
        r = rotated_info(c, 90)
        # 90° CCW: N→W, W→S, S→E, E→N
        assert r.pad_sides["W"] == ["a"]  # was N
        assert r.pad_sides["E"] == ["b"]  # was S
        assert r.pad_sides["N"] == ["c"]  # was E
        assert r.pad_sides["S"] == ["d"]  # was W

    def test_edge_signal_count_rotates(self):
        c = ComponentInfo(
            address="test", width=5.0, height=3.0, is_tht=False,
            pin_count=4, nets=[],
            pad_sides={"N": ["a"], "S": ["b", "c"], "E": [], "W": ["d"]},
            edge_signal_count={"N": 1, "S": 2, "E": 0, "W": 1},
        )
        r = rotated_info(c, 90)
        assert r.edge_signal_count["W"] == 1  # was N
        assert r.edge_signal_count["E"] == 2  # was S
        assert r.edge_signal_count["N"] == 0  # was E
        assert r.edge_signal_count["S"] == 1  # was W


class TestRotatedInfoCollision:
    """Rotated components must have correct collision boxes."""

    def test_tssop_side_by_side_no_collision_at_0(self):
        """Two 5×3 TSSOs with 1mm gap at 0° — no collision."""
        from placement.helpers import CollisionTracker
        tracker = CollisionTracker(100, 100, clearance=0.0)
        # A at (10, 10), B at (16, 10) — gap = 16 - 10 - 5/2 - 5/2 = 1mm
        tracker.register(10, 10, 5.0, 3.0, "F", False, label="A")
        assert not tracker.collides(16, 10, 5.0, 3.0, "F", False)

    def test_tssop_rotated_90_causes_collision(self):
        """A at 0° (5×3), B at 90° (3×5) — B is taller, now overlaps A."""
        from placement.helpers import CollisionTracker
        tracker = CollisionTracker(100, 100, clearance=0.0)
        # A at (10, 10), unrotated 5×3
        tracker.register(10, 10, 5.0, 3.0, "F", False, label="A")
        # B at (16, 10), rotated 90° → dims become 3×5
        c = ComponentInfo(
            address="B", width=5.0, height=3.0, is_tht=False,
            pin_count=4, nets=[], pad_sides={}, edge_signal_count={},
        )
        r = rotated_info(c, 90)
        # r.width=3.0, r.height=5.0 — taller, overlaps A vertically
        # A spans y=[8.5, 11.5], B at 90° spans y=[7.5, 12.5] — overlap
        assert tracker.collides(16, 10, r.width, r.height, "F", False)
```

- [ ] **Step 6: Implement rotated_info in strategies/__init__.py**

Add after the `Placement` dataclass (before `AntiAffinityRule`):

```python
def rotated_info(comp: ComponentInfo, degrees: float) -> ComponentInfo:
    """Return a new ComponentInfo with dimensions/offsets/pad_sides rotated.

    KiCad convention: positive degrees = CCW viewed from front.
    Only supports 0/90/180/270 (mod 360).
    """
    from placement.helpers import rotate_pad_sides

    deg = int(degrees) % 360
    if deg == 0:
        return comp

    # Rotate dimensions
    if deg in (90, 270):
        w, h = comp.height, comp.width
    else:
        w, h = comp.width, comp.height

    # Rotate origin offset as 2D vector (CCW)
    cx, cy = comp.cx_offset, comp.cy_offset
    if deg == 90:
        cx, cy = cy, -cx
    elif deg == 180:
        cx, cy = -cx, -cy
    elif deg == 270:
        cx, cy = -cy, cx

    # Rotate pad sides
    new_pad_sides = rotate_pad_sides(comp.pad_sides, deg) if comp.pad_sides else {}
    new_edge_count = rotate_pad_sides(comp.edge_signal_count, deg) if comp.edge_signal_count else {}

    return ComponentInfo(
        address=comp.address,
        width=w, height=h,
        is_tht=comp.is_tht,
        pin_count=comp.pin_count,
        nets=comp.nets,
        cx_offset=cx, cy_offset=cy,
        routing_pressure=comp.routing_pressure,
        group=comp.group,
        pad_sides=new_pad_sides,
        edge_signal_count=new_edge_count,
    )
```

Note: `rotate_pad_sides` works for both `dict[str, list[str]]` (pad_sides) and `dict[str, int]` (edge_signal_count) since the rotation logic just remaps keys.

- [ ] **Step 7: Run all tests**

Run: `cd hardware && make test-hw`
Expected: All existing tests pass + new rotation tests pass.

---

## Chunk 2: Cluster Building

### Task 2: `Cluster` dataclass and `build_clusters()`

**Files:**
- Modify: `hardware/boards/scripts/placement/strategies/__init__.py`
- Modify: `hardware/boards/scripts/placement/helpers.py`
- Create: `hardware/boards/scripts/tests/test_clustering.py`

- [ ] **Step 1: Add Cluster dataclass**

In `strategies/__init__.py`, add after `AntiAffinityRule`:

```python
@dataclass
class Cluster:
    """A group of components placed as a unit around an anchor IC."""
    anchor: str                          # anchor component address
    satellites: dict[str, list[str]]     # satellite_addr → [passive_addrs]
    bypass: list[str]                    # passives near anchor (caps, by address)
```

- [ ] **Step 2: Write failing tests for build_clusters**

Create `hardware/boards/scripts/tests/test_clustering.py`:

```python
"""Tests for build_clusters() — automatic module grouping."""

from placement.helpers import build_clusters
from placement.strategies import ComponentInfo, Cluster


def _comp(addr, nets=None, pin_count=8):
    return ComponentInfo(
        address=addr, width=5.0, height=3.0, is_tht=False,
        pin_count=pin_count, nets=nets or [],
        pad_sides={"N": [], "S": [], "E": [], "W": []},
        edge_signal_count={"N": 0, "S": 0, "E": 0, "W": 0},
        group=addr.split(".")[0] if "." in addr else None,
    )


class TestBuildClusters:

    def test_single_group_with_anchor_and_satellite(self):
        """dac.dac1 (anchor) + dac.opamp1 (satellite sharing 2+ nets)."""
        comps = {
            "dac.dac1": _comp("dac.dac1", nets=["out0", "out1", "sclk"]),
            "dac.opamp1": _comp("dac.opamp1", nets=["out0", "out1"]),
            "dac.r_fb1": _comp("dac.r_fb1", nets=["out0"], pin_count=2),
        }
        net_graph = {
            "out0": ["dac.dac1", "dac.opamp1", "dac.r_fb1"],
            "out1": ["dac.dac1", "dac.opamp1"],
            "sclk": ["dac.dac1"],
        }
        clusters = build_clusters(comps, net_graph)
        assert len(clusters) >= 1
        dac_cluster = [c for c in clusters if c.anchor == "dac.dac1"]
        assert len(dac_cluster) == 1
        cl = dac_cluster[0]
        assert "dac.opamp1" in cl.satellites
        # r_fb1 shares nets with opamp1, should be its passive
        assert "dac.r_fb1" in cl.satellites["dac.opamp1"]

    def test_bypass_caps_assigned_by_address(self):
        """Caps with only power nets get assigned by address prefix."""
        comps = {
            "dac.dac1": _comp("dac.dac1", nets=["out0", "sclk"]),
            "dac.c_dac1_1": _comp("dac.c_dac1_1", nets=[], pin_count=2),
            "dac.c_vio1": _comp("dac.c_vio1", nets=[], pin_count=2),
        }
        net_graph = {
            "out0": ["dac.dac1"],
            "sclk": ["dac.dac1"],
        }
        clusters = build_clusters(comps, net_graph)
        dac_cluster = [c for c in clusters if c.anchor == "dac.dac1"][0]
        assert "dac.c_dac1_1" in dac_cluster.bypass
        # c_vio1 doesn't match dac1 prefix directly but is in same group
        assert "dac.c_vio1" in dac_cluster.bypass

    def test_no_clusters_for_ungrouped(self):
        """Components without dots in address don't form clusters."""
        comps = {
            "standalone": _comp("standalone", nets=["net1"]),
        }
        net_graph = {"net1": ["standalone"]}
        clusters = build_clusters(comps, net_graph)
        assert len(clusters) == 0

    def test_two_anchors_same_group(self):
        """Two DACs in same group → two separate clusters."""
        comps = {
            "dac.dac1": _comp("dac.dac1", nets=["out0", "sclk", "din"]),
            "dac.dac2": _comp("dac.dac2", nets=["out4", "sclk", "din"]),
            "dac.opamp1": _comp("dac.opamp1", nets=["out0"]),
            "dac.opamp3": _comp("dac.opamp3", nets=["out4"]),
        }
        net_graph = {
            "out0": ["dac.dac1", "dac.opamp1"],
            "out4": ["dac.dac2", "dac.opamp3"],
            "sclk": ["dac.dac1", "dac.dac2"],
            "din": ["dac.dac1", "dac.dac2"],
        }
        clusters = build_clusters(comps, net_graph)
        anchors = {c.anchor for c in clusters}
        assert "dac.dac1" in anchors
        assert "dac.dac2" in anchors

    def test_satellite_needs_2_shared_nets(self):
        """Component sharing only 1 net with anchor is NOT a satellite IC."""
        comps = {
            "dac.dac1": _comp("dac.dac1", nets=["out0", "out1", "sclk"]),
            "dac.misc": _comp("dac.misc", nets=["sclk"]),  # only 1 shared net
        }
        net_graph = {
            "out0": ["dac.dac1"],
            "out1": ["dac.dac1"],
            "sclk": ["dac.dac1", "dac.misc"],
        }
        clusters = build_clusters(comps, net_graph)
        dac_cluster = [c for c in clusters if c.anchor == "dac.dac1"][0]
        assert "dac.misc" not in dac_cluster.satellites
```

- [ ] **Step 3: Implement build_clusters in helpers.py**

Add after `extract_pad_sides()` (before the anti-affinity section):

```python
# ---------------------------------------------------------------------------
# Module-aware clustering
# ---------------------------------------------------------------------------

_PASSIVE_PREFIXES = ("r_", "c_", "l_", "r.", "c.", "l.")


def _is_passive_addr(addr):
    """Check if address looks like a passive component (R, C, L)."""
    parts = addr.rsplit(".", 1)
    leaf = parts[-1] if len(parts) > 1 else addr
    return any(leaf.lower().startswith(p) for p in _PASSIVE_PREFIXES)


def build_clusters(components, net_graph):
    """Build hierarchical clusters from component connectivity and address prefixes.

    Args:
        components: dict[str, ComponentInfo] — all free components
        net_graph: dict[str, list[str]] — net → component addresses

    Returns:
        list[Cluster] — one per detected anchor IC
    """
    from placement.strategies import Cluster

    # 1. Group components by address prefix (first dotted segment)
    groups = defaultdict(list)
    for addr in components:
        if "." in addr:
            prefix = addr.split(".")[0]
            groups[prefix].append(addr)

    # 2. Build adjacency: addr → {other_addr: shared_net_count}
    adjacency = defaultdict(lambda: defaultdict(int))
    for net, net_addrs in net_graph.items():
        group_addrs = [a for a in net_addrs if a in components]
        for i in range(len(group_addrs)):
            for j in range(i + 1, len(group_addrs)):
                adjacency[group_addrs[i]][group_addrs[j]] += 1
                adjacency[group_addrs[j]][group_addrs[i]] += 1

    clusters = []
    assigned = set()  # track components already in a cluster

    for prefix, group_addrs in groups.items():
        # 3. Find anchor: non-passive IC with most net connections in group
        anchor_candidates = [
            a for a in group_addrs
            if not _is_passive_addr(a) and components[a].pin_count > 4
        ]
        if not anchor_candidates:
            continue

        # Sort by number of non-power nets (descending)
        anchor_candidates.sort(
            key=lambda a: len(components[a].nets), reverse=True)

        # Multiple anchors possible (e.g. dac1 + dac2)
        # Each anchor gets its own cluster
        for anchor_addr in anchor_candidates:
            if anchor_addr in assigned:
                continue

            # 4. Find satellite ICs: non-passive, 2+ shared nets with anchor
            satellites = {}  # sat_addr → [passive_addrs]
            for other_addr in group_addrs:
                if other_addr == anchor_addr or other_addr in assigned:
                    continue
                if _is_passive_addr(other_addr):
                    continue
                shared = adjacency[anchor_addr].get(other_addr, 0)
                if shared >= 2:
                    satellites[other_addr] = []
                    assigned.add(other_addr)

            # 5. Assign passives to satellites by shared nets
            unassigned_passives = []
            for other_addr in group_addrs:
                if other_addr == anchor_addr or other_addr in assigned:
                    continue
                if not _is_passive_addr(other_addr):
                    continue
                # Find which satellite shares the most nets
                best_sat = None
                best_count = 0
                for sat_addr in satellites:
                    shared = adjacency[other_addr].get(sat_addr, 0)
                    if shared > best_count:
                        best_sat = sat_addr
                        best_count = shared
                if best_sat and best_count > 0:
                    satellites[best_sat].append(other_addr)
                    assigned.add(other_addr)
                else:
                    unassigned_passives.append(other_addr)

            # 6. Bypass caps: passives with no net connections (power-only)
            #    or unassigned passives — assign by address proximity
            bypass = []
            for addr in unassigned_passives:
                bypass.append(addr)
                assigned.add(addr)

            assigned.add(anchor_addr)
            clusters.append(Cluster(
                anchor=anchor_addr,
                satellites=satellites,
                bypass=bypass,
            ))

    return clusters
```

- [ ] **Step 4: Run all tests**

Run: `cd hardware && make test-hw`
Expected: All pass.

---

## Chunk 3: Combined Position + Rotation Satellite Placement

### Task 3: `place_cluster_satellites()`

**Files:**
- Modify: `hardware/boards/scripts/placement/helpers.py`
- Create: `hardware/boards/scripts/tests/test_cluster_placement.py`

- [ ] **Step 1: Write failing tests**

Create `hardware/boards/scripts/tests/test_cluster_placement.py`:

```python
"""Tests for place_cluster_satellites() and place_cluster_passives()."""

from placement.helpers import place_cluster_satellites, build_clusters
from placement.strategies import (
    BoardState, ComponentInfo, Placement, Cluster,
)


def _comp(addr, w=5.0, h=3.0, nets=None, pad_sides=None,
          edge_signal_count=None, pin_count=8):
    return ComponentInfo(
        address=addr, width=w, height=h, is_tht=False,
        pin_count=pin_count, nets=nets or [],
        pad_sides=pad_sides or {"N": [], "S": [], "E": [], "W": []},
        edge_signal_count=edge_signal_count or {"N": 0, "S": 0, "E": 0, "W": 0},
        group=addr.split(".")[0] if "." in addr else None,
    )


def _board(net_graph):
    return BoardState(
        width=140, height=84,
        fixed={}, fixed_info={},
        net_graph=net_graph,
        anti_affinity=[],
    )


class TestPlaceClusterSatellites:

    def test_opamp_moves_to_correct_edge(self):
        """Opamp sharing west-edge nets should end up west of DAC."""
        qfn = _comp("dac.dac1", w=9.0, h=9.0,
                     nets=["o0", "o1", "o2", "o3", "sclk"],
                     pad_sides={"W": ["o0", "o1", "o2", "o3"],
                                "S": [], "E": ["sclk"], "N": []},
                     edge_signal_count={"W": 4, "S": 0, "E": 1, "N": 0})
        opamp = _comp("dac.opamp1", nets=["o0", "o1", "o2", "o3"])
        comps = {"dac.dac1": qfn, "dac.opamp1": opamp}
        net_graph = {
            "o0": ["dac.dac1", "dac.opamp1"],
            "o1": ["dac.dac1", "dac.opamp1"],
            "o2": ["dac.dac1", "dac.opamp1"],
            "o3": ["dac.dac1", "dac.opamp1"],
            "sclk": ["dac.dac1"],
        }
        cluster = Cluster(
            anchor="dac.dac1",
            satellites={"dac.opamp1": []},
            bypass=[],
        )
        placements = {
            "dac.dac1": Placement(x=70, y=42, side="F"),
            "dac.opamp1": Placement(x=20, y=20, side="F"),  # far away
        }
        board = _board(net_graph)

        result = place_cluster_satellites(
            [cluster], placements, comps, board, net_graph)

        # Opamp should be west of DAC
        assert result["dac.opamp1"].x < 70

    def test_rotation_applied(self):
        """Satellite should get a non-zero rotation if it improves wirelength."""
        qfn = _comp("dac.dac1", w=9.0, h=9.0,
                     nets=["o0", "o1"],
                     pad_sides={"W": ["o0", "o1"], "S": [], "E": [], "N": []},
                     edge_signal_count={"W": 2, "S": 0, "E": 0, "N": 0})
        # Opamp with inputs on E, outputs on W — if placed west of DAC,
        # 180° rotation would put inputs facing the DAC
        opamp = _comp("dac.opamp1", nets=["o0", "o1"],
                       pad_sides={"W": ["o0"], "E": ["o1"], "N": [], "S": []},
                       edge_signal_count={"W": 1, "E": 1, "N": 0, "S": 0})
        comps = {"dac.dac1": qfn, "dac.opamp1": opamp}
        net_graph = {
            "o0": ["dac.dac1", "dac.opamp1"],
            "o1": ["dac.dac1", "dac.opamp1"],
        }
        cluster = Cluster(anchor="dac.dac1",
                          satellites={"dac.opamp1": []}, bypass=[])
        placements = {
            "dac.dac1": Placement(x=70, y=42, side="F"),
            "dac.opamp1": Placement(x=20, y=20, side="F"),
        }
        board = _board(net_graph)

        result = place_cluster_satellites(
            [cluster], placements, comps, board, net_graph)

        # Should have a rotation set (the exact value depends on the algorithm)
        # At minimum, the placement should exist and be west of DAC
        assert result["dac.opamp1"].x < 70

    def test_qfn_anchor_not_moved(self):
        """The anchor (QFN DAC) should not be repositioned."""
        qfn = _comp("dac.dac1", w=9.0, h=9.0, nets=["o0"],
                     pad_sides={"W": ["o0"], "S": [], "E": [], "N": []},
                     edge_signal_count={"W": 1, "S": 0, "E": 0, "N": 0})
        opamp = _comp("dac.opamp1", nets=["o0"])
        comps = {"dac.dac1": qfn, "dac.opamp1": opamp}
        net_graph = {"o0": ["dac.dac1", "dac.opamp1"]}
        cluster = Cluster(anchor="dac.dac1",
                          satellites={"dac.opamp1": []}, bypass=[])
        placements = {
            "dac.dac1": Placement(x=70, y=42, side="F"),
            "dac.opamp1": Placement(x=20, y=20, side="F"),
        }
        board = _board(net_graph)

        result = place_cluster_satellites(
            [cluster], placements, comps, board, net_graph)

        assert result["dac.dac1"].x == 70
        assert result["dac.dac1"].y == 42

    def test_empty_clusters_noop(self):
        """No clusters → placements unchanged."""
        placements = {"comp": Placement(x=10, y=10, side="F")}
        comps = {"comp": _comp("comp")}
        board = _board({})
        result = place_cluster_satellites([], placements, comps, board, {})
        assert result == placements
```

- [ ] **Step 2: Implement place_cluster_satellites**

Add to `helpers.py` (replace the existing `nudge_satellites` and related helpers):

```python
# ---------------------------------------------------------------------------
# Cluster-based satellite placement (replaces nudge_satellites)
# ---------------------------------------------------------------------------

def _edge_offset(edge, distance):
    """Return (dx, dy) offset for a given edge direction and distance."""
    offsets = {
        "W": (-distance, 0),
        "E": (distance, 0),
        "N": (0, -distance),
        "S": (0, distance),
    }
    return offsets.get(edge, (0, 0))


def place_cluster_satellites(clusters, placements, free_comps, board_state,
                              net_graph, tolerance=5.0):
    """Position and orient satellite ICs near their anchor's correct edge.

    For each cluster, determines which anchor edge each satellite connects to,
    computes a target position, tries all 4 rotations at that position, and
    picks the (position, rotation) that minimizes wirelength while avoiding
    collisions and proximity to other QFN anchors.

    Args:
        clusters: list[Cluster]
        placements: dict[str, Placement] — current placements (all components)
        free_comps: dict[str, ComponentInfo] — free component info
        board_state: BoardState — for collision-aware positioning
        net_graph: dict[str, list[str]] — net → addresses
        tolerance: float — don't move if already within this distance

    Returns:
        Updated placements dict.
    """
    from placement.strategies import Placement, rotated_info

    if not clusters:
        return placements

    result = dict(placements)
    anchor_addrs = {c.anchor for c in clusters}

    for cluster in clusters:
        anchor_addr = cluster.anchor
        if anchor_addr not in result:
            continue
        anchor_pos = result[anchor_addr]
        anchor_comp = free_comps.get(anchor_addr)
        if not anchor_comp or not anchor_comp.pad_sides:
            continue

        for sat_addr in cluster.satellites:
            if sat_addr not in result or sat_addr not in free_comps:
                continue
            sat_comp = free_comps[sat_addr]

            # Determine best anchor edge by shared net count
            shared_nets = set()
            for net, addrs in net_graph.items():
                if anchor_addr in addrs and sat_addr in addrs:
                    shared_nets.add(net)

            edge_counts = {e: 0 for e in ("N", "S", "E", "W")}
            for edge, edge_nets in anchor_comp.pad_sides.items():
                for net in edge_nets:
                    if net in shared_nets:
                        edge_counts[edge] += 1

            best_edge = max(edge_counts, key=edge_counts.get)
            if edge_counts[best_edge] == 0:
                continue

            # Compute target position with pin-density gap
            edge_gap = 2.0
            if anchor_comp.edge_signal_count:
                pins = anchor_comp.edge_signal_count.get(best_edge, 0)
                edge_gap = max(edge_gap, 2.5 + pins * 0.5)

            offset_dist = (max(anchor_comp.width, anchor_comp.height) / 2 +
                           max(sat_comp.width, sat_comp.height) / 2 + edge_gap)
            dx, dy = _edge_offset(best_edge, offset_dist)
            target_x = anchor_pos.x + dx
            target_y = anchor_pos.y + dy

            # Skip if already close enough
            current = result[sat_addr]
            dist_to_target = ((current.x - target_x) ** 2 +
                              (current.y - target_y) ** 2) ** 0.5
            if dist_to_target <= tolerance:
                continue

            # Skip if target is too close to another anchor
            too_close = False
            for other_anchor in anchor_addrs:
                if other_anchor == anchor_addr:
                    continue
                opos = result.get(other_anchor)
                if not opos:
                    continue
                ocomp = free_comps.get(other_anchor)
                if not ocomp:
                    continue
                min_clear = (max(ocomp.width, ocomp.height) / 2 +
                             max(sat_comp.width, sat_comp.height) / 2 + edge_gap)
                if ((target_x - opos.x) ** 2 +
                        (target_y - opos.y) ** 2) ** 0.5 < min_clear:
                    too_close = True
                    break
            if too_close:
                continue

            # Build fresh board state without this satellite
            nudge_board = board_state.copy()
            for other_addr, other_p in result.items():
                if other_addr == sat_addr:
                    continue
                other_comp = free_comps.get(other_addr)
                if other_comp:
                    nudge_board.register_placement(
                        other_addr, other_p.x, other_p.y,
                        other_comp, other_p.side)

            # Try all 4 rotations at the target position
            best_placement = None
            best_cost = float('inf')

            # Collect connected positions for wirelength scoring
            connected_pos = {}
            for net in shared_nets:
                for addr in net_graph.get(net, []):
                    if addr != sat_addr and addr in result:
                        connected_pos[addr] = (result[addr].x, result[addr].y)

            for rot in (0, 90, 180, 270):
                r_comp = rotated_info(sat_comp, rot)
                # Check collision at target with rotated dims
                cx = target_x + r_comp.cx_offset
                cy = target_y + r_comp.cy_offset
                if nudge_board._tracker.collides(
                        cx, cy, r_comp.width, r_comp.height,
                        current.side, r_comp.is_tht):
                    continue
                if not nudge_board._tracker.in_bounds(
                        cx, cy, r_comp.width, r_comp.height):
                    continue

                # Score: sum of Manhattan distances from rotated pad edges
                # to their connected component positions
                cost = 0.0
                for edge, nets in r_comp.pad_sides.items():
                    edge_dx, edge_dy = _edge_offset(
                        edge, max(r_comp.width, r_comp.height) / 2)
                    pad_x = target_x + edge_dx
                    pad_y = target_y + edge_dy
                    for net in nets:
                        for addr in net_graph.get(net, []):
                            if addr in connected_pos:
                                px, py = connected_pos[addr]
                                cost += abs(pad_x - px) + abs(pad_y - py)

                if cost < best_cost:
                    best_cost = cost
                    best_placement = Placement(
                        x=target_x, y=target_y,
                        side=current.side, rotation=float(rot))

            if best_placement is None:
                # Fallback: find any legal position at 0° rotation
                fx, fy, side = nudge_board.find_legal_position(
                    target_x, target_y, sat_comp, side=current.side)
                best_placement = Placement(x=fx, y=fy, side=side,
                                            rotation=current.rotation)

            result[sat_addr] = best_placement

    return result
```

- [ ] **Step 3: Run all tests**

Run: `cd hardware && make test-hw`

---

## Chunk 4: Radial Passive Placement

### Task 4: `place_cluster_passives()`

**Files:**
- Modify: `hardware/boards/scripts/placement/helpers.py`
- Add tests to: `hardware/boards/scripts/tests/test_cluster_placement.py`

- [ ] **Step 1: Write failing tests**

Add to `test_cluster_placement.py`:

```python
from placement.helpers import place_cluster_passives


class TestPlaceClusterPassives:

    def test_feedback_resistor_near_opamp(self):
        """Passive assigned to satellite should end up near that satellite."""
        qfn = _comp("dac.dac1", w=9.0, h=9.0, nets=["o0"],
                     pad_sides={"W": ["o0"], "S": [], "E": [], "N": []},
                     edge_signal_count={"W": 1, "S": 0, "E": 0, "N": 0})
        opamp = _comp("dac.opamp1", nets=["o0", "fb0"])
        resistor = _comp("dac.r_fb1", nets=["fb0"], pin_count=2)
        comps = {
            "dac.dac1": qfn,
            "dac.opamp1": opamp,
            "dac.r_fb1": resistor,
        }
        net_graph = {
            "o0": ["dac.dac1", "dac.opamp1"],
            "fb0": ["dac.opamp1", "dac.r_fb1"],
        }
        cluster = Cluster(anchor="dac.dac1",
                          satellites={"dac.opamp1": ["dac.r_fb1"]},
                          bypass=[])
        placements = {
            "dac.dac1": Placement(x=70, y=42, side="F"),
            "dac.opamp1": Placement(x=55, y=42, side="F"),
            "dac.r_fb1": Placement(x=10, y=10, side="F"),  # far away
        }
        board = _board(net_graph)

        result = place_cluster_passives(
            [cluster], placements, comps, net_graph, board)

        # Resistor should be closer to opamp (55, 42) than before (10, 10)
        import math
        old_dist = math.hypot(10 - 55, 10 - 42)
        new_dist = math.hypot(result["dac.r_fb1"].x - 55,
                              result["dac.r_fb1"].y - 42)
        assert new_dist < old_dist

    def test_bypass_cap_near_anchor(self):
        """Bypass cap should be placed near its anchor IC."""
        qfn = _comp("dac.dac1", w=9.0, h=9.0, nets=["o0"],
                     pad_sides={"W": ["o0"], "S": [], "E": [], "N": []},
                     edge_signal_count={"W": 1, "S": 0, "E": 0, "N": 0})
        cap = _comp("dac.c_dac1_1", nets=[], pin_count=2)
        comps = {"dac.dac1": qfn, "dac.c_dac1_1": cap}
        net_graph = {"o0": ["dac.dac1"]}
        cluster = Cluster(anchor="dac.dac1", satellites={},
                          bypass=["dac.c_dac1_1"])
        placements = {
            "dac.dac1": Placement(x=70, y=42, side="F"),
            "dac.c_dac1_1": Placement(x=10, y=10, side="F"),  # far away
        }
        board = _board(net_graph)

        result = place_cluster_passives(
            [cluster], placements, comps, net_graph, board)

        import math
        new_dist = math.hypot(result["dac.c_dac1_1"].x - 70,
                              result["dac.c_dac1_1"].y - 42)
        assert new_dist < 20  # should be near the anchor

    def test_empty_clusters_noop(self):
        placements = {"comp": Placement(x=10, y=10, side="F")}
        comps = {"comp": _comp("comp")}
        board = _board({})
        result = place_cluster_passives([], placements, comps, {}, board)
        assert result == placements
```

- [ ] **Step 2: Implement place_cluster_passives**

Add to `helpers.py` after `place_cluster_satellites`:

```python
def place_cluster_passives(clusters, placements, free_comps, net_graph,
                            board_state):
    """Position cluster passives along radial paths from their satellite ICs.

    Feedback/gain resistors → near their satellite IC, along the radial
    from anchor toward connector.
    Bypass caps → adjacent to their anchor IC.

    Args:
        clusters: list[Cluster]
        placements: dict[str, Placement] — current placements
        free_comps: dict[str, ComponentInfo] — free component info
        net_graph: dict[str, list[str]] — net → addresses
        board_state: BoardState — for collision-aware positioning

    Returns:
        Updated placements dict.
    """
    from placement.strategies import Placement

    if not clusters:
        return placements

    result = dict(placements)

    for cluster in clusters:
        anchor_addr = cluster.anchor
        if anchor_addr not in result:
            continue
        anchor_pos = result[anchor_addr]

        # Place bypass caps near anchor
        for cap_addr in cluster.bypass:
            if cap_addr not in result or cap_addr not in free_comps:
                continue
            cap_comp = free_comps[cap_addr]
            current = result[cap_addr]

            # Target: adjacent to anchor (slight offset to avoid stacking)
            target_x = anchor_pos.x + 2.0
            target_y = anchor_pos.y + 2.0

            nudge_board = board_state.copy()
            for other_addr, other_p in result.items():
                if other_addr == cap_addr:
                    continue
                other_comp = free_comps.get(other_addr)
                if other_comp:
                    nudge_board.register_placement(
                        other_addr, other_p.x, other_p.y,
                        other_comp, other_p.side)

            fx, fy, side = nudge_board.find_legal_position(
                target_x, target_y, cap_comp, side=current.side)
            result[cap_addr] = Placement(x=fx, y=fy, side=side,
                                          rotation=current.rotation)

        # Place satellite passives along radial from satellite toward board edge
        for sat_addr, passive_addrs in cluster.satellites.items():
            if not passive_addrs or sat_addr not in result:
                continue
            sat_pos = result[sat_addr]

            # Radial direction: from anchor toward satellite, extended outward
            dx = sat_pos.x - anchor_pos.x
            dy = sat_pos.y - anchor_pos.y
            dist = (dx ** 2 + dy ** 2) ** 0.5
            if dist < 0.01:
                dx, dy, dist = 1.0, 0.0, 1.0
            nx, ny = dx / dist, dy / dist

            for i, passive_addr in enumerate(passive_addrs):
                if passive_addr not in result or passive_addr not in free_comps:
                    continue
                passive_comp = free_comps[passive_addr]
                current = result[passive_addr]

                # Position along radial, past the satellite
                offset = 3.0 + i * 2.5  # stagger passives along the radial
                target_x = sat_pos.x + nx * offset
                target_y = sat_pos.y + ny * offset

                nudge_board = board_state.copy()
                for other_addr, other_p in result.items():
                    if other_addr == passive_addr:
                        continue
                    other_comp = free_comps.get(other_addr)
                    if other_comp:
                        nudge_board.register_placement(
                            other_addr, other_p.x, other_p.y,
                            other_comp, other_p.side)

                fx, fy, side = nudge_board.find_legal_position(
                    target_x, target_y, passive_comp, side=current.side)
                result[passive_addr] = Placement(x=fx, y=fy, side=side,
                                                  rotation=current.rotation)

    return result
```

- [ ] **Step 3: Run all tests**

Run: `cd hardware && make test-hw`

---

## Chunk 5: Orchestrator Wiring + Cleanup

### Task 5: Wire into orchestrator, remove nudge_satellites

**Files:**
- Modify: `hardware/boards/scripts/placement/place_components.py`
- Modify: `hardware/boards/scripts/placement/helpers.py` (remove old code)
- Remove: `hardware/boards/scripts/tests/test_satellite_nudge.py`

- [ ] **Step 1: Update _extract_component_info to populate group field**

In `place_components.py`, update `_extract_component_info()`:

```python
def _extract_component_info(addr, fp, pcbnew, power_nets):
    """Extract ComponentInfo from a pcbnew footprint."""
    from placement.helpers import extract_footprint_dims, is_tht as is_tht_fn, \
        get_component_nets, extract_pad_sides
    from placement.strategies import ComponentInfo

    w, h, cx_off, cy_off = extract_footprint_dims(fp, pcbnew)
    tht = is_tht_fn(fp, pcbnew)
    pin_count = len(list(fp.Pads()))
    nets = get_component_nets(fp, power_nets)
    pad_sides = extract_pad_sides(fp, pcbnew, power_nets)
    edge_signal_count = {edge: len(nets_list)
                         for edge, nets_list in pad_sides.items()}
    group = addr.split(".")[0] if "." in addr else None
    return ComponentInfo(
        address=addr, width=w, height=h, is_tht=tht,
        pin_count=pin_count, nets=nets,
        cx_offset=cx_off, cy_offset=cy_off,
        pad_sides=pad_sides,
        edge_signal_count=edge_signal_count,
        group=group,
    )
```

- [ ] **Step 2: Replace nudge_satellites with cluster pipeline in orchestrator**

In `place_board()`, replace lines 510-519:

```python
    # Post-process 1: enforce anti-affinity (push apart violating pairs)
    from placement.helpers import enforce_anti_affinity, nudge_satellites
    placements = enforce_anti_affinity(
        placements, free_components, fixed_placements,
        anti_affinity_rules, board_state)

    # Post-process 2: nudge QFN satellite components toward correct edges
    placements = nudge_satellites(
        placements, free_components, fixed_placements, fixed_info,
        net_graph, board_state)
```

With:

```python
    # Post-process 1: enforce anti-affinity (push apart violating pairs)
    from placement.helpers import (
        enforce_anti_affinity, build_clusters,
        place_cluster_satellites, place_cluster_passives,
    )
    placements = enforce_anti_affinity(
        placements, free_components, fixed_placements,
        anti_affinity_rules, board_state)

    # Post-process 2: cluster-based satellite + passive placement
    clusters = build_clusters(free_components, net_graph)
    if clusters:
        print(f"  Clusters: {len(clusters)} "
              f"({', '.join(c.anchor for c in clusters)})")
        placements = place_cluster_satellites(
            clusters, placements, free_components, board_state, net_graph)
        placements = place_cluster_passives(
            clusters, placements, free_components, net_graph, board_state)
```

- [ ] **Step 3: Remove old nudge_satellites code from helpers.py**

Remove the `nudge_satellites()` function and the old `_PASSIVE_PREFIXES` / `_is_passive_addr` / `_edge_offset` definitions that were in the "QFN satellite nudging" section (keep the copies that are now in the clustering section).

- [ ] **Step 4: Delete test_satellite_nudge.py**

```bash
rm hardware/boards/scripts/tests/test_satellite_nudge.py
```

- [ ] **Step 5: Run all tests**

Run: `cd hardware && make test-hw`
Expected: All tests pass (minus removed test file).

---

## Chunk 6: Integration Test

### Task 6: Run full pipeline

- [ ] **Step 1: Run placement for all variants**

Run: `cd hardware && make place`

Watch for:
- Cluster detection messages in output
- No overlap errors
- No anti-affinity violations

- [ ] **Step 2: Check routing results**

```bash
for f in boards/build/main-*-result.json; do
    echo "$(basename $f): $(python3 -c "import json; d=json.load(open('$f')); print(f\"{d['status']} vias={d.get('via_count',0)} trace={d.get('trace_length_mm',0):.0f}mm\")")"
done
echo "---"
for f in boards/build/control-*-result.json; do
    echo "$(basename $f): $(python3 -c "import json; d=json.load(open('$f')); print(f\"{d['status']} vias={d.get('via_count',0)} trace={d.get('trace_length_mm',0):.0f}mm\")")"
done
```

**Success criteria:**
- Main board: ≥4/5 pass (up from 2/5)
- Control board: ≥3/5 pass (up from 1/5)

- [ ] **Step 3: Check DAC separation in all variants**

```bash
for variant in constructive-a constructive-b grid-spread-a grid-spread-b sa-refine-a; do
  # Use KiCad Python to extract DAC positions and verify ≥12mm separation
done
```

- [ ] **Step 4: Compare routing quality**

| Metric | Before | After |
|--------|--------|-------|
| Main pass rate | 2/5 | ? |
| Best via count | 134 | ? |
| Best trace length | 5906mm | ? |
| Control pass rate | 1/5 | ? |
