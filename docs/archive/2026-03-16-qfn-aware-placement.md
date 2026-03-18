# QFN-Aware Placement Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Increase main board routing success from 2/5 to 5/5 variants by adding pin-side awareness and satellite nudging to the placement pipeline.

**Architecture:** Extend `ComponentInfo` with per-edge pad classification. Compute padding from pin density. Add a post-processing step that nudges QFN satellite components (op-amps) toward the correct DAC edge. No changes to individual strategies — nudging runs in the orchestrator after any strategy completes.

**Tech Stack:** Python 3.9 (KiCad-bundled), pytest, no new dependencies.

---

## Chunk 1: Pin-Side Metadata

### Task 1: Add pad_sides and edge_signal_count to ComponentInfo

**Files:**
- Modify: `hardware/boards/scripts/placement/strategies/__init__.py:14-25`
- Test: `hardware/boards/scripts/tests/test_pad_sides.py` (new, Task 2)

- [ ] **Step 1: Add fields to ComponentInfo dataclass**

In `hardware/boards/scripts/placement/strategies/__init__.py`, add two fields with defaults so existing code is unaffected:

```python
@dataclass
class ComponentInfo:
    """Pre-extracted component information for strategies."""
    address: str
    width: float
    height: float
    is_tht: bool
    pin_count: int
    nets: list[str]
    cx_offset: float = 0.0
    cy_offset: float = 0.0
    routing_pressure: float = 0.0
    group: str | None = None
    pad_sides: dict[str, list[str]] = field(default_factory=dict)
    edge_signal_count: dict[str, int] = field(default_factory=dict)
```

- [ ] **Step 2: Run tests to verify no regressions**

Run: `cd hardware && make test-hw`
Expected: 162 passed (no regressions — new fields have defaults)

- [ ] **Step 3: Commit**

```
feat(placement): add pad_sides and edge_signal_count to ComponentInfo
```

### Task 2: Implement extract_pad_sides()

**Files:**
- Modify: `hardware/boards/scripts/placement/helpers.py`
- Test: `hardware/boards/scripts/tests/test_pad_sides.py` (new)

- [ ] **Step 1: Write failing tests for extract_pad_sides**

Create `hardware/boards/scripts/tests/test_pad_sides.py`:

