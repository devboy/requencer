"""AABB collision detection with side-awareness and zone enforcement.

Internal module — strategies access this through PlacementContext.
"""

from __future__ import annotations

from .dtypes import BlockedZone, Component, Side, ZoneSide
from .geometry import rotated_dims, padded_rect, center_of_rect


class CollisionGrid:
    """Track placed component rectangles and detect collisions.

    Every placed component is registered as a rectangle on a side.
    THT components (tagged "tht") occupy BOTH sides.

    Collision rules:
      - SMD vs SMD: collide only if same side
      - THT vs anything: collide on both sides
      - Zone restrictions checked via tag matching
    """

    def __init__(self, board_w: float, board_h: float,
                 clearance: float = 0.5,
                 tht_extra_clearance: float = 0.0):
        self.board_w = board_w
        self.board_h = board_h
        self.clearance = clearance
        self.tht_extra_clearance = tht_extra_clearance
        # Each entry: (x1, y1, x2, y2, effective_side, label, margin)
        # effective_side is "front", "back", or "both"
        self._rects: list[tuple[float, float, float, float, str, str, float]] = []
        self._zones: list[BlockedZone] = []
        # label → index for unregister
        self._label_index: dict[str, int] = {}

    def register(self, cx: float, cy: float, w: float, h: float,
                 side: Side, is_tht: bool, label: str = "") -> None:
        """Register a placed component. cx/cy is center, w/h is full extent."""
        margin = self.clearance + (self.tht_extra_clearance if is_tht else 0.0)
        x1 = cx - w / 2 - margin
        y1 = cy - h / 2 - margin
        x2 = cx + w / 2 + margin
        y2 = cy + h / 2 + margin
        effective_side = "both" if is_tht else side.value
        idx = len(self._rects)
        self._rects.append((x1, y1, x2, y2, effective_side, label, margin))
        if label:
            self._label_index[label] = idx

    def register_zone(self, zone: BlockedZone) -> None:
        """Register a blocked zone as both a zone (for tag checks) and a
        collision rect (so find_free/collides never place inside it)."""
        self._zones.append(zone)
        # Also register as a collision rect so the ring search respects it.
        cx = zone.x + zone.width / 2
        cy = zone.y + zone.height / 2
        side_str = zone.side.value if zone.side != ZoneSide.BOTH else "both"
        side = Side.FRONT if side_str == "front" else Side.BACK if side_str == "back" else Side.FRONT
        effective_side = "both" if side_str == "both" else side_str
        self._rects.append((
            zone.x, zone.y,
            zone.x + zone.width, zone.y + zone.height,
            effective_side, f"__zone_{len(self._zones)}", 0.0,
        ))

    def unregister(self, label: str) -> None:
        """Mark a registered rect as removed (by label)."""
        idx = self._label_index.pop(label, None)
        if idx is not None:
            # Replace with a zero-area rect that never collides
            self._rects[idx] = (0, 0, 0, 0, "none", "", 0)

    def collides(self, cx: float, cy: float, w: float, h: float,
                 side: Side, is_tht: bool = False) -> bool:
        """Check if placing a component at center (cx, cy) would collide."""
        hx = w / 2
        hy = h / 2
        ax1, ay1 = cx - hx, cy - hy
        ax2, ay2 = cx + hx, cy + hy
        check_side = "both" if is_tht else side.value

        for bx1, by1, bx2, by2, bside, _, _m in self._rects:
            if not _sides_conflict(check_side, bside):
                continue
            if ax1 < bx2 and ax2 > bx1 and ay1 < by2 and ay2 > by1:
                return True
        return False

    def collides_zone(self, cx: float, cy: float, w: float, h: float,
                      side: Side, tags: set[str]) -> bool:
        """Check if component with given tags would violate any zone."""
        hx, hy = w / 2, h / 2
        ax1, ay1 = cx - hx, cy - hy
        ax2, ay2 = cx + hx, cy + hy

        for zone in self._zones:
            # Check side match
            zone_side = zone.side
            if zone_side == ZoneSide.FRONT and side != Side.FRONT:
                continue
            if zone_side == ZoneSide.BACK and side != Side.BACK:
                continue

            # Check spatial overlap
            zx2 = zone.x + zone.width
            zy2 = zone.y + zone.height
            if not (ax1 < zx2 and ax2 > zone.x and ay1 < zy2 and ay2 > zone.y):
                continue

            # Check tag-based restriction
            if not zone.excluded_tags or tags & zone.excluded_tags:
                if zone.allowed_tags and tags & zone.allowed_tags:
                    continue  # Exception: allowed
                if not zone.excluded_tags:
                    return True  # Zone blocks everything
                if tags & zone.excluded_tags:
                    return True

        return False

    def in_bounds(self, cx: float, cy: float, w: float, h: float) -> bool:
        """Check if a component body fits within board edges."""
        hx, hy = w / 2, h / 2
        return (cx - hx >= 0 and cy - hy >= 0 and
                cx + hx <= self.board_w and cy + hy <= self.board_h)

    def find_free(self, cx: float, cy: float, w: float, h: float,
                  side: Side, is_tht: bool = False,
                  bounds: tuple[float, float, float, float] | None = None,
                  step: float = 1.0) -> tuple[float, float] | None:
        """Find nearest collision-free position via expanding ring search.

        bounds: (x, y, w, h) constrains search area.
        Returns (cx, cy) center of free position, or None.
        """
        # Quick check: is the original position free?
        if (not self.collides(cx, cy, w, h, side, is_tht) and
                self.in_bounds(cx, cy, w, h)):
            return cx, cy

        max_radius = max(self.board_w, self.board_h)
        max_rings = int(max_radius / step) + 1

        def _ring_search(min_x, min_y, max_x, max_y):
            for ring in range(1, max_rings + 1):
                d = ring * step
                best = None
                best_dist = float('inf')
                for i in range(-ring, ring + 1):
                    candidates = [
                        (cx + d, cy + i * step),
                        (cx - d, cy + i * step),
                        (cx + i * step, cy + d),
                        (cx + i * step, cy - d),
                    ]
                    for tx, ty in candidates:
                        if tx < min_x or tx > max_x or ty < min_y or ty > max_y:
                            continue
                        if not self.collides(tx, ty, w, h, side, is_tht):
                            dist = abs(tx - cx) + abs(ty - cy)
                            if dist < best_dist:
                                best = (tx, ty)
                                best_dist = dist
                if best is not None:
                    return best
            return None

        # Search within bounds first
        if bounds:
            bx, by, bw, bh = bounds
            result = _ring_search(bx + w / 2, by + h / 2,
                                  bx + bw - w / 2, by + bh - h / 2)
            if result:
                return result

        # Fallback: entire board
        return _ring_search(w / 2, h / 2,
                            self.board_w - w / 2, self.board_h - h / 2)

    def find_largest_free_rects(self, side: Side, resolution: float = 2.0,
                                count: int = 5,
                                edge_margin: float = 5.0
                                ) -> list[tuple[float, float, float, float]]:
        """Find largest empty rectangles using histogram algorithm.

        Returns up to `count` non-overlapping rectangles as (x, y, w, h).
        """
        cols = int(self.board_w / resolution)
        rows = int(self.board_h / resolution)
        if cols <= 0 or rows <= 0:
            return []

        # Build occupancy grid
        grid = [[False] * cols for _ in range(rows)]
        for r in range(rows):
            for c in range(cols):
                x = (c + 0.5) * resolution
                y = (r + 0.5) * resolution
                if (x < edge_margin or x > self.board_w - edge_margin or
                        y < edge_margin or y > self.board_h - edge_margin):
                    grid[r][c] = True
                elif self.collides(x, y, resolution * 0.9, resolution * 0.9,
                                   side):
                    grid[r][c] = True

        results = []
        for _ in range(count):
            heights = [0] * cols
            best_area = 0
            best = None

            for r in range(rows):
                for c in range(cols):
                    heights[c] = 0 if grid[r][c] else heights[c] + 1

                stack: list[int] = []
                for c in range(cols + 1):
                    h = heights[c] if c < cols else 0
                    while stack and heights[stack[-1]] > h:
                        height = heights[stack.pop()]
                        width = c if not stack else c - stack[-1] - 1
                        area = height * width
                        if area > best_area:
                            best_area = area
                            x0 = (stack[-1] + 1 if stack else 0) * resolution
                            y0 = (r - height + 1) * resolution
                            best = (x0, y0, width * resolution,
                                    height * resolution)
                    stack.append(c)

            if not best or best_area < 4:
                break
            results.append(best)

            # Mark found rectangle as occupied
            rx, ry, rw, rh = best
            for r in range(rows):
                for c in range(cols):
                    x = (c + 0.5) * resolution
                    y = (r + 0.5) * resolution
                    if rx <= x <= rx + rw and ry <= y <= ry + rh:
                        grid[r][c] = True

        return results

    def repulsion_offset(self, cx: float, cy: float,
                         radius: float = 15.0, strength: float = 2.0,
                         max_offset: float = 8.0) -> tuple[float, float]:
        """Compute damped repulsion vector pushing away from crowding."""
        rx, ry = 0.0, 0.0
        for x1, y1, x2, y2, _side, _label, _m in self._rects:
            px = (x1 + x2) / 2
            py = (y1 + y2) / 2
            dx = cx - px
            dy = cy - py
            dist = (dx * dx + dy * dy) ** 0.5
            if 0 < dist < radius:
                force = strength * (1.0 - dist / radius)
                rx += (dx / dist) * force
                ry += (dy / dist) * force
        mag = (rx * rx + ry * ry) ** 0.5
        if mag > max_offset:
            rx = rx / mag * max_offset
            ry = ry / mag * max_offset
        return rx, ry

    def overlap_report(self) -> list[tuple[str, str, str, str, float]]:
        """Return all current overlaps between actual component bodies."""
        overlaps = []
        for i in range(len(self._rects)):
            ax1, ay1, ax2, ay2, aside, alabel, am = self._rects[i]
            if aside == "none":
                continue
            ax1, ay1, ax2, ay2 = ax1 + am, ay1 + am, ax2 - am, ay2 - am
            for j in range(i + 1, len(self._rects)):
                bx1, by1, bx2, by2, bside, blabel, bm = self._rects[j]
                if bside == "none":
                    continue
                if not _sides_conflict(aside, bside):
                    continue
                bx1, by1, bx2, by2 = bx1 + bm, by1 + bm, bx2 - bm, by2 - bm
                dx = min(ax2, bx2) - max(ax1, bx1)
                dy = min(ay2, by2) - max(ay1, by1)
                if dx > 0 and dy > 0:
                    overlaps.append((alabel, blabel, aside, bside, dx * dy))
        return overlaps

    @property
    def count(self) -> int:
        return len(self._rects)


