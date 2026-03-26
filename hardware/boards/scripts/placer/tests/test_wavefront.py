"""Tests for wavefront strategy helpers."""

from placer.dtypes import Board, Component, Net, Pin, PlacedComponent, Side
from placer.context import PlacementContext
from placer.strategies.wavefront import _best_position_and_rotation
from placer.strategies.wavefront import _interleave_bypass_caps
from placer import place


class TestInterleaveBypassCaps:
    def test_basic_interleave(self):
        """Bypass caps move to right after their IC."""
        ordered = ["dac.u1", "dac.opamp", "dac.c_u1_100n", "dac.c_op_100n"]
        bypass_map = {
            "dac.c_u1_100n": "dac.u1",
            "dac.c_op_100n": "dac.opamp",
        }
        result = _interleave_bypass_caps(ordered, bypass_map)
        assert result == [
            "dac.u1", "dac.c_u1_100n",
            "dac.opamp", "dac.c_op_100n",
        ]

    def test_multiple_caps_per_ic(self):
        """Multiple bypass caps follow their IC in original relative order."""
        ordered = ["dac.u1", "dac.c_hf", "dac.c_bulk"]
        bypass_map = {
            "dac.c_hf": "dac.u1",
            "dac.c_bulk": "dac.u1",
        }
        result = _interleave_bypass_caps(ordered, bypass_map)
        assert result == ["dac.u1", "dac.c_hf", "dac.c_bulk"]

    def test_non_bypass_caps_unchanged(self):
        """Caps not in bypass_map stay at original position."""
        ordered = ["dac.u1", "dac.c_filter", "dac.c_bypass"]
        bypass_map = {"dac.c_bypass": "dac.u1"}
        result = _interleave_bypass_caps(ordered, bypass_map)
        # c_filter not in bypass_map → stays in place
        # c_bypass → moves after u1
        assert result == ["dac.u1", "dac.c_bypass", "dac.c_filter"]

    def test_empty_bypass_map(self):
        """No bypass caps → order unchanged."""
        ordered = ["a", "b", "c"]
        result = _interleave_bypass_caps(ordered, {})
        assert result == ["a", "b", "c"]

    def test_ic_not_in_list_fixed(self):
        """Bypass cap whose IC is fixed (not in free list) → prepended."""
        ordered = ["dac.opamp", "dac.c_mcu_100n"]
        bypass_map = {"dac.c_mcu_100n": "mcu.pga"}  # mcu.pga is fixed
        result = _interleave_bypass_caps(ordered, bypass_map)
        # Cap's IC not in ordered → cap prepended
        assert result == ["dac.c_mcu_100n", "dac.opamp"]

    def test_mixed_fixed_and_free_ics(self):
        """Mix of bypass caps for fixed and free ICs."""
        ordered = ["dac.u1", "dac.c_free", "pwr.c_fixed"]
        bypass_map = {
            "dac.c_free": "dac.u1",       # u1 is in ordered (free)
            "pwr.c_fixed": "pwr.reg_5v",  # reg_5v not in ordered (fixed)
        }
        result = _interleave_bypass_caps(ordered, bypass_map)
        # pwr.c_fixed prepended (fixed IC), dac.c_free after dac.u1
        assert result == ["pwr.c_fixed", "dac.u1", "dac.c_free"]


