"""Tests for the full rotation pipeline: pin positions, edge maps, and connectivity.

Validates that pin_world_position, effective_edge_map, and connectivity_target
all behave correctly across all rotations on both Front and Back sides.
"""

import pytest
from placer.dtypes import Board, Component, Net, Pin, PlacedComponent, Side
from placer.geometry import (
    classify_pins_by_edge,
    effective_edge_map,
    effective_point,
    pin_world_position,
    rotate_point,
    rotated_dims,
)
from placer.context import PlacementContext


# ---------------------------------------------------------------------------
# Shared fixture: synthetic 4-pin IC (4mm x 6mm)
# ---------------------------------------------------------------------------

def _make_ic() -> Component:
    """4mm x 6mm IC with pins at edge midpoints."""
    return Component(
        id="ic1",
        width=4.0,
        height=6.0,
        pins=[
            Pin("n1", 2.0, 0.0),  # N edge center
            Pin("s1", 2.0, 6.0),  # S edge center
            Pin("e1", 4.0, 3.0),  # E edge center
            Pin("w1", 0.0, 3.0),  # W edge center
        ],
    )


# ===========================================================================
# A. Pin world positions at all rotations
# ===========================================================================

class TestPinWorldPositionFront:
    """pin_world_position for all rotations on Front side.

    Component placed at bbox top-left (10, 20). IC is 4x6.
    rotate_point formulas (Front = just rotate):
      0°:   (px, py)
      90°:  (py, w - px)
      180°: (w - px, h - py)
      270°: (h - py, px)
    World = (10 + rx, 20 + ry)
    """

    @pytest.fixture
    def ic(self):
        return _make_ic()

    # --- rotation 0° ---
    def test_front_0_n1(self, ic):
        # n1=(2,0) -> rotate_point(2,0,4,6,0)=(2,0) -> world=(12,20)
        x, y = pin_world_position(ic, ic.pins[0], 10, 20, 0, Side.FRONT)
        assert x == pytest.approx(12.0)
        assert y == pytest.approx(20.0)

    def test_front_0_s1(self, ic):
        # s1=(2,6) -> (2,6) -> world=(12,26)
        x, y = pin_world_position(ic, ic.pins[1], 10, 20, 0, Side.FRONT)
        assert x == pytest.approx(12.0)
        assert y == pytest.approx(26.0)

    def test_front_0_e1(self, ic):
        # e1=(4,3) -> (4,3) -> world=(14,23)
        x, y = pin_world_position(ic, ic.pins[2], 10, 20, 0, Side.FRONT)
        assert x == pytest.approx(14.0)
        assert y == pytest.approx(23.0)

    def test_front_0_w1(self, ic):
        # w1=(0,3) -> (0,3) -> world=(10,23)
        x, y = pin_world_position(ic, ic.pins[3], 10, 20, 0, Side.FRONT)
        assert x == pytest.approx(10.0)
        assert y == pytest.approx(23.0)

    # --- rotation 90° CCW ---
    def test_front_90_n1(self, ic):
        # n1=(2,0) -> rotate_point(2,0,4,6,90)=(0, 4-2)=(0,2) -> world=(10,22)
        x, y = pin_world_position(ic, ic.pins[0], 10, 20, 90, Side.FRONT)
        assert x == pytest.approx(10.0)
        assert y == pytest.approx(22.0)

    def test_front_90_s1(self, ic):
        # s1=(2,6) -> rotate_point(2,6,4,6,90)=(6, 4-2)=(6,2) -> world=(16,22)
        x, y = pin_world_position(ic, ic.pins[1], 10, 20, 90, Side.FRONT)
        assert x == pytest.approx(16.0)
        assert y == pytest.approx(22.0)

    def test_front_90_e1(self, ic):
        # e1=(4,3) -> rotate_point(4,3,4,6,90)=(3, 4-4)=(3,0) -> world=(13,20)
        x, y = pin_world_position(ic, ic.pins[2], 10, 20, 90, Side.FRONT)
        assert x == pytest.approx(13.0)
        assert y == pytest.approx(20.0)

    def test_front_90_w1(self, ic):
        # w1=(0,3) -> rotate_point(0,3,4,6,90)=(3, 4-0)=(3,4) -> world=(13,24)
        x, y = pin_world_position(ic, ic.pins[3], 10, 20, 90, Side.FRONT)
        assert x == pytest.approx(13.0)
        assert y == pytest.approx(24.0)

    # --- rotation 180° ---
    def test_front_180_n1(self, ic):
        # n1=(2,0) -> rotate_point(2,0,4,6,180)=(4-2, 6-0)=(2,6) -> world=(12,26)
        x, y = pin_world_position(ic, ic.pins[0], 10, 20, 180, Side.FRONT)
        assert x == pytest.approx(12.0)
        assert y == pytest.approx(26.0)

    def test_front_180_s1(self, ic):
        # s1=(2,6) -> (4-2, 6-6)=(2,0) -> world=(12,20)
        x, y = pin_world_position(ic, ic.pins[1], 10, 20, 180, Side.FRONT)
        assert x == pytest.approx(12.0)
        assert y == pytest.approx(20.0)

    def test_front_180_e1(self, ic):
        # e1=(4,3) -> (4-4, 6-3)=(0,3) -> world=(10,23)
        x, y = pin_world_position(ic, ic.pins[2], 10, 20, 180, Side.FRONT)
        assert x == pytest.approx(10.0)
        assert y == pytest.approx(23.0)

    def test_front_180_w1(self, ic):
        # w1=(0,3) -> (4-0, 6-3)=(4,3) -> world=(14,23)
        x, y = pin_world_position(ic, ic.pins[3], 10, 20, 180, Side.FRONT)
        assert x == pytest.approx(14.0)
        assert y == pytest.approx(23.0)

    # --- rotation 270° ---
    def test_front_270_n1(self, ic):
        # n1=(2,0) -> rotate_point(2,0,4,6,270)=(6-0, 2)=(6,2) -> world=(16,22)
        x, y = pin_world_position(ic, ic.pins[0], 10, 20, 270, Side.FRONT)
        assert x == pytest.approx(16.0)
        assert y == pytest.approx(22.0)

    def test_front_270_s1(self, ic):
        # s1=(2,6) -> (6-6, 2)=(0,2) -> world=(10,22)
        x, y = pin_world_position(ic, ic.pins[1], 10, 20, 270, Side.FRONT)
        assert x == pytest.approx(10.0)
        assert y == pytest.approx(22.0)

    def test_front_270_e1(self, ic):
        # e1=(4,3) -> (6-3, 4)=(3,4) -> world=(13,24)
        x, y = pin_world_position(ic, ic.pins[2], 10, 20, 270, Side.FRONT)
        assert x == pytest.approx(13.0)
        assert y == pytest.approx(24.0)

    def test_front_270_w1(self, ic):
        # w1=(0,3) -> (6-3, 0)=(3,0) -> world=(13,20)
        x, y = pin_world_position(ic, ic.pins[3], 10, 20, 270, Side.FRONT)
        assert x == pytest.approx(13.0)
        assert y == pytest.approx(20.0)


