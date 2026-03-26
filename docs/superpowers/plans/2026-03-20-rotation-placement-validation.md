# Rotation & Placement Validation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate that rotation, side-flipping, and pin position detection work correctly through the full pipeline: KiCad extraction → placer algorithm → KiCad application.

**Architecture:** Two layers of tests: (1) a visual diagnostic script that generates PNGs from the placer's internal state alongside kicad-cli renders of the same board, for human comparison; (2) pure Python unit tests that encode the validated expectations as assertions. The visual tests use a synthetic KiCad PCB with a handful of known components. The unit tests use synthetic `Component`/`Pin` objects with no KiCad dependency.

**Tech Stack:** Python, pytest, PIL (Pillow), kicad-cli, pcbnew (KiCad Python)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `placer/tests/test_rotation_pipeline.py` | Pure Python unit tests for pin positions, rotation, side-flip, placement direction |
| `placer/tests/test_kicad_roundtrip.py` | KiCad-dependent tests: extract → place → re-extract, verify positions match (skips if no pcbnew) |
| `placer/tests/rotation_visual_check.py` | Standalone script (not pytest): generates comparison PNGs for human review |

All paths relative to `hardware/boards/scripts/`.

---

## Test Scenarios

Each scenario is tested on **both Front and Back** sides.

### A. Fixed component pin positions after rotation

Given: A component at a known position with rotation 0°, 90°, 180°, 270°.
Verify: Pin world positions (via `pin_world_position()`) match expected coordinates.

Example: A 4-pin IC (2mm × 3mm) with pins at known bbox-relative positions.
- Pin NW at (0.5, 0.5), Pin NE at (1.5, 0.5), Pin SE at (1.5, 2.5), Pin SW at (0.5, 2.5)
- At rotation 90° on Front: dimensions become (3mm × 2mm), pin positions rotate accordingly
- At rotation 90° on Back: mirror X first, then rotate

### B. Free component placed on correct side of fixed component

Given: A fixed IC with pins on its East edge connected to a free resistor.
Verify: The free resistor is placed to the East of the IC (not West, not overlapping).

Repeat with pins on N, S, E, W edges. Repeat on Back side.

### C. Free-to-free placement direction

Given: Two free components connected by a net. First one placed, second targeting it.
Verify: `connectivity_target` returns a position near the first component, and the second lands adjacent to it on the correct side.

### D. Free component with rotation still on correct side

Given: A free component that gets rotated (e.g., 90°). Its pins shift edges (N→W, E→N, etc.).
Verify: After rotation, `effective_edge_map` correctly reflects which pins are on which world-edge, and connectivity targeting still places neighbors on the correct side.

---

## Tasks

### Task 1: Pure Python pin position tests

**Files:**
- Create: `placer/tests/test_rotation_pipeline.py`

- [ ] **Step 1: Write failing tests for pin_world_position at all rotations on Front**

