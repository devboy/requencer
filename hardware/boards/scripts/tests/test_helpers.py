"""Tests for helper functions (pure algorithms, no pcbnew)."""

from placement.helpers import (
    connectivity_sort,
    connectivity_sort_by_net_graph,
    estimate_hpwl,
    pin_alignment_padding,
    pin_edge_position,
    size_sort_by_info,
)
from placement.strategies import ComponentInfo, Placement


class TestConnectivitySort:
    def test_most_connected_first(self):
        graph = {
            "a": {"b": 3, "c": 1},
            "b": {"a": 3, "c": 2},
            "c": {"a": 1, "b": 2},
        }
        result = connectivity_sort(["a", "b", "c"], graph)
        # "b" has highest total weight (3+2=5), should start first
        assert result[0] == "b"
        assert set(result) == {"a", "b", "c"}

    def test_disconnected_components(self):
        graph = {
            "a": {"b": 1},
            "b": {"a": 1},
        }
        result = connectivity_sort(["a", "b", "c"], graph)
        assert len(result) == 3
        assert set(result) == {"a", "b", "c"}

    def test_empty(self):
        assert connectivity_sort([], {}) == []

    def test_single_component(self):
        result = connectivity_sort(["a"], {})
        assert result == ["a"]


class TestConnectivitySortByNetGraph:
    def test_groups_connected(self):
        net_graph = {
            "net1": ["a", "b"],
            "net2": ["b", "c"],
        }
        result = connectivity_sort_by_net_graph(["a", "b", "c"], net_graph)
        assert len(result) == 3
        # "b" connects to both nets, should be first
        assert result[0] == "b"

    def test_filters_external_addrs(self):
        net_graph = {
            "net1": ["a", "b", "external"],
        }
        result = connectivity_sort_by_net_graph(["a", "b"], net_graph)
        assert set(result) == {"a", "b"}


class TestSizeSortByInfo:
    def test_largest_first(self):
        components = {
            "small": ComponentInfo("small", 2.0, 1.0, False, 2, []),
            "big": ComponentInfo("big", 10.0, 8.0, False, 16, []),
            "medium": ComponentInfo("medium", 5.0, 3.0, False, 4, []),
        }
        result = size_sort_by_info(["small", "big", "medium"], components)
        assert result[0] == "big"
        assert result[-1] == "small"


class TestEstimateHPWL:
    def test_single_net(self):
        placements = {
            "a": Placement(x=0.0, y=0.0, side="F"),
            "b": Placement(x=10.0, y=0.0, side="F"),
        }
        net_graph = {"net1": ["a", "b"]}
        hpwl = estimate_hpwl(placements, net_graph)
        assert hpwl == 10.0  # x span 10, y span 0

    def test_multiple_nets(self):
        placements = {
            "a": Placement(x=0.0, y=0.0, side="F"),
            "b": Placement(x=10.0, y=0.0, side="F"),
            "c": Placement(x=0.0, y=5.0, side="F"),
        }
        net_graph = {
            "net1": ["a", "b"],      # HPWL = 10
            "net2": ["a", "c"],      # HPWL = 5
        }
        hpwl = estimate_hpwl(placements, net_graph)
        assert hpwl == 15.0

    def test_unplaced_components_skipped(self):
        placements = {
            "a": Placement(x=0.0, y=0.0, side="F"),
        }
        net_graph = {"net1": ["a", "b"]}
        hpwl = estimate_hpwl(placements, net_graph)
        assert hpwl == 0.0  # Only 1 placed component, skip

    def test_empty(self):
        assert estimate_hpwl({}, {}) == 0.0


