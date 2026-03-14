"""Shared helpers for placement strategies.

Pure geometry and graph algorithms — no pcbnew dependency.
Strategies and the orchestrator both use these.
"""

import re
import uuid as _uuid
from collections import Counter, defaultdict


# ---------------------------------------------------------------------------
# UUID deduplication (post-placement, text-level)
# ---------------------------------------------------------------------------

_UUID_RE = re.compile(
    r'\(uuid "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"\)'
)


def regenerate_duplicate_uuids(pcb_path):
    """Replace duplicate UUIDs in a saved KiCad PCB file with fresh unique ones.

    Atopile instantiates footprints from library .kicad_mod files that contain
    hardcoded pad UUIDs.  When the same footprint is used multiple times, all
    instances share identical pad UUIDs, which breaks KiCad DRC and FreeRouting
    net assignment.

    Returns the number of UUIDs replaced.
    """
    with open(pcb_path, "r") as f:
        text = f.read()

    all_uuids = _UUID_RE.findall(text)
    counts = Counter(all_uuids)
    duplicated = {u for u, c in counts.items() if c > 1}

    if not duplicated:
        return 0

    n_replaced = 0

    def _replace(match):
        nonlocal n_replaced
        old = match.group(1)
        if old in duplicated:
            n_replaced += 1
            return f'(uuid "{_uuid.uuid4()}")'
        return match.group(0)

    text = _UUID_RE.sub(_replace, text)

    with open(pcb_path, "w") as f:
        f.write(text)

    return n_replaced


# ---------------------------------------------------------------------------
# CollisionTracker — AABB collision detection, expanding ring search
# ---------------------------------------------------------------------------


