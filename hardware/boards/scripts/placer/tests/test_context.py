"""Tests for PlacementContext."""

import pytest
from placer.dtypes import (
    AffinityRule, Board, Component, Net, Pin, PlacedComponent, Side, SidePadding,
)
from placer.context import PlacementContext


def _make_board(**kwargs):
    """Create a minimal test board."""
    defaults = dict(width=100, height=50)
    defaults.update(kwargs)
    return Board(**defaults)


def _make_comp(id, width=5, height=3, **kwargs):
    return Component(id=id, width=width, height=height, **kwargs)


class TestPlacementContext:
    def test_collides_with_fixed(self):
        fixed = _make_comp("fixed1", width=10, height=10, fixed=True,
                           x=0, y=0, side=Side.FRONT)
        board = _make_board(components=[fixed])
        ctx = PlacementContext(board)
        # Should collide at same position on same side
        free = _make_comp("u1", width=5, height=5)
        assert ctx.collides(free, 2, 2, Side.FRONT)

    def test_no_collision_different_side(self):
        fixed = _make_comp("fixed1", width=10, height=10, fixed=True,
                           x=0, y=0, side=Side.FRONT)
        board = _make_board(components=[fixed])
        ctx = PlacementContext(board)
        free = _make_comp("u1", width=5, height=5)
        assert not ctx.collides(free, 2, 2, Side.BACK)

    def test_in_bounds(self):
        board = _make_board()
        ctx = PlacementContext(board)
        comp = _make_comp("u1", width=5, height=3)
        assert ctx.in_bounds(comp, 10, 10)
        assert not ctx.in_bounds(comp, -1, 10)
        assert not ctx.in_bounds(comp, 98, 10)

    def test_find_free(self):
        board = _make_board()
        ctx = PlacementContext(board)
        comp = _make_comp("u1")
        result = ctx.find_free(comp, 10, 10, Side.FRONT)
        assert result is not None
        assert result == (10, 10)  # No obstacles

    def test_find_free_displaced(self):
        fixed = _make_comp("fixed1", width=10, height=10, fixed=True,
                           x=5, y=5, side=Side.FRONT)
        board = _make_board(components=[fixed])
        ctx = PlacementContext(board)
        comp = _make_comp("u1", width=5, height=5)
        result = ctx.find_free(comp, 7, 7, Side.FRONT)
        assert result is not None
        # Should be displaced from (7, 7)
        x, y = result
        assert (x, y) != (7, 7)

    def test_place_component(self):
        board = _make_board()
        ctx = PlacementContext(board)
        comp = _make_comp("u1")
        placed = ctx.place_component(comp, 10, 10, Side.FRONT)
        assert placed.component_id == "u1"
        assert placed.x == 10
        assert placed.y == 10
        assert placed.side == Side.FRONT

    def test_place_component_avoids_collision(self):
        fixed = _make_comp("fixed1", width=20, height=20, fixed=True,
                           x=10, y=10, side=Side.FRONT)
        board = _make_board(components=[fixed])
        ctx = PlacementContext(board)
        comp = _make_comp("u1", width=5, height=5)
        placed = ctx.place_component(comp, 15, 15, Side.FRONT)
        # Should not overlap with fixed
        assert placed.x != 15 or placed.y != 15

    def test_connectivity_target_center_fallback(self):
        board = _make_board(width=100, height=50)
        ctx = PlacementContext(board)
        # No connections → center of board
        x, y = ctx.connectivity_target("u1", {})
        assert x == pytest.approx(50)
        assert y == pytest.approx(25)

    def test_connectivity_target_with_neighbor(self):
        nets = [Net("sig1", (("u1", "1"), ("u2", "1")))]
        comps = [_make_comp("u1"), _make_comp("u2")]
        board = _make_board(components=comps, nets=nets)
        ctx = PlacementContext(board)
        placed = {"u2": PlacedComponent("u2", 30, 20, 0, Side.FRONT)}
        x, y = ctx.connectivity_target("u1", placed)
        # Returns center of u2 (30+5/2, 20+3/2) = (32.5, 21.5)
        assert x == pytest.approx(32.5)
        assert y == pytest.approx(21.5)

    def test_anti_affinity_cost(self):
        rules = [AffinityRule("dac.", "adc.", 20.0, "separation")]
        comps = [_make_comp("dac.u1"), _make_comp("adc.u1")]
        board = _make_board(components=comps, affinity_rules=rules)
        ctx = PlacementContext(board)
        placed = {"adc.u1": PlacedComponent("adc.u1", 10, 10, 0, Side.FRONT)}
        # Very close — should have high cost
        cost = ctx.anti_affinity_cost("dac.u1", 12, 12, placed)
        assert cost > 0
        # Far away — should have zero cost
        cost_far = ctx.anti_affinity_cost("dac.u1", 50, 40, placed)
        assert cost_far == 0

    def test_net_graph(self):
        nets = [
            Net("sig1", (("u1", "1"), ("r1", "2"))),
            Net("sig2", (("u1", "2"), ("r2", "1"))),
        ]
        board = _make_board(nets=nets)
        ctx = PlacementContext(board)
        graph = ctx.net_graph()
        assert "sig1" in graph
        assert len(graph["sig1"]) == 2

    def test_wave_distances(self):
        fixed = _make_comp("fixed1", fixed=True, x=0, y=0)
        free1 = _make_comp("u1")
        free2 = _make_comp("u2")
        nets = [
            Net("n1", (("fixed1", "1"), ("u1", "1"))),
            Net("n2", (("u1", "2"), ("u2", "1"))),
        ]
        board = _make_board(components=[fixed, free1, free2], nets=nets)
        ctx = PlacementContext(board)
        wave_map, orphans = ctx.wave_distances()
        assert wave_map["u1"] == 0
        assert wave_map["u2"] == 1
        assert len(orphans) == 0

    def test_circuits(self):
        comps = [_make_comp("a"), _make_comp("b"), _make_comp("c")]
        nets = [Net("n1", (("a", "1"), ("b", "1")))]
        board = _make_board(components=comps, nets=nets)
        ctx = PlacementContext(board)
        circuits = ctx.circuits()
        assert len(circuits) == 2  # {a, b} and {c}

    def test_free_and_fixed_components(self):
        fixed = _make_comp("f1", fixed=True, x=0, y=0)
        free = _make_comp("u1")
        board = _make_board(components=[fixed, free])
        ctx = PlacementContext(board)
        assert len(ctx.free_components()) == 1
        assert len(ctx.fixed_components()) == 1
        assert ctx.free_components()[0].id == "u1"

    def test_legalize(self):
        board = _make_board()
        ctx = PlacementContext(board)
        comps = [_make_comp("a"), _make_comp("b")]
        board.components = comps
        ctx = PlacementContext(board)
        positions = {"a": (10.0, 10.0), "b": (20.0, 10.0)}
        result = ctx.legalize(positions)
        assert "a" in result
        assert "b" in result

    def test_copy(self):
        board = _make_board()
        ctx = PlacementContext(board)
        ctx2 = ctx.copy()
        assert ctx2 is not ctx
        assert ctx2.board is board

    def test_reset(self):
        fixed = _make_comp("f1", fixed=True, x=0, y=0, side=Side.FRONT)
        free = _make_comp("u1")
        board = _make_board(components=[fixed, free])
        ctx = PlacementContext(board)
        # Place a free component
        ctx.register(free, 30, 30, Side.FRONT)
        assert ctx.collides(free, 30, 30, Side.FRONT)
        # Reset should clear free but keep fixed
        ctx.reset()
        assert not ctx.collides(free, 30, 30, Side.FRONT)

    def test_register_with_padding(self):
        board = _make_board()
        ctx = PlacementContext(board)
        comp = _make_comp("u1", width=10, height=8)
        pad = SidePadding(top=2, bottom=2, left=2, right=2)
        ctx.register(comp, 20, 20, Side.FRONT, padding=pad)
        # Padded area should be 14x12, check collision near edge
        nearby = _make_comp("probe", width=1, height=1)
        # At edge of padding zone (20-2=18 left edge), should collide
        assert ctx.collides(nearby, 18.5, 24, Side.FRONT)