class TestPinEdgePosition:
    def _resistor(self, rotation=0.0):
        """2-pin passive: net_a on West, net_b on East (at rotation 0)."""
        return ComponentInfo(
            address="r1", width=2.0, height=1.0, is_tht=False,
            pin_count=2, nets=["net_a", "net_b"],
            pad_sides={"W": ["net_a"], "E": ["net_b"]},
        )

    def _ic(self):
        """Multi-edge IC with nets on different sides."""
        return ComponentInfo(
            address="ic1", width=8.0, height=8.0, is_tht=False,
            pin_count=32, nets=["sda", "scl", "cs", "mosi"],
            pad_sides={
                "N": ["sda", "scl"],
                "S": ["cs"],
                "E": ["mosi"],
                "W": [],
            },
        )

    def test_passive_east_pin_front(self):
        comp = self._resistor()
        p = Placement(x=10.0, y=20.0, side="F", rotation=0.0)
        pos = pin_edge_position(comp, p, "net_b")
        # net_b on East, width=2 → offset +1.0 in x
        assert pos == (11.0, 20.0)

    def test_passive_west_pin_front(self):
        comp = self._resistor()
        p = Placement(x=10.0, y=20.0, side="F", rotation=0.0)
        pos = pin_edge_position(comp, p, "net_a")
        # net_a on West → offset -1.0 in x
        assert pos == (9.0, 20.0)

    def test_passive_rotated_90_front(self):
        comp = self._resistor()
        p = Placement(x=10.0, y=20.0, side="F", rotation=90.0)
        pos = pin_edge_position(comp, p, "net_a")
        # 90° CCW: W→S, so net_a ends up on South edge
        # Rotated dims: width=1.0, height=2.0 → S offset = height/2 = 1.0
        assert pos == (10.0, 21.0)

    def test_passive_rotated_180_front(self):
        comp = self._resistor()
        p = Placement(x=10.0, y=20.0, side="F", rotation=180.0)
        pos = pin_edge_position(comp, p, "net_a")
        # 180°: W→E, so net_a ends up on East edge
        assert pos == (11.0, 20.0)

    def test_passive_rotated_270_front(self):
        comp = self._resistor()
        p = Placement(x=10.0, y=20.0, side="F", rotation=270.0)
        pos = pin_edge_position(comp, p, "net_a")
        # 270° CCW: W→N, so net_a ends up on North edge
        assert pos == (10.0, 19.0)

    def test_bcu_mirror_swaps_east_west(self):
        """B.Cu at rotation=0: East becomes West due to X-mirror."""
        comp = self._resistor()
        p = Placement(x=10.0, y=20.0, side="B", rotation=0.0)
        # net_b is originally on East → B.Cu mirror → now on West
        pos = pin_edge_position(comp, p, "net_b")
        assert pos == (9.0, 20.0)
        # net_a is originally on West → B.Cu mirror → now on East
        pos = pin_edge_position(comp, p, "net_a")
        assert pos == (11.0, 20.0)

    def test_bcu_mirror_preserves_north_south(self):
        """B.Cu mirror doesn't affect N/S edges."""
        comp = self._ic()
        p = Placement(x=50.0, y=50.0, side="B", rotation=0.0)
        # sda on North → still North after mirror
        pos = pin_edge_position(comp, p, "sda")
        assert pos == (50.0, 46.0)
        # mosi on East → mirror → West
        pos = pin_edge_position(comp, p, "mosi")
        assert pos == (46.0, 50.0)

    def test_bcu_rotated_90(self):
        """B.Cu + 90° rotation: mirror first (W→E), then rotate 90° CCW (E→N)."""
        comp = self._resistor()
        p = Placement(x=10.0, y=20.0, side="B", rotation=90.0)
        pos = pin_edge_position(comp, p, "net_a")
        # net_a: West → mirror → East → rotate 90° CCW → North
        # Rotated dims: width=1.0, height=2.0 → N offset = -1.0
        assert pos == (10.0, 19.0)

    def test_ic_multi_edge_front(self):
        comp = self._ic()
        p = Placement(x=50.0, y=50.0, side="F", rotation=0.0)
        pos = pin_edge_position(comp, p, "sda")
        assert pos == (50.0, 46.0)
        pos = pin_edge_position(comp, p, "mosi")
        assert pos == (54.0, 50.0)

    def test_net_not_in_pad_sides(self):
        comp = self._resistor()
        p = Placement(x=10.0, y=20.0, side="F", rotation=0.0)
        pos = pin_edge_position(comp, p, "unknown_net")
        assert pos is None

    def test_no_pad_sides(self):
        comp = ComponentInfo(
            address="u1", width=4.0, height=4.0, is_tht=False,
            pin_count=8, nets=["net_a"],
        )
        p = Placement(x=10.0, y=20.0, side="F", rotation=0.0)
        pos = pin_edge_position(comp, p, "net_a")
        assert pos is None


