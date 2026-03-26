"""Tests for placer connectivity module."""

from placer.dtypes import Board, Component, Cluster, Net, Pin
from placer.connectivity import (
    build_net_graph, build_adjacency, connectivity_sort,
    build_circuits, compute_wave_distances, build_clusters,
    estimate_hpwl, _is_passive_id, identify_bypass_caps,
)


class TestBuildNetGraph:
    def test_basic(self):
        nets = [
            Net("sig1", (("u1", "1"), ("r1", "2"))),
            Net("sig2", (("u1", "2"), ("r2", "1"), ("r3", "1"))),
        ]
        board = Board(width=100, height=50, nets=nets)
        graph = build_net_graph(board)
        assert "sig1" in graph
        assert sorted(graph["sig1"]) == ["r1", "u1"]
        assert len(graph["sig2"]) == 3

    def test_single_connection_filtered(self):
        nets = [Net("lonely", (("u1", "1"),))]
        board = Board(width=100, height=50, nets=nets)
        graph = build_net_graph(board)
        assert "lonely" not in graph


class TestBuildAdjacency:
    def test_shared_nets(self):
        net_graph = {"n1": ["a", "b"], "n2": ["b", "c"]}
        adj = build_adjacency(net_graph)
        assert adj["a"]["b"] == 1
        assert adj["b"]["a"] == 1
        assert adj["b"]["c"] == 1

    def test_multiple_shared_nets(self):
        net_graph = {"n1": ["a", "b"], "n2": ["a", "b"]}
        adj = build_adjacency(net_graph)
        assert adj["a"]["b"] == 2

    def test_filter_by_addrs(self):
        net_graph = {"n1": ["a", "b", "c"]}
        adj = build_adjacency(net_graph, addrs={"a", "b"})
        assert "c" not in adj["a"]


class TestConnectivitySort:
    def test_most_connected_first(self):
        net_graph = {
            "n1": ["a", "b"],
            "n2": ["b", "c"],
            "n3": ["a", "b"],
        }
        result = connectivity_sort(["a", "b", "c"], net_graph)
        # b has strongest connections (connected to both a and c)
        assert result[0] == "b"
        assert set(result) == {"a", "b", "c"}

    def test_empty(self):
        assert connectivity_sort([], {}) == []

    def test_single(self):
        assert connectivity_sort(["a"], {}) == ["a"]

    def test_disconnected(self):
        net_graph = {"n1": ["a", "b"]}
        result = connectivity_sort(["a", "b", "c"], net_graph)
        assert len(result) == 3
        assert set(result) == {"a", "b", "c"}


class TestBuildCircuits:
    def test_connected(self):
        net_graph = {"n1": ["a", "b"], "n2": ["b", "c"]}
        circuits = build_circuits(net_graph, {"a", "b", "c"})
        assert len(circuits) == 1
        assert circuits[0] == {"a", "b", "c"}

    def test_disconnected(self):
        net_graph = {"n1": ["a", "b"]}
        circuits = build_circuits(net_graph, {"a", "b", "c"})
        assert len(circuits) == 2
        sizes = sorted(len(c) for c in circuits)
        assert sizes == [1, 2]

    def test_singleton(self):
        circuits = build_circuits({}, {"a"})
        assert len(circuits) == 1
        assert circuits[0] == {"a"}


class TestComputeWaveDistances:
    def test_basic_waves(self):
        net_graph = {
            "n1": ["fixed1", "a"],  # a is wave 0
            "n2": ["a", "b"],       # b is wave 1
            "n3": ["b", "c"],       # c is wave 2
        }
        wave_map, orphans = compute_wave_distances(
            net_graph, {"fixed1"}, {"a", "b", "c"})
        assert wave_map["a"] == 0
        assert wave_map["b"] == 1
        assert wave_map["c"] == 2
        assert len(orphans) == 0

    def test_orphans(self):
        net_graph = {"n1": ["fixed1", "a"]}
        wave_map, orphans = compute_wave_distances(
            net_graph, {"fixed1"}, {"a", "b"})
        assert wave_map["a"] == 0
        assert "b" in orphans


class TestIsPassiveId:
    def test_resistor(self):
        assert _is_passive_id("dac.r_100k")
        assert _is_passive_id("r_10k")
        # "dac.r.1" → leaf is "1", not passive (rsplit on "." gives "1")
        # The real pattern is "dac.r_100k" where leaf is "r_100k"

    def test_capacitor(self):
        assert _is_passive_id("power.c_100n")

    def test_not_passive(self):
        assert not _is_passive_id("dac.u1")
        assert not _is_passive_id("leds.tlc1")