class CollisionTracker:
    """Track placed component footprints and detect collisions.

    Every placed component is registered as a rectangle on a side (F/B).
    THT components occupy BOTH sides (pins penetrate the board).

    Collision rules:
      - SMD vs SMD: collide only if same side
      - THT vs anything: collide on both sides
      - All checks use actual footprint bounding boxes + clearance margin
    """

    def __init__(self, board_w, board_h, clearance=0.5, extra_padding=0.0,
                 tht_extra_clearance=0.0):
        self.board_w = board_w
        self.board_h = board_h
        self.clearance = clearance + extra_padding
        self.tht_extra_clearance = tht_extra_clearance
        # Each entry: (x1, y1, x2, y2, side, label, margin)
        # side is "F", "B", or "both" (for THT)
        # margin is the clearance used when registering (for overlap_report shrinkback)
        self._rects = []

    def register(self, cx, cy, w, h, side, is_tht, label=""):
        """Register a placed component. cx/cy is center, w/h is full extent."""
        margin = self.clearance + (self.tht_extra_clearance if is_tht else 0.0)
        x1 = cx - w / 2 - margin
        y1 = cy - h / 2 - margin
        x2 = cx + w / 2 + margin
        y2 = cy + h / 2 + margin
        effective_side = "both" if is_tht else side
        self._rects.append((x1, y1, x2, y2, effective_side, label, margin))

    def register_bbox(self, x1, y1, x2, y2, side, is_tht, label=""):
        """Register using actual bounding box coords (not center+dims)."""
        margin = self.clearance + (self.tht_extra_clearance if is_tht else 0.0)
        effective_side = "both" if is_tht else side
        self._rects.append((
            x1 - margin, y1 - margin, x2 + margin, y2 + margin,
            effective_side, label, margin,
        ))

    def register_zone(self, x1, y1, x2, y2, side, label="zone"):
        """Register a static exclusion zone (e.g. LCD area)."""
        self._rects.append((x1, y1, x2, y2, side, label, 0.0))

    def collides(self, cx, cy, w, h, side, is_tht=False):
        """Check if placing a component at (cx, cy) would collide."""
        hx = w / 2
        hy = h / 2
        ax1, ay1 = cx - hx, cy - hy
        ax2, ay2 = cx + hx, cy + hy
        check_side = "both" if is_tht else side

        for bx1, by1, bx2, by2, bside, _, _m in self._rects:
            if not self._sides_conflict(check_side, bside):
                continue
            if ax1 < bx2 and ax2 > bx1 and ay1 < by2 and ay2 > by1:
                return True
        return False

    def in_bounds(self, cx, cy, w, h):
        """Check if a component body fits within board edges."""
        hx, hy = w / 2, h / 2
        return (cx - hx >= 0 and cy - hy >= 0 and
                cx + hx <= self.board_w and cy + hy <= self.board_h)

    def find_free(self, cx, cy, w, h, side, is_tht, zone_bounds=None, step=1.0):
        """Find the nearest collision-free position starting from (cx, cy).

        Uses expanding ring search: tries positions at increasing distance.
        zone_bounds: (zx, zy, zw, zh) constrains the search area.
        If no free spot exists in zone, falls back to searching entire board.
        Returns (x, y) of first free position, or (cx, cy) if nothing found.
        """
        def _ring_search(min_x, min_y, max_x, max_y, max_rings):
            best = None
            best_dist = float('inf')
            for ring in range(1, max_rings + 1):
                d = ring * step
                candidates = []
                steps_per_side = ring
                for i in range(-steps_per_side, steps_per_side + 1):
                    candidates.append((cx + d, cy + i * step))
                    candidates.append((cx - d, cy + i * step))
                    candidates.append((cx + i * step, cy + d))
                    candidates.append((cx + i * step, cy - d))

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

        # Quick check: is the original position free?
        if (not self.collides(cx, cy, w, h, side, is_tht) and
                self.in_bounds(cx, cy, w, h)):
            return cx, cy

        max_radius = max(self.board_w, self.board_h)
        max_rings = int(max_radius / step) + 1

        # Search within zone bounds first
        if zone_bounds:
            zx, zy, zw, zh = zone_bounds
            min_x, min_y = zx + w / 2, zy + h / 2
            max_x, max_y = zx + zw - w / 2, zy + zh - h / 2
            result = _ring_search(min_x, min_y, max_x, max_y, max_rings)
            if result:
                return result

        # Fallback: search entire board
        min_x, min_y = w / 2, h / 2
        max_x = self.board_w - w / 2
        max_y = self.board_h - h / 2
        result = _ring_search(min_x, min_y, max_x, max_y, max_rings)
        if result:
            return result

        # No valid position found
        return None

    def find_largest_free_rects(self, side, resolution=2.0, count=5,
                                edge_margin=5.0):
        """Find the largest empty rectangles on the given side.

        Scans the board on a grid, builds a height map, and uses the
        'largest rectangle in histogram' algorithm to find maximal empty rects.
        edge_margin keeps components away from board edges for routing access.
        Returns up to `count` non-overlapping rectangles as (x, y, w, h) tuples.
        """
        cols = int(self.board_w / resolution)
        rows = int(self.board_h / resolution)

        # Build occupancy grid — True means blocked
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

                stack = []
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

            rx, ry, rw, rh = best
            for r in range(rows):
                for c in range(cols):
                    x = (c + 0.5) * resolution
                    y = (r + 0.5) * resolution
                    if rx <= x <= rx + rw and ry <= y <= ry + rh:
                        grid[r][c] = True

        return results

    @staticmethod
    def _sides_conflict(side_a, side_b):
        """Return True if two items on these sides can physically collide."""
        if side_a == "both" or side_b == "both":
            return True
        return side_a == side_b

    @property
    def count(self):
        return len(self._rects)

    def register_label(self, fp, pcbnew, side):
        """Register reference designator text as a collision rect with small clearance."""
        bbox = get_ref_text_bbox(fp, pcbnew)
        if bbox is None:
            return
        x1, y1, x2, y2 = bbox
        label_clearance = 0.3
        self._rects.append((
            x1 - label_clearance, y1 - label_clearance,
            x2 + label_clearance, y2 + label_clearance,
            side, f"label:{fp.GetReference()}", label_clearance,
        ))

    def repulsion_offset(self, cx, cy, radius=15.0, strength=2.0,
                         max_offset=8.0):
        """Compute a damped repulsion vector pushing (cx, cy) away from crowding.

        For each registered rect within `radius` mm, adds a linear repulsion
        force (stronger when closer, zero at radius edge). The total offset
        is capped at `max_offset` mm to prevent components from flying to
        board edges.
        """
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

    def overlap_report(self):
        """Return list of all current overlaps between actual component bodies.

        Registered rects include clearance margins. Shrink by clearance before
        comparing to report real physical overlaps.
        """
        overlaps = []
        for i in range(len(self._rects)):
            ax1, ay1, ax2, ay2, aside, alabel, am = self._rects[i]
            ax1, ay1, ax2, ay2 = ax1 + am, ay1 + am, ax2 - am, ay2 - am
            for j in range(i + 1, len(self._rects)):
                bx1, by1, bx2, by2, bside, blabel, bm = self._rects[j]
                if not self._sides_conflict(aside, bside):
                    continue
                bx1, by1, bx2, by2 = bx1 + bm, by1 + bm, bx2 - bm, by2 - bm
                dx = min(ax2, bx2) - max(ax1, bx1)
                dy = min(ay2, by2) - max(ay1, by1)
                if dx > 0 and dy > 0:
                    overlaps.append((alabel, blabel, aside, bside, dx * dy))
        return overlaps


