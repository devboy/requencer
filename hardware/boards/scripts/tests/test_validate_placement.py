"""Tests for validate_placement — verifies bounds, overlap, and dimension requirements."""

import pytest

from placement.helpers import check_anti_affinity, validate_placement
from placement.strategies import AntiAffinityRule, ComponentInfo, Placement


def _info(addr, w, h, is_tht=False, cx_offset=0.0, cy_offset=0.0):
    return ComponentInfo(
        address=addr, width=w, height=h, is_tht=is_tht, pin_count=2, nets=[],
        cx_offset=cx_offset, cy_offset=cy_offset,
    )


class TestOutOfBounds:
    def test_all_in_bounds(self):
        info = {"a": _info("a", 4, 4)}
        placements = {"a": Placement(x=10.0, y=10.0, side="F")}
        ok, oob, _ = validate_placement(20, 20, {}, placements, info)
        assert ok
        assert oob == []

    def test_extends_past_right_edge(self):
        info = {"a": _info("a", 4, 4)}
        # x=19 → right edge at 21, board is 20 wide
        placements = {"a": Placement(x=19.0, y=10.0, side="F")}
        ok, oob, _ = validate_placement(20, 20, {}, placements, info)
        assert not ok
        assert "a" in oob

    def test_extends_past_left_edge(self):
        info = {"a": _info("a", 4, 4)}
        # x=1 → left edge at -1
        placements = {"a": Placement(x=1.0, y=10.0, side="F")}
        ok, oob, _ = validate_placement(20, 20, {}, placements, info)
        assert not ok
        assert "a" in oob

    def test_extends_past_top_edge(self):
        info = {"a": _info("a", 4, 4)}
        # y=1 → top edge at -1
        placements = {"a": Placement(x=10.0, y=1.0, side="F")}
        ok, oob, _ = validate_placement(20, 20, {}, placements, info)
        assert not ok
        assert "a" in oob

    def test_extends_past_bottom_edge(self):
        info = {"a": _info("a", 4, 4)}
        # y=19 → bottom edge at 21
        placements = {"a": Placement(x=10.0, y=19.0, side="F")}
        ok, oob, _ = validate_placement(20, 20, {}, placements, info)
        assert not ok
        assert "a" in oob

    def test_exactly_at_edge_is_valid(self):
        info = {"a": _info("a", 4, 4)}
        # x=2 → left edge at 0, right edge at 4. Board is 20 wide. Valid.
        placements = {"a": Placement(x=2.0, y=2.0, side="F")}
        ok, oob, _ = validate_placement(20, 20, {}, placements, info)
        assert ok
        assert oob == []

    def test_multiple_components_some_out(self):
        info = {
            "a": _info("a", 4, 4),
            "b": _info("b", 4, 4),
            "c": _info("c", 4, 4),
        }
        placements = {
            "a": Placement(x=10.0, y=10.0, side="F"),  # ok
            "b": Placement(x=19.0, y=10.0, side="F"),  # out of bounds
            "c": Placement(x=10.0, y=19.0, side="F"),  # out of bounds
        }
        ok, oob, _ = validate_placement(20, 20, {}, placements, info)
        assert not ok
        assert "b" in oob
        assert "c" in oob
        assert "a" not in oob


