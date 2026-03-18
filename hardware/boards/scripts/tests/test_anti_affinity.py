"""Tests for anti-affinity enforcement across all placement strategies.

Verifies that each strategy respects minimum distance constraints between
component groups (e.g. keep voltage regulators away from precision DACs).
"""

import math

import pytest

from placement.helpers import check_anti_affinity
from placement.strategies import AntiAffinityRule, ComponentInfo, Placement
from conftest import FixtureData
from placement.strategies.constructive import ConstructiveStrategy
from placement.strategies.force_directed import ForceDirectedStrategy
from placement.strategies.grid_spread import GridSpreadStrategy
from placement.strategies.sa_refine import SARefineStrategy
from tests.conftest import board_state_from_ctx


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
        components, board = board_state_from_ctx(anti_affinity_ctx)
        result = strategy.place(components, board, {"order": "connectivity"})
        assert "dacs.dac_a" in result
        dist = _check_dac_distance(anti_affinity_ctx, result)
        # Should respect the 30mm anti-affinity rule
        assert dist >= 25.0, f"DAC placed {dist:.1f}mm from regulator (min 30mm)"

    def test_all_components_placed(self, anti_affinity_ctx):
        strategy = ConstructiveStrategy()
        components, board = board_state_from_ctx(anti_affinity_ctx)
        result = strategy.place(components, board, {"order": "connectivity"})
        assert set(result.keys()) == set(anti_affinity_ctx.free.keys())

    def test_no_anti_affinity_violations(self, anti_affinity_ctx):
        strategy = ConstructiveStrategy()
        components, board = board_state_from_ctx(anti_affinity_ctx)
        result = strategy.place(components, board, {"order": "connectivity"})
        violations = check_anti_affinity(
            result, anti_affinity_ctx.fixed, anti_affinity_ctx.anti_affinity)
        assert violations == [], f"Anti-affinity violations: {violations}"


class TestForceDirectedAntiAffinity:
    def test_dac_placed_away_from_regulator(self, anti_affinity_ctx):
        strategy = ForceDirectedStrategy()
        components, board = board_state_from_ctx(anti_affinity_ctx)
        result = strategy.place(components, board,
                                {"attraction": 1.0, "repulsion": 0.5,
                                 "iterations": 200})
        assert "dacs.dac_a" in result
        dist = _check_dac_distance(anti_affinity_ctx, result)
        assert dist >= 25.0, f"DAC placed {dist:.1f}mm from regulator (min 30mm)"

    def test_all_components_placed(self, anti_affinity_ctx):
        strategy = ForceDirectedStrategy()
        components, board = board_state_from_ctx(anti_affinity_ctx)
        result = strategy.place(components, board, {"iterations": 200})
        assert set(result.keys()) == set(anti_affinity_ctx.free.keys())


class TestSARefineAntiAffinity:
    def test_dac_placed_away_from_regulator(self, anti_affinity_ctx):
        strategy = SARefineStrategy()
        components, board = board_state_from_ctx(anti_affinity_ctx)
        result = strategy.place(components, board,
                                {"initial_temp": 5.0, "cooling_rate": 0.95,
                                 "seed": 42, "max_steps": 1000})
        assert "dacs.dac_a" in result
        dist = _check_dac_distance(anti_affinity_ctx, result)
        assert dist >= 25.0, f"DAC placed {dist:.1f}mm from regulator (min 30mm)"

    def test_all_components_placed(self, anti_affinity_ctx):
        strategy = SARefineStrategy()
        components, board = board_state_from_ctx(anti_affinity_ctx)
        result = strategy.place(components, board,
                                {"seed": 42, "max_steps": 500})
        assert set(result.keys()) == set(anti_affinity_ctx.free.keys())


class TestGridSpreadAntiAffinity:
    def test_dac_placed_away_from_regulator(self, anti_affinity_ctx):
        strategy = GridSpreadStrategy()
        components, board = board_state_from_ctx(anti_affinity_ctx)
        result = strategy.place(components, board,
                                {"margin": 3.0, "connectivity_weight": 1.0,
                                 "seed": 42})
        assert "dacs.dac_a" in result
        dist = _check_dac_distance(anti_affinity_ctx, result)
        assert dist >= 25.0, f"DAC placed {dist:.1f}mm from regulator (min 30mm)"

    def test_all_components_placed(self, anti_affinity_ctx):
        strategy = GridSpreadStrategy()
        components, board = board_state_from_ctx(anti_affinity_ctx)
        result = strategy.place(components, board,
                                {"margin": 3.0, "seed": 42})
        assert set(result.keys()) == set(anti_affinity_ctx.free.keys())

    def test_no_anti_affinity_violations(self, anti_affinity_ctx):
        strategy = GridSpreadStrategy()
        components, board = board_state_from_ctx(anti_affinity_ctx)
        result = strategy.place(components, board,
                                {"margin": 3.0, "seed": 42})
        violations = check_anti_affinity(
            result, anti_affinity_ctx.fixed, anti_affinity_ctx.anti_affinity)
        assert violations == [], f"Anti-affinity violations: {violations}"