def find_best_side(tracker, cx, cy, w, h, is_tht, step=0.5, smd_side="both"):
    """Try allowed sides, return (x, y, side) or None if none works.

    Args:
        smd_side: "F", "B", or "both" — restricts which side(s) to search.
    """
    try_f = smd_side in ("both", "F")
    try_b = smd_side in ("both", "B")

    result_f = tracker.find_free(cx, cy, w, h, "F", is_tht, step=step) if try_f else None
    result_b = tracker.find_free(cx, cy, w, h, "B", is_tht, step=step) if try_b else None

    if result_f is None and result_b is None:
        return None
    if result_f is None:
        return (*result_b, "B")
    if result_b is None:
        return (*result_f, "F")

    fx, fy = result_f
    bx, by = result_b
    dist_f = (fx - cx) ** 2 + (fy - cy) ** 2
    dist_b = (bx - cx) ** 2 + (by - cy) ** 2
    if dist_f <= dist_b:
        return (fx, fy, "F")
    return (bx, by, "B")


def validate_placement(board_w, board_h, fixed, placements, component_info,
                       clearance=0.25, tht_extra_clearance=0.0):
    """Validate that all placements are in bounds and overlap-free.

    Args:
        board_w, board_h: Board dimensions in mm.
        fixed: dict of addr → Placement for locked components.
        placements: dict of addr → Placement returned by strategy.
        component_info: dict of addr → ComponentInfo for ALL components
            (fixed + free). Missing entries raise ValueError.
        clearance: mm clearance for overlap checks.

    Returns:
        (ok, out_of_bounds, overlapping) — ok is True if valid.

    All collision checks use bbox centers (fp_position + cx/cy_offset)
    to correctly handle asymmetric footprints like SIP-9 resistor
    networks and shrouded headers where the origin is at pin 1.
    """
    tracker = CollisionTracker(board_w, board_h, clearance=clearance,
                               tht_extra_clearance=tht_extra_clearance)

    # Register fixed components at bbox center — require real dimensions
    for addr, p in fixed.items():
        if addr not in component_info:
            raise ValueError(
                f"Fixed component '{addr}' missing from component_info — "
                f"cannot validate placement without dimensions"
            )
        info = component_info[addr]
        bcx = p.x + info.cx_offset
        bcy = p.y + info.cy_offset
        tracker.register(bcx, bcy, info.width, info.height, p.side,
                         info.is_tht, label=addr)

    out_of_bounds = []
    overlapping = []
    for addr, p in placements.items():
        if addr not in component_info:
            raise ValueError(
                f"Placed component '{addr}' missing from component_info — "
                f"cannot validate placement without dimensions"
            )
        info = component_info[addr]
        bcx = p.x + info.cx_offset
        bcy = p.y + info.cy_offset
        if not tracker.in_bounds(bcx, bcy, info.width, info.height):
            out_of_bounds.append(addr)
        if tracker.collides(bcx, bcy, info.width, info.height, p.side,
                            info.is_tht):
            overlapping.append(addr)
        tracker.register(bcx, bcy, info.width, info.height, p.side,
                         info.is_tht, label=addr)

    ok = len(out_of_bounds) == 0 and len(overlapping) == 0
    return ok, out_of_bounds, overlapping