```python
"""Tests for rotation, pin positions, and placement direction."""
import pytest
from placer.dtypes import Component, Pin, Side, PlacedComponent, Net, Board
from placer.geometry import (
    pin_world_position, rotated_dims, effective_point,
    classify_pins_by_edge, effective_edge_map,
)
from placer.context import PlacementContext


def _make_ic(id="ic1", width=4.0, height=6.0, pins=None):
    """Create a 4-pin IC: pins at midpoints of each edge."""
    if pins is None:
        pins = [
            Pin(id="n1", x=2.0, y=0.0),   # N edge center
            Pin(id="s1", x=2.0, y=6.0),   # S edge center
            Pin(id="e1", x=4.0, y=3.0),   # E edge center
            Pin(id="w1", x=0.0, y=3.0),   # W edge center
        ]
    return Component(id=id, width=width, height=height, pins=pins)


def _make_resistor(id="r1", width=3.0, height=1.5, net_w="net_a", net_e="net_b"):
    """Create a 2-pin resistor: pads on W and E edges."""
    return Component(
        id=id, width=width, height=height,
        pins=[Pin(id=net_w, x=0.0, y=0.75), Pin(id=net_e, x=3.0, y=0.75)],
    )


class TestPinWorldPositionFront:
    """Verify pin world positions for all rotations on Front side."""

    def test_rotation_0(self):
        ic = _make_ic()
        # IC placed at bbox top-left (10, 20), rot=0, front
        # N pin at (2,0) relative → world (12, 20)
        wx, wy = pin_world_position(ic, ic.pins[0], 10, 20, 0.0, Side.FRONT)
        assert (wx, wy) == pytest.approx((12.0, 20.0), abs=0.01)
        # E pin at (4,3) → world (14, 23)
        wx, wy = pin_world_position(ic, ic.pins[2], 10, 20, 0.0, Side.FRONT)
        assert (wx, wy) == pytest.approx((14.0, 23.0), abs=0.01)

    def test_rotation_90(self):
        ic = _make_ic()
        # At 90° CCW, bbox becomes 6×4. Pin N (2,0) rotates.
        # rotate_point(2, 0, w=4, h=6, rot=90) → (0, 4-2) = (0, 2)
        wx, wy = pin_world_position(ic, ic.pins[0], 10, 20, 90.0, Side.FRONT)
        assert (wx, wy) == pytest.approx((10.0, 22.0), abs=0.01)

    def test_rotation_180(self):
        ic = _make_ic()
        # rotate_point(2, 0, w=4, h=6, rot=180) → (4-2, 6-0) = (2, 6)
        wx, wy = pin_world_position(ic, ic.pins[0], 10, 20, 180.0, Side.FRONT)
        assert (wx, wy) == pytest.approx((12.0, 26.0), abs=0.01)

    def test_rotation_270(self):
        ic = _make_ic()
        # rotate_point(2, 0, w=4, h=6, rot=270) → (6-0, 2) = (6, 2)
        wx, wy = pin_world_position(ic, ic.pins[0], 10, 20, 270.0, Side.FRONT)
        assert (wx, wy) == pytest.approx((16.0, 22.0), abs=0.01)


class TestPinWorldPositionBack:
    """Verify pin positions on Back side (mirror X, then rotate)."""

    def test_back_rotation_0(self):
        ic = _make_ic()
        # Back: mirror X first. Pin N at (2,0) → mirror → (4-2, 0) = (2, 0)
        # Then rotate 0° → (2, 0). World: (12, 20)
        wx, wy = pin_world_position(ic, ic.pins[0], 10, 20, 0.0, Side.BACK)
        assert (wx, wy) == pytest.approx((12.0, 20.0), abs=0.01)

    def test_back_rotation_0_east_pin(self):
        ic = _make_ic()
        # E pin at (4, 3) → mirror X → (0, 3) → rotate 0° → (0, 3)
        # World: (10, 23)
        wx, wy = pin_world_position(ic, ic.pins[2], 10, 20, 0.0, Side.BACK)
        assert (wx, wy) == pytest.approx((10.0, 23.0), abs=0.01)

    def test_back_rotation_90(self):
        ic = _make_ic()
        # E pin (4,3) → mirror → (0, 3) → rotate 90° in 4×6 box
        # rotate_point(0, 3, w=4, h=6, rot=90) → (3, 4-0) = (3, 4)
        wx, wy = pin_world_position(ic, ic.pins[2], 10, 20, 90.0, Side.BACK)
        assert (wx, wy) == pytest.approx((13.0, 24.0), abs=0.01)


class TestEdgeMapRotation:
    """Verify edge classification rotates correctly."""

    def test_front_rotation_0(self):
        ic = _make_ic()
        edge_map = classify_pins_by_edge(ic)
        eff = effective_edge_map(edge_map, 0.0, Side.FRONT)
        # At 0° front, N pin stays N, E stays E, etc.
        assert len(eff["N"]) == 1
        assert eff["N"][0].id == "n1"
        assert len(eff["E"]) == 1
        assert eff["E"][0].id == "e1"

    def test_front_rotation_90(self):
        ic = _make_ic()
        edge_map = classify_pins_by_edge(ic)
        eff = effective_edge_map(edge_map, 90.0, Side.FRONT)
        # 90° CCW: N→W, E→N, S→E, W→S
        assert eff["W"][0].id == "n1"
        assert eff["N"][0].id == "e1"

    def test_back_rotation_0(self):
        ic = _make_ic()
        edge_map = classify_pins_by_edge(ic)
        eff = effective_edge_map(edge_map, 0.0, Side.BACK)
        # Back mirror: E↔W, N and S unchanged
        assert eff["W"][0].id == "e1"
        assert eff["E"][0].id == "w1"
        assert eff["N"][0].id == "n1"


class TestConnectivityTargetDirection:
    """Verify free components target the correct side of fixed components."""

    def _make_board(self, fixed_pin_edge="E", fixed_side=Side.FRONT,
                    fixed_rotation=0.0):
        """Board with one fixed IC and one free resistor connected via net_a.

        fixed_pin_edge: which edge of the IC has the connecting pin.
        """
        ic = _make_ic(id="ic1")
        ic.fixed = True
        ic.x = 50.0
        ic.y = 40.0
        ic.rotation = fixed_rotation
        ic.side = fixed_side

        resistor = _make_resistor(id="r1", net_w="net_a", net_e="net_b")

        # Net connects ic1.e1 (East pin) to r1's West pin
        net = Net(id="net_a", connections=(("ic1", "e1"), ("r1", "net_a")))

        board = Board(
            width=100.0, height=80.0,
            components=[ic, resistor],
            nets=[net],
            rotation_nets=[net],
            clearance=0.5,
        )
        return board

    def test_free_targets_east_of_fixed_front(self):
        board = self._make_board(fixed_pin_edge="E", fixed_side=Side.FRONT)
        ctx = PlacementContext(board)
        tx, ty = ctx.connectivity_target("r1", {})
        # IC is at (50, 40) with E pin at (54, 43).
        # Target should be to the right of the IC (x > 52)
        assert tx > 52.0, f"Expected target east of IC, got tx={tx}"

    def test_free_targets_east_of_fixed_back(self):
        board = self._make_board(fixed_pin_edge="E", fixed_side=Side.BACK)
        ctx = PlacementContext(board)
        tx, ty = ctx.connectivity_target("r1", {})
        # On back, E pin mirrors to W side. IC center is ~(52, 43).
        # The E pin world position after mirror: (50, 43)
        # Target should be to the LEFT of the IC (x < 52)
        assert tx < 52.0, f"Expected target west of IC on back side, got tx={tx}"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd hardware/boards/scripts && PYTHONPATH=. python -m pytest placer/tests/test_rotation_pipeline.py -v`
