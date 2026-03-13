"""Tests for helper functions (pure algorithms, no pcbnew)."""

from placement.helpers import (
    connectivity_sort,
    connectivity_sort_by_net_graph,
    estimate_hpwl,
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