```python
"""Tests for pad-side classification (QFN and TSSOP footprints)."""

import pytest
from placement.helpers import extract_pad_sides


class FakePad:
    """Minimal pad mock for testing without pcbnew."""
    def __init__(self, x_mm, y_mm, net_name, attr="smd"):
        self._x = x_mm
        self._y = y_mm
        self._net = net_name
        self._attr = attr

    def GetPosition(self):
        return FakeVector(self._x * 1e6, self._y * 1e6)  # mm -> nm

    def GetNetname(self):
        return self._net

    def GetAttribute(self):
        return self._attr


class FakeVector:
    def __init__(self, x, y):
        self.x = x
        self.y = y


class FakePcbnew:
    @staticmethod
    def ToMM(val):
        return val / 1e6


class FakeFootprint:
    def __init__(self, pads):
        self._pads = pads

    def Pads(self):
        return self._pads

    def GetPosition(self):
        return FakeVector(0, 0)


class TestExtractPadSidesQFN:
    """WQFN-16: pads on all 4 sides + center thermal pad."""

    def _make_qfn16(self):
        """DAC80508 WQFN-16 pad layout (3x3mm body)."""
        power_nets = {"GND", "AVDD", "VIO"}
        pads = [
            # West edge (x=-1.45)
            FakePad(-1.45, -0.75, "OUT0"),
            FakePad(-1.45, -0.25, "OUT1"),
            FakePad(-1.45,  0.25, "OUT2"),
            FakePad(-1.45,  0.75, "OUT3"),
            # South edge (y=+1.45, KiCad +Y = down)
            FakePad(-0.75,  1.45, "OUT4"),
            FakePad(-0.25,  1.45, "OUT5"),
            FakePad( 0.25,  1.45, "OUT6"),
            FakePad( 0.75,  1.45, "OUT7"),
            # East edge (x=+1.45)
            FakePad( 1.45,  0.75, "VIO"),
            FakePad( 1.45,  0.25, "SDO"),
            FakePad( 1.45, -0.25, "SCLK"),
            FakePad( 1.45, -0.75, "SYNC"),
            # North edge (y=-1.45)
            FakePad( 0.75, -1.45, "DIN"),
            FakePad( 0.25, -1.45, "AVDD"),
            FakePad(-0.25, -1.45, "VREF"),
            FakePad(-0.75, -1.45, "GND"),
            # Center thermal pad
            FakePad(0.0, 0.0, "GND"),
        ]
        return FakeFootprint(pads), power_nets

    def test_four_edges_populated(self):
        fp, power = self._make_qfn16()
        sides = extract_pad_sides(fp, FakePcbnew(), power)
        assert set(sides.keys()) == {"N", "S", "E", "W"}

    def test_west_has_outputs(self):
        fp, power = self._make_qfn16()
        sides = extract_pad_sides(fp, FakePcbnew(), power)
        assert sides["W"] == ["OUT0", "OUT1", "OUT2", "OUT3"]

    def test_south_has_outputs(self):
        fp, power = self._make_qfn16()
        sides = extract_pad_sides(fp, FakePcbnew(), power)
        assert sides["S"] == ["OUT4", "OUT5", "OUT6", "OUT7"]

    def test_east_has_spi(self):
        fp, power = self._make_qfn16()
        sides = extract_pad_sides(fp, FakePcbnew(), power)
        # VIO is power, filtered out
        assert sides["E"] == ["SDO", "SCLK", "SYNC"]

    def test_north_has_din_and_vref(self):
        fp, power = self._make_qfn16()
        sides = extract_pad_sides(fp, FakePcbnew(), power)
        # AVDD and GND are power, filtered out
        assert sides["N"] == ["DIN", "VREF"]

    def test_thermal_pad_skipped(self):
        """Center thermal pad should not appear in any edge."""
        fp, power = self._make_qfn16()
        sides = extract_pad_sides(fp, FakePcbnew(), power)
        all_nets = [n for nets in sides.values() for n in nets]
        # GND is power-filtered anyway, but the center pad shouldn't
        # cause classification errors
        assert len(all_nets) == 4 + 4 + 3 + 2  # W=4, S=4, E=3, N=2


class TestExtractPadSidesTSSOP:
    """TSSOP-14: pads on west and east sides only."""

    def _make_tssop14(self):
        power_nets = {"VCC", "GND"}
        pads = [
            # West edge (x=-2.2, pins 1-7)
            FakePad(-2.2, -1.95, "IN1+"),
            FakePad(-2.2, -1.30, "IN1-"),
            FakePad(-2.2, -0.65, "OUT1"),
            FakePad(-2.2,  0.0,  "VCC"),
            FakePad(-2.2,  0.65, "IN2+"),
            FakePad(-2.2,  1.30, "IN2-"),
            FakePad(-2.2,  1.95, "OUT2"),
            # East edge (x=+2.2, pins 8-14)
            FakePad( 2.2,  1.95, "OUT3"),
            FakePad( 2.2,  1.30, "IN3-"),
            FakePad( 2.2,  0.65, "IN3+"),
            FakePad( 2.2,  0.0,  "GND"),
            FakePad( 2.2, -0.65, "IN4+"),
            FakePad( 2.2, -1.30, "IN4-"),
            FakePad( 2.2, -1.95, "OUT4"),
        ]
        return FakeFootprint(pads), power_nets

    def test_only_west_and_east(self):
        fp, power = self._make_tssop14()
        sides = extract_pad_sides(fp, FakePcbnew(), power)
        # N and S should be empty (no pads there)
        assert len(sides.get("N", [])) == 0
        assert len(sides.get("S", [])) == 0
        assert len(sides["W"]) > 0
        assert len(sides["E"]) > 0

    def test_power_filtered(self):
        fp, power = self._make_tssop14()
        sides = extract_pad_sides(fp, FakePcbnew(), power)
        all_nets = [n for nets in sides.values() for n in nets]
        assert "VCC" not in all_nets
        assert "GND" not in all_nets


class TestExtractPadSidesEdgeCases:

    def test_empty_footprint(self):
        fp = FakeFootprint([])
        sides = extract_pad_sides(fp, FakePcbnew(), set())
        assert sides == {"N": [], "S": [], "E": [], "W": []}

    def test_single_pad(self):
        """Single pad — cannot determine edges, should be empty."""
        fp = FakeFootprint([FakePad(-1.0, 0.0, "SIG")])
        sides = extract_pad_sides(fp, FakePcbnew(), set())
        # With only one pad, there's no edge geometry to classify
        all_nets = [n for nets in sides.values() for n in nets]
        assert len(all_nets) == 0

    def test_two_pads_opposite_sides(self):
        """Two pads on opposite sides should classify correctly."""
        fp = FakeFootprint([
            FakePad(-2.0, 0.0, "SIG_A"),
            FakePad(2.0, 0.0, "SIG_B"),
        ])
        sides = extract_pad_sides(fp, FakePcbnew(), set())
        assert "SIG_A" in sides["W"]
        assert "SIG_B" in sides["E"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd hardware && make test-hw  # tests/test_pad_sides.py -v`
