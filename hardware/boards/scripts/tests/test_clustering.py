"""Tests for build_clusters() in placement/helpers.py."""

import pytest

from placement.helpers import build_clusters
from placement.strategies import Cluster, ComponentInfo


def _comp(addr, nets=None, pin_count=8, multi_edge=False):
    """Create a test ComponentInfo.

    multi_edge=True gives the component signal pins on 4 edges (QFN-like),
    which is required for cluster anchor detection.
    """
    if multi_edge and nets:
        # Distribute nets across 4 edges so it qualifies as QFN-like
        sides = {"N": [], "S": [], "E": [], "W": []}
        edges = ["N", "S", "E", "W"]
        for i, net in enumerate(nets):
            sides[edges[i % 4]].append(net)
        edge_counts = {e: len(n) for e, n in sides.items()}
    else:
        sides = {"N": [], "S": [], "E": [], "W": []}
        edge_counts = {"N": 0, "S": 0, "E": 0, "W": 0}
    return ComponentInfo(
        address=addr, width=5.0, height=3.0, is_tht=False,
        pin_count=pin_count, nets=nets or [],
        pad_sides=sides,
        edge_signal_count=edge_counts,
        group=addr.split(".")[0] if "." in addr else None,
    )


def _net_graph_from_components(components):
    """Build net_graph from ComponentInfo.nets lists."""
    from collections import defaultdict
    net_graph = defaultdict(list)
    for addr, comp in components.items():
        for net in comp.nets:
            net_graph[net].append(addr)
    return dict(net_graph)


# ---------------------------------------------------------------------------
# TestBuildClusters
# ---------------------------------------------------------------------------

class TestBuildClusters:

    def test_single_group_with_anchor_and_satellite(self):
        """DAC anchor + opamp satellite + feedback resistor passive."""
        components = {
            "dac.dac1": _comp("dac.dac1", nets=["out0", "out1", "sclk", "din"], pin_count=16, multi_edge=True),
            "dac.opamp1": _comp("dac.opamp1", nets=["out0", "out1"], pin_count=8),
            "dac.r_fb1": _comp("dac.r_fb1", nets=["out0"], pin_count=2),
        }
        net_graph = _net_graph_from_components(components)
        clusters = build_clusters(components, net_graph)

        assert len(clusters) == 1
        cluster = clusters[0]
        assert cluster.anchor == "dac.dac1"
        assert "dac.opamp1" in cluster.satellites
        assert "dac.r_fb1" in cluster.satellites["dac.opamp1"]

    def test_bypass_caps_assigned_by_address(self):
        """Caps with no signal nets end up in bypass list."""
        components = {
            "dac.dac1": _comp("dac.dac1", nets=["out0", "sclk", "din", "vref"], pin_count=16, multi_edge=True),
            "dac.c_dac1_1": _comp("dac.c_dac1_1", nets=[], pin_count=2),
            "dac.c_vio1": _comp("dac.c_vio1", nets=[], pin_count=2),
        }
        net_graph = _net_graph_from_components(components)
        clusters = build_clusters(components, net_graph)

        assert len(clusters) == 1
        cluster = clusters[0]
        assert cluster.anchor == "dac.dac1"
        assert "dac.c_dac1_1" in cluster.bypass
        assert "dac.c_vio1" in cluster.bypass

    def test_no_clusters_for_ungrouped(self):
        """Components without a dot in address produce no clusters."""
        components = {
            "standalone": _comp("standalone", nets=["net1", "net2"], pin_count=16),
        }
        net_graph = _net_graph_from_components(components)
        clusters = build_clusters(components, net_graph)

        assert len(clusters) == 0

    def test_two_anchors_same_group(self):
        """Two ICs in same group each become anchor for their own satellite.

        The two DACs share only 1 bus net (sclk) so neither qualifies as a
        satellite of the other (threshold is 2+ shared nets).
        """
        components = {
            "dac.dac1": _comp("dac.dac1", nets=["out0", "out1", "sclk", "din"], pin_count=16, multi_edge=True),
            "dac.dac2": _comp("dac.dac2", nets=["out4", "out5", "sclk", "vref"], pin_count=16, multi_edge=True),
            "dac.opamp1": _comp("dac.opamp1", nets=["out0", "out1"], pin_count=8),
            "dac.opamp3": _comp("dac.opamp3", nets=["out4", "out5"], pin_count=8),
        }
        net_graph = _net_graph_from_components(components)
        clusters = build_clusters(components, net_graph)

        assert len(clusters) == 2
        anchors = {c.anchor for c in clusters}
        assert "dac.dac1" in anchors
        assert "dac.dac2" in anchors

        cluster1 = next(c for c in clusters if c.anchor == "dac.dac1")
        cluster2 = next(c for c in clusters if c.anchor == "dac.dac2")
        assert "dac.opamp1" in cluster1.satellites
        assert "dac.opamp3" in cluster2.satellites

    def test_satellite_needs_2_shared_nets(self):
        """Component sharing only 1 net with anchor is NOT a satellite.

        dac.misc has pin_count=4 so it does not qualify as an anchor (>4 required).
        It shares only 1 net with dac.dac1, so it is not a satellite either.
        """
        components = {
            "dac.dac1": _comp("dac.dac1", nets=["out0", "out1", "sclk", "din"], pin_count=16, multi_edge=True),
            "dac.misc": _comp("dac.misc", nets=["sclk"], pin_count=4),
        }
        net_graph = _net_graph_from_components(components)
        clusters = build_clusters(components, net_graph)

        assert len(clusters) == 1
        cluster = clusters[0]
        assert "dac.misc" not in cluster.satellites
        # misc should end up in bypass (it's not passive by name, and not a satellite)
        # Actually misc doesn't match passive prefix, so it won't be in bypass either
        # It just won't be assigned to this cluster
        assert "dac.misc" not in cluster.bypass