class TestOverlap:
    def test_no_overlap(self):
        info = {
            "a": _info("a", 4, 4),
            "b": _info("b", 4, 4),
        }
        placements = {
            "a": Placement(x=5.0, y=10.0, side="F"),
            "b": Placement(x=15.0, y=10.0, side="F"),
        }
        ok, _, overlaps = validate_placement(30, 30, {}, placements, info)
        assert ok
        assert overlaps == []

    def test_overlapping_same_side(self):
        info = {
            "a": _info("a", 4, 4),
            "b": _info("b", 4, 4),
        }
        placements = {
            "a": Placement(x=10.0, y=10.0, side="F"),
            "b": Placement(x=11.0, y=10.0, side="F"),  # overlaps a
        }
        ok, _, overlaps = validate_placement(30, 30, {}, placements, info,
                                              clearance=0.0)
        assert not ok
        assert "b" in overlaps

    def test_no_overlap_opposite_sides_smd(self):
        info = {
            "a": _info("a", 4, 4),
            "b": _info("b", 4, 4),
        }
        placements = {
            "a": Placement(x=10.0, y=10.0, side="F"),
            "b": Placement(x=10.0, y=10.0, side="B"),  # same spot, other side
        }
        ok, _, overlaps = validate_placement(30, 30, {}, placements, info)
        assert ok
        assert overlaps == []

    def test_tht_overlaps_both_sides(self):
        info = {
            "a": _info("a", 4, 4, is_tht=True),
            "b": _info("b", 4, 4),
        }
        placements = {
            "a": Placement(x=10.0, y=10.0, side="F"),
            "b": Placement(x=11.0, y=10.0, side="B"),  # THT blocks both sides
        }
        ok, _, overlaps = validate_placement(30, 30, {}, placements, info,
                                              clearance=0.0)
        assert not ok
        assert "b" in overlaps

    def test_overlap_with_fixed(self):
        """Free component overlapping a fixed component should be detected."""
        fixed = {"fix": Placement(x=10.0, y=10.0, side="F")}
        info = {
            "fix": _info("fix", 6, 6),  # real dimensions, not 5x5 default
            "a": _info("a", 4, 4),
        }
        placements = {"a": Placement(x=12.0, y=10.0, side="F")}
        ok, _, overlaps = validate_placement(30, 30, fixed, placements, info,
                                              clearance=0.0)
        assert not ok
        assert "a" in overlaps

    def test_clearance_causes_overlap(self):
        """Components that don't physically overlap but violate clearance."""
        info = {
            "a": _info("a", 4, 4),
            "b": _info("b", 4, 4),
        }
        # Centers 4.5mm apart → physical gap = 4.5 - 2 - 2 = 0.5mm
        placements = {
            "a": Placement(x=8.0, y=10.0, side="F"),
            "b": Placement(x=12.5, y=10.0, side="F"),
        }
        # With 0 clearance: no overlap (0.5mm gap)
        ok, _, overlaps = validate_placement(30, 30, {}, placements, info,
                                              clearance=0.0)
        assert ok

        # With 1.0 clearance: registered rect for a extends to 11.0,
        # b starts at 10.5 → overlap
        ok, _, overlaps = validate_placement(30, 30, {}, placements, info,
                                              clearance=1.0)
        assert not ok


class TestMissingDimensions:
    def test_missing_fixed_info_raises(self):
        fixed = {"fix": Placement(x=10.0, y=10.0, side="F")}
        info = {"a": _info("a", 4, 4)}  # missing "fix"
        placements = {"a": Placement(x=20.0, y=10.0, side="F")}
        with pytest.raises(ValueError, match="Fixed component 'fix' missing"):
            validate_placement(30, 30, fixed, placements, info)

    def test_missing_placed_info_raises(self):
        info = {}  # missing "a"
        placements = {"a": Placement(x=10.0, y=10.0, side="F")}
        with pytest.raises(ValueError, match="Placed component 'a' missing"):
            validate_placement(30, 30, {}, placements, info)


class TestCombined:
    def test_both_out_of_bounds_and_overlapping(self):
        info = {
            "a": _info("a", 4, 4),
            "b": _info("b", 4, 4),
            "c": _info("c", 4, 4),
        }
        placements = {
            "a": Placement(x=10.0, y=10.0, side="F"),
            "b": Placement(x=11.0, y=10.0, side="F"),  # overlaps a
            "c": Placement(x=19.0, y=10.0, side="F"),  # out of bounds
        }
        ok, oob, overlaps = validate_placement(20, 20, {}, placements, info,
                                                clearance=0.0)
        assert not ok
        assert "c" in oob
        assert "b" in overlaps

    def test_empty_placement_is_valid(self):
        ok, oob, overlaps = validate_placement(20, 20, {}, {}, {})
        assert ok
        assert oob == []
        assert overlaps == []

    def test_large_fixed_component_blocks_free(self):
        """A large fixed header should block nearby free components."""
        fixed = {"header": Placement(x=15.0, y=15.0, side="F")}
        info = {
            "header": _info("header", 10, 20, is_tht=True),  # big header
            "smd": _info("smd", 3, 2),
        }
        # smd at x=18 with width 3 → edges [16.5, 19.5]
        # header edges [10, 20] → overlap
        placements = {"smd": Placement(x=18.0, y=15.0, side="F")}
        ok, _, overlaps = validate_placement(30, 30, fixed, placements, info,
                                              clearance=0.0)
        assert not ok
        assert "smd" in overlaps