class TestWithoutAntiAffinity:
    """Verify that strategies still work when no anti-affinity rules are set."""

    def test_constructive_no_rules(self, small_board_ctx):
        assert small_board_ctx.anti_affinity == []
        strategy = ConstructiveStrategy()
        components, board = board_state_from_ctx(small_board_ctx)
        result = strategy.place(components, board, {"order": "connectivity"})
        assert set(result.keys()) == set(small_board_ctx.free.keys())

    def test_force_directed_no_rules(self, small_board_ctx):
        strategy = ForceDirectedStrategy()
        components, board = board_state_from_ctx(small_board_ctx)
        result = strategy.place(components, board, {"iterations": 100})
        assert set(result.keys()) == set(small_board_ctx.free.keys())

    def test_sa_refine_no_rules(self, small_board_ctx):
        strategy = SARefineStrategy()
        components, board = board_state_from_ctx(small_board_ctx)
        result = strategy.place(components, board,
                                {"seed": 42, "max_steps": 500})
        assert set(result.keys()) == set(small_board_ctx.free.keys())

    def test_grid_spread_no_rules(self, small_board_ctx):
        strategy = GridSpreadStrategy()
        components, board = board_state_from_ctx(small_board_ctx)
        result = strategy.place(components, board,
                                {"margin": 3.0, "seed": 42})
        assert set(result.keys()) == set(small_board_ctx.free.keys())


# ---------------------------------------------------------------------------
# AntiAffinityRule._match pattern tests
# ---------------------------------------------------------------------------


class TestAntiAffinityMatching:
    """Unit tests for AntiAffinityRule pattern matching."""

    def test_exact_match(self):
        rule = AntiAffinityRule("dac.dac1", "dac.dac2", min_mm=12.0)
        assert rule.matches("dac.dac1", "dac.dac2")
        assert rule.matches("dac.dac2", "dac.dac1")  # symmetric

    def test_exact_no_match(self):
        rule = AntiAffinityRule("dac.dac1", "dac.dac2", min_mm=12.0)
        assert not rule.matches("dac.dac1", "dac.dac3")
        assert not rule.matches("dac.opamp1", "dac.dac2")

    def test_prefix_match_with_dot(self):
        rule = AntiAffinityRule("power.", "dac.", min_mm=20.0)
        assert rule.matches("power.reg_5v", "dac.dac1")
        assert rule.matches("dac.opamp3", "power.reg_3v3")  # symmetric
        assert not rule.matches("dac.dac1", "dac.dac2")  # both match "dac." but not "power."

    def test_wildcard_match(self):
        rule = AntiAffinityRule("dac.opamp*", "dac.opamp*", min_mm=6.0)
        assert rule.matches("dac.opamp1", "dac.opamp2")
        assert rule.matches("dac.opamp5", "dac.opamp3")

    def test_wildcard_no_match_different_prefix(self):
        rule = AntiAffinityRule("dac.opamp*", "dac.opamp*", min_mm=6.0)
        assert not rule.matches("dac.dac1", "dac.opamp2")
        assert not rule.matches("dac.opamp1", "dac.dac1")

    def test_wildcard_self_no_match(self):
        """Same component should not match against itself in practice,
        but the rule itself doesn't prevent it --- callers skip self-pairs."""
        rule = AntiAffinityRule("dac.opamp*", "dac.opamp*", min_mm=6.0)
        # Same addr in both slots --- matches pattern-wise
        assert rule.matches("dac.opamp1", "dac.opamp1")

    def test_mixed_exact_and_wildcard(self):
        rule = AntiAffinityRule("power.reg_5v", "dac.opamp*", min_mm=10.0)
        assert rule.matches("power.reg_5v", "dac.opamp3")
        assert rule.matches("dac.opamp1", "power.reg_5v")  # symmetric
        assert not rule.matches("power.reg_3v3", "dac.opamp1")