class TestBypassTargeting:
    def test_bypass_cap_targets_ic_not_centroid(self):
        """Bypass cap on GND+AVDD should target its IC, not all GND members."""
        # IC at (50, 25) center, other component at (10, 25)
        ic = Component(id="dac.u1", width=10, height=10,
                       pins=[Pin("AVDD", 5, 0), Pin("GND", 5, 10)],
                       fixed=True, x=45, y=20, group="dac")
        other = Component(id="pwr.reg", width=5, height=5,
                          pins=[Pin("GND", 2.5, 5)],
                          fixed=True, x=7.5, y=22.5, group="pwr")
        cap = Component(id="dac.c_100n", width=2, height=1,
                        pins=[Pin("AVDD", 0, 0.5), Pin("GND", 2, 0.5)],
                        group="dac")

        # Power nets connect cap to IC and other
        rot_nets = [
            Net("AVDD", (("dac.u1", "AVDD"), ("dac.c_100n", "AVDD"))),
            Net("GND", (("dac.u1", "GND"), ("pwr.reg", "GND"),
                        ("dac.c_100n", "GND"))),
        ]
        power = frozenset(["AVDD", "GND"])
        board = Board(width=100, height=50,
                      components=[ic, other, cap],
                      rotation_nets=rot_nets,
                      power_nets=power)
        ctx = PlacementContext(board)

        rot_net_graph = ctx.rotation_net_graph()
        bypass_map = {"dac.c_100n": "dac.u1"}

        # With bypass_map: should target IC, not centroid
        cx_bypass, cy_bypass, _ = _best_position_and_rotation(
            cap, rot_net_graph, {}, ctx, bypass_map=bypass_map)

        # Without bypass_map: would target centroid of IC + pwr.reg on GND
        cx_normal, cy_normal, _ = _best_position_and_rotation(
            cap, rot_net_graph, {}, ctx)

        # Bypass targeting should place cap closer to IC (x=50) than
        # normal targeting (which averages with pwr.reg at x=10)
        assert abs(cx_bypass - 50) < abs(cx_normal - 50), (
            f"Bypass cx={cx_bypass:.1f} should be closer to IC (50) "
            f"than normal cx={cx_normal:.1f}")

    def test_signal_net_not_filtered(self):
        """Bypass cap with a signal net: filtering only on power nets."""
        # IC at x=70, other at x=10. Cap has signal net to both + power to IC.
        ic = Component(id="dac.u1", width=10, height=10,
                       pins=[Pin("AVDD", 5, 0), Pin("GND", 5, 10),
                             Pin("sig", 0, 5)],
                       fixed=True, x=65, y=20, group="dac")
        other = Component(id="dac.opamp", width=4, height=4,
                          pins=[Pin("sig", 2, 0)],
                          fixed=True, x=8, y=23, group="dac")
        cap = Component(id="dac.c_100n", width=2, height=1,
                        pins=[Pin("AVDD", 0, 0.5), Pin("GND", 2, 0.5),
                              Pin("sig", 1, 0)],
                        group="dac")

        rot_nets = [
            Net("AVDD", (("dac.u1", "AVDD"), ("dac.c_100n", "AVDD"))),
            Net("GND", (("dac.u1", "GND"), ("dac.c_100n", "GND"))),
            Net("sig", (("dac.u1", "sig"), ("dac.opamp", "sig"),
                        ("dac.c_100n", "sig"))),
        ]
        power = frozenset(["AVDD", "GND"])
        board = Board(width=100, height=50,
                      components=[ic, other, cap],
                      rotation_nets=rot_nets,
                      power_nets=power)
        ctx = PlacementContext(board)
        rot_net_graph = ctx.rotation_net_graph()

        # Cap is in bypass_map (even though it has a signal net —
        # identify_bypass_caps would exclude it, but we test the
        # filtering behavior directly)
        bypass_map = {"dac.c_100n": "dac.u1"}

        cx, cy, _ = _best_position_and_rotation(
            cap, rot_net_graph, {}, ctx, bypass_map=bypass_map)

        # Power nets filtered to IC only. But signal net "sig" still
        # considers both dac.u1 AND dac.opamp — so cap is pulled
        # somewhat toward opamp (x=10), not purely at IC (x=70).
        # Cap should NOT be at IC center — the signal net pull proves
        # signal-net neighbors are not filtered.
        assert cx < 70, (
            f"Cap at cx={cx:.1f} should be pulled away from IC (70) "
            f"by signal net to opamp at x=10")


class TestBypassCapIntegration:
    def test_bypass_cap_placed_near_ic(self):
        """End-to-end: bypass cap lands closer to its IC than board center."""
        ic = Component(id="dac.u1", width=10, height=10,
                       pins=[Pin("AVDD", 5, 0), Pin("GND", 5, 10),
                             Pin("sig1", 0, 5), Pin("sig2", 10, 5)],
                       fixed=True, x=70, y=20, group="dac")
        cap = Component(id="dac.c_100n", width=2, height=1,
                        pins=[Pin("AVDD", 0, 0.5), Pin("GND", 2, 0.5)],
                        group="dac")

        signal_nets = [
            Net("sig1", (("dac.u1", "sig1"),)),  # single-component, filtered out
        ]
        rot_nets = [
            Net("AVDD", (("dac.u1", "AVDD"), ("dac.c_100n", "AVDD"))),
            Net("GND", (("dac.u1", "GND"), ("dac.c_100n", "GND"))),
        ]
        power = frozenset(["AVDD", "GND"])
        board = Board(width=100, height=50,
                      components=[ic, cap],
                      nets=signal_nets,
                      rotation_nets=rot_nets,
                      power_nets=power)

        results = place(board, strategy="wavefront")
        assert len(results) == 1
        cap_result = results[0]
        assert cap_result.component_id == "dac.c_100n"

        # Cap should be adjacent to IC edge, not at board center
        # IC bbox: x=70..80, y=20..30
        # Cap should be within ~2mm of the IC bounding box edge
        cap_cx = cap_result.x + 1  # cap width=2, center offset
        cap_cy = cap_result.y + 0.5

        # Distance from cap center to nearest IC edge
        dx = max(70 - cap_cx, 0, cap_cx - 80)
        dy = max(20 - cap_cy, 0, cap_cy - 30)
        edge_dist = (dx**2 + dy**2) ** 0.5

        assert edge_dist <= 2.5, (
            f"Cap at ({cap_cx:.1f}, {cap_cy:.1f}) too far from IC edge: "
            f"dist={edge_dist:.1f}mm")
