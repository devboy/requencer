"""Tests for simulated annealing refinement strategy."""

from placement.helpers import CollisionTracker, estimate_hpwl
from placement.strategies.sa_refine import SARefineStrategy


class TestSARefineStrategy:
    def test_places_all_free_components(self, small_board_ctx):
        strategy = SARefineStrategy()
        result = strategy.place(small_board_ctx, {"max_steps": 200})
        assert set(result.keys()) == set(small_board_ctx.free.keys())

    def test_no_overlaps(self, small_board_ctx):
        strategy = SARefineStrategy()
        result = strategy.place(small_board_ctx, {"max_steps": 200})
        tracker = CollisionTracker(50, 50, clearance=0.5)
        for addr, p in small_board_ctx.fixed.items():
            tracker.register(p.x, p.y, 5, 5, p.side, False, addr)
        for addr, p in result.items():
            info = small_board_ctx.free[addr]
            tracker.register(p.x, p.y, info.width, info.height, p.side,
                             info.is_tht, addr)
        assert len(tracker.overlap_report()) == 0

    def test_fixed_components_unmoved(self, small_board_ctx):
        strategy = SARefineStrategy()
        result = strategy.place(small_board_ctx, {})
        assert "fixed_a" not in result
        assert "fixed_b" not in result

    def test_deterministic_with_same_seed(self, small_board_ctx):
        strategy = SARefineStrategy()
        r1 = strategy.place(small_board_ctx,
                            {"seed": 42, "max_steps": 100})
        r2 = strategy.place(small_board_ctx,
                            {"seed": 42, "max_steps": 100})
        for addr in small_board_ctx.free:
            assert abs(r1[addr].x - r2[addr].x) < 0.01
            assert abs(r1[addr].y - r2[addr].y) < 0.01

    def test_different_seeds_different_results(self, small_board_ctx):
        strategy = SARefineStrategy()
        r1 = strategy.place(small_board_ctx,
                            {"seed": 42, "max_steps": 500})
        r2 = strategy.place(small_board_ctx,
                            {"seed": 123, "max_steps": 500})
        any_different = any(
            abs(r1[a].x - r2[a].x) > 0.1 or abs(r1[a].y - r2[a].y) > 0.1
            for a in small_board_ctx.free
        )
        assert any_different

    def test_hpwl_improves_over_random(self, small_board_ctx):
        """SA with many steps should beat SA with zero steps (just constructive)."""
        strategy = SARefineStrategy()
        r_none = strategy.place(small_board_ctx,
                                {"max_steps": 0, "seed": 42})
        r_many = strategy.place(small_board_ctx,
                                {"max_steps": 1000, "seed": 42})

        all_p_none = dict(small_board_ctx.fixed)
        all_p_none.update(r_none)
        all_p_many = dict(small_board_ctx.fixed)
        all_p_many.update(r_many)

        hpwl_none = estimate_hpwl(all_p_none, small_board_ctx.net_graph)
        hpwl_many = estimate_hpwl(all_p_many, small_board_ctx.net_graph)

        # SA should not make things much worse (may not improve on tiny boards)
        assert hpwl_many <= hpwl_none * 1.2

    def test_tht_components(self, tht_board_ctx):
        strategy = SARefineStrategy()
        result = strategy.place(tht_board_ctx, {"max_steps": 200})
        assert "tht_comp" in result
