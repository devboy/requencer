"""Tests for CollisionTracker."""

from placement.helpers import CollisionTracker


class TestRegisterAndCollide:
    def test_no_collision_when_separated(self):
        t = CollisionTracker(100, 100, clearance=0.5)
        t.register(10, 10, 5, 5, "F", False, "a")
        assert not t.collides(30, 30, 5, 5, "F")

    def test_collision_same_side(self):
        t = CollisionTracker(100, 100, clearance=0.5)
        t.register(10, 10, 5, 5, "F", False, "a")
        assert t.collides(13, 10, 5, 5, "F")

    def test_no_collision_opposite_sides_smd(self):
        t = CollisionTracker(100, 100, clearance=0.5)
        t.register(10, 10, 5, 5, "F", False, "a")
        assert not t.collides(10, 10, 5, 5, "B")

    def test_tht_collides_both_sides(self):
        t = CollisionTracker(100, 100, clearance=0.5)
        t.register(10, 10, 5, 5, "F", True, "tht")  # THT = both
        assert t.collides(12, 10, 5, 5, "F")
        assert t.collides(12, 10, 5, 5, "B")

    def test_smd_vs_tht_collision(self):
        t = CollisionTracker(100, 100, clearance=0.5)
        t.register(10, 10, 5, 5, "B", False, "smd")
        # THT checking against existing SMD — "both" conflicts with "B"
        assert t.collides(12, 10, 5, 5, "F", is_tht=True)

    def test_clearance_respected(self):
        t = CollisionTracker(100, 100, clearance=2.0)
        t.register(10, 10, 4, 4, "F", False, "a")
        # Registered rect: (10-2-2, ...) to (10+2+2, ...) = (6, 8) to (14, 12)
        # Query at 17: body from 15 to 19 — no overlap with (6..14)
        assert not t.collides(17, 10, 4, 4, "F")
        # Query at 15: body from 13 to 17 — overlaps with (6..14)
        assert t.collides(15, 10, 4, 4, "F")
        # Query at 14.5: body from 12.5 to 16.5 — overlaps
        assert t.collides(14.5, 10, 4, 4, "F")

    def test_extra_padding(self):
        t = CollisionTracker(100, 100, clearance=0.5, extra_padding=2.0)
        t.register(10, 10, 4, 4, "F", False, "a")
        # Total clearance = 2.5mm. Registered rect: (5.5..14.5)
        # Query at 15: body 13..17 — overlaps with 5.5..14.5
        assert t.collides(15, 10, 4, 4, "F")
        # Query at 17: body 15..19 — no overlap
        assert not t.collides(17, 10, 4, 4, "F")

    def test_register_bbox(self):
        t = CollisionTracker(100, 100, clearance=0.5)
        t.register_bbox(5, 5, 15, 15, "F", False, "box")
        assert t.collides(10, 10, 2, 2, "F")
        assert not t.collides(25, 25, 2, 2, "F")

    def test_register_zone(self):
        t = CollisionTracker(100, 100, clearance=0.5)
        t.register_zone(0, 0, 20, 20, "both", "exclusion")
        assert t.collides(10, 10, 2, 2, "F")
        assert t.collides(10, 10, 2, 2, "B")


class TestInBounds:
    def test_in_bounds(self):
        t = CollisionTracker(50, 50, clearance=0.5)
        assert t.in_bounds(25, 25, 10, 10)

    def test_out_of_bounds_right(self):
        t = CollisionTracker(50, 50, clearance=0.5)
        assert not t.in_bounds(48, 25, 10, 10)

    def test_out_of_bounds_top(self):
        t = CollisionTracker(50, 50, clearance=0.5)
        assert not t.in_bounds(25, 2, 10, 10)