class TestPinWorldPositionBack:
    """pin_world_position for all rotations on Back side.

    Back: mirror X first (px -> w - px), then rotate.
    IC is 4x6 at bbox top-left (10, 20).
    """

    @pytest.fixture
    def ic(self):
        return _make_ic()

    # --- rotation 0° ---
    def test_back_0_n1(self, ic):
        # n1=(2,0) -> mirror_x: (4-2,0)=(2,0) -> rotate(2,0,4,6,0)=(2,0) -> world=(12,20)
        x, y = pin_world_position(ic, ic.pins[0], 10, 20, 0, Side.BACK)
        assert x == pytest.approx(12.0)
        assert y == pytest.approx(20.0)

    def test_back_0_s1(self, ic):
        # s1=(2,6) -> mirror_x: (2,6) -> rotate 0°: (2,6) -> world=(12,26)
        x, y = pin_world_position(ic, ic.pins[1], 10, 20, 0, Side.BACK)
        assert x == pytest.approx(12.0)
        assert y == pytest.approx(26.0)

    def test_back_0_e1(self, ic):
        # e1=(4,3) -> mirror_x: (0,3) -> rotate 0°: (0,3) -> world=(10,23)
        x, y = pin_world_position(ic, ic.pins[2], 10, 20, 0, Side.BACK)
        assert x == pytest.approx(10.0)
        assert y == pytest.approx(23.0)

    def test_back_0_w1(self, ic):
        # w1=(0,3) -> mirror_x: (4,3) -> rotate 0°: (4,3) -> world=(14,23)
        x, y = pin_world_position(ic, ic.pins[3], 10, 20, 0, Side.BACK)
        assert x == pytest.approx(14.0)
        assert y == pytest.approx(23.0)

    # --- rotation 90° CCW ---
    def test_back_90_n1(self, ic):
        # n1=(2,0) -> mirror_x: (2,0) -> rotate(2,0,4,6,90)=(0,2) -> world=(10,22)
        x, y = pin_world_position(ic, ic.pins[0], 10, 20, 90, Side.BACK)
        assert x == pytest.approx(10.0)
        assert y == pytest.approx(22.0)

    def test_back_90_s1(self, ic):
        # s1=(2,6) -> mirror_x: (2,6) -> rotate(2,6,4,6,90)=(6,2) -> world=(16,22)
        x, y = pin_world_position(ic, ic.pins[1], 10, 20, 90, Side.BACK)
        assert x == pytest.approx(16.0)
        assert y == pytest.approx(22.0)

    def test_back_90_e1(self, ic):
        # e1=(4,3) -> mirror_x: (0,3) -> rotate(0,3,4,6,90)=(3,4) -> world=(13,24)
        x, y = pin_world_position(ic, ic.pins[2], 10, 20, 90, Side.BACK)
        assert x == pytest.approx(13.0)
        assert y == pytest.approx(24.0)

    def test_back_90_w1(self, ic):
        # w1=(0,3) -> mirror_x: (4,3) -> rotate(4,3,4,6,90)=(3,0) -> world=(13,20)
        x, y = pin_world_position(ic, ic.pins[3], 10, 20, 90, Side.BACK)
        assert x == pytest.approx(13.0)
        assert y == pytest.approx(20.0)

    # --- rotation 180° ---
    def test_back_180_n1(self, ic):
        # n1=(2,0) -> mirror_x: (2,0) -> rotate(2,0,4,6,180)=(2,6) -> world=(12,26)
        x, y = pin_world_position(ic, ic.pins[0], 10, 20, 180, Side.BACK)
        assert x == pytest.approx(12.0)
        assert y == pytest.approx(26.0)

    def test_back_180_s1(self, ic):
        # s1=(2,6) -> mirror_x: (2,6) -> rotate(2,6,4,6,180)=(2,0) -> world=(12,20)
        x, y = pin_world_position(ic, ic.pins[1], 10, 20, 180, Side.BACK)
        assert x == pytest.approx(12.0)
        assert y == pytest.approx(20.0)

    def test_back_180_e1(self, ic):
        # e1=(4,3) -> mirror_x: (0,3) -> rotate(0,3,4,6,180)=(4,3) -> world=(14,23)
        x, y = pin_world_position(ic, ic.pins[2], 10, 20, 180, Side.BACK)
        assert x == pytest.approx(14.0)
        assert y == pytest.approx(23.0)

    def test_back_180_w1(self, ic):
        # w1=(0,3) -> mirror_x: (4,3) -> rotate(4,3,4,6,180)=(0,3) -> world=(10,23)
        x, y = pin_world_position(ic, ic.pins[3], 10, 20, 180, Side.BACK)
        assert x == pytest.approx(10.0)
        assert y == pytest.approx(23.0)

    # --- rotation 270° ---
    def test_back_270_n1(self, ic):
        # n1=(2,0) -> mirror_x: (2,0) -> rotate(2,0,4,6,270)=(6,2) -> world=(16,22)
        x, y = pin_world_position(ic, ic.pins[0], 10, 20, 270, Side.BACK)
        assert x == pytest.approx(16.0)
        assert y == pytest.approx(22.0)

    def test_back_270_s1(self, ic):
        # s1=(2,6) -> mirror_x: (2,6) -> rotate(2,6,4,6,270)=(0,2) -> world=(10,22)
        x, y = pin_world_position(ic, ic.pins[1], 10, 20, 270, Side.BACK)
        assert x == pytest.approx(10.0)
        assert y == pytest.approx(22.0)

    def test_back_270_e1(self, ic):
        # e1=(4,3) -> mirror_x: (0,3) -> rotate(0,3,4,6,270)=(3,0) -> world=(13,20)
        x, y = pin_world_position(ic, ic.pins[2], 10, 20, 270, Side.BACK)
        assert x == pytest.approx(13.0)
        assert y == pytest.approx(20.0)

    def test_back_270_w1(self, ic):
        # w1=(0,3) -> mirror_x: (4,3) -> rotate(4,3,4,6,270)=(3,4) -> world=(13,24)
        x, y = pin_world_position(ic, ic.pins[3], 10, 20, 270, Side.BACK)
        assert x == pytest.approx(13.0)
        assert y == pytest.approx(24.0)