Expected: ImportError — `extract_pad_sides` not found

- [ ] **Step 3: Implement extract_pad_sides in helpers.py**

Add to `hardware/boards/scripts/placement/helpers.py` after the `get_component_nets` function:

```python
def extract_pad_sides(fp, pcbnew, power_nets):
    """Classify footprint pads by edge (N/S/E/W).

    Skips thermal/exposed center pads and power nets.
    Returns dict with keys "N", "S", "E", "W", each mapping to a list
    of signal net names on that edge.

    Uses KiCad coordinates: +Y points down, so:
      - North (top) = most negative Y
      - South (bottom) = most positive Y
    """
    pads = list(fp.Pads())
    if not pads:
        return {"N": [], "S": [], "E": [], "W": []}

    # Get pad positions relative to footprint origin
    fp_pos = fp.GetPosition()
    fp_x = pcbnew.ToMM(fp_pos.x)
    fp_y = pcbnew.ToMM(fp_pos.y)

    pad_data = []
    for pad in pads:
        pos = pad.GetPosition()
        px = pcbnew.ToMM(pos.x) - fp_x
        py = pcbnew.ToMM(pos.y) - fp_y
        net = pad.GetNetname()
        pad_data.append((px, py, net))

    if not pad_data:
        return {"N": [], "S": [], "E": [], "W": []}

    # Find bounding box of all pads
    xs = [p[0] for p in pad_data]
    ys = [p[1] for p in pad_data]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    cx = (min_x + max_x) / 2
    cy = (min_y + max_y) / 2
    span_x = max_x - min_x
    span_y = max_y - min_y

    # Threshold for "center" pad detection: pad must be within 20% of
    # center relative to the span.  Catches QFN thermal pads.
    center_thresh_x = span_x * 0.2 if span_x > 0 else 0.1
    center_thresh_y = span_y * 0.2 if span_y > 0 else 0.1

    sides = {"N": [], "S": [], "E": [], "W": []}

    for px, py, net in pad_data:
        # Skip center/thermal pads
        if (abs(px - cx) < center_thresh_x and
                abs(py - cy) < center_thresh_y):
            continue

        # Skip power nets
        if net in power_nets:
            continue

        # Skip unconnected pads
        if not net:
            continue

        # Classify by which edge the pad is closest to
        dist_w = abs(px - min_x)
        dist_e = abs(px - max_x)
        dist_n = abs(py - min_y)  # KiCad: min Y = top = north
        dist_s = abs(py - max_y)  # KiCad: max Y = bottom = south

        min_dist = min(dist_w, dist_e, dist_n, dist_s)
        if min_dist == dist_w:
            sides["W"].append(net)
        elif min_dist == dist_e:
            sides["E"].append(net)
        elif min_dist == dist_n:
            sides["N"].append(net)
        else:
            sides["S"].append(net)

    return sides
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd hardware && make test-hw  # tests/test_pad_sides.py -v`
Expected: All tests pass

- [ ] **Step 5: Run full test suite**

Run: `cd hardware && make test-hw`
Expected: 162 + new tests all pass

- [ ] **Step 6: Commit**

```
feat(placement): add extract_pad_sides() for pin-edge classification
```

---

## Chunk 2: Auto-Padding from Pin Density

### Task 3: Support auto_from_pins in get_component_padding