# ---------------------------------------------------------------------------
# Net graph & connectivity
# ---------------------------------------------------------------------------

_POWER_PATTERN = re.compile(
    r"(^|\W)(gnd|vcc|vdd|vss|avdd|avss|dvdd|dvss"
    r"|v5v|v3v3|v12p|v12n|\+12v|\-12v|\+5v|\+3\.3v"
    r"|hv|vsys|vbus|vref|agnd|dgnd|pgnd)"
    r"($|\W)",
    re.IGNORECASE,
)


def identify_power_nets(board):
    """Return set of net names that are power/ground.

    Uses two heuristics:
      1. Name patterns: gnd, vcc, vdd, 3v3, 5v, 12v, avdd, etc.
      2. High fanout: any net connected to >15 pads is likely power.

    Requires pcbnew board object.
    """
    power_nets = set()

    netinfo = board.GetNetInfo()
    for net in netinfo.NetsByName():
        name = str(net)
        if _POWER_PATTERN.search(name):
            power_nets.add(name)

    pad_count = defaultdict(int)
    for fp in board.GetFootprints():
        for pad in fp.Pads():
            net_name = pad.GetNetname()
            if net_name:
                pad_count[net_name] += 1
    for net_name, count in pad_count.items():
        if count > 15:
            power_nets.add(net_name)

    return power_nets


def build_net_graph(board, addr_map, power_nets):
    """Build net → list of component addresses mapping.

    Filters out power nets. Each net maps to the set of component addresses
    whose pads connect to that net.

    Returns dict[str, list[str]].
    """
    net_to_addrs = defaultdict(set)
    for addr, fp in addr_map.items():
        for pad in fp.Pads():
            net_name = pad.GetNetname()
            if net_name and net_name not in power_nets:
                net_to_addrs[net_name].add(addr)

    return {net: sorted(addrs) for net, addrs in net_to_addrs.items()
            if len(addrs) >= 2}


def build_connectivity_graph(board, addrs, addr_map, power_nets):
    """Build adjacency graph: addr -> {neighbor_addr: shared_net_count}.

    Two components are connected if they share at least one non-power net.
    Requires pcbnew board object.
    """
    net_to_addrs = defaultdict(set)
    for addr in addrs:
        fp = addr_map.get(addr)
        if not fp:
            continue
        for pad in fp.Pads():
            net_name = pad.GetNetname()
            if net_name and net_name not in power_nets:
                net_to_addrs[net_name].add(addr)

    graph = defaultdict(lambda: defaultdict(int))
    for net_name, connected_addrs in net_to_addrs.items():
        addr_list = list(connected_addrs)
        for i in range(len(addr_list)):
            for j in range(i + 1, len(addr_list)):
                graph[addr_list[i]][addr_list[j]] += 1
                graph[addr_list[j]][addr_list[i]] += 1

    return graph


def connectivity_sort(addrs, graph):
    """Order components so electrically-connected ones are adjacent.

    Greedy BFS: start from the most-connected node, always visit the
    unvisited neighbor with the strongest connection.
    """
    if not addrs:
        return []

    remaining = set(addrs)
    ordered = []

    while remaining:
        start = max(
            remaining,
            key=lambda a: (sum(graph[a].get(n, 0) for n in remaining)
                           if a in graph else 0),
        )
        remaining.remove(start)
        ordered.append(start)

        current = start
        while True:
            neighbors = {
                n: w for n, w in graph.get(current, {}).items()
                if n in remaining
            }
            if not neighbors:
                best = None
                best_w = 0
                for r in remaining:
                    for o in ordered:
                        w = graph.get(r, {}).get(o, 0)
                        if w > best_w:
                            best = r
                            best_w = w
                if best and best_w > 0:
                    remaining.remove(best)
                    ordered.append(best)
                    current = best
                    continue
                break
            best_neighbor = max(neighbors, key=neighbors.get)
            remaining.remove(best_neighbor)
            ordered.append(best_neighbor)
            current = best_neighbor

    return ordered