class TestBuildClusters:
    def test_basic_cluster(self):
        # Anchor IC with pins on 4 edges, satellite with shared nets
        anchor_pins = [
            Pin("1", 0, 2.5), Pin("2", 0, 7.5),   # W
            Pin("3", 10, 2.5), Pin("4", 10, 7.5),  # E
            Pin("5", 5, 0),                          # N
            Pin("6", 5, 10),                         # S
        ]
        sat_pins = [Pin("1", 0, 1), Pin("2", 4, 1)]
        components = {
            "dac.u1": Component(id="dac.u1", width=10, height=10,
                                pins=anchor_pins),
            "dac.opamp": Component(id="dac.opamp", width=4, height=2,
                                   pins=sat_pins),
            "dac.r_100k": Component(id="dac.r_100k", width=2, height=1,
                                    pins=[Pin("1", 0, 0.5), Pin("2", 2, 0.5)]),
        }
        net_graph = {
            "sig_a": ["dac.u1", "dac.opamp"],
            "sig_b": ["dac.u1", "dac.opamp"],
            "sig_c": ["dac.opamp", "dac.r_100k"],
        }
        clusters = build_clusters(components, net_graph)
        assert len(clusters) == 1
        assert clusters[0].anchor == "dac.u1"
        assert "dac.opamp" in clusters[0].satellites

    def test_no_anchor(self):
        # Only passives — no cluster
        components = {
            "dac.r1": Component(id="dac.r1", width=2, height=1,
                                pins=[Pin("1", 0, 0.5), Pin("2", 2, 0.5)]),
        }
        clusters = build_clusters(components, {})
        assert len(clusters) == 0


class TestEstimateHPWL:
    def test_basic(self):
        positions = {"a": (0, 0), "b": (10, 0), "c": (0, 5)}
        net_graph = {"n1": ["a", "b"], "n2": ["a", "c"]}
        hpwl = estimate_hpwl(positions, net_graph)
        # n1: |10-0| + |0-0| = 10, n2: |0-0| + |5-0| = 5
        assert hpwl == 15.0

    def test_missing_component(self):
        positions = {"a": (0, 0)}
        net_graph = {"n1": ["a", "b"]}
        # Only 1 placed component in net — skipped
        assert estimate_hpwl(positions, net_graph) == 0.0