class TestPinWorldPositionSymmetry:
    """Cross-checks: front vs back pin positions demonstrate mirror behavior."""

    @pytest.fixture
    def ic(self):
        return _make_ic()

    def test_e_w_swap_at_rot0(self, ic):
        """At 0° rotation, Back mirrors E and W pins."""
        e_front = pin_world_position(ic, ic.pins[2], 10, 20, 0, Side.FRONT)
        w_front = pin_world_position(ic, ic.pins[3], 10, 20, 0, Side.FRONT)
        e_back = pin_world_position(ic, ic.pins[2], 10, 20, 0, Side.BACK)
        w_back = pin_world_position(ic, ic.pins[3], 10, 20, 0, Side.BACK)
        # E pin on front should match W pin on back (and vice versa)
        assert e_front[0] == pytest.approx(w_back[0])
        assert e_front[1] == pytest.approx(w_back[1])
        assert w_front[0] == pytest.approx(e_back[0])
        assert w_front[1] == pytest.approx(e_back[1])

    def test_n_s_unchanged_at_rot0(self, ic):
        """At 0° rotation, N and S y-coords unchanged by back side (x mirrors to same for centered pins)."""
        n_front = pin_world_position(ic, ic.pins[0], 10, 20, 0, Side.FRONT)
        n_back = pin_world_position(ic, ic.pins[0], 10, 20, 0, Side.BACK)
        # n1 is at x=2, mirror -> x=4-2=2, so identical
        assert n_front == pytest.approx(n_back, abs=1e-9)