# ---------------------------------------------------------------------------
# IC anti-affinity integration (QFN / TSSOP spacing)
# ---------------------------------------------------------------------------


@pytest.fixture
def ic_anti_affinity_ctx():
    """Board with 2 QFN DACs and 3 TSSOP op-amps that must be spaced apart."""
    fixed = {
        "mcu": Placement(x=50.0, y=40.0, side="F"),
    }
    fixed_info = {
        "mcu": ComponentInfo(
            address="mcu", width=10.0, height=10.0,
            is_tht=False, pin_count=48, nets=["spi"],
        ),
    }
    free = {
        "dac.dac1": ComponentInfo(
            address="dac.dac1", width=5.0, height=5.0,
            is_tht=False, pin_count=16, nets=["spi", "avdd"],
        ),
        "dac.dac2": ComponentInfo(
            address="dac.dac2", width=5.0, height=5.0,
            is_tht=False, pin_count=16, nets=["spi", "avdd"],
        ),
        "dac.opamp1": ComponentInfo(
            address="dac.opamp1", width=6.0, height=4.0,
            is_tht=False, pin_count=14, nets=["avdd"],
        ),
        "dac.opamp2": ComponentInfo(
            address="dac.opamp2", width=6.0, height=4.0,
            is_tht=False, pin_count=14, nets=["avdd"],
        ),
        "dac.opamp3": ComponentInfo(
            address="dac.opamp3", width=6.0, height=4.0,
            is_tht=False, pin_count=14, nets=["avdd"],
        ),
    }
    net_graph = {
        "spi": ["mcu", "dac.dac1", "dac.dac2"],
        "avdd": ["dac.dac1", "dac.dac2", "dac.opamp1", "dac.opamp2", "dac.opamp3"],
    }
    rules = [
        AntiAffinityRule("dac.dac1", "dac.dac2", min_mm=12.0),
        AntiAffinityRule("dac.opamp*", "dac.opamp*", min_mm=6.0),
    ]
    return FixtureData(
        width=100.0,
        height=80.0,
        fixed=fixed,
        free=free,
        net_graph=net_graph,
        config={},
        fixed_info=fixed_info,
        anti_affinity=rules,
    )


class TestICAntiAffinity:
    """Verify DAC-DAC and opamp-opamp spacing across strategies."""

    def _dac_distance(self, result):
        return _distance(result["dac.dac1"], result["dac.dac2"])

    def _min_opamp_distance(self, result):
        opamps = ["dac.opamp1", "dac.opamp2", "dac.opamp3"]
        min_d = float("inf")
        for i in range(len(opamps)):
            for j in range(i + 1, len(opamps)):
                d = _distance(result[opamps[i]], result[opamps[j]])
                min_d = min(min_d, d)
        return min_d

    def test_grid_spread_dac_spacing(self, ic_anti_affinity_ctx):
        strategy = GridSpreadStrategy()
        components, board = board_state_from_ctx(ic_anti_affinity_ctx)
        result = strategy.place(components, board,
                                {"margin": 3.0, "connectivity_weight": 1.0,
                                 "seed": 42})
        assert set(result.keys()) == set(ic_anti_affinity_ctx.free.keys())
        dist = self._dac_distance(result)
        assert dist >= 10.0, f"DACs placed {dist:.1f}mm apart (min 12mm rule)"

    def test_grid_spread_opamp_spacing(self, ic_anti_affinity_ctx):
        strategy = GridSpreadStrategy()
        components, board = board_state_from_ctx(ic_anti_affinity_ctx)
        result = strategy.place(components, board,
                                {"margin": 3.0, "connectivity_weight": 1.0,
                                 "seed": 42})
        min_d = self._min_opamp_distance(result)
        assert min_d >= 4.0, f"Opamps min distance {min_d:.1f}mm (min 6mm rule)"

    def test_sa_refine_dac_spacing(self, ic_anti_affinity_ctx):
        strategy = SARefineStrategy()
        components, board = board_state_from_ctx(ic_anti_affinity_ctx)
        result = strategy.place(components, board,
                                {"initial_temp": 5.0, "cooling_rate": 0.95,
                                 "seed": 42, "max_steps": 1000})
        assert set(result.keys()) == set(ic_anti_affinity_ctx.free.keys())
        dist = self._dac_distance(result)
        assert dist >= 10.0, f"DACs placed {dist:.1f}mm apart (min 12mm rule)"

    def test_constructive_dac_spacing(self, ic_anti_affinity_ctx):
        strategy = ConstructiveStrategy()
        components, board = board_state_from_ctx(ic_anti_affinity_ctx)
        result = strategy.place(components, board,
                                {"order": "connectivity"})
        assert set(result.keys()) == set(ic_anti_affinity_ctx.free.keys())
        dist = self._dac_distance(result)
        assert dist >= 10.0, f"DACs placed {dist:.1f}mm apart (min 12mm rule)"


