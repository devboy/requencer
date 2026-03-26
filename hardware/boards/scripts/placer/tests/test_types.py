"""Tests for placer type definitions."""

from placer.dtypes import (
    AffinityRule, BlockedZone, Board, Component, Cluster, Net, Pin,
    PlacedComponent, PlacementError, Side, SidePadding, ZoneSide,
)


class TestComponent:
    def test_defaults(self):
        c = Component(id="u1", width=10, height=8)
        assert c.x == 0.0
        assert c.y == 0.0
        assert c.rotation == 0.0
        assert c.side == Side.FRONT
        assert c.fixed is False
        assert c.pins == []
        assert c.tags == set()
        assert c.group is None

    def test_with_pins(self):
        pins = [Pin("1", 0.0, 4.0), Pin("2", 10.0, 4.0)]
        c = Component(id="u1", width=10, height=8, pins=pins)
        assert len(c.pins) == 2
        assert c.pins[0].x == 0.0

    def test_fixed(self):
        c = Component(id="j1", width=5, height=5, fixed=True,
                      x=10, y=20, side=Side.FRONT)
        assert c.fixed
        assert c.x == 10


class TestAffinityRule:
    def test_exact_match(self):
        r = AffinityRule("a", "b", 10.0)
        assert r.matches("a", "b")
        assert r.matches("b", "a")
        assert not r.matches("a", "c")

    def test_prefix_match_dot(self):
        r = AffinityRule("dac.", "adc.", 15.0)
        assert r.matches("dac.u1", "adc.u2")
        assert r.matches("adc.r1", "dac.c1")
        assert not r.matches("dac.u1", "leds.d1")

    def test_prefix_match_star(self):
        r = AffinityRule("dac*", "adc*", 15.0)
        assert r.matches("dac_u1", "adc_u2")


class TestNet:
    def test_frozen(self):
        n = Net(id="sig1", connections=(("u1", "1"), ("r1", "2")))
        assert len(n.connections) == 2


class TestBlockedZone:
    def test_defaults(self):
        z = BlockedZone(x=0, y=0, width=10, height=10)
        assert z.side == ZoneSide.BOTH
        assert z.excluded_tags == frozenset()

    def test_with_tags(self):
        z = BlockedZone(x=0, y=0, width=10, height=10,
                        excluded_tags=frozenset({"tht"}),
                        allowed_tags=frozenset({"connector"}))
        assert "tht" in z.excluded_tags
        assert "connector" in z.allowed_tags


class TestBoard:
    def test_minimal(self):
        b = Board(width=100, height=50)
        assert b.clearance == 0.5
        assert b.components == []
        assert b.nets == []

    def test_with_components(self):
        comps = [Component(id="u1", width=10, height=8)]
        b = Board(width=100, height=50, components=comps)
        assert len(b.components) == 1


class TestPlacedComponent:
    def test_frozen(self):
        p = PlacedComponent("u1", 10.0, 20.0, 90.0, Side.BACK)
        assert p.component_id == "u1"
        assert p.rotation == 90.0
        assert p.side == Side.BACK


class TestCluster:
    def test_basic(self):
        c = Cluster(anchor="dac.u1",
                    satellites={"dac.opamp1": ["dac.r1", "dac.r2"]},
                    bypass=["dac.c1"])
        assert c.anchor == "dac.u1"
        assert len(c.satellites) == 1
        assert len(c.bypass) == 1


class TestPlacementError:
    def test_is_exception(self):
        try:
            raise PlacementError("failed")
        except PlacementError as e:
            assert str(e) == "failed"