def size_sort(addrs, addr_map, pcbnew):
    """Sort component addresses by footprint bounding-box area, largest first.

    Requires pcbnew module for dimension extraction.
    """
    def area(addr):
        fp = addr_map.get(addr)
        if not fp:
            return 0
        bbox = fp.GetBoundingBox(False, False)
        return pcbnew.ToMM(bbox.GetWidth()) * pcbnew.ToMM(bbox.GetHeight())
    return sorted(addrs, key=area, reverse=True)


def size_sort_by_info(addrs, components):
    """Sort addresses by component area (from ComponentInfo), largest first.

    Pure function — no pcbnew dependency. For use by strategies.
    """
    def area(addr):
        info = components.get(addr)
        if not info:
            return 0
        return info.width * info.height
    return sorted(addrs, key=area, reverse=True)


def connectivity_sort_by_net_graph(addrs, net_graph):
    """Order components by connectivity using net_graph (net → [addrs]).

    Converts net_graph to adjacency format, then uses connectivity_sort.
    Pure function — no pcbnew dependency. For use by strategies.
    """
    graph = defaultdict(lambda: defaultdict(int))
    for net, connected in net_graph.items():
        for i in range(len(connected)):
            if connected[i] not in addrs:
                continue
            for j in range(i + 1, len(connected)):
                if connected[j] not in addrs:
                    continue
                graph[connected[i]][connected[j]] += 1
                graph[connected[j]][connected[i]] += 1
    return connectivity_sort(addrs, graph)


# ---------------------------------------------------------------------------
# Anti-affinity helpers
# ---------------------------------------------------------------------------


def check_anti_affinity(placements, fixed, rules):
    """Check all anti-affinity rules against current placements.

    Returns list of (addr_a, addr_b, distance_mm, min_mm) for violations.
    """
    if not rules:
        return []

    # Merge all positions
    all_positions = {}
    for addr, p in fixed.items():
        all_positions[addr] = (p.x, p.y)
    for addr, p in placements.items():
        all_positions[addr] = (p.x, p.y)

    violations = []
    addrs = list(all_positions.keys())
    for rule in rules:
        for i in range(len(addrs)):
            for j in range(i + 1, len(addrs)):
                a, b = addrs[i], addrs[j]
                if not rule.matches(a, b):
                    continue
                ax, ay = all_positions[a]
                bx, by = all_positions[b]
                dist = ((ax - bx) ** 2 + (ay - by) ** 2) ** 0.5
                if dist < rule.min_mm:
                    violations.append((a, b, round(dist, 1), rule.min_mm))
    return violations


def anti_affinity_repulsion(addr, x, y, placed_positions, fixed, rules,
                            board_w=None, board_h=None):
    """Compute repulsion offset pushing addr away from anti-affinity partners.

    Returns (dx, dy) offset to add to the target position.
    placed_positions: dict[str, (x, y)] of already-placed free components.
    board_w, board_h: board dimensions (used for fallback push direction).
    """
    if not rules:
        return 0.0, 0.0

    dx, dy = 0.0, 0.0
    for rule in rules:
        # Check all placed + fixed positions
        for other_addr, (ox, oy) in list(placed_positions.items()) + \
                [(a, (p.x, p.y)) for a, p in fixed.items()]:
            if other_addr == addr:
                continue
            if not rule.matches(addr, other_addr):
                continue
            ddx = x - ox
            ddy = y - oy
            dist = (ddx ** 2 + ddy ** 2) ** 0.5
            if dist >= rule.min_mm:
                continue
            if dist < 0.01:
                # Target is on top of the anti-affinity partner — push toward
                # board center (or diagonally away if no board dims given)
                if board_w and board_h:
                    ddx = board_w / 2 - ox
                    ddy = board_h / 2 - oy
                    dist = (ddx ** 2 + ddy ** 2) ** 0.5
                    if dist < 0.01:
                        ddx, ddy, dist = 1.0, 0.0, 1.0
                else:
                    ddx, ddy, dist = 1.0, 1.0, 1.414
            # Push away — full min_mm distance
            dx += (ddx / dist) * rule.min_mm
            dy += (ddy / dist) * rule.min_mm
    return dx, dy