**Files:**
- Modify: `hardware/boards/scripts/placement/place_components.py:37-48`
- Test: `hardware/boards/scripts/tests/test_component_padding.py`

- [ ] **Step 1: Write failing tests for auto_from_pins config**

Add to `hardware/boards/scripts/tests/test_component_padding.py`:

```python
class TestAutoFromPins:
    """Test auto_from_pins padding mode."""

    def test_auto_padding_returns_uniform_max(self):
        """auto_from_pins should return uniform padding = max edge value."""
        config = {
            "dacs.dac": {
                "auto_from_pins": True,
                "base": 2.5,
                "per_signal_pin": 0.5,
            }
        }
        edge_counts = {"N": 2, "S": 4, "E": 3, "W": 4}
        # Max = 2.5 + 4*0.5 = 4.5
        result = get_component_padding("dacs.dac1", config,
                                        edge_signal_counts=edge_counts)
        assert result == (4.5, 4.5, 4.5, 4.5)

    def test_auto_padding_without_edge_counts_uses_base(self):
        """If no edge_signal_counts provided, use base as uniform."""
        config = {
            "dacs.dac": {
                "auto_from_pins": True,
                "base": 2.5,
                "per_signal_pin": 0.5,
            }
        }
        result = get_component_padding("dacs.dac1", config)
        assert result == (2.5, 2.5, 2.5, 2.5)

    def test_explicit_padding_still_works(self):
        """Existing left/right/top/bottom format unchanged."""
        config = {
            "dacs.dac": {
                "left": 3.0, "right": 3.0,
                "top": 3.0, "bottom": 3.0,
            }
        }
        result = get_component_padding("dacs.dac1", config)
        assert result == (3.0, 3.0, 3.0, 3.0)

    def test_no_match_returns_zeros(self):
        config = {"dacs.dac": {"left": 3.0}}
        result = get_component_padding("other.comp", config)
        assert result == (0.0, 0.0, 0.0, 0.0)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd hardware && make test-hw  # tests/test_component_padding.py::TestAutoFromPins -v`
Expected: FAIL — `get_component_padding` doesn't accept `edge_signal_counts`

- [ ] **Step 3: Update get_component_padding to support auto_from_pins**

In `hardware/boards/scripts/placement/place_components.py`:

```python
def get_component_padding(addr, component_padding, edge_signal_counts=None):
    """Look up per-side courtyard padding for a component address.

    Config keys are prefix-matched against the address, so "leds.tlc"
    matches "leds.tlc1" and "leds.tlc2".

    Supports two formats:
      - Explicit: {"left": N, "right": N, "top": N, "bottom": N}
      - Auto: {"auto_from_pins": true, "base": N, "per_signal_pin": N}
        Computes per-edge padding from signal pin count, uses max as uniform.

    Returns (left, right, top, bottom) in mm.
    """
    for prefix, pad in component_padding.items():
        if addr.startswith(prefix):
            if pad.get("auto_from_pins"):
                base = pad.get("base", 0.0)
                per_pin = pad.get("per_signal_pin", 0.0)
                if edge_signal_counts:
                    edge_paddings = {
                        edge: base + count * per_pin
                        for edge, count in edge_signal_counts.items()
                    }
                    max_pad = max(edge_paddings.values()) if edge_paddings else base
                else:
                    max_pad = base
                return (max_pad, max_pad, max_pad, max_pad)
            return (pad.get("left", 0.0), pad.get("right", 0.0),
                    pad.get("top", 0.0), pad.get("bottom", 0.0))
    return (0.0, 0.0, 0.0, 0.0)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd hardware && make test-hw  # tests/test_component_padding.py -v`
Expected: All pass (including existing tests)

- [ ] **Step 5: Commit**

```
feat(placement): support auto_from_pins padding config
```

### Task 4: Wire pad_sides into the orchestrator

**Files:**
- Modify: `hardware/boards/scripts/placement/place_components.py:254-268` (_extract_component_info)
- Modify: `hardware/boards/scripts/placement/place_components.py:426-441` (padding application)

- [ ] **Step 1: Update _extract_component_info to populate pad_sides**

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
    return ComponentInfo(
        address=addr, width=w, height=h, is_tht=tht,
        pin_count=pin_count, nets=nets,
        cx_offset=cx_off, cy_offset=cy_off,
        pad_sides=pad_sides,
        edge_signal_count=edge_signal_count,
    )
