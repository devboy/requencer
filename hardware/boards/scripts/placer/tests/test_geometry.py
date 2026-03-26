"""Tests for placer geometry module."""

import pytest
from placer.dtypes import Component, Pin, Side, SidePadding
from placer.geometry import (
    rotated_dims, rotate_point, mirror_x_point, effective_point,
    effective_dims, padded_rect, center_of_rect, topleft_from_center,
    pin_world_position, classify_pins_by_edge, rotate_edge_map,
    mirror_x_edge_map, effective_edge_map, edge_offset, OPPOSITE_EDGE,
)


class TestRotatedDims:
    def test_0(self):
        assert rotated_dims(10, 5, 0) == (10, 5)

    def test_90(self):
        assert rotated_dims(10, 5, 90) == (5, 10)

    def test_180(self):
        assert rotated_dims(10, 5, 180) == (10, 5)

    def test_270(self):
        assert rotated_dims(10, 5, 270) == (5, 10)

    def test_360_wraps(self):
        assert rotated_dims(10, 5, 360) == (10, 5)


class TestRotatePoint:
    def test_0(self):
        assert rotate_point(2, 3, 10, 8, 0) == (2, 3)

    def test_90(self):
        # (2, 3) in 10x8 rect → (3, 8) in 8x10 rect
        x, y = rotate_point(2, 3, 10, 8, 90)
        assert x == pytest.approx(3)
        assert y == pytest.approx(8)

    def test_180(self):
        x, y = rotate_point(2, 3, 10, 8, 180)
        assert x == pytest.approx(8)
        assert y == pytest.approx(5)

    def test_270(self):
        x, y = rotate_point(2, 3, 10, 8, 270)
        assert x == pytest.approx(5)
        assert y == pytest.approx(2)

    def test_invalid_raises(self):
        with pytest.raises(ValueError):
            rotate_point(0, 0, 10, 10, 45)


class TestMirrorXPoint:
    def test_mirror(self):
        assert mirror_x_point(2.0, 10.0) == 8.0

    def test_center_unchanged(self):
        assert mirror_x_point(5.0, 10.0) == 5.0


class TestEffectivePoint:
    def test_front_no_rotation(self):
        x, y = effective_point(2, 3, 10, 8, 0, Side.FRONT)
        assert (x, y) == (2, 3)

    def test_back_mirrors_x(self):
        x, y = effective_point(2, 3, 10, 8, 0, Side.BACK)
        assert x == pytest.approx(8)  # mirrored
        assert y == pytest.approx(3)  # unchanged


class TestEffectiveDims:
    def test_with_component(self):
        c = Component(id="u1", width=10, height=5)
        assert effective_dims(c, 90) == (5, 10)


class TestPaddedRect:
    def test_no_padding(self):
        result = padded_rect(5, 10, 20, 15, SidePadding())
        assert result == (5, 10, 20, 15)

    def test_uniform_padding(self):
        pad = SidePadding(top=1, bottom=1, left=1, right=1)
        x, y, w, h = padded_rect(5, 10, 20, 15, pad)
        assert x == 4
        assert y == 9
        assert w == 22
        assert h == 17

    def test_asymmetric_padding(self):
        pad = SidePadding(top=2, bottom=0, left=1, right=3)
        x, y, w, h = padded_rect(0, 0, 10, 10, pad)
        assert x == -1
        assert y == -2
        assert w == 14
        assert h == 12


class TestCenterConversions:
    def test_center_of_rect(self):
        assert center_of_rect(0, 0, 10, 8) == (5, 4)

    def test_topleft_from_center(self):
        assert topleft_from_center(5, 4, 10, 8) == (0, 0)

    def test_roundtrip(self):
        cx, cy = center_of_rect(3, 7, 10, 6)
        x, y = topleft_from_center(cx, cy, 10, 6)
        assert x == pytest.approx(3)
        assert y == pytest.approx(7)


class TestPinWorldPosition:
    def test_no_rotation(self):
        comp = Component(id="u1", width=10, height=8)
        pin = Pin("1", 0, 4)
        x, y = pin_world_position(comp, pin, 5, 10, 0, Side.FRONT)
        assert x == pytest.approx(5)
        assert y == pytest.approx(14)

    def test_rotated_90(self):
        comp = Component(id="u1", width=10, height=8)
        pin = Pin("1", 0, 4)
        x, y = pin_world_position(comp, pin, 5, 10, 90, Side.FRONT)
        # rotate_point(0, 4, 10, 8, 90) → (4, 10)
        assert x == pytest.approx(9)
        assert y == pytest.approx(20)


class TestClassifyPinsByEdge:
    def test_quad_package(self):
        # 4 pins at cardinal positions of a 10x10 component
        pins = [
            Pin("N", 5, 0),   # top
            Pin("S", 5, 10),  # bottom
            Pin("W", 0, 5),   # left
            Pin("E", 10, 5),  # right
        ]
        comp = Component(id="u1", width=10, height=10, pins=pins)
        edges = classify_pins_by_edge(comp)
        assert len(edges["N"]) == 1
        assert edges["N"][0].id == "N"
        assert len(edges["S"]) == 1
        assert edges["S"][0].id == "S"
        assert len(edges["W"]) == 1
        assert len(edges["E"]) == 1

    def test_no_pins(self):
        comp = Component(id="u1", width=10, height=10)
        edges = classify_pins_by_edge(comp)
        assert all(len(v) == 0 for v in edges.values())


class TestRotateEdgeMap:
    def test_90_ccw(self):
        emap = {"N": [1], "S": [2], "E": [3], "W": [4]}
        result = rotate_edge_map(emap, 90)
        assert result["W"] == [1]  # N→W
        assert result["E"] == [2]  # S→E
        assert result["N"] == [3]  # E→N
        assert result["S"] == [4]  # W→S

    def test_180(self):
        emap = {"N": [1], "S": [2], "E": [3], "W": [4]}
        result = rotate_edge_map(emap, 180)
        assert result["S"] == [1]  # N→S
        assert result["N"] == [2]  # S→N

    def test_0_identity(self):
        emap = {"N": [1], "S": [2], "E": [3], "W": [4]}
        result = rotate_edge_map(emap, 0)
        assert result == emap


class TestMirrorXEdgeMap:
    def test_swaps_ew(self):
        emap = {"N": [1], "S": [2], "E": [3], "W": [4]}
        result = mirror_x_edge_map(emap)
        assert result["E"] == [4]  # W→E
        assert result["W"] == [3]  # E→W
        assert result["N"] == [1]  # unchanged
        assert result["S"] == [2]  # unchanged


class TestEdgeOffset:
    def test_north(self):
        assert edge_offset("N", 5.0) == (0.0, -5.0)

    def test_east(self):
        assert edge_offset("E", 3.0) == (3.0, 0.0)

    def test_unknown(self):
        assert edge_offset("X", 5.0) == (0.0, 0.0)


class TestOppositeEdge:
    def test_all(self):
        assert OPPOSITE_EDGE["N"] == "S"
        assert OPPOSITE_EDGE["S"] == "N"
        assert OPPOSITE_EDGE["E"] == "W"
        assert OPPOSITE_EDGE["W"] == "E"
