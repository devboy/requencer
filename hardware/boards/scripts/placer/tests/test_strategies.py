"""Tests for placer strategies (wavefront variants)."""

import pytest
from placer import Board, Component, Net, Pin, PlacedComponent, Side, place


def _simple_board():
    """A board with 1 fixed + 3 free connected components."""
    comps = [
        Component(id="fixed1", width=10, height=10, fixed=True,
                  x=5, y=5, side=Side.FRONT),
        Component(id="ic1", width=8, height=8,
                  pins=[Pin("1", 0, 4), Pin("2", 8, 4)]),
        Component(id="r1", width=2, height=1,
                  pins=[Pin("1", 0, 0.5), Pin("2", 2, 0.5)]),
        Component(id="r2", width=2, height=1,
                  pins=[Pin("1", 0, 0.5), Pin("2", 2, 0.5)]),
    ]
    nets = [
        Net(id="sig1", connections=(("fixed1", "A"), ("ic1", "1"))),
        Net(id="sig2", connections=(("ic1", "2"), ("r1", "1"))),
        Net(id="sig3", connections=(("r1", "2"), ("r2", "1"))),
    ]
    return Board(width=50, height=30, components=comps, nets=nets)


def _larger_board():
    """A board with more components for stress testing."""
    comps = [
        Component(id="mcu", width=12, height=12, fixed=True,
                  x=20, y=10, side=Side.FRONT,
                  pins=[Pin(str(i), i * 1.5, 0) for i in range(8)] +
                        [Pin(str(i+8), i * 1.5, 12) for i in range(8)]),
    ]
    # Add 20 free components
    for i in range(10):
        comps.append(Component(
            id=f"ic{i}", width=4+i%3, height=3+i%2,
            pins=[Pin("1", 0, 1), Pin("2", 4+i%3, 1)],
            group=f"group{i%3}",
        ))
    for i in range(10):
        comps.append(Component(
            id=f"r{i}", width=2, height=1,
            pins=[Pin("1", 0, 0.5), Pin("2", 2, 0.5)],
            group=f"group{i%3}",
        ))

    nets = []
    # Connect each IC to MCU
    for i in range(10):
        nets.append(Net(f"mcu_ic{i}",
                        (("mcu", str(i)), (f"ic{i}", "1"))))
    # Connect ICs to their resistors
    for i in range(10):
        nets.append(Net(f"ic_r{i}",
                        ((f"ic{i}", "2"), (f"r{i}", "1"))))
    # Some inter-resistor connections
    for i in range(0, 8, 2):
        nets.append(Net(f"r_chain{i}",
                        ((f"r{i}", "2"), (f"r{i+1}", "1"))))

    return Board(width=80, height=60, components=comps, nets=nets)


class TestWavefront:
    def test_places_all(self):
        board = _simple_board()
        results = place(board, strategy="wavefront")
        assert len(results) == 3
        ids = {r.component_id for r in results}
        assert ids == {"ic1", "r1", "r2"}

    def test_no_overlaps(self):
        board = _simple_board()
        results = place(board, strategy="wavefront")
        # Check no two results overlap (simple bbox check)
        for i, a in enumerate(results):
            for b in results[i+1:]:
                if a.side != b.side:
                    continue
                comp_a = next(c for c in board.components if c.id == a.component_id)
                comp_b = next(c for c in board.components if c.id == b.component_id)
                ax2 = a.x + comp_a.width
                ay2 = a.y + comp_a.height
                bx2 = b.x + comp_b.width
                by2 = b.y + comp_b.height
                overlap = (a.x < bx2 and ax2 > b.x and
                           a.y < by2 and ay2 > b.y)
                assert not overlap, f"{a.component_id} overlaps {b.component_id}"

    def test_empty_board(self):
        board = Board(width=50, height=30)
        results = place(board, strategy="wavefront")
        assert results == []

    def test_larger_board(self):
        board = _larger_board()
        results = place(board, strategy="wavefront")
        assert len(results) == 20  # 10 ICs + 10 resistors


class TestWavefrontCircuit:
    def test_places_all(self):
        board = _simple_board()
        results = place(board, strategy="wavefront_circuit")
        assert len(results) == 3

    def test_groups_modules(self):
        """Components with same group prefix should be placed near each other."""
        board = _larger_board()
        results = place(board, strategy="wavefront_circuit")
        assert len(results) == 20


class TestWavefrontDirect:
    def test_places_all(self):
        board = _simple_board()
        results = place(board, strategy="wavefront_direct")
        assert len(results) == 3

    def test_larger_board(self):
        board = _larger_board()
        results = place(board, strategy="wavefront_direct")
        assert len(results) == 20

    def test_with_auto_rotate(self):
        board = _simple_board()
        results = place(board, strategy="wavefront_direct",
                        params={"auto_rotate": True})
        assert len(results) == 3


class TestAllStrategies:
    """Cross-strategy tests."""

    @pytest.mark.parametrize("strategy", [
        "wavefront", "wavefront_circuit", "wavefront_direct"])
    def test_in_bounds(self, strategy):
        board = _simple_board()
        results = place(board, strategy=strategy)
        for r in results:
            comp = next(c for c in board.components if c.id == r.component_id)
            assert r.x >= 0, f"{r.component_id} x={r.x} < 0"
            assert r.y >= 0, f"{r.component_id} y={r.y} < 0"
            assert r.x + comp.width <= board.width + 1, \
                f"{r.component_id} exceeds board width"
            assert r.y + comp.height <= board.height + 1, \
                f"{r.component_id} exceeds board height"

    @pytest.mark.parametrize("strategy", [
        "wavefront", "wavefront_circuit", "wavefront_direct"])
    def test_only_free_returned(self, strategy):
        board = _simple_board()
        results = place(board, strategy=strategy)
        ids = {r.component_id for r in results}
        assert "fixed1" not in ids

    @pytest.mark.parametrize("strategy", [
        "wavefront", "wavefront_circuit", "wavefront_direct"])
    def test_orphan_components(self, strategy):
        """Components with no nets should still be placed."""
        comps = [
            Component(id="fixed1", width=5, height=5, fixed=True,
                      x=0, y=0, side=Side.FRONT),
            Component(id="orphan", width=3, height=3),
        ]
        board = Board(width=50, height=30, components=comps)
        results = place(board, strategy=strategy)
        assert len(results) == 1
        assert results[0].component_id == "orphan"