class TestBboxOffset:
    """Tests for components where footprint origin != bbox center.

    SIP-9 resistor networks and shrouded headers have their origin at pin 1,
    not the geometric center. The cx_offset/cy_offset fields in ComponentInfo
    represent this difference. validate_placement must account for it.
    """

    def test_sip9_overlap_detected_with_offset(self):
        """SIP-9 (origin at pin 1, body extends down) overlaps a button below.

        SIP-9 at origin (57, 55) with cy_offset=10.16 → bbox center at (57, 65.16)
        → body spans Y 54.16 to 76.16.
        Button at (58, 74) with 9mm height → body spans Y 69.5 to 78.5.
        These overlap in Y and are close in X.
        """
        fixed = {"button": Placement(x=58.0, y=74.0, side="F")}
        info = {
            "button": _info("button", 9, 9, is_tht=True),  # symmetric, offset=0
            "sip9": _info("sip9", 1.7, 22.0, is_tht=True,
                          cx_offset=0.0, cy_offset=10.16),
        }
        placements = {"sip9": Placement(x=57.0, y=55.0, side="F")}
        ok, _, overlaps = validate_placement(200, 200, fixed, placements, info,
                                              clearance=0.0)
        assert not ok
        assert "sip9" in overlaps

    def test_sip9_no_overlap_when_far(self):
        """SIP-9 far from any other component doesn't overlap."""
        fixed = {"button": Placement(x=58.0, y=74.0, side="F")}
        info = {
            "button": _info("button", 9, 9, is_tht=True),
            "sip9": _info("sip9", 1.7, 22.0, is_tht=True,
                          cx_offset=0.0, cy_offset=10.16),
        }
        # Place SIP-9 far above the button
        placements = {"sip9": Placement(x=57.0, y=20.0, side="F")}
        ok, _, overlaps = validate_placement(200, 200, fixed, placements, info,
                                              clearance=0.0)
        assert ok
        assert overlaps == []

    def test_sip9_without_offset_would_miss_overlap(self):
        """Verify that without offset, the same positions appear collision-free.

        This proves the offset is necessary — not just a cosmetic change.
        """
        fixed = {"button": Placement(x=58.0, y=74.0, side="F")}
        info_no_offset = {
            "button": _info("button", 9, 9, is_tht=True),
            "sip9": _info("sip9", 1.7, 22.0, is_tht=True,
                          cx_offset=0.0, cy_offset=0.0),  # NO offset
        }
        placements = {"sip9": Placement(x=57.0, y=55.0, side="F")}
        # Without offset, body center is at Y=55, spans 44..66 — misses button at 69.5..78.5
        ok, _, overlaps = validate_placement(200, 200, fixed, placements,
                                              info_no_offset, clearance=0.0)
        assert ok  # False negative — the bug this fix addresses

    def test_header_with_x_offset(self):
        """Shrouded header with X offset — body extends to the right of pin 1."""
        fixed = {}
        info = {
            "hdr": _info("hdr", 12, 8, is_tht=True,
                         cx_offset=5.0, cy_offset=0.0),
            "cap": _info("cap", 3, 2),
        }
        # Header at origin (10, 25). cx_offset=5 → bbox center at (15, 25)
        # → body spans X: 15-6=9 to 15+6=21.
        # Cap at (20, 25) with width 3 → X: 18.5 to 21.5 → overlap!
        fixed = {"hdr": Placement(x=10.0, y=25.0, side="F")}
        placements = {"cap": Placement(x=20.0, y=25.0, side="F")}
        ok, _, overlaps = validate_placement(50, 50, fixed, placements, info,
                                              clearance=0.0)
        assert not ok
        assert "cap" in overlaps

    def test_offset_affects_bounds_check(self):
        """Component near board edge with offset should be out of bounds."""
        info = {
            "sip9": _info("sip9", 1.7, 22.0, is_tht=True,
                          cx_offset=0.0, cy_offset=10.0),
        }
        # Origin at (5, 85) on 100mm board. cy_offset=10 → bbox center at (5, 95)
        # → body bottom at 95+11=106 — past board edge!
        placements = {"sip9": Placement(x=5.0, y=85.0, side="F")}
        ok, oob, _ = validate_placement(100, 100, {}, placements, info)
        assert not ok
        assert "sip9" in oob