```

- [ ] **Step 2: Pass edge_signal_counts to get_component_padding**

In `place_board()`, update the padding application block (~line 430):

```python
    for addr, fp in addr_map.items():
        info = _extract_component_info(addr, fp, pcbnew, power_nets)
        pad_l, pad_r, pad_t, pad_b = get_component_padding(
            addr, component_padding,
            edge_signal_counts=info.edge_signal_count)
        if pad_l or pad_r or pad_t or pad_b:
            info.width += pad_l + pad_r
            info.height += pad_t + pad_b
        if addr in fixed_placements:
            fixed_info[addr] = info
        else:
            free_components[addr] = info
```

- [ ] **Step 3: Run full test suite**

Run: `cd hardware && make test-hw`
Expected: All tests pass

- [ ] **Step 4: Commit**

```
feat(placement): wire pad_sides into orchestrator and padding computation
```

### Task 5: Update board-config.json

**Files:**
- Modify: `hardware/boards/board-config.json`

- [ ] **Step 1: Replace DAC padding with auto_from_pins**

Change the `dacs.dac` entry in the main board's `component_padding`:

```json
"dacs.dac": {
    "auto_from_pins": true,
    "base": 2.5,
    "per_signal_pin": 0.5
}
```

Leave `dac.opamp` and `connector.header` entries unchanged.

- [ ] **Step 2: Run full test suite**

Run: `cd hardware && make test-hw`
Expected: All tests pass

- [ ] **Step 3: Commit**

```
config: switch DAC padding to auto_from_pins
```

---

## Chunk 3: Satellite Nudging

### Task 6: Implement nudge_satellites()

**Files:**
- Modify: `hardware/boards/scripts/placement/helpers.py`
- Test: `hardware/boards/scripts/tests/test_satellite_nudge.py` (new)

- [ ] **Step 1: Write failing tests for satellite nudging**

Create `hardware/boards/scripts/tests/test_satellite_nudge.py`:

```python
"""Tests for QFN satellite nudging post-processor."""

import math
import pytest

from placement.strategies import (
    BoardState, ComponentInfo, Placement, AntiAffinityRule,
)
from placement.helpers import nudge_satellites


def _make_comp(addr, w=5.0, h=3.0, nets=None, pad_sides=None,
               edge_signal_count=None):
    return ComponentInfo(
        address=addr, width=w, height=h, is_tht=False,
        pin_count=8, nets=nets or [],
        pad_sides=pad_sides or {},
        edge_signal_count=edge_signal_count or {},
    )


class TestIdentifyQFNComponents:
    """nudge_satellites should only process components with 3+ signal edges."""

    def test_tssop_not_nudged(self):
        """2-sided parts (TSSOP) should not trigger satellite nudging."""
        tssop = _make_comp("dac.opamp1", nets=["net1"],
                           pad_sides={"W": ["IN"], "E": ["OUT"]},
                           edge_signal_count={"W": 1, "E": 1})
        placements = {"dac.opamp1": Placement(x=20, y=20, side="F")}
        net_graph = {"net1": ["dac.opamp1"]}
        board = BoardState(width=100, height=100, fixed={}, fixed_info={},
                           net_graph=net_graph, anti_affinity=[])
        result = nudge_satellites(
            placements, {"dac.opamp1": tssop}, {}, {}, net_graph, board)
        assert result == placements  # unchanged

    def test_qfn_triggers_nudging(self):
        """4-sided QFN should trigger satellite nudging for its neighbors."""
        qfn = _make_comp("dac.dac1", w=9.0, h=9.0,
                         nets=["out0", "out4", "sclk", "din"],
                         pad_sides={"W": ["out0"], "S": ["out4"],
                                    "E": ["sclk"], "N": ["din"]},
                         edge_signal_count={"W": 1, "S": 1, "E": 1, "N": 1})
        opamp = _make_comp("dac.opamp1", nets=["out0"])

        placements = {
            "dac.dac1": Placement(x=50, y=50, side="F"),
            # opamp placed east of DAC, but connects to west-side net
            "dac.opamp1": Placement(x=70, y=50, side="F"),
        }
        comps = {"dac.dac1": qfn, "dac.opamp1": opamp}
        net_graph = {"out0": ["dac.dac1", "dac.opamp1"],
                     "out4": ["dac.dac1"],
                     "sclk": ["dac.dac1"],
                     "din": ["dac.dac1"]}
        board = BoardState(width=100, height=100, fixed={}, fixed_info={},
                           net_graph=net_graph, anti_affinity=[])
        result = nudge_satellites(
            placements, comps, {}, {}, net_graph, board)
        # opamp should have moved toward the west side of the DAC
        assert result["dac.opamp1"].x < placements["dac.dac1"].x