class TestPinAlignmentPadding:
    def test_facing_pins_no_padding(self):
        """Two resistors: R1's East connects to R2's West → facing, no padding."""
        r1 = ComponentInfo(
            address="r1", width=2.0, height=1.0, is_tht=False,
            pin_count=2, nets=["net_a"],
            pad_sides={"W": [], "E": ["net_a"]},
        )
        r2 = ComponentInfo(
            address="r2", width=2.0, height=1.0, is_tht=False,
            pin_count=2, nets=["net_a"],
            pad_sides={"W": ["net_a"], "E": []},
        )
        placements = {
            "r1": Placement(x=10.0, y=20.0, side="F", rotation=0.0),
            "r2": Placement(x=15.0, y=20.0, side="F", rotation=0.0),
        }
        net_graph = {"net_a": ["r1", "r2"]}
        comp_map = {"r1": r1, "r2": r2}
        pad = pin_alignment_padding(r1, placements["r1"], net_graph,
                                    placements, comp_map)
        assert all(v == 0.0 for v in pad.values())

    def test_same_direction_pins_add_padding(self):
        """Both pins on East → same direction, needs padding on East side."""
        r1 = ComponentInfo(
            address="r1", width=2.0, height=1.0, is_tht=False,
            pin_count=2, nets=["net_a"],
            pad_sides={"W": [], "E": ["net_a"]},
        )
        r2 = ComponentInfo(
            address="r2", width=2.0, height=1.0, is_tht=False,
            pin_count=2, nets=["net_a"],
            pad_sides={"W": [], "E": ["net_a"]},
        )
        placements = {
            "r1": Placement(x=10.0, y=20.0, side="F", rotation=0.0),
            "r2": Placement(x=15.0, y=20.0, side="F", rotation=0.0),
        }
        net_graph = {"net_a": ["r1", "r2"]}
        comp_map = {"r1": r1, "r2": r2}
        pad = pin_alignment_padding(r1, placements["r1"], net_graph,
                                    placements, comp_map)
        assert pad["E"] > 0
        assert pad["W"] == 0.0
        assert pad["N"] == 0.0
        assert pad["S"] == 0.0

    def test_perpendicular_pins_moderate_padding(self):
        """R1 East connects to R2 North → perpendicular, moderate padding."""
        r1 = ComponentInfo(
            address="r1", width=2.0, height=1.0, is_tht=False,
            pin_count=2, nets=["net_a"],
            pad_sides={"W": [], "E": ["net_a"]},
        )
        r2 = ComponentInfo(
            address="r2", width=2.0, height=1.0, is_tht=False,
            pin_count=2, nets=["net_a"],
            pad_sides={"N": ["net_a"], "S": []},
        )
        placements = {
            "r1": Placement(x=10.0, y=20.0, side="F", rotation=0.0),
            "r2": Placement(x=15.0, y=15.0, side="F", rotation=0.0),
        }
        net_graph = {"net_a": ["r1", "r2"]}
        comp_map = {"r1": r1, "r2": r2}
        pad = pin_alignment_padding(r1, placements["r1"], net_graph,
                                    placements, comp_map)
        # Perpendicular: score=1, padding = 0.3*(1.8^1 - 1) = 0.24
        assert 0 < pad["E"] < 0.5

    def test_same_direction_more_than_perpendicular(self):
        """Same-direction padding > perpendicular padding."""
        r1 = ComponentInfo(
            address="r1", width=2.0, height=1.0, is_tht=False,
            pin_count=2, nets=["net_a", "net_b"],
            pad_sides={"W": [], "E": ["net_a", "net_b"]},
        )
        # net_a: same direction (both E) → score +2
        r_same = ComponentInfo(
            address="r_same", width=2.0, height=1.0, is_tht=False,
            pin_count=2, nets=["net_a"],
            pad_sides={"W": [], "E": ["net_a"]},
        )
        # net_b: perpendicular (E vs N) → score +1
        r_perp = ComponentInfo(
            address="r_perp", width=2.0, height=1.0, is_tht=False,
            pin_count=2, nets=["net_b"],
            pad_sides={"N": ["net_b"], "S": []},
        )
        placements = {
            "r1": Placement(x=10.0, y=20.0, side="F", rotation=0.0),
            "r_same": Placement(x=15.0, y=20.0, side="F", rotation=0.0),
            "r_perp": Placement(x=15.0, y=15.0, side="F", rotation=0.0),
        }
        net_graph = {"net_a": ["r1", "r_same"], "net_b": ["r1", "r_perp"]}
        comp_map = {"r1": r1, "r_same": r_same, "r_perp": r_perp}
        pad = pin_alignment_padding(r1, placements["r1"], net_graph,
                                    placements, comp_map)
        # Total score on E = 2 (same-dir) + 1 (perp) = 3
        # padding = 0.3 * (1.8^3 - 1) = 0.3 * 4.832 ≈ 1.45
        assert pad["E"] > 1.0

    def test_exponential_growth(self):
        """More misaligned nets on the same edge → exponentially more padding."""
        r1 = ComponentInfo(
            address="r1", width=2.0, height=1.0, is_tht=False,
            pin_count=2, nets=["net_a"],
            pad_sides={"W": [], "E": ["net_a"]},
        )
        # One perpendicular neighbor
        r2 = ComponentInfo(
            address="r2", width=2.0, height=1.0, is_tht=False,
            pin_count=2, nets=["net_a"],
            pad_sides={"N": ["net_a"], "S": []},
        )
        p1 = {"r1": Placement(x=10.0, y=20.0, side="F", rotation=0.0),
              "r2": Placement(x=15.0, y=15.0, side="F", rotation=0.0)}
        pad_one = pin_alignment_padding(
            r1, p1["r1"], {"net_a": ["r1", "r2"]}, p1, {"r1": r1, "r2": r2})

        # Two perpendicular neighbors on the same net
        r3 = ComponentInfo(
            address="r3", width=2.0, height=1.0, is_tht=False,
            pin_count=2, nets=["net_a"],
            pad_sides={"S": ["net_a"], "N": []},
        )
        p2 = {**p1, "r3": Placement(x=15.0, y=25.0, side="F", rotation=0.0)}
        pad_two = pin_alignment_padding(
            r1, p2["r1"], {"net_a": ["r1", "r2", "r3"]}, p2,
            {"r1": r1, "r2": r2, "r3": r3})

        # Two misaligned should be more than double one misaligned
        assert pad_two["E"] > 2 * pad_one["E"]

    def test_no_pad_sides_no_padding(self):
        """Component without pad_sides gets zero padding."""
        comp = ComponentInfo(
            address="u1", width=4.0, height=4.0, is_tht=False,
            pin_count=8, nets=["net_a"],
        )
        placements = {"u1": Placement(x=10.0, y=20.0, side="F", rotation=0.0)}
        net_graph = {"net_a": ["u1", "r1"]}
        comp_map = {"u1": comp}
        pad = pin_alignment_padding(comp, placements["u1"], net_graph,
                                    placements, comp_map)
        assert all(v == 0.0 for v in pad.values())