Expected: Some tests may pass (geometry is already implemented), others may fail if pin_world_position or edge_map behavior doesn't match expectations. This validates our understanding.

- [ ] **Step 3: Fix any test expectations that don't match the actual (correct) behavior**

The goal is to establish ground truth. If `rotate_point(2, 0, w=4, h=6, rot=90)` returns something different than our expectation, check the geometry code, verify it's correct, and update the test expectation. Do NOT change the geometry code to match wrong expectations.

- [ ] **Step 4: Run tests to verify all pass**

Run: `cd hardware/boards/scripts && PYTHONPATH=. python -m pytest placer/tests/test_rotation_pipeline.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add hardware/boards/scripts/placer/tests/test_rotation_pipeline.py
git commit -m "test: add rotation pipeline unit tests for pin positions and edge maps"
```

---

### Task 2: Visual diagnostic script for human verification

**Files:**
- Create: `placer/tests/rotation_visual_check.py`

This script creates a synthetic board with known components, runs placement, and generates:
1. **algo_view.png** — placer's internal rectangles with pin positions drawn as dots
2. **kicad_render.png** — kicad-cli render of the actual placed PCB (via pcbnew)
3. **comparison.png** — side-by-side composite

The script does NOT run as a pytest test — it's a manual visual validation tool.

- [ ] **Step 1: Write the visual check script**