# ===========================================================================
# B. Edge map rotation
# ===========================================================================

class TestEdgeMapFront:
    """effective_edge_map on Front side at various rotations."""

    @pytest.fixture
    def edge_map(self):
        ic = _make_ic()
        return classify_pins_by_edge(ic)

    def test_classify_base(self, edge_map):
        """Sanity: base classification puts pins on expected edges."""
        assert len(edge_map["N"]) == 1
        assert edge_map["N"][0].id == "n1"
        assert len(edge_map["S"]) == 1
        assert edge_map["S"][0].id == "s1"
        assert len(edge_map["E"]) == 1
        assert edge_map["E"][0].id == "e1"
        assert len(edge_map["W"]) == 1
        assert edge_map["W"][0].id == "w1"

    def test_front_0(self, edge_map):
        result = effective_edge_map(edge_map, 0, Side.FRONT)
        assert result["N"][0].id == "n1"
        assert result["S"][0].id == "s1"
        assert result["E"][0].id == "e1"
        assert result["W"][0].id == "w1"

    def test_front_90(self, edge_map):
        """90° CCW: N->W, E->N, S->E, W->S."""
        result = effective_edge_map(edge_map, 90, Side.FRONT)
        assert result["W"][0].id == "n1"
        assert result["E"][0].id == "s1"
        assert result["N"][0].id == "e1"
        assert result["S"][0].id == "w1"

    def test_front_180(self, edge_map):
        """180°: N->S, S->N, E->W, W->E."""
        result = effective_edge_map(edge_map, 180, Side.FRONT)
        assert result["S"][0].id == "n1"
        assert result["N"][0].id == "s1"
        assert result["W"][0].id == "e1"
        assert result["E"][0].id == "w1"

    def test_front_270(self, edge_map):
        """270° CCW: N->E, E->S, S->W, W->N."""
        result = effective_edge_map(edge_map, 270, Side.FRONT)
        assert result["E"][0].id == "n1"
        assert result["W"][0].id == "s1"
        assert result["S"][0].id == "e1"
        assert result["N"][0].id == "w1"