class TestSatelliteEdgeAssignment:
    """Satellites should be assigned to the QFN edge with most shared nets."""

    def test_opamp_assigned_to_west(self):
        """Op-amp sharing 4 nets with west edge should go west."""
        qfn = _make_comp("dac.dac1", w=9.0, h=9.0,
                         nets=["o0", "o1", "o2", "o3", "o4", "sclk"],
                         pad_sides={"W": ["o0", "o1", "o2", "o3"],
                                    "S": ["o4"],
                                    "E": ["sclk"],
                                    "N": []},
                         edge_signal_count={"W": 4, "S": 1, "E": 1, "N": 0})
        opamp = _make_comp("dac.opamp1", nets=["o0", "o1", "o2", "o3"])

        placements = {
            "dac.dac1": Placement(x=50, y=50, side="F"),
            "dac.opamp1": Placement(x=70, y=50, side="F"),
        }
        comps = {"dac.dac1": qfn, "dac.opamp1": opamp}
        net_graph = {
            "o0": ["dac.dac1", "dac.opamp1"],
            "o1": ["dac.dac1", "dac.opamp1"],
            "o2": ["dac.dac1", "dac.opamp1"],
            "o3": ["dac.dac1", "dac.opamp1"],
            "o4": ["dac.dac1"],
            "sclk": ["dac.dac1"],
        }
        board = BoardState(width=100, height=100, fixed={}, fixed_info={},
                           net_graph=net_graph, anti_affinity=[])
        result = nudge_satellites(
            placements, comps, {}, {}, net_graph, board)
        # Should be west of DAC center
        assert result["dac.opamp1"].x < 50


class TestPassiveExclusion:
    """Components with R/C/L designator prefixes should not be nudged."""

    def test_resistor_not_nudged(self):
        qfn = _make_comp("dac.dac1", w=9.0, h=9.0,
                         nets=["o0"],
                         pad_sides={"W": ["o0"], "S": [], "E": [], "N": []},
                         edge_signal_count={"W": 1, "S": 0, "E": 0, "N": 0})
        resistor = _make_comp("dac.r_fb1", nets=["o0"])

        placements = {
            "dac.dac1": Placement(x=50, y=50, side="F"),
            "dac.r_fb1": Placement(x=70, y=50, side="F"),
        }
        comps = {"dac.dac1": qfn, "dac.r_fb1": resistor}
        net_graph = {"o0": ["dac.dac1", "dac.r_fb1"]}
        board = BoardState(width=100, height=100, fixed={}, fixed_info={},
                           net_graph=net_graph, anti_affinity=[])
        result = nudge_satellites(
            placements, comps, {}, {}, net_graph, board)
        # Resistor should stay where it was
        assert result["dac.r_fb1"].x == 70


class TestAlreadyCorrectPosition:
    """Satellites already near the correct edge should not be moved."""

    def test_no_nudge_when_close(self):
        qfn = _make_comp("dac.dac1", w=9.0, h=9.0,
                         nets=["o0"],
                         pad_sides={"W": ["o0"], "S": [], "E": [], "N": []},
                         edge_signal_count={"W": 1, "S": 0, "E": 0, "N": 0})
        opamp = _make_comp("dac.opamp1", nets=["o0"])

        placements = {
            "dac.dac1": Placement(x=50, y=50, side="F"),
            # Already west of DAC, close to target
            "dac.opamp1": Placement(x=38, y=50, side="F"),
        }
        comps = {"dac.dac1": qfn, "dac.opamp1": opamp}
        net_graph = {"o0": ["dac.dac1", "dac.opamp1"]}
        board = BoardState(width=100, height=100, fixed={}, fixed_info={},
                           net_graph=net_graph, anti_affinity=[])
        result = nudge_satellites(
            placements, comps, {}, {}, net_graph, board)
        # Should stay roughly where it was (within tolerance)
        assert abs(result["dac.opamp1"].x - 38) < 5
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd hardware && make test-hw  # tests/test_satellite_nudge.py -v`
Expected: ImportError — `nudge_satellites` not found