```python
#!/usr/bin/env python3
"""Visual rotation check: synthetic board with known pin positions.

Creates a small KiCad PCB with a few components, runs placement,
renders both the algorithm's view and KiCad's actual rendering.

Usage:
    # From hardware/boards/scripts:
    /Applications/KiCad/KiCad.app/.../python3 -m placer.tests.rotation_visual_check

Outputs to hardware/boards/scripts/build/rotation_check/
"""
import os
import sys
import subprocess

# Needs KiCad Python
pcbnew = None
try:
    import pcbnew
except ImportError:
    print("ERROR: Requires KiCad Python (pcbnew)")
    sys.exit(1)

from PIL import Image, ImageDraw

from placer.dtypes import Component, Pin, Side, Net, Board, PlacedComponent
from placer.geometry import pin_world_position, rotated_dims
from placer.kicad_bridge import (
    extract_component, extract_nets, build_placer_board, apply_placements,
)
from placer.context import PlacementContext
from placer.strategies.wavefront import wavefront


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(SCRIPT_DIR, "..", "build", "rotation_check")


def mm_to_px(mm, scale=10.0):
    return int(mm * scale)


def render_algo_view(filename, board_w, board_h, components, placements,
                     title="", scale=10.0):
    """Render algorithm's view: bounding boxes + pin dots."""
    pw = mm_to_px(board_w, scale) + 40
    ph = mm_to_px(board_h, scale) + 60
    img = Image.new("RGB", (pw, ph), "white")
    draw = ImageDraw.Draw(img)
    ox, oy = 20, 40

    draw.text((10, 5), title, fill="black")
    draw.rectangle([ox, oy, ox + mm_to_px(board_w, scale),
                    oy + mm_to_px(board_h, scale)],
                   outline="black", width=2)

    comp_map = {c.id: c for c in components}

    for comp in components:
        if comp.fixed:
            x, y, rot, side = comp.x, comp.y, comp.rotation, comp.side
        else:
            p = placements.get(comp.id)
            if p is None:
                continue
            x, y, rot, side = p.x, p.y, p.rotation, p.side

        ew, eh = rotated_dims(comp.width, comp.height, rot)

        # Draw bbox
        px1 = ox + mm_to_px(x, scale)
        py1 = oy + mm_to_px(y, scale)
        px2 = px1 + mm_to_px(ew, scale)
        py2 = py1 + mm_to_px(eh, scale)
        color = "#cccccc" if comp.fixed else "#4488ff"
        outline = "#888888" if comp.fixed else "#2266cc"
        draw.rectangle([px1, py1, px2, py2], fill=color, outline=outline)

        # Label
        label = f"{comp.id} {'B' if side == Side.BACK else 'F'} {int(rot)}°"
        draw.text((px1 + 2, py1 + 2), label, fill="black")

        # Draw pins as colored dots
        for pin in comp.pins:
            wpx, wpy = pin_world_position(comp, pin, x, y, rot, side)
            dpx = ox + mm_to_px(wpx, scale)
            dpy = oy + mm_to_px(wpy, scale)
            r = 3
            draw.ellipse([dpx - r, dpy - r, dpx + r, dpy + r],
                         fill="red", outline="darkred")
            draw.text((dpx + 4, dpy - 6), pin.id[:6], fill="red")

    img.save(filename)
    print(f"  Saved {filename}")


def run_check():
    os.makedirs(OUT_DIR, exist_ok=True)

    # --- Test scenarios ---
    scenarios = [
        # (description, fixed_side, fixed_rotation)
        ("Front 0°", Side.FRONT, 0.0),
        ("Front 90°", Side.FRONT, 90.0),
        ("Front 180°", Side.FRONT, 180.0),
        ("Front 270°", Side.FRONT, 270.0),
        ("Back 0°", Side.BACK, 0.0),
        ("Back 90°", Side.BACK, 90.0),
        ("Back 180°", Side.BACK, 180.0),
        ("Back 270°", Side.BACK, 270.0),
    ]

    board_w, board_h = 60.0, 40.0

    for desc, fixed_side, fixed_rot in scenarios:
        tag = f"{fixed_side.value}_{int(fixed_rot)}"

        # Fixed IC in center
        ic = Component(
            id="ic1", width=6.0, height=8.0, fixed=True,
            x=20.0, y=12.0, rotation=fixed_rot, side=fixed_side,
            pins=[
                Pin(id="n1", x=3.0, y=0.0),
                Pin(id="s1", x=3.0, y=8.0),
                Pin(id="e1", x=6.0, y=4.0),
                Pin(id="w1", x=0.0, y=4.0),
            ],
        )

        # Free resistors connected to each IC pin
        r_e = Component(id="r_east", width=3.0, height=1.5,
                        pins=[Pin(id="e1", x=0.0, y=0.75),
                              Pin(id="other", x=3.0, y=0.75)])
        r_w = Component(id="r_west", width=3.0, height=1.5,
                        pins=[Pin(id="w1", x=0.0, y=0.75),
                              Pin(id="other", x=3.0, y=0.75)])
        r_n = Component(id="r_north", width=3.0, height=1.5,
                        pins=[Pin(id="n1", x=0.0, y=0.75),
                              Pin(id="other", x=3.0, y=0.75)])
        r_s = Component(id="r_south", width=3.0, height=1.5,
                        pins=[Pin(id="s1", x=0.0, y=0.75),
                              Pin(id="other", x=3.0, y=0.75)])

        nets = [
            Net(id="e1", connections=(("ic1", "e1"), ("r_east", "e1"))),
            Net(id="w1", connections=(("ic1", "w1"), ("r_west", "w1"))),
            Net(id="n1", connections=(("ic1", "n1"), ("r_north", "n1"))),
            Net(id="s1", connections=(("ic1", "s1"), ("r_south", "s1"))),
        ]

        board = Board(
            width=board_w, height=board_h,
            components=[ic, r_e, r_w, r_n, r_s],
            nets=nets, rotation_nets=nets,
            clearance=0.5,
        )

        ctx = PlacementContext(board)
        results = wavefront(board, ctx, {})
        placements = {r.component_id: r for r in results}

        render_algo_view(
            os.path.join(OUT_DIR, f"algo_{tag}.png"),
            board_w, board_h, board.components, placements,
            title=f"ALGO: IC on {desc}, resistors should surround it",
        )

    print(f"\nAll PNGs saved to {OUT_DIR}/")
    print("Verify visually:")
    print("  - Pin dots (red) should be at correct edge of IC bbox")
    print("  - Resistors should be placed near the IC edge they connect to")
    print("  - Back-side scenarios should mirror E/W pins")


if __name__ == "__main__":
    run_check()
```