def _sides_conflict(side_a: str, side_b: str) -> bool:
    """Return True if two items on these sides can physically collide."""
    if side_a == "both" or side_b == "both":
        return True
    return side_a == side_b


def find_best_side(grid: CollisionGrid, cx: float, cy: float,
                   w: float, h: float, is_tht: bool,
                   step: float = 0.5,
                   smd_side: str = "both") -> tuple[float, float, Side] | None:
    """Try allowed sides, return (cx, cy, side) or None."""
    if is_tht:
        try_f = True
        try_b = True
    else:
        try_f = smd_side in ("both", "front")
        try_b = smd_side in ("both", "back")

    result_f = grid.find_free(cx, cy, w, h, Side.FRONT, is_tht,
                              step=step) if try_f else None
    result_b = grid.find_free(cx, cy, w, h, Side.BACK, is_tht,
                              step=step) if try_b else None

    if result_f is None and result_b is None:
        return None
    if result_f is None:
        return (*result_b, Side.BACK)  # type: ignore
    if result_b is None:
        return (*result_f, Side.FRONT)  # type: ignore

    fx, fy = result_f
    bx, by = result_b
    dist_f = (fx - cx) ** 2 + (fy - cy) ** 2
    dist_b = (bx - cx) ** 2 + (by - cy) ** 2
    if dist_f <= dist_b:
        return fx, fy, Side.FRONT
    return bx, by, Side.BACK
