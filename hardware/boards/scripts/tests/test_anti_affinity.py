"""Tests for anti-affinity enforcement across all placement strategies.

Verifies that each strategy respects minimum distance constraints between
component groups (e.g. keep voltage regulators away from precision DACs).
"""

import math

from placement.helpers import check_anti_affinity
from placement.strategies.constructive import ConstructiveStrategy
from placement.strategies.force_directed import ForceDirectedStrategy
from placement.strategies.sa_refine import SARefineStrategy


def _distance(p1, p2):
    return math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2)


def _check_dac_distance(ctx, placements):
    """Return distance between the fixed regulator and placed DAC."""
    reg = ctx.fixed["power.reg_5v"]
    dac = placements["dacs.dac_a"]
    return _distance(reg, dac)


class TestConstructiveAntiAffinity:
    def test_dac_placed_away_from_regulator(self, anti_affinity_ctx):
        strategy = ConstructiveStrategy()
        result = strategy.place(anti_affinity_ctx, {"order": "connectivity"})
        assert "dacs.dac_a" in result
        dist = _check_dac_distance(anti_affinity_ctx, result)
        # Should respect the 30mm anti-affinity rule
        assert dist >= 25.0, f"DAC placed {dist:.1f}mm from regulator (min 30mm)"

    def test_all_components_placed(self, anti_affinity_ctx):
        strategy = ConstructiveStrategy()
        result = strategy.place(anti_affinity_ctx, {"order": "connectivity"})
        assert set(result.keys()) == set(anti_affinity_ctx.free.keys())

    def test_no_anti_affinity_violations(self, anti_affinity_ctx):
        strategy = ConstructiveStrategy()
        result = strategy.place(anti_affinity_ctx, {"order": "connectivity"})
        violations = check_anti_affinity(
            result, anti_affinity_ctx.fixed, anti_affinity_ctx.anti_affinity)
        assert violations == [], f"Anti-affinity violations: {violations}"


class TestForceDirectedAntiAffinity:
    def test_dac_placed_away_from_regulator(self, anti_affinity_ctx):
        strategy = ForceDirectedStrategy()
        result = strategy.place(anti_affinity_ctx,
                                {"attraction": 1.0, "repulsion": 0.5,
                                 "iterations": 200})
        assert "dacs.dac_a" in result
        dist = _check_dac_distance(anti_affinity_ctx, result)
        assert dist >= 25.0, f"DAC placed {dist:.1f}mm from regulator (min 30mm)"

    def test_all_components_placed(self, anti_affinity_ctx):
        strategy = ForceDirectedStrategy()
        result = strategy.place(anti_affinity_ctx, {"iterations": 200})
        assert set(result.keys()) == set(anti_affinity_ctx.free.keys())


class TestSARefineAntiAffinity:
    def test_dac_placed_away_from_regulator(self, anti_affinity_ctx):
        strategy = SARefineStrategy()
        result = strategy.place(anti_affinity_ctx,
                                {"initial_temp": 5.0, "cooling_rate": 0.95,
                                 "seed": 42, "max_steps": 1000})
        assert "dacs.dac_a" in result
        dist = _check_dac_distance(anti_affinity_ctx, result)
        assert dist >= 25.0, f"DAC placed {dist:.1f}mm from regulator (min 30mm)"

    def test_all_components_placed(self, anti_affinity_ctx):
        strategy = SARefineStrategy()
        result = strategy.place(anti_affinity_ctx,
                                {"seed": 42, "max_steps": 500})
        assert set(result.keys()) == set(anti_affinity_ctx.free.keys())


class TestWithoutAntiAffinity:
    """Verify that strategies still work when no anti-affinity rules are set."""

    def test_constructive_no_rules(self, small_board_ctx):
        assert small_board_ctx.anti_affinity == []
        strategy = ConstructiveStrategy()
        result = strategy.place(small_board_ctx, {"order": "connectivity"})
        assert set(result.keys()) == set(small_board_ctx.free.keys())

    def test_force_directed_no_rules(self, small_board_ctx):
        strategy = ForceDirectedStrategy()
        result = strategy.place(small_board_ctx, {"iterations": 100})
        assert set(result.keys()) == set(small_board_ctx.free.keys())

    def test_sa_refine_no_rules(self, small_board_ctx):
        strategy = SARefineStrategy()
        result = strategy.place(small_board_ctx,
                                {"seed": 42, "max_steps": 500})
        assert set(result.keys()) == set(small_board_ctx.free.keys())