class TestAntiAffinity:
    def test_no_violation_when_far(self):
        rules = [AntiAffinityRule("reg", "dac", min_mm=20)]
        placements = {
            "reg": Placement(x=10.0, y=10.0, side="F"),
            "dac": Placement(x=80.0, y=10.0, side="F"),
        }
        violations = check_anti_affinity(placements, {}, rules)
        assert violations == []

    def test_violation_when_close(self):
        rules = [AntiAffinityRule("reg", "dac", min_mm=20)]
        placements = {
            "reg": Placement(x=10.0, y=10.0, side="F"),
            "dac": Placement(x=20.0, y=10.0, side="F"),  # 10mm apart
        }
        violations = check_anti_affinity(placements, {}, rules)
        assert len(violations) == 1
        assert violations[0][2] == 10.0  # distance
        assert violations[0][3] == 20  # min_mm

    def test_prefix_matching(self):
        rules = [AntiAffinityRule("power.", "dacs.", min_mm=15)]
        placements = {
            "power.reg_5v": Placement(x=10.0, y=10.0, side="F"),
            "dacs.dac_a": Placement(x=20.0, y=10.0, side="F"),
        }
        violations = check_anti_affinity(placements, {}, rules)
        assert len(violations) == 1

    def test_prefix_no_match(self):
        rules = [AntiAffinityRule("power.", "dacs.", min_mm=15)]
        placements = {
            "mcu.pga": Placement(x=10.0, y=10.0, side="F"),
            "dacs.dac_a": Placement(x=20.0, y=10.0, side="F"),
        }
        violations = check_anti_affinity(placements, {}, rules)
        assert violations == []

    def test_fixed_vs_free(self):
        rules = [AntiAffinityRule("reg", "dac", min_mm=20)]
        fixed = {"reg": Placement(x=10.0, y=10.0, side="F")}
        placements = {"dac": Placement(x=20.0, y=10.0, side="F")}
        violations = check_anti_affinity(placements, fixed, rules)
        assert len(violations) == 1

    def test_bidirectional_matching(self):
        """Rule matches regardless of which component is 'from' or 'to'."""
        rules = [AntiAffinityRule("dac", "reg", min_mm=20)]
        placements = {
            "reg": Placement(x=10.0, y=10.0, side="F"),
            "dac": Placement(x=20.0, y=10.0, side="F"),
        }
        violations = check_anti_affinity(placements, {}, rules)
        assert len(violations) == 1

    def test_exactly_at_min_distance(self):
        rules = [AntiAffinityRule("reg", "dac", min_mm=20)]
        placements = {
            "reg": Placement(x=10.0, y=10.0, side="F"),
            "dac": Placement(x=30.0, y=10.0, side="F"),  # exactly 20mm
        }
        violations = check_anti_affinity(placements, {}, rules)
        assert violations == []

    def test_multiple_rules(self):
        rules = [
            AntiAffinityRule("power.reg_5v", "dacs.", min_mm=20),
            AntiAffinityRule("power.reg_3v3", "dacs.", min_mm=15),
        ]
        placements = {
            "power.reg_5v": Placement(x=10.0, y=10.0, side="F"),
            "power.reg_3v3": Placement(x=50.0, y=10.0, side="F"),
            "dacs.dac_a": Placement(x=15.0, y=10.0, side="F"),  # too close to reg_5v
        }
        violations = check_anti_affinity(placements, {}, rules)
        assert len(violations) == 1  # only reg_5v violation, reg_3v3 is 35mm away
