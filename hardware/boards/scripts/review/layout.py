"""Layout helpers (pure Python, no external deps).

Two algorithms:
  - grid_place: deterministic row/column placement — used for both the
    per-subcircuit page layouts and the top-level board overview.
  - force_layout: Fruchterman-Reingold force-directed layout. Not
    currently called from production code (the overview moved to grid
    placement for predictable non-overlapping output) but kept here as
    a utility in case a future layout needs it.

Both take items with `width` and `height` fields and return positions as
(cx, cy) or (x, y) depending on helper.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import Any, Generic, TypeVar


# --------------------------------------------------------------------------
# Grid placement
# --------------------------------------------------------------------------

T = TypeVar("T")


@dataclass
class PlacedItem(Generic[T]):
    item: T
    x: float       # top-left of the item's bounding box
    y: float
    width: float
    height: float


def grid_place(
    items: list[Any],
    width_attr: str = "width",
    height_attr: str = "height",
    cols: int | None = None,
    col_gap: float = 14.0,
    row_gap: float = 24.0,
    margin: float = 10.0,
) -> tuple[list[PlacedItem], float, float]:
    """Place items in a grid from left-to-right, top-to-bottom.

    Args:
        items: list of objects with `width` and `height` attributes.
        cols: fixed number of columns. If None, auto-pick based on item count.
        col_gap: horizontal space between columns (added to the max item width).
        row_gap: vertical space between rows (added to the max item height).
        margin: outer margin around the whole grid.

    Returns:
        (placed, total_width, total_height)
    """
    n = len(items)
    if n == 0:
        return [], 2 * margin, 2 * margin

    if cols is None:
        # Aim for a roughly 4:3 aspect ratio
        cols = max(1, int(math.ceil(math.sqrt(n) * 1.15)))
    cols = min(cols, n)
    rows = math.ceil(n / cols)

    # Compute column widths and row heights based on items going into each cell
    col_widths = [0.0] * cols
    row_heights = [0.0] * rows
    for idx, it in enumerate(items):
        r, c = divmod(idx, cols)
        w = getattr(it, width_attr)
        h = getattr(it, height_attr)
        if w > col_widths[c]:
            col_widths[c] = w
        if h > row_heights[r]:
            row_heights[r] = h

    # x positions for each column (left edge of cell)
    col_x = [margin]
    for c in range(1, cols):
        col_x.append(col_x[-1] + col_widths[c - 1] + col_gap)
    total_width = col_x[-1] + col_widths[-1] + margin

    # y positions for each row (top edge of cell)
    row_y = [margin]
    for r in range(1, rows):
        row_y.append(row_y[-1] + row_heights[r - 1] + row_gap)
    total_height = row_y[-1] + row_heights[-1] + margin

    placed = []
    for idx, it in enumerate(items):
        r, c = divmod(idx, cols)
        w = getattr(it, width_attr)
        h = getattr(it, height_attr)
        # Center the item within its cell column (but anchor to top so
        # refdes labels above the item line up)
        x = col_x[c] + (col_widths[c] - w) / 2
        y = row_y[r]
        placed.append(PlacedItem(item=it, x=x, y=y, width=w, height=h))

    return placed, total_width, total_height


# --------------------------------------------------------------------------
# Force-directed layout (for the board overview)
# --------------------------------------------------------------------------

@dataclass
class ForceNode:
    key: str
    width: float
    height: float
    cx: float = 0.0
    cy: float = 0.0
    # Velocity components (not exposed in return value)
    _vx: float = 0.0
    _vy: float = 0.0


def force_layout(
    nodes: list[ForceNode],
    edges: list[tuple[str, str]],
    *,
    iterations: int = 300,
    canvas_width: float = 400.0,
    canvas_height: float = 300.0,
    k_repel: float = 3500.0,
    k_attract: float = 0.05,
    damping: float = 0.85,
    seed: int = 1,
) -> None:
    """Fruchterman-Reingold style force-directed layout.

    Mutates `nodes` in place, setting each node's cx, cy to the final
    position. Nodes that share an edge attract; all pairs repel.
    A simple damping applied each step to make the system converge.

    Deterministic given the same seed.
    """
    n = len(nodes)
    if n == 0:
        return

    rnd = random.Random(seed)
    # Initialize positions on a circle so we don't start stacked
    for i, node in enumerate(nodes):
        angle = 2 * math.pi * i / n
        r = min(canvas_width, canvas_height) * 0.35
        node.cx = canvas_width / 2 + r * math.cos(angle) + rnd.uniform(-5, 5)
        node.cy = canvas_height / 2 + r * math.sin(angle) + rnd.uniform(-5, 5)
        node._vx = 0.0
        node._vy = 0.0

    key_to_idx = {node.key: i for i, node in enumerate(nodes)}
    edge_idx = []
    for a, b in edges:
        if a in key_to_idx and b in key_to_idx:
            edge_idx.append((key_to_idx[a], key_to_idx[b]))

    for _ in range(iterations):
        # Repulsive forces
        fx = [0.0] * n
        fy = [0.0] * n
        for i in range(n):
            for j in range(i + 1, n):
                dx = nodes[i].cx - nodes[j].cx
                dy = nodes[i].cy - nodes[j].cy
                dist2 = dx * dx + dy * dy + 0.01
                dist = math.sqrt(dist2)
                # Account for node sizes: repel harder if bounding boxes overlap
                min_dist = (
                    (nodes[i].width + nodes[j].width) * 0.5
                    + (nodes[i].height + nodes[j].height) * 0.5
                ) * 0.5 + 20.0
                f = k_repel / dist2
                if dist < min_dist:
                    f += (min_dist - dist) * 2.0
                fx[i] += f * dx / dist
                fy[i] += f * dy / dist
                fx[j] -= f * dx / dist
                fy[j] -= f * dy / dist

        # Attractive forces (edges)
        for i, j in edge_idx:
            dx = nodes[i].cx - nodes[j].cx
            dy = nodes[i].cy - nodes[j].cy
            dist = math.sqrt(dx * dx + dy * dy + 0.01)
            f = k_attract * dist
            fx[i] -= f * dx / dist
            fy[i] -= f * dy / dist
            fx[j] += f * dx / dist
            fy[j] += f * dy / dist

        # Integrate
        for i, node in enumerate(nodes):
            node._vx = (node._vx + fx[i]) * damping
            node._vy = (node._vy + fy[i]) * damping
            # Cap velocity to prevent runaway
            speed = math.sqrt(node._vx * node._vx + node._vy * node._vy)
            max_speed = 15.0
            if speed > max_speed:
                node._vx = node._vx * max_speed / speed
                node._vy = node._vy * max_speed / speed
            node.cx += node._vx
            node.cy += node._vy

    # After iterations, translate to fit inside canvas with margin
    _fit_to_canvas(nodes, canvas_width, canvas_height, margin=30.0)


def _fit_to_canvas(
    nodes: list[ForceNode],
    canvas_width: float,
    canvas_height: float,
    margin: float = 20.0,
) -> None:
    """Translate nodes so their bounding box fits inside the canvas."""
    if not nodes:
        return
    min_x = min(n.cx - n.width / 2 for n in nodes)
    max_x = max(n.cx + n.width / 2 for n in nodes)
    min_y = min(n.cy - n.height / 2 for n in nodes)
    max_y = max(n.cy + n.height / 2 for n in nodes)

    # Compute the offset that puts the bbox at (margin, margin)
    dx = margin - min_x
    dy = margin - min_y

    # Also scale down if bbox overflows canvas
    bbox_w = max_x - min_x
    bbox_h = max_y - min_y
    scale = 1.0
    avail_w = canvas_width - 2 * margin
    avail_h = canvas_height - 2 * margin
    if bbox_w > avail_w or bbox_h > avail_h:
        scale = min(avail_w / bbox_w, avail_h / bbox_h)

    for node in nodes:
        node.cx = (node.cx + dx) * scale + (1 - scale) * margin
        node.cy = (node.cy + dy) * scale + (1 - scale) * margin