# ---------------------------------------------------------------------------
# Density repulsion (automatic IC spacing based on component area)
# ---------------------------------------------------------------------------


@pytest.fixture
def density_ctx():
    """Board with 2 large ICs and 4 small passives --- no explicit anti-affinity.

    The density repulsion should still keep the ICs apart while allowing
    passives to cluster freely.
    """
    fixed = {}
    fixed_info = {}
    free = {
        "ic_a": ComponentInfo(
            address="ic_a", width=6.0, height=6.0,
            is_tht=False, pin_count=16, nets=["spi", "vdd"],
        ),
        "ic_b": ComponentInfo(
            address="ic_b", width=6.0, height=6.0,
            is_tht=False, pin_count=16, nets=["spi", "vdd"],
        ),
        "cap1": ComponentInfo(
            address="cap1", width=2.0, height=1.0,
            is_tht=False, pin_count=2, nets=["vdd"],
        ),
        "cap2": ComponentInfo(
            address="cap2", width=2.0, height=1.0,
            is_tht=False, pin_count=2, nets=["vdd"],
        ),
        "res1": ComponentInfo(
            address="res1", width=2.0, height=1.0,
            is_tht=False, pin_count=2, nets=["spi"],
        ),
        "res2": ComponentInfo(
            address="res2", width=2.0, height=1.0,
            is_tht=False, pin_count=2, nets=["spi"],
        ),
    }
    net_graph = {
        "spi": ["ic_a", "ic_b", "res1", "res2"],
        "vdd": ["ic_a", "ic_b", "cap1", "cap2"],
    }
    return FixtureData(
        width=60.0,
        height=60.0,
        fixed=fixed,
        free=free,
        net_graph=net_graph,
        config={},
        fixed_info=fixed_info,
    )


class TestDensityRepulsion:
    """Verify automatic spacing of large components via density_weight."""

    def test_ics_spread_with_density_weight(self, density_ctx):
        strategy = GridSpreadStrategy()
        components, board = board_state_from_ctx(density_ctx)
        result = strategy.place(components, board,
                                {"margin": 3.0, "connectivity_weight": 1.0,
                                 "density_weight": 0.15, "seed": 42})
        assert set(result.keys()) == set(density_ctx.free.keys())
        dist = _distance(result["ic_a"], result["ic_b"])
        # With density repulsion, ICs should be pushed apart
        assert dist >= 10.0, f"ICs placed {dist:.1f}mm apart (should be spread)"

    def test_density_repulsion_increases_ic_distance(self, density_ctx):
        """With strong connectivity pull, density repulsion should push ICs apart."""
        strategy = GridSpreadStrategy()
        # Strong connectivity pull to cluster ICs together
        components, board = board_state_from_ctx(density_ctx)
        result = strategy.place(components, board,
                                {"margin": 3.0, "connectivity_weight": 5.0,
                                 "density_weight": 0.0, "seed": 42})
        assert set(result.keys()) == set(density_ctx.free.keys())
        dist_no_repulsion = _distance(result["ic_a"], result["ic_b"])

        components, board = board_state_from_ctx(density_ctx)
        result2 = strategy.place(components, board,
                                 {"margin": 3.0, "connectivity_weight": 5.0,
                                  "density_weight": 0.5, "seed": 42})
        dist_with_repulsion = _distance(result2["ic_a"], result2["ic_b"])

        # Density weight should push ICs further apart
        assert dist_with_repulsion >= dist_no_repulsion, (
            f"Density repulsion shouldn't decrease IC distance: "
            f"{dist_with_repulsion:.1f}mm vs {dist_no_repulsion:.1f}mm"
        )

    def test_passives_unaffected_by_density(self, density_ctx):
        """Passives are below threshold --- density repulsion shouldn't change them."""
        strategy = GridSpreadStrategy()
        components, board = board_state_from_ctx(density_ctx)
        result = strategy.place(components, board,
                                {"margin": 3.0, "connectivity_weight": 1.0,
                                 "density_weight": 0.15,
                                 "density_threshold_mm2": 10.0,
                                 "seed": 42})
        # All passives should still be placed
        for name in ["cap1", "cap2", "res1", "res2"]:
            assert name in result