- [ ] **Step 3: Implement nudge_satellites in helpers.py**

Add to `hardware/boards/scripts/placement/helpers.py`:

```python
# ---------------------------------------------------------------------------
# QFN satellite nudging
# ---------------------------------------------------------------------------

_PASSIVE_PREFIXES = ("r_", "c_", "l_", "r.", "c.", "l.")


def _is_passive_addr(addr):
    """Check if address looks like a passive component (R, C, L)."""
    # Check the last segment of the address (after the last dot)
    parts = addr.rsplit(".", 1)
    leaf = parts[-1] if len(parts) > 1 else addr
    return any(leaf.lower().startswith(p) for p in _PASSIVE_PREFIXES)


def _edge_offset(edge, distance):
    """Return (dx, dy) offset for a given edge direction and distance."""
    offsets = {
        "W": (-distance, 0),
        "E": (distance, 0),
        "N": (0, -distance),  # KiCad: -Y = up = north
        "S": (0, distance),   # KiCad: +Y = down = south
    }
    return offsets.get(edge, (0, 0))


def nudge_satellites(placements, free_comps, fixed_placements, fixed_info,
                     net_graph, board_state, tolerance=5.0):
    """Post-process placements to nudge QFN satellite components.

    Identifies QFN components (signal pins on 3+ edges), finds their
    directly-connected non-passive neighbors, and nudges each neighbor
    toward the QFN edge where they share the most nets.

    Args:
        placements: dict[str, Placement] — strategy output (mutated in place)
        free_comps: dict[str, ComponentInfo] — all free components
        fixed_placements: dict[str, Placement] — fixed component positions
        fixed_info: dict[str, ComponentInfo] — fixed component info
        net_graph: dict[str, list[str]] — net → component addresses
        board_state: BoardState — for collision-aware repositioning
        tolerance: float — don't nudge if already within this distance of target

    Returns:
        Updated placements dict.
    """
    # Find QFN components (3+ edges with signal pins)
    qfn_comps = {}
    for addr, comp in free_comps.items():
        if not comp.pad_sides:
            continue
        edges_with_signals = sum(
            1 for nets in comp.pad_sides.values() if len(nets) > 0)
        if edges_with_signals >= 3:
            qfn_comps[addr] = comp

    # Also check fixed components
    for addr, comp in fixed_info.items():
        if not comp.pad_sides:
            continue
        edges_with_signals = sum(
            1 for nets in comp.pad_sides.values() if len(nets) > 0)
        if edges_with_signals >= 3:
            qfn_comps[addr] = comp

    if not qfn_comps:
        return placements

    # For each QFN, find satellites and compute preferred edge
    result = dict(placements)
    for qfn_addr, qfn_comp in qfn_comps.items():
        # Get QFN position
        if qfn_addr in result:
            qfn_pos = result[qfn_addr]
        elif qfn_addr in fixed_placements:
            qfn_pos = fixed_placements[qfn_addr]
        else:
            continue

        # Find directly connected non-passive components
        qfn_nets = set(qfn_comp.nets)
        satellites = {}  # addr -> set of shared nets
        for net_name, net_addrs in net_graph.items():
            if qfn_addr not in net_addrs:
                continue
            if net_name not in qfn_nets:
                continue
            for other_addr in net_addrs:
                if other_addr == qfn_addr:
                    continue
                if other_addr not in free_comps:
                    continue
                if _is_passive_addr(other_addr):
                    continue
                if other_addr not in satellites:
                    satellites[other_addr] = set()
                satellites[other_addr].add(net_name)

        # For each satellite, determine preferred edge
        for sat_addr, shared_nets in satellites.items():
            if sat_addr not in result:
                continue
            sat_comp = free_comps[sat_addr]

            # Count shared nets per QFN edge
            edge_counts = {edge: 0 for edge in ("N", "S", "E", "W")}
            for edge, edge_nets in qfn_comp.pad_sides.items():
                for net in edge_nets:
                    if net in shared_nets:
                        edge_counts[edge] += 1

            # Find best edge
            best_edge = max(edge_counts, key=edge_counts.get)
            if edge_counts[best_edge] == 0:
                continue  # no nets on any edge — skip

            # Compute target position: outside QFN on the preferred edge
            # Distance = half QFN + half satellite + some routing space
            offset_dist = (max(qfn_comp.width, qfn_comp.height) / 2 +
                           max(sat_comp.width, sat_comp.height) / 2 + 2.0)
            dx, dy = _edge_offset(best_edge, offset_dist)
            target_x = qfn_pos.x + dx
            target_y = qfn_pos.y + dy

            # Check if satellite is already close enough
            current = result[sat_addr]
            dist_to_target = ((current.x - target_x) ** 2 +
                              (current.y - target_y) ** 2) ** 0.5
            if dist_to_target <= tolerance:
                continue

            # Build a fresh board state with all components EXCEPT this
            # satellite registered, to avoid self-collision during search.
            nudge_board = board_state.copy()
            for other_addr, other_p in result.items():
                if other_addr == sat_addr:
                    continue  # skip the satellite we're about to move
                other_comp = free_comps.get(other_addr)
                if other_comp:
                    nudge_board.register_placement(
                        other_addr, other_p.x, other_p.y,
                        other_comp, other_p.side)

            fx, fy, side = nudge_board.find_legal_position(
                target_x, target_y, sat_comp, side=current.side)
            result[sat_addr] = Placement(x=fx, y=fy, side=side,
                                          rotation=current.rotation)

    return result
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd hardware && make test-hw  # tests/test_satellite_nudge.py -v`
Expected: All tests pass