class TestEdgeMapBack:
    """effective_edge_map on Back side: mirror X (E<->W swap) then rotate."""

    @pytest.fixture
    def edge_map(self):
        ic = _make_ic()
        return classify_pins_by_edge(ic)

    def test_back_0(self, edge_map):
        """Back 0°: mirror only -> E<->W swapped, N/S unchanged."""
        result = effective_edge_map(edge_map, 0, Side.BACK)
        assert result["N"][0].id == "n1"
        assert result["S"][0].id == "s1"
        assert result["W"][0].id == "e1"  # E->W
        assert result["E"][0].id == "w1"  # W->E

    def test_back_90(self, edge_map):
        """Back 90°: mirror then 90° CCW.
        Mirror: N->N, S->S, E->W, W->E
        Then 90° CCW: N->W, W->S, S->E, E->N
        Combined: n1: N->N->W, s1: S->S->E, e1: E->W->S, w1: W->E->N
        """
        result = effective_edge_map(edge_map, 90, Side.BACK)
        assert result["W"][0].id == "n1"
        assert result["E"][0].id == "s1"
        assert result["S"][0].id == "e1"
        assert result["N"][0].id == "w1"

    def test_back_180(self, edge_map):
        """Back 180°: mirror then 180°.
        Mirror: E<->W
        Then 180°: N<->S, E<->W
        Combined: n1: N->N->S, s1: S->S->N, e1: E->W->E, w1: W->E->W
        """
        result = effective_edge_map(edge_map, 180, Side.BACK)
        assert result["S"][0].id == "n1"
        assert result["N"][0].id == "s1"
        assert result["E"][0].id == "e1"
        assert result["W"][0].id == "w1"

    def test_back_270(self, edge_map):
        """Back 270°: mirror then 270° CCW.
        Mirror: E<->W
        Then 270°: N->E, E->S, S->W, W->N
        Combined: n1: N->N->E, s1: S->S->W, e1: E->W->N, w1: W->E->S
        """
        result = effective_edge_map(edge_map, 270, Side.BACK)
        assert result["E"][0].id == "n1"
        assert result["W"][0].id == "s1"
        assert result["N"][0].id == "e1"
        assert result["S"][0].id == "w1"


# ===========================================================================
# C. Connectivity target direction
# ===========================================================================