- [ ] **Step 2: Run the visual check**

Run: `/opt/homebrew/bin/python3.11 -m placer.tests.rotation_visual_check` (from `hardware/boards/scripts/`)
Expected: PNGs in `build/rotation_check/`. Verify visually:
- Pin dots at correct edges
- Resistors placed near the correct IC edge
- Back-side mirrors E↔W

- [ ] **Step 3: Review and screenshot the PNGs**

Open each PNG. For each scenario, verify:
1. Red pin dots match the expected edge of the IC bounding box
2. The 4 resistors are placed near the IC edge they connect to
3. Back-side scenarios have mirrored E/W compared to front

If anything looks wrong, trace through the geometry code and fix it.

- [ ] **Step 4: Commit**

```bash
git add placer/tests/rotation_visual_check.py
git commit -m "test: add visual rotation check script for human verification"
```

---

### Task 3: KiCad roundtrip test

**Files:**
- Create: `placer/tests/test_kicad_roundtrip.py`

Tests that extract → place → apply → re-extract produces consistent positions. Uses real KiCad footprints from the control board PCB.

- [ ] **Step 1: Write the roundtrip test**

```python
"""KiCad roundtrip: extract component, apply placement, verify position.

Tests that our coordinate conversion (bbox top-left ↔ KiCad origin)
is consistent through extract → place → apply → re-extract.

Requires KiCad Python (pcbnew). Skipped if not available.
"""
import os
import pytest

pcbnew = pytest.importorskip("pcbnew")

import sys
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(SCRIPT_DIR, "..", ".."))

from placement.helpers import identify_power_nets
from placer.kicad_bridge import extract_component, apply_placements, _rotate_offset
from placer.geometry import rotated_dims
from placer.dtypes import PlacedComponent, Side


BOARDS_DIR = os.path.join(SCRIPT_DIR, "..", "..", "..")
CONTROL_PCB = os.path.join(BOARDS_DIR, "elec", "layout", "control", "control.kicad_pcb")


def _load_board():
    if not os.path.exists(CONTROL_PCB):
        pytest.skip(f"PCB not found: {CONTROL_PCB}")
    return pcbnew.LoadBoard(CONTROL_PCB)


def _find_fp(board, addr):
    for fp in board.GetFootprints():
        if fp.HasFieldByName("atopile_address"):
            if fp.GetFieldText("atopile_address") == addr:
                return fp
    pytest.skip(f"Footprint not found: {addr}")


@pytest.mark.parametrize("rotation", [0.0, 90.0, 180.0, 270.0])
@pytest.mark.parametrize("side", [Side.FRONT, Side.BACK])
class TestRoundtrip:
    """Extract a component, create a placement, apply it, verify position."""

    def test_resistor_roundtrip(self, rotation, side):
        """A simple 2-pad resistor survives the roundtrip."""
        board = _load_board()
        power_nets = identify_power_nets(board)

        # Find a resistor
        addr = None
        for fp in board.GetFootprints():
            if fp.HasFieldByName("atopile_address"):
                a = fp.GetFieldText("atopile_address")
                if a.startswith("r_") or ".r_" in a:
                    addr = a
                    break
        if addr is None:
            pytest.skip("No resistor found")

        fp = _find_fp(board, addr)
        bridge = extract_component(addr, fp, pcbnew, power_nets)
        comp = bridge.component

        # Create a placement at a known position
        target_x, target_y = 30.0, 25.0
        placed = PlacedComponent(
            component_id=addr,
            x=target_x, y=target_y,
            rotation=rotation,
            side=side,
        )

        # Apply placement
        apply_placements([placed], {addr: bridge}, {addr: fp}, board, pcbnew)

        # Re-extract and verify the position roundtrips
        bridge2 = extract_component(
            addr, fp, pcbnew, power_nets,
            is_fixed=True,
            fixed_x=pcbnew.ToMM(fp.GetPosition().x),
            fixed_y=pcbnew.ToMM(fp.GetPosition().y),
            fixed_side="F" if fp.GetLayer() == board.GetLayerID("F.Cu") else "B",
            fixed_rotation=fp.GetOrientationDegrees(),
        )

        # The re-extracted bbox top-left should match our original target
        assert bridge2.component.x == pytest.approx(target_x, abs=0.5)
        assert bridge2.component.y == pytest.approx(target_y, abs=0.5)
```