class TestIdentifyBypassCaps:
    def _make_comp(self, cid, n_pins=2, group=None):
        """Helper: create component with n_pins dummy pins."""
        pins = [Pin(str(i), float(i), 0.0) for i in range(n_pins)]
        return Component(id=cid, width=2, height=1, pins=pins,
                         group=group)

    def test_basic_bypass_cap(self):
        """Cap with all connections on power nets → bypass, associated to IC."""
        comps = {
            "dac.u1": self._make_comp("dac.u1", n_pins=8, group="dac"),
            "dac.c_100n": self._make_comp("dac.c_100n", group="dac"),
        }
        rot_nets = [
            Net("AVDD", (("dac.u1", "AVDD"), ("dac.c_100n", "AVDD"))),
            Net("GND", (("dac.u1", "GND"), ("dac.c_100n", "GND"))),
        ]
        power = frozenset(["AVDD", "GND"])
        board = Board(width=100, height=50, components=list(comps.values()),
                      rotation_nets=rot_nets, power_nets=power)

        result = identify_bypass_caps(board)
        assert result == {"dac.c_100n": "dac.u1"}

    def test_filter_cap_excluded(self):
        """Cap connected to a signal net is NOT bypass."""
        comps = {
            "dac.u1": self._make_comp("dac.u1", n_pins=8, group="dac"),
            "dac.c_filt": self._make_comp("dac.c_filt", group="dac"),
        }
        rot_nets = [
            Net("VREF", (("dac.u1", "VREF"), ("dac.c_filt", "VREF"))),
            Net("GND", (("dac.u1", "GND"), ("dac.c_filt", "GND"))),
        ]
        power = frozenset(["GND"])
        board = Board(width=100, height=50, components=list(comps.values()),
                      rotation_nets=rot_nets, power_nets=power)

        result = identify_bypass_caps(board)
        assert result == {}

    def test_resistor_excluded(self):
        """Resistors are passives but not caps — excluded."""
        comps = {
            "dac.u1": self._make_comp("dac.u1", n_pins=8, group="dac"),
            "dac.r_pullup": self._make_comp("dac.r_pullup", group="dac"),
        }
        rot_nets = [
            Net("VCC", (("dac.u1", "VCC"), ("dac.r_pullup", "VCC"))),
            Net("GND", (("dac.u1", "GND"), ("dac.r_pullup", "GND"))),
        ]
        power = frozenset(["VCC", "GND"])
        board = Board(width=100, height=50, components=list(comps.values()),
                      rotation_nets=rot_nets, power_nets=power)

        result = identify_bypass_caps(board)
        assert result == {}

    def test_no_group_excluded(self):
        """Cap without dotted address → no group → excluded."""
        comps = {
            "u1": self._make_comp("u1", n_pins=8),
            "c_100n": self._make_comp("c_100n"),
        }
        rot_nets = [
            Net("VCC", (("u1", "VCC"), ("c_100n", "VCC"))),
            Net("GND", (("u1", "GND"), ("c_100n", "GND"))),
        ]
        power = frozenset(["VCC", "GND"])
        board = Board(width=100, height=50, components=list(comps.values()),
                      rotation_nets=rot_nets, power_nets=power)

        result = identify_bypass_caps(board)
        assert result == {}

    def test_tiebreak_by_pin_count(self):
        """When multiple ICs share same power nets, pick the one with most pins."""
        comps = {
            "dac.u1": self._make_comp("dac.u1", n_pins=28, group="dac"),
            "dac.opamp": self._make_comp("dac.opamp", n_pins=8, group="dac"),
            "dac.c_100n": self._make_comp("dac.c_100n", group="dac"),
        }
        rot_nets = [
            Net("AVDD", (("dac.u1", "AVDD"), ("dac.opamp", "AVDD"),
                         ("dac.c_100n", "AVDD"))),
            Net("GND", (("dac.u1", "GND"), ("dac.opamp", "GND"),
                        ("dac.c_100n", "GND"))),
        ]
        power = frozenset(["AVDD", "GND"])
        board = Board(width=100, height=50, components=list(comps.values()),
                      rotation_nets=rot_nets, power_nets=power)

        result = identify_bypass_caps(board)
        assert result == {"dac.c_100n": "dac.u1"}

    def test_multiple_bypass_caps(self):
        """Multiple caps can be bypass for same or different ICs."""
        comps = {
            "dac.u1": self._make_comp("dac.u1", n_pins=28, group="dac"),
            "dac.opamp": self._make_comp("dac.opamp", n_pins=8, group="dac"),
            "dac.c_u1_100n": self._make_comp("dac.c_u1_100n", group="dac"),
            "dac.c_op_100n": self._make_comp("dac.c_op_100n", group="dac"),
        }
        rot_nets = [
            Net("AVDD", (("dac.u1", "AVDD"), ("dac.c_u1_100n", "AVDD"))),
            Net("DVDD", (("dac.opamp", "DVDD"), ("dac.c_op_100n", "DVDD"))),
            Net("GND", (("dac.u1", "GND"), ("dac.opamp", "GND"),
                        ("dac.c_u1_100n", "GND"), ("dac.c_op_100n", "GND"))),
        ]
        power = frozenset(["AVDD", "DVDD", "GND"])
        board = Board(width=100, height=50, components=list(comps.values()),
                      rotation_nets=rot_nets, power_nets=power)

        result = identify_bypass_caps(board)
        assert result["dac.c_u1_100n"] == "dac.u1"
        assert result["dac.c_op_100n"] == "dac.opamp"

    def test_no_shared_power_net_excluded(self):
        """Cap on power net but no same-group IC shares it → not bypass."""
        comps = {
            "pwr.reg": self._make_comp("pwr.reg", n_pins=8, group="pwr"),
            "dac.c_100n": self._make_comp("dac.c_100n", group="dac"),
        }
        rot_nets = [
            Net("V3V3", (("pwr.reg", "V3V3"), ("dac.c_100n", "V3V3"))),
            Net("GND", (("pwr.reg", "GND"), ("dac.c_100n", "GND"))),
        ]
        power = frozenset(["V3V3", "GND"])
        board = Board(width=100, height=50, components=list(comps.values()),
                      rotation_nets=rot_nets, power_nets=power)

        result = identify_bypass_caps(board)
        assert result == {}
