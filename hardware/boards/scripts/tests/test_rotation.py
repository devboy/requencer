"""Tests for rotate_pad_sides() and rotated_info() rotation geometry primitives."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from placement.helpers import rotate_pad_sides, CollisionTracker
from placement.strategies import ComponentInfo, rotated_info

# ---------------------------------------------------------------------------
# Shared test data
# ---------------------------------------------------------------------------

SIDES = {"N": ["din"], "S": ["out4", "out5"], "E": ["sclk"], "W": ["out0", "out1"]}


# ---------------------------------------------------------------------------
# TestRotatePadSides
# ---------------------------------------------------------------------------

class TestRotatePadSides:
    def test_zero_degrees_returns_copy(self):
        result = rotate_pad_sides(SIDES, 0)
        assert result == SIDES
        assert result is not SIDES  # must be a copy

    def test_90_ccw(self):
        # 90° CCW: N→W, W→S, S→E, E→N
        result = rotate_pad_sides(SIDES, 90)
        assert result["W"] == SIDES["N"]   # N moves to W
        assert result["S"] == SIDES["W"]   # W moves to S
        assert result["E"] == SIDES["S"]   # S moves to E
        assert result["N"] == SIDES["E"]   # E moves to N

    def test_180(self):
        # 180°: N↔S, W↔E
        result = rotate_pad_sides(SIDES, 180)
        assert result["S"] == SIDES["N"]
        assert result["N"] == SIDES["S"]
        assert result["E"] == SIDES["W"]
        assert result["W"] == SIDES["E"]

    def test_270_ccw(self):
        # 270° CCW: W→N, N→E, E→S, S→W
        result = rotate_pad_sides(SIDES, 270)
        assert result["N"] == SIDES["W"]   # W moves to N
        assert result["E"] == SIDES["N"]   # N moves to E
        assert result["S"] == SIDES["E"]   # E moves to S
        assert result["W"] == SIDES["S"]   # S moves to W

    def test_360_roundtrip(self):
        result = rotate_pad_sides(SIDES, 360)
        assert result == SIDES

    def test_empty_sides(self):
        result = rotate_pad_sides({}, 90)
        assert result == {}

    def test_invalid_degrees_raises(self):
        import pytest
        with pytest.raises(ValueError):
            rotate_pad_sides(SIDES, 45)

    def test_returns_new_lists(self):
        # Values must be independent copies, not shared references
        result = rotate_pad_sides(SIDES, 90)
        result["W"].append("EXTRA")
        assert "EXTRA" not in SIDES["N"]

    def test_works_with_int_values(self):
        # edge_signal_count variant: dict[str, int]
        counts = {"N": 1, "S": 2, "E": 3, "W": 4}
        result = rotate_pad_sides(counts, 90)
        assert result["W"] == counts["N"]
        assert result["S"] == counts["W"]
        assert result["E"] == counts["S"]
        assert result["N"] == counts["E"]


# ---------------------------------------------------------------------------
# TestRotatedInfoDimensions
# ---------------------------------------------------------------------------

def make_comp(w, h, cx=0.0, cy=0.0, pad_sides=None, edge_count=None):
    return ComponentInfo(
        address="test.comp",
        width=w, height=h,
        is_tht=False, pin_count=4,
        nets=["net1"],
        cx_offset=cx, cy_offset=cy,
        pad_sides=pad_sides or {},
        edge_signal_count=edge_count or {},
    )


class TestRotatedInfoDimensions:
    def test_zero_returns_same_object(self):
        comp = make_comp(5, 3)
        result = rotated_info(comp, 0)
        assert result is comp

    def test_90_swaps_dimensions(self):
        comp = make_comp(5, 3)
        result = rotated_info(comp, 90)
        assert result.width == 3
        assert result.height == 5

    def test_180_keeps_dimensions(self):
        comp = make_comp(5, 3)
        result = rotated_info(comp, 180)
        assert result.width == 5
        assert result.height == 3

    def test_270_swaps_dimensions(self):
        comp = make_comp(5, 3)
        result = rotated_info(comp, 270)
        assert result.width == 3
        assert result.height == 5

    def test_360_roundtrip(self):
        comp = make_comp(5, 3)
        result = rotated_info(comp, 360)
        # 360 % 360 == 0 → returns same object
        assert result is comp

    def test_other_fields_preserved(self):
        comp = make_comp(5, 3)
        result = rotated_info(comp, 90)
        assert result.address == comp.address
        assert result.is_tht == comp.is_tht
        assert result.pin_count == comp.pin_count
        assert result.nets == comp.nets


# ---------------------------------------------------------------------------
# TestRotatedInfoOffset
# ---------------------------------------------------------------------------

class TestRotatedInfoOffset:
    def test_zero_no_change(self):
        comp = make_comp(5, 3, cx=0, cy=4)
        result = rotated_info(comp, 0)
        assert result.cx_offset == 0
        assert result.cy_offset == 4

    def test_90_ccw(self):
        # (cx=0, cy=4) → 90° CCW: (cy, -cx) = (4, 0)
        comp = make_comp(5, 3, cx=0, cy=4)
        result = rotated_info(comp, 90)
        assert result.cx_offset == pytest.approx(4.0)
        assert result.cy_offset == pytest.approx(0.0)

    def test_180(self):
        # (cx=0, cy=4) → 180°: (-cx, -cy) = (0, -4)
        comp = make_comp(5, 3, cx=0, cy=4)
        result = rotated_info(comp, 180)
        assert result.cx_offset == pytest.approx(0.0)
        assert result.cy_offset == pytest.approx(-4.0)

    def test_270_ccw(self):
        # (cx=0, cy=4) → 270° CCW: (-cy, cx) = (-4, 0)
        comp = make_comp(5, 3, cx=0, cy=4)
        result = rotated_info(comp, 270)
        assert result.cx_offset == pytest.approx(-4.0)
        assert result.cy_offset == pytest.approx(0.0)

    def test_180_general_offset(self):
        # (cx=2, cy=3) → 180°: (-2, -3)
        comp = make_comp(5, 3, cx=2, cy=3)
        result = rotated_info(comp, 180)
        assert result.cx_offset == pytest.approx(-2.0)
        assert result.cy_offset == pytest.approx(-3.0)


import pytest


# ---------------------------------------------------------------------------
# TestRotatedInfoPadSides
# ---------------------------------------------------------------------------

class TestRotatedInfoPadSides:
    def test_pad_sides_rotate_90(self):
        comp = make_comp(5, 3, pad_sides=dict(SIDES))
        result = rotated_info(comp, 90)
        # 90° CCW: N→W, W→S, S→E, E→N
        assert result.pad_sides["W"] == SIDES["N"]
        assert result.pad_sides["S"] == SIDES["W"]
        assert result.pad_sides["E"] == SIDES["S"]
        assert result.pad_sides["N"] == SIDES["E"]

    def test_edge_signal_count_rotates(self):
        counts = {"N": 1, "S": 2, "E": 3, "W": 4}
        comp = make_comp(5, 3, edge_count=dict(counts))
        result = rotated_info(comp, 90)
        assert result.edge_signal_count["W"] == counts["N"]
        assert result.edge_signal_count["S"] == counts["W"]
        assert result.edge_signal_count["E"] == counts["S"]
        assert result.edge_signal_count["N"] == counts["E"]

    def test_empty_pad_sides_stays_empty(self):
        comp = make_comp(5, 3)
        result = rotated_info(comp, 90)
        assert result.pad_sides == {}
        assert result.edge_signal_count == {}


# ---------------------------------------------------------------------------
# TestRotatedInfoCollision
# ---------------------------------------------------------------------------

class TestRotatedInfoCollision:
    """Verify that rotated dimensions affect collision detection via CollisionTracker."""

    def _make_tsso_comp(self):
        """5×3mm TSSO-style component, pads only on W and E."""
        return make_comp(
            w=5, h=3,
            pad_sides={"N": [], "S": [], "E": ["sclk", "sync"], "W": ["out0", "out1"]},
        )

    def test_side_by_side_no_collision(self):
        """Two 5×3 components placed side-by-side with 1mm gap: no collision."""
        tracker = CollisionTracker(50, 50, clearance=0.0)
        # Place first at center (10, 10)
        tracker.register(10, 10, 5, 3, "F", is_tht=False, label="comp_a")
        # Place second 6mm to the right (5mm width + 1mm gap)
        assert not tracker.collides(16, 10, 5, 3, "F", is_tht=False)

    def test_rotate_90_causes_collision(self):
        """Rotating one 5×3 component to 90° → becomes 3×5, taller body overlaps."""
        tracker = CollisionTracker(50, 50, clearance=0.0)
        # Place first component (5×3) at (10, 10)
        comp_a = self._make_tsso_comp()
        tracker.register(10, 10, comp_a.width, comp_a.height, "F", is_tht=False, label="comp_a")

        # Rotate second component 90° → becomes 3w × 5h
        comp_b_rotated = rotated_info(self._make_tsso_comp(), 90)
        assert comp_b_rotated.width == 3
        assert comp_b_rotated.height == 5

        # Place it 4mm to the right: gap between edges = 4 - 2.5 - 1.5 = 0mm
        # At exactly touching, collides() returns False (open boundary)
        # At 3.9mm gap we expect a collision
        collides = tracker.collides(
            10 + 3.9, 10,
            comp_b_rotated.width, comp_b_rotated.height,
            "F", is_tht=False
        )
        assert collides

    def test_rotate_90_no_collision_when_separated(self):
        """Rotated component with sufficient separation: no collision."""
        tracker = CollisionTracker(50, 50, clearance=0.0)
        comp_a = self._make_tsso_comp()
        tracker.register(10, 10, comp_a.width, comp_a.height, "F", is_tht=False, label="comp_a")

        comp_b_rotated = rotated_info(self._make_tsso_comp(), 90)
        # comp_a half-width=2.5, comp_b_rotated half-width=1.5 → need >4mm separation
        collides = tracker.collides(
            10 + 5.0, 10,
            comp_b_rotated.width, comp_b_rotated.height,
            "F", is_tht=False
        )
        assert not collides
