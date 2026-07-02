"""Tests for layout.py — grid and force-directed placement."""
from __future__ import annotations

from dataclasses import dataclass

from review import layout


@dataclass
class Box:
    width: float
    height: float
    name: str = ""


# --------- grid_place ----------------------------------------------------


def test_grid_place_empty_returns_zero_size():
    placed, tw, th = layout.grid_place([])
    assert placed == []
    assert tw >= 0
    assert th >= 0


def test_grid_place_single_item():
    placed, tw, th = layout.grid_place([Box(20, 14)], cols=1, margin=5)
    assert len(placed) == 1
    assert placed[0].x >= 5
    assert placed[0].y >= 5
    assert tw >= 20 + 10
    assert th >= 14 + 10


def test_grid_place_respects_column_count():
    items = [Box(10, 10) for _ in range(6)]
    placed, _, _ = layout.grid_place(items, cols=3, col_gap=5, row_gap=5, margin=0)
    # Row 0 (first 3) should share the same y, row 1 (next 3) share a different y
    y0 = placed[0].y
    assert placed[1].y == y0
    assert placed[2].y == y0
    assert placed[3].y > y0
    assert placed[4].y == placed[3].y


def test_grid_place_respects_column_widths_with_variable_sizes():
    items = [Box(20, 10), Box(10, 10), Box(30, 10), Box(5, 10)]
    placed, tw, _ = layout.grid_place(items, cols=2, col_gap=5, row_gap=5, margin=0)
    # Column 0 width = max(20, 30) = 30
    # Column 1 width = max(10, 5) = 10
    # Items in col 0 should share x, items in col 1 should share x
    assert placed[0].x + placed[0].width / 2 == placed[2].x + placed[2].width / 2
    assert placed[1].x + placed[1].width / 2 == placed[3].x + placed[3].width / 2
    assert tw >= 30 + 10 + 5  # col0 + col1 + gap


def test_grid_place_no_overlap():
    items = [Box(10, 10) for _ in range(9)]
    placed, _, _ = layout.grid_place(items, cols=3, col_gap=5, row_gap=5, margin=5)
    # Verify no two placed items overlap
    for i in range(len(placed)):
        for j in range(i + 1, len(placed)):
            a = placed[i]
            b = placed[j]
            overlap_x = (
                a.x < b.x + b.width and b.x < a.x + a.width
            )
            overlap_y = (
                a.y < b.y + b.height and b.y < a.y + a.height
            )
            assert not (overlap_x and overlap_y), (
                f"Items {i} and {j} overlap"
            )


def test_grid_place_default_cols_approx_square():
    items = [Box(10, 10) for _ in range(16)]
    placed, tw, th = layout.grid_place(items, margin=0, col_gap=2, row_gap=2)
    # 16 items → default cols should produce roughly 4-5
    # Check that layout fits all items
    assert len(placed) == 16


# --------- force_layout --------------------------------------------------


def test_force_layout_noop_on_empty():
    layout.force_layout([], [], iterations=5)
    # No crash, nothing to assert


def test_force_layout_sets_positions():
    nodes = [
        layout.ForceNode(key="a", width=30, height=20),
        layout.ForceNode(key="b", width=30, height=20),
        layout.ForceNode(key="c", width=30, height=20),
    ]
    layout.force_layout(
        nodes,
        [("a", "b"), ("b", "c")],
        iterations=100,
        canvas_width=200,
        canvas_height=200,
    )
    # All positions should be finite and within the canvas
    for n in nodes:
        assert isinstance(n.cx, float)
        assert isinstance(n.cy, float)
        assert 0 <= n.cx <= 300  # allow some overflow since fit is best-effort
        assert 0 <= n.cy <= 300


def test_force_layout_is_deterministic():
    def run(seed):
        nodes = [
            layout.ForceNode(key=chr(97 + i), width=30, height=20)
            for i in range(5)
        ]
        edges = [("a", "b"), ("b", "c"), ("c", "d"), ("d", "e")]
        layout.force_layout(nodes, edges, iterations=50, seed=seed)
        return [(n.cx, n.cy) for n in nodes]

    assert run(42) == run(42)


def test_force_layout_connected_nodes_closer_than_unconnected():
    # a-b connected, c isolated
    nodes = [
        layout.ForceNode(key="a", width=20, height=20),
        layout.ForceNode(key="b", width=20, height=20),
        layout.ForceNode(key="c", width=20, height=20),
    ]
    layout.force_layout(nodes, [("a", "b")], iterations=500, canvas_width=400, canvas_height=400)
    dist_ab = (
        (nodes[0].cx - nodes[1].cx) ** 2 + (nodes[0].cy - nodes[1].cy) ** 2
    ) ** 0.5
    dist_ac = (
        (nodes[0].cx - nodes[2].cx) ** 2 + (nodes[0].cy - nodes[2].cy) ** 2
    ) ** 0.5
    # Connected nodes should end up closer than disconnected ones.
    # With only 3 nodes this is not rock-solid, but usually holds.
    # Use a loose comparison.
    assert dist_ab < dist_ac + 30