- [ ] **Step 5: Run full test suite**

Run: `cd hardware && make test-hw`
Expected: All tests pass (existing + new)

- [ ] **Step 6: Commit**

```
feat(placement): add nudge_satellites() post-processor for QFN parts
```

### Task 7: Wire nudge_satellites into the orchestrator

**Files:**
- Modify: `hardware/boards/scripts/placement/place_components.py:484-486` (after strategy.place())

- [ ] **Step 1: Add nudge_satellites call after strategy placement**

In `place_board()`, after `placements = strategy.place(...)` (line 484), add:

```python
    placements = strategy.place(components_list, board_state, params)

    # Post-process: nudge QFN satellite components toward correct edges.
    # nudge_satellites builds fresh collision trackers internally per
    # satellite to avoid self-collision when repositioning.
    from placement.helpers import nudge_satellites
    placements = nudge_satellites(
        placements, free_components, fixed_placements, fixed_info,
        net_graph, board_state)

    print(f"  Strategy placed {len(placements)} components")
```

- [ ] **Step 2: Run full test suite**

Run: `cd hardware && make test-hw`
Expected: All tests pass

- [ ] **Step 3: Commit**

```
feat(placement): wire satellite nudging into orchestrator
```

---

## Chunk 4: Integration Test

### Task 8: Run full placement + routing pipeline

- [ ] **Step 1: Run placement for all variants**

Run: `cd hardware && make place`

Watch for:
- All 5 main board variants should complete placement
- All 5 control board variants should complete placement
- No overlap errors

- [ ] **Step 2: Check routing results**

After placement completes, examine routing results:

```bash
for f in boards/build/main-*-result.json; do
    echo "=== $(basename $f) ==="; cat "$f" | python3 -m json.tool
done
```

**Success criteria:**
- All 5 main board variants: `"status": "pass"`, `"unconnected_count": 0`
- All 5 control board variants: at least 4/5 pass (same or better than before)

- [ ] **Step 3: Compare routing quality**

Check if the passing variants improved (fewer vias, shorter traces):

| Metric | Before | After |
|--------|--------|-------|
| Main pass rate | 2/5 | ? |
| Best via count | 132 | ? |
| Best trace length | 5708mm | ? |
| Control pass rate | 4/5 | ? |

- [ ] **Step 4: If any main variants still fail, investigate**

Check which nets are unconnected. If it's always the same net(s), the nudging tolerance or offset distance may need tuning.

- [ ] **Step 5: Final commit**

```
test: verify QFN-aware placement improves routing success
```