class TestFindFree:
    def test_returns_original_if_free(self):
        t = CollisionTracker(50, 50, clearance=0.5)
        x, y = t.find_free(25, 25, 5, 5, "F", False)
        assert (x, y) == (25, 25)

    def test_finds_nearby_free_spot(self):
        t = CollisionTracker(50, 50, clearance=0.5)
        t.register(25, 25, 10, 10, "F", False, "blocker")
        x, y = t.find_free(25, 25, 3, 3, "F", False, step=1.0)
        assert (x, y) != (25, 25)
        assert not t.collides(x, y, 3, 3, "F")

    def test_respects_zone_bounds(self):
        t = CollisionTracker(100, 100, clearance=0.5)
        t.register(10, 10, 5, 5, "F", False, "blocker")
        x, y = t.find_free(10, 10, 3, 3, "F", False,
                           zone_bounds=(0, 0, 30, 30), step=1.0)
        assert 0 <= x <= 30
        assert 0 <= y <= 30
        assert not t.collides(x, y, 3, 3, "F")

    def test_falls_back_to_board_when_zone_full(self):
        t = CollisionTracker(100, 100, clearance=0.5)
        # Fill a small zone
        t.register(5, 5, 10, 10, "F", False, "fill")
        x, y = t.find_free(5, 5, 3, 3, "F", False,
                           zone_bounds=(0, 0, 10, 10), step=1.0)
        assert not t.collides(x, y, 3, 3, "F")

    def test_returns_none_when_board_full(self):
        """When no valid position exists, find_free must return None."""
        t = CollisionTracker(10, 10, clearance=0.0)
        # Fill the entire board with one big component
        t.register(5, 5, 10, 10, "F", False, "fill")
        result = t.find_free(5, 5, 3, 3, "F", False, step=1.0)
        assert result is None


class TestFindBestSide:
    def test_picks_closer_side(self):
        from placement.helpers import find_best_side
        t = CollisionTracker(50, 50, clearance=0.5)
        # Block front at target, back should be available
        t.register(25, 25, 10, 10, "F", False, "blocker")
        result = find_best_side(t, 25, 25, 3, 3, False)
        assert result is not None
        x, y, side = result
        assert side == "B"  # front blocked, back available at exact spot

    def test_returns_none_when_both_full(self):
        from placement.helpers import find_best_side
        t = CollisionTracker(10, 10, clearance=0.0)
        t.register(5, 5, 10, 10, "F", True, "fill")  # THT blocks both sides
        result = find_best_side(t, 5, 5, 3, 3, False)
        assert result is None

    def test_returns_front_for_free_board(self):
        from placement.helpers import find_best_side
        t = CollisionTracker(50, 50, clearance=0.5)
        result = find_best_side(t, 25, 25, 3, 3, False)
        assert result is not None
        x, y, side = result
        assert (x, y) == (25, 25)
        assert side == "F"  # front preferred when equal


class TestRepulsion:
    def test_repulsion_pushes_away(self):
        t = CollisionTracker(100, 100, clearance=0.5)
        t.register(50, 50, 5, 5, "F", False, "center")
        rx, ry = t.repulsion_offset(52, 50, radius=15.0, strength=2.0)
        # Should push to the right (away from center)
        assert rx > 0

    def test_repulsion_zero_when_far(self):
        t = CollisionTracker(100, 100, clearance=0.5)
        t.register(10, 10, 5, 5, "F", False, "far")
        rx, ry = t.repulsion_offset(80, 80, radius=15.0, strength=2.0)
        assert rx == 0.0 and ry == 0.0


class TestOverlapReport:
    def test_no_overlaps(self):
        t = CollisionTracker(100, 100, clearance=0.5)
        t.register(10, 10, 5, 5, "F", False, "a")
        t.register(30, 30, 5, 5, "F", False, "b")
        assert t.overlap_report() == []

    def test_detects_overlap(self):
        t = CollisionTracker(100, 100, clearance=0.0)
        t.register(10, 10, 10, 10, "F", False, "a")
        t.register(15, 10, 10, 10, "F", False, "b")
        overlaps = t.overlap_report()
        assert len(overlaps) == 1
        assert overlaps[0][0] == "a"
        assert overlaps[0][1] == "b"

    def test_no_overlap_cross_side_smd(self):
        t = CollisionTracker(100, 100, clearance=0.0)
        t.register(10, 10, 10, 10, "F", False, "a")
        t.register(10, 10, 10, 10, "B", False, "b")
        assert t.overlap_report() == []


class TestFindLargestFreeRects:
    def test_finds_rects_on_empty_board(self):
        t = CollisionTracker(100, 100, clearance=0.5)
        rects = t.find_largest_free_rects("F", resolution=5.0, count=1,
                                           edge_margin=5.0)
        assert len(rects) == 1
        x, y, w, h = rects[0]
        assert w > 50  # should be most of the board
        assert h > 50

    def test_finds_rects_around_obstacle(self):
        t = CollisionTracker(100, 100, clearance=0.5)
        t.register(50, 50, 40, 40, "F", False, "obstacle")
        rects = t.find_largest_free_rects("F", resolution=5.0, count=2,
                                           edge_margin=5.0)
        assert len(rects) >= 1
