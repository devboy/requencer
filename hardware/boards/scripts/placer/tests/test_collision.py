"""Tests for placer collision detection."""

import pytest
from placer.dtypes import BlockedZone, Side, ZoneSide
from placer.collision import CollisionGrid, find_best_side, _sides_conflict


class TestSidesConflict:
    def test_same_side(self):
        assert _sides_conflict("front", "front")
        assert _sides_conflict("back", "back")

    def test_different_sides(self):
        assert not _sides_conflict("front", "back")

    def test_both_always_conflicts(self):
        assert _sides_conflict("both", "front")
        assert _sides_conflict("both", "back")
        assert _sides_conflict("front", "both")


class TestCollisionGrid:
    def test_no_collision_empty(self):
        grid = CollisionGrid(100, 50)
        assert not grid.collides(10, 10, 5, 5, Side.FRONT)

    def test_collision_same_side(self):
        grid = CollisionGrid(100, 50, clearance=0)
        grid.register(10, 10, 5, 5, Side.FRONT, False, "a")
        # Overlapping rect on same side
        assert grid.collides(12, 12, 5, 5, Side.FRONT)

    def test_no_collision_different_side(self):
        grid = CollisionGrid(100, 50, clearance=0)
        grid.register(10, 10, 5, 5, Side.FRONT, False, "a")
        # Same position but different side — no collision for SMD
        assert not grid.collides(10, 10, 5, 5, Side.BACK)

    def test_tht_collides_both_sides(self):
        grid = CollisionGrid(100, 50, clearance=0)
        grid.register(10, 10, 5, 5, Side.FRONT, True, "a")  # THT
        assert grid.collides(10, 10, 5, 5, Side.BACK)  # Should collide

    def test_clearance_margin(self):
        grid = CollisionGrid(100, 50, clearance=2.0)
        grid.register(10, 10, 4, 4, Side.FRONT, False, "a")
        # Body is 4x4 centered at (10,10) → edges at 8-12.
        # With clearance=2, registered rect is 6-14.
        # A 2x2 probe centered at 14.5 → edges at 13.5-15.5 → overlaps 14
        assert grid.collides(14.5, 10, 2, 2, Side.FRONT)
        # A probe well outside clearance shouldn't collide
        assert not grid.collides(20, 10, 2, 2, Side.FRONT)

    def test_in_bounds(self):
        grid = CollisionGrid(100, 50)
        assert grid.in_bounds(50, 25, 10, 10)
        assert not grid.in_bounds(0, 25, 10, 10)  # extends past left edge
        assert not grid.in_bounds(50, 0, 10, 10)  # extends past top edge

    def test_find_free_no_obstacles(self):
        grid = CollisionGrid(100, 50)
        result = grid.find_free(10, 10, 5, 5, Side.FRONT)
        assert result == (10, 10)

    def test_find_free_displaced(self):
        grid = CollisionGrid(100, 50, clearance=0)
        grid.register(10, 10, 6, 6, Side.FRONT, False, "a")
        result = grid.find_free(10, 10, 5, 5, Side.FRONT, step=1.0)
        assert result is not None
        x, y = result
        # Should be displaced from (10, 10)
        assert abs(x - 10) > 2 or abs(y - 10) > 2

    def test_unregister(self):
        grid = CollisionGrid(100, 50, clearance=0)
        grid.register(10, 10, 5, 5, Side.FRONT, False, "a")
        assert grid.collides(10, 10, 5, 5, Side.FRONT)
        grid.unregister("a")
        assert not grid.collides(10, 10, 5, 5, Side.FRONT)

    def test_overlap_report(self):
        grid = CollisionGrid(100, 50, clearance=0)
        grid.register(10, 10, 6, 6, Side.FRONT, False, "a")
        grid.register(12, 12, 6, 6, Side.FRONT, False, "b")
        overlaps = grid.overlap_report()
        assert len(overlaps) == 1
        assert overlaps[0][0] == "a"
        assert overlaps[0][1] == "b"

    def test_largest_free_rects(self):
        grid = CollisionGrid(50, 50)
        rects = grid.find_largest_free_rects(Side.FRONT, count=3)
        assert len(rects) > 0
        x, y, w, h = rects[0]
        assert w > 0 and h > 0

    def test_repulsion_offset(self):
        grid = CollisionGrid(100, 50)
        grid.register(10, 10, 5, 5, Side.FRONT, False, "a")
        dx, dy = grid.repulsion_offset(12, 12, radius=15)
        # Should push away from (10,10)
        assert dx > 0  # pushed right
        assert dy > 0  # pushed down

    def test_count(self):
        grid = CollisionGrid(100, 50)
        assert grid.count == 0
        grid.register(10, 10, 5, 5, Side.FRONT, False, "a")
        assert grid.count == 1


class TestCollisionGridZones:
    def test_zone_blocks_tagged_component(self):
        grid = CollisionGrid(100, 50)
        zone = BlockedZone(x=0, y=0, width=20, height=20,
                           excluded_tags=frozenset({"tht"}))
        grid.register_zone(zone)
        assert grid.collides_zone(10, 10, 5, 5, Side.FRONT, {"tht"})

    def test_zone_allows_untagged(self):
        grid = CollisionGrid(100, 50)
        zone = BlockedZone(x=0, y=0, width=20, height=20,
                           excluded_tags=frozenset({"tht"}))
        grid.register_zone(zone)
        assert not grid.collides_zone(10, 10, 5, 5, Side.FRONT, {"smd"})

    def test_zone_allows_exception(self):
        grid = CollisionGrid(100, 50)
        zone = BlockedZone(x=0, y=0, width=20, height=20,
                           excluded_tags=frozenset({"tht"}),
                           allowed_tags=frozenset({"connector"}))
        grid.register_zone(zone)
        assert not grid.collides_zone(10, 10, 5, 5, Side.FRONT,
                                      {"tht", "connector"})

    def test_zone_side_filtering(self):
        grid = CollisionGrid(100, 50)
        zone = BlockedZone(x=0, y=0, width=20, height=20,
                           side=ZoneSide.FRONT,
                           excluded_tags=frozenset({"tht"}))
        grid.register_zone(zone)
        assert grid.collides_zone(10, 10, 5, 5, Side.FRONT, {"tht"})
        assert not grid.collides_zone(10, 10, 5, 5, Side.BACK, {"tht"})


class TestFindBestSide:
    def test_prefers_closer_side(self):
        grid = CollisionGrid(100, 50, clearance=0)
        # Block front at target
        grid.register(10, 10, 8, 8, Side.FRONT, False, "blocker")
        result = find_best_side(grid, 10, 10, 4, 4, False, smd_side="both")
        assert result is not None
        _, _, side = result
        assert side == Side.BACK  # Back is free at target

    def test_tht_searches_both(self):
        grid = CollisionGrid(100, 50)
        result = find_best_side(grid, 25, 25, 4, 4, True)
        assert result is not None
        assert result[0] == 25 and result[1] == 25

    def test_returns_none_when_full(self):
        # Tiny board, large component
        grid = CollisionGrid(5, 5, clearance=0)
        grid.register(2.5, 2.5, 5, 5, Side.FRONT, False, "full_f")
        grid.register(2.5, 2.5, 5, 5, Side.BACK, False, "full_b")
        result = find_best_side(grid, 2.5, 2.5, 6, 6, False)
        assert result is None