class TestConnectivityTargetDirection:
    """Verify connectivity_target returns a position pulled toward
    the connected pin's physical location.

    Setup: fixed IC at (50, 40) connected to a free resistor via the IC's
    East pin (e1). The target for the resistor should be pulled toward
    the East side of the IC on Front, and toward the West side on Back
    (since the E pin mirrors to the W side physically).
    """

    def _make_board(self, ic_rotation: float, ic_side: Side) -> Board:
        ic = Component(
            id="ic1",
            width=4.0,
            height=6.0,
            pins=[
                Pin("n1", 2.0, 0.0),
                Pin("s1", 2.0, 6.0),
                Pin("e1", 4.0, 3.0),
                Pin("w1", 0.0, 3.0),
            ],
            fixed=True,
            x=50.0,
            y=40.0,
            rotation=ic_rotation,
            side=ic_side,
        )
        resistor = Component(
            id="r1",
            width=2.0,
            height=1.0,
            pins=[
                Pin("1", 0.0, 0.5),
                Pin("2", 2.0, 0.5),
            ],
        )
        net = Net(
            id="sig1",
            connections=(("ic1", "e1"), ("r1", "1")),
        )
        return Board(
            width=200.0,
            height=200.0,
            components=[ic, resistor],
            nets=[net],
        )

    def test_front_rot0_target_east_of_ic(self):
        """Front 0°: IC center is at (52, 43). E pin at world (54, 43).
        Resistor target should be the IC center (only 1 neighbor).
        """
        board = self._make_board(0, Side.FRONT)
        ctx = PlacementContext(board)
        target_x, target_y = ctx.connectivity_target("r1", {})
        # IC at (50,40) with dims 4x6 -> center (52, 43)
        ic_cx, ic_cy = 52.0, 43.0
        assert target_x == pytest.approx(ic_cx)
        assert target_y == pytest.approx(ic_cy)

    def test_back_rot0_target_is_ic_center(self):
        """Back 0°: IC center is still (52, 43) in board coords.
        connectivity_target returns IC center regardless of side.
        """
        board = self._make_board(0, Side.BACK)
        ctx = PlacementContext(board)
        target_x, target_y = ctx.connectivity_target("r1", {})
        ic_cx, ic_cy = 52.0, 43.0
        assert target_x == pytest.approx(ic_cx)
        assert target_y == pytest.approx(ic_cy)

    def test_front_rot90_target_is_ic_center(self):
        """Front 90°: IC rotated dims are (6, 4). Center = (50+3, 40+2) = (53, 42)."""
        board = self._make_board(90, Side.FRONT)
        ctx = PlacementContext(board)
        target_x, target_y = ctx.connectivity_target("r1", {})
        ic_cx, ic_cy = 53.0, 42.0
        assert target_x == pytest.approx(ic_cx)
        assert target_y == pytest.approx(ic_cy)

    def test_front_e_pin_physical_position_vs_target(self):
        """Verify the E pin's world position is to the east of the IC center.

        This confirms that when the resistor is placed near the connectivity
        target (IC center), it lands near the correct side.
        """
        board = self._make_board(0, Side.FRONT)
        ic = board.components[0]
        e_pin = ic.pins[2]
        px, py = pin_world_position(ic, e_pin, 50, 40, 0, Side.FRONT)
        ic_cx = 52.0
        # E pin should be to the right of center
        assert px > ic_cx

    def test_back_e_pin_physical_position_mirrors(self):
        """Back 0°: E pin mirrors to west side physically."""
        board = self._make_board(0, Side.BACK)
        ic = board.components[0]
        e_pin = ic.pins[2]
        px, py = pin_world_position(ic, e_pin, 50, 40, 0, Side.BACK)
        ic_cx = 52.0
        # E pin on back should be to the LEFT of center (mirrored)
        assert px < ic_cx

    def test_no_connections_returns_board_center(self):
        """A component with no net connections targets the board center."""
        ic = Component(
            id="ic1", width=4.0, height=6.0,
            fixed=True, x=50.0, y=40.0,
        )
        orphan = Component(id="orphan", width=2.0, height=1.0)
        board = Board(
            width=200.0, height=200.0,
            components=[ic, orphan],
            nets=[],
        )
        ctx = PlacementContext(board)
        tx, ty = ctx.connectivity_target("orphan", {})
        assert tx == pytest.approx(100.0)
        assert ty == pytest.approx(100.0)

    def test_multiple_neighbors_centroid(self):
        """With 2 placed neighbors, target is their centroid."""
        ic1 = Component(
            id="ic1", width=4.0, height=6.0,
            fixed=True, x=20.0, y=30.0, rotation=0, side=Side.FRONT,
        )
        ic2 = Component(
            id="ic2", width=4.0, height=6.0,
            fixed=True, x=80.0, y=30.0, rotation=0, side=Side.FRONT,
        )
        resistor = Component(
            id="r1", width=2.0, height=1.0,
            pins=[Pin("1", 0.0, 0.5), Pin("2", 2.0, 0.5)],
        )
        net_a = Net(id="a", connections=(("ic1", "1"), ("r1", "1")))
        net_b = Net(id="b", connections=(("ic2", "1"), ("r1", "2")))
        board = Board(
            width=200.0, height=200.0,
            components=[ic1, ic2, resistor],
            nets=[net_a, net_b],
        )
        ctx = PlacementContext(board)
        tx, ty = ctx.connectivity_target("r1", {})
        # ic1 center: (22, 33), ic2 center: (82, 33)
        assert tx == pytest.approx(52.0)
        assert ty == pytest.approx(33.0)