- [ ] **Step 2: Run the test**

Run: `cd hardware/boards/scripts && PYTHONPATH=. /Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3 -m pytest placer/tests/test_kicad_roundtrip.py -v`
Expected: Tests pass or reveal roundtrip mismatches that need fixing.

- [ ] **Step 3: Fix any roundtrip failures**

If a rotation/side combination produces a position mismatch, the bug is in either `apply_placements` (the additive rotation logic) or `extract_component` (the bbox-from-origin conversion). Fix the code, not the test.

- [ ] **Step 4: Run tests again to verify all pass**

Expected: 8 tests pass (4 rotations × 2 sides)

- [ ] **Step 5: Commit**

```bash
git add placer/tests/test_kicad_roundtrip.py
git commit -m "test: add KiCad roundtrip test for rotation and side-flip"
```

---

### Task 4: Add KiCad render comparison to visual check

**Files:**
- Modify: `placer/tests/rotation_visual_check.py`

Extend the visual check to also produce kicad-cli SVG renders of placed boards for direct comparison with the algorithm view.

- [ ] **Step 1: Add KiCad PCB generation and rendering**

After generating the algo view PNGs, also:
1. Create a minimal `.kicad_pcb` with footprints at the placed positions
2. Run `kicad-cli pcb export svg` on it
3. Save alongside the algo PNG

This requires either creating synthetic KiCad footprints (complex) or using real footprints from an existing PCB. Use the simpler approach: generate a `.kicad_pcb` with `gr_rect` bounding boxes and pin position `gr_circle` markers on the correct layers — this gives a KiCad-rendered view without needing real footprints.

- [ ] **Step 2: Run and compare**

Open both PNGs side-by-side. The bounding boxes and pin dots should match between the algo view and the KiCad render.

- [ ] **Step 3: Commit**

```bash
git add placer/tests/rotation_visual_check.py
git commit -m "test: add kicad-cli render comparison to visual rotation check"
```