def anti_affinity_penalty(addr, x, y, all_positions, rules):
    """Return a cost penalty for anti-affinity violations at (x, y).

    all_positions: dict[str, (x, y)] — all component positions.
    Returns penalty in mm (0.0 if no violations).
    """
    if not rules:
        return 0.0

    penalty = 0.0
    for rule in rules:
        for other_addr, (ox, oy) in all_positions.items():
            if other_addr == addr:
                continue
            if not rule.matches(addr, other_addr):
                continue
            dist = ((x - ox) ** 2 + (y - oy) ** 2) ** 0.5
            if dist < rule.min_mm:
                # Quadratic penalty — stronger closer
                penalty += (rule.min_mm - dist) ** 2
    return penalty


# ---------------------------------------------------------------------------
# HPWL estimation
# ---------------------------------------------------------------------------


def estimate_hpwl(placements, net_graph):
    """Estimate total half-perimeter wirelength from placements and net graph.

    placements: dict[str, Placement] — address → Placement with x, y fields.
    net_graph: dict[str, list[str]] — net name → list of component addresses.

    Returns total HPWL in mm. Nets with fewer than 2 placed components are
    skipped.
    """
    total = 0.0
    for net, addrs in net_graph.items():
        xs = []
        ys = []
        for addr in addrs:
            p = placements.get(addr)
            if p is not None:
                xs.append(p.x)
                ys.append(p.y)
        if len(xs) >= 2:
            total += (max(xs) - min(xs)) + (max(ys) - min(ys))
    return total


# ---------------------------------------------------------------------------
# pcbnew utility functions (used by orchestrator to build BoardContext)
# ---------------------------------------------------------------------------


def get_ref_text_bbox(fp, pcbnew):
    """Get reference designator text bounding box in board coordinates.

    Returns (x1, y1, x2, y2) in mm, or None if ref text is hidden/missing.
    """
    ref = fp.Reference()
    if not ref or not ref.IsVisible():
        return None

    text_str = ref.GetShownText(False)
    if not text_str:
        return None

    # Get text bounding box from KiCad (includes font size and rotation)
    text_bbox = ref.GetBoundingBox()
    x1 = pcbnew.ToMM(text_bbox.GetLeft())
    y1 = pcbnew.ToMM(text_bbox.GetTop())
    x2 = pcbnew.ToMM(text_bbox.GetRight())
    y2 = pcbnew.ToMM(text_bbox.GetBottom())

    # Ensure minimum dimensions (text can be tiny)
    if x2 - x1 < 0.5 or y2 - y1 < 0.3:
        return None

    return (x1, y1, x2, y2)


def extract_footprint_dims(fp, pcbnew):
    """Get footprint body dimensions and bbox center offset in mm.

    Returns (w, h, cx_offset, cy_offset).

    Computes the offset from the footprint origin (pin 1 for THT parts)
    to the bounding box center. This offset is critical for collision
    detection — without it, asymmetric components like SIP-9 resistor
    networks are registered at the wrong position.

    Uses the same technique as the proven control-board placement code:
    temporarily moves the footprint to origin, reads bbox center, restores.
    """
    orig_pos = fp.GetPosition()
    fp.SetPosition(pcbnew.VECTOR2I(0, 0))
    bbox = fp.GetBoundingBox(False, False)
    cx_offset = (pcbnew.ToMM(bbox.GetLeft()) + pcbnew.ToMM(bbox.GetRight())) / 2
    cy_offset = (pcbnew.ToMM(bbox.GetTop()) + pcbnew.ToMM(bbox.GetBottom())) / 2
    w = pcbnew.ToMM(bbox.GetWidth())
    h = pcbnew.ToMM(bbox.GetHeight())
    fp.SetPosition(orig_pos)
    return max(w, 1.0), max(h, 1.0), cx_offset, cy_offset


def is_tht(fp, pcbnew):
    """Check if footprint has any through-hole pads."""
    return any(
        pad.GetAttribute() == pcbnew.PAD_ATTRIB_PTH for pad in fp.Pads()
    )


def get_component_nets(fp, power_nets):
    """Get list of non-power net names connected to a footprint."""
    nets = []
    for pad in fp.Pads():
        net_name = pad.GetNetname()
        if net_name and net_name not in power_nets:
            if net_name not in nets:
                nets.append(net_name)
    return nets
