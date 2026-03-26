"""Wavefront placement strategies.

Three variants:
  - wavefront: BFS waves from fixed anchors with multi-region adaptive grid
  - wavefront_circuit: Circuit-first variant (all components of one module
    before next)
  - wavefront_direct: Two-pass with pin-edge targets (no grid quantization)
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass

from ..dtypes import Board, Component, PlacedComponent, Side, SidePadding
from ..context import PlacementContext
from ..geometry import (
    classify_pins_by_edge, edge_offset, effective_edge_map,
    rotated_dims, OPPOSITE_EDGE,
)
from ..connectivity import build_circuits, compute_wave_distances
from . import register


# ---------------------------------------------------------------------------
# Grid helpers (shared by wavefront and wavefront_circuit)
# ---------------------------------------------------------------------------


def _build_multi_region_grid(ctx: PlacementContext, n_free: int,
                             margin: float = 1.0,
                             zones: list | None = None,
                             ) -> tuple[list[tuple[float, float]], float]:
    """Build grid points across all free rectangular regions.

    Uses largest-free-rects to discover available regions, then creates
    a grid within each proportional to capacity.
    """
    board = ctx.board
    rects = ctx.largest_free_rects(Side.BACK, count=20)

    if not rects:
        # Fallback: uniform grid
        board_area = board.width * board.height
        step = math.sqrt(board_area / max(n_free * 2, 1))
        step = max(step, 2.0)
        points = []
        x = step / 2
        while x < board.width:
            y = step / 2
            while y < board.height:
                points.append((x, y))
                y += step
            x += step
        return points, step

    total_area = sum(w * h for _, _, w, h in rects)
    if total_area <= 0:
        return [], 5.0

    target_cells = n_free * 2
    avg_cell_area = total_area / max(target_cells, 1)
    avg_step = math.sqrt(avg_cell_area)
    avg_step = max(avg_step, 2.0)

    points: list[tuple[float, float]] = []
    for rx, ry, rw, rh in rects:
        if rw < 3 or rh < 3:
            continue

        region_area = rw * rh
        region_cells = max(1, int(target_cells * region_area / total_area))
        step = math.sqrt(region_area / max(region_cells, 1))
        step = max(step, 2.0)

        x = rx + step / 2
        while x < rx + rw:
            y = ry + step / 2
            while y < ry + rh:
                if 0 < x < board.width and 0 < y < board.height:
                    in_zone = False
                    if zones:
                        for z in zones:
                            if (z["x_min"] <= x <= z["x_max"] and
                                    z["y_min"] <= y <= z["y_max"]):
                                in_zone = True
                                break
                    if not in_zone:
                        points.append((x, y))
                y += step
            x += step

    return points, avg_step


def _claim_grid_point(grid_points: list[tuple[float, float]],
                      tx: float, ty: float,
                      comp: Component, grid_step: float,
                      per_pin_margin: float = 0.3,
                      zones: list | None = None,
                      comp_id: str = "",
                      ) -> tuple[float, float, list[tuple[float, float]]]:
    """Pick nearest available grid point, claim surrounding area."""

    def _is_excluded(x, y, cid, zs):
        if not zs:
            return False
        for z in zs:
            if (z["x_min"] <= x <= z["x_max"] and
                    z["y_min"] <= y <= z["y_max"]):
                prefixes = z.get("allowed_prefixes", [])
                if not any(cid.startswith(p) for p in prefixes):
                    return True
        return False

    if not grid_points:
        if _is_excluded(tx, ty, comp_id, zones):
            for z in zones or []:
                if (z["x_min"] <= tx <= z["x_max"] and
                        z["y_min"] <= ty <= z["y_max"]):
                    distances = [
                        (abs(tx - z["x_min"]), z["x_min"] - 2, ty),
                        (abs(tx - z["x_max"]), z["x_max"] + 2, ty),
                        (abs(ty - z["y_min"]), tx, z["y_min"] - 2),
                        (abs(ty - z["y_max"]), tx, z["y_max"] + 2),
                    ]
                    distances.sort(key=lambda d: d[0])
                    _, tx, ty = distances[0]
                    break
        return tx, ty, []

    if zones:
        allowed_indices = [
            i for i, (gx, gy) in enumerate(grid_points)
            if not _is_excluded(gx, gy, comp_id, zones)
        ]
    else:
        allowed_indices = list(range(len(grid_points)))

    if not allowed_indices:
        return tx, ty, grid_points

    # Find nearest allowed point
    best_idx = allowed_indices[0]
    best_dist = float('inf')
    for i in allowed_indices:
        gx, gy = grid_points[i]
        dist = abs(gx - tx) + abs(gy - ty)
        if dist < best_dist:
            best_dist = dist
            best_idx = i

    gx, gy = grid_points[best_idx]

    # Claim radius
    pin_count = len(comp.pins)
    pin_extra = pin_count * per_pin_margin
    half_w = comp.width / 2 + pin_extra / 2 + grid_step * 0.25
    half_h = comp.height / 2 + pin_extra / 2 + grid_step * 0.25
    remaining = [
        (px, py) for px, py in grid_points
        if abs(px - gx) > half_w or abs(py - gy) > half_h
    ]

    return gx, gy, remaining


# ---------------------------------------------------------------------------
# Pin-aware position + rotation optimizer
# ---------------------------------------------------------------------------


def _pin_offset_from_center(comp: Component, pin: Pin,
                            rotation: float, side: Side
                            ) -> tuple[float, float]:
    """Pin position relative to component CENTER (not top-left).

    Returns (dx, dy) such that pin_world = (cx + dx, cy + dy).
    """
    from ..geometry import effective_point
    # effective_point returns position relative to bbox top-left
    epx, epy = effective_point(pin.x, pin.y, comp.width, comp.height,
                               rotation, side)
    ew, eh = rotated_dims(comp.width, comp.height, rotation)
    return epx - ew / 2, epy - eh / 2


def _get_neighbor_pin_world(neighbor_id: str, net_id: str,
                            placed: dict[str, PlacedComponent],
                            ctx: PlacementContext,
                            ) -> tuple[float, float] | None:
    """Get world position of a specific pin on a placed/fixed neighbor."""
    from ..geometry import pin_world_position

    neighbor = ctx.get_component(neighbor_id)
    if neighbor is None:
        return None

    # Get neighbor's placement
    p = placed.get(neighbor_id)
    if p is not None:
        nx, ny, nrot, nside = p.x, p.y, p.rotation, p.side
    elif neighbor.fixed:
        nx, ny, nrot, nside = neighbor.x, neighbor.y, neighbor.rotation, neighbor.side
    else:
        return None

    # Find the pin on the neighbor that matches this net
    for pin in neighbor.pins:
        if pin.id == net_id:
            return pin_world_position(neighbor, pin, nx, ny, nrot, nside)

    # Fallback: return neighbor center
    ew, eh = rotated_dims(neighbor.width, neighbor.height, nrot)
    return nx + ew / 2, ny + eh / 2


def _best_position_and_rotation(
    comp: Component,
    net_graph: dict[str, list[str]],
    placed: dict[str, PlacedComponent],
    ctx: PlacementContext,
    side: Side = Side.FRONT,
    group_weight: float = 0.5,
    bypass_map: dict[str, str] | None = None,
) -> tuple[float, float, float]:
    """Find optimal (cx, cy, rotation) by minimizing pin-to-pin wirelength.

    For each candidate rotation:
      1. Compute each pin's offset from component center
      2. Find the connected pin's world position on each placed neighbor
      3. Optimal center = weighted mean of (neighbor_pin - my_pin_offset)
      4. Score = total Manhattan pin-to-pin distance at optimal position

    Returns (cx, cy, best_rotation). Falls back to board center if
    no connections exist.
    """
    if not comp.pins:
        # No pins at all — use board center, rotation 0
        return ctx.board.width / 2, ctx.board.height / 2, 0.0

    # Build pin→net mapping
    pin_nets: dict[str, set[str]] = defaultdict(set)
    for net_id, addrs in net_graph.items():
        if comp.id not in addrs:
            continue
        for pin in comp.pins:
            if pin.id == net_id or pin.id in net_id:
                pin_nets[pin.id].add(net_id)
        # Also check by net_id matching pin id directly
        for pin in comp.pins:
            pin_nets[pin.id].add(net_id) if net_id == pin.id else None

    # Collect all pin-to-pin connections: (my_pin, neighbor_world_pos, weight)
    # Weight = number of pads on the neighbor that share this net.
    # Components with more pads on a net pull harder (e.g., USB-C connector
    # with 2 DP pads pulls 2× vs MCU with 1 usb_dp pad).
    connections: list[tuple[Pin, float, float, float]] = []
    for net_id, addrs in net_graph.items():
        if comp.id not in addrs:
            continue
        # Find which of my pins is on this net
        my_pin = None
        for pin in comp.pins:
            if pin.id == net_id:
                my_pin = pin
                break
        if my_pin is None:
            continue

        # Find neighbor pin positions on this net
        for other_id in addrs:
            if other_id == comp.id:
                continue
            # Bypass cap filtering: on power nets, only target the
            # associated IC, ignore all other components.
            if (bypass_map and comp.id in bypass_map and
                    net_id in ctx.board.power_nets):
                if other_id != bypass_map[comp.id]:
                    continue
            neighbor = ctx.get_component(other_id)
            if neighbor is None:
                continue
            # Count how many pins on the neighbor share this net.
            # Square the count so components with more connections pull
            # disproportionately harder (USB-C with 2 DP pads pulls 4×
            # vs MCU with 1 pad pulling 1×).
            pin_count = sum(1 for p in neighbor.pins if p.id == net_id)
            weight = max(pin_count, 1) ** 2
            npos = _get_neighbor_pin_world(other_id, net_id, placed, ctx)
            if npos is not None:
                connections.append((my_pin, npos[0], npos[1], weight))

    # Add group affinity (pull toward same-group components)
    group = comp.group
    group_targets: list[tuple[float, float]] = []
    if group:
        group_prefix = group + "."
        for other_id, p in placed.items():
            if other_id != comp.id and other_id.startswith(group_prefix):
                other = ctx.get_component(other_id)
                if other:
                    ew, eh = rotated_dims(other.width, other.height, p.rotation)
                    group_targets.append((p.x + ew / 2, p.y + eh / 2))
        for other_id in ctx._fixed_ids:
            other = ctx.get_component(other_id)
            if other and other_id != comp.id and other_id.startswith(group_prefix):
                ew, eh = rotated_dims(other.width, other.height, other.rotation)
                group_targets.append((other.x + ew / 2, other.y + eh / 2))

    if not connections and not group_targets:
        return ctx.board.width / 2, ctx.board.height / 2, 0.0

    best_cx, best_cy, best_rot = ctx.board.width / 2, ctx.board.height / 2, 0.0
    best_cost = float("inf")

    for rot in (0.0, 90.0, 180.0, 270.0):
        # Compute optimal center position for this rotation
        sum_tx, sum_ty, sum_w = 0.0, 0.0, 0.0

        for my_pin, nx, ny, w in connections:
            dx, dy = _pin_offset_from_center(comp, my_pin, rot, side)
            # Optimal center contribution: neighbor_pin_pos - my_pin_offset
            # Weight by neighbor's pad count on this net
            sum_tx += (nx - dx) * w
            sum_ty += (ny - dy) * w
            sum_w += w

        for gx, gy in group_targets:
            sum_tx += gx * group_weight
            sum_ty += gy * group_weight
            sum_w += group_weight

        if sum_w <= 0:
            continue

        cx = sum_tx / sum_w
        cy = sum_ty / sum_w

        # Score: weighted Manhattan pin-to-pin distance at this position
        cost = 0.0
        for my_pin, nx, ny, w in connections:
            dx, dy = _pin_offset_from_center(comp, my_pin, rot, side)
            cost += (abs(cx + dx - nx) + abs(cy + dy - ny)) * w
        for gx, gy in group_targets:
            cost += (abs(cx - gx) + abs(cy - gy)) * group_weight

        if cost < best_cost:
            best_cost = cost
            best_cx, best_cy, best_rot = cx, cy, rot

    return best_cx, best_cy, best_rot


# ---------------------------------------------------------------------------
# Pin-count escape padding
# ---------------------------------------------------------------------------


def _escape_padding(comp: Component, pitch: float = 1.0) -> SidePadding:
    """Compute uniform padding from pin count for via escape routing.

    Each pair of pins needs one via escape channel (~0.8mm: via 0.6mm
    + clearance 0.2mm). Distributed uniformly across 4 sides.
    """
    n_pins = len(comp.pins)
    if n_pins == 0:
        return SidePadding()
    n_pairs = (n_pins + 1) // 2  # round up
    per_side = (n_pairs * pitch) / 4
    return SidePadding(top=per_side, bottom=per_side,
                       left=per_side, right=per_side)


# ---------------------------------------------------------------------------
# Pin alignment padding (for wavefront_direct pass 2)
# ---------------------------------------------------------------------------


def _pin_alignment_padding(comp: Component, placement: PlacedComponent,
                           net_graph: dict[str, list[str]],
                           all_placed: dict[str, PlacedComponent],
                           ctx: PlacementContext,
                           base: float = 0.3,
                           growth: float = 1.8,
                           ) -> dict[str, float]:
    """Compute per-edge extra padding based on pin alignment quality."""
    edge_map = classify_pins_by_edge(comp)
    if not any(edge_map.values()):
        return {"N": 0.0, "S": 0.0, "E": 0.0, "W": 0.0}

    # Build pin→nets
    pin_nets: dict[str, set[str]] = defaultdict(set)
    for net_id, addrs in net_graph.items():
        if comp.id not in addrs:
            continue
        for pin in comp.pins:
            pin_nets[pin.id].add(net_id)

    eff_emap = effective_edge_map(edge_map, placement.rotation, placement.side)

    def _net_edge_for(pin_list, net_id):
        for pin in pin_list:
            if net_id in pin_nets.get(pin.id, set()):
                return True
        return False

    def _find_edge(comp_id, net_id, p):
        other_comp = ctx.get_component(comp_id)
        if other_comp is None:
            return None
        other_edge_map = classify_pins_by_edge(other_comp)
        other_eff = effective_edge_map(other_edge_map, p.rotation, p.side)
        other_pin_nets: dict[str, set[str]] = defaultdict(set)
        for nid, addrs in net_graph.items():
            if comp_id not in addrs:
                continue
            for pin in other_comp.pins:
                other_pin_nets[pin.id].add(nid)
        for edge, pins in other_eff.items():
            for pin in pins:
                if net_id in other_pin_nets.get(pin.id, set()):
                    return edge
        return None

    scores = {"N": 0, "S": 0, "E": 0, "W": 0}

    for my_edge, my_pins in eff_emap.items():
        for pin in my_pins:
            for net_id in pin_nets.get(pin.id, set()):
                for other_id in net_graph.get(net_id, []):
                    if other_id == comp.id:
                        continue
                    other_p = all_placed.get(other_id)
                    if other_p is None:
                        continue
                    other_edge = _find_edge(other_id, net_id, other_p)
                    if other_edge is None:
                        continue
                    if other_edge == OPPOSITE_EDGE.get(my_edge):
                        continue  # Facing — no penalty
                    elif other_edge == my_edge:
                        scores[my_edge] += 2  # Same direction — worst
                    else:
                        scores[my_edge] += 1  # Perpendicular

    padding = {}
    max_padding = 3.0  # mm — cap to prevent exponential blowup
    for edge, score in scores.items():
        if score == 0:
            padding[edge] = 0.0
        else:
            padding[edge] = min(base * (growth ** score - 1), max_padding)
    return padding


def _padding_dict_to_side_padding(pad: dict[str, float]) -> SidePadding:
    """Convert N/S/E/W dict to SidePadding."""
    return SidePadding(
        top=pad.get("N", 0.0),
        bottom=pad.get("S", 0.0),
        left=pad.get("W", 0.0),
        right=pad.get("E", 0.0),
    )


# ---------------------------------------------------------------------------
# Bypass cap satellite placement
# ---------------------------------------------------------------------------


def _interleave_bypass_caps(ordered: list[str],
                            bypass_map: dict[str, str],
                            ) -> list[str]:
    """Reorder so bypass caps follow immediately after their associated IC.

    Caps whose IC is not in the ordered list (e.g., fixed components)
    are prepended — they target a fixed position and benefit from
    being placed early.
    """
    if not bypass_map:
        return list(ordered)

    bypass_ids = set(bypass_map.keys())

    # Build reverse map: ic_id → [cap_ids] preserving original order
    ic_to_caps: dict[str, list[str]] = defaultdict(list)
    for cid in ordered:
        if cid in bypass_ids:
            ic_id = bypass_map[cid]
            ic_to_caps[ic_id].append(cid)

    # Strip bypass caps from ordered list
    stripped = [cid for cid in ordered if cid not in bypass_ids]

    # Find ICs whose caps exist but IC is not in stripped (fixed ICs)
    ics_in_list = set(stripped)
    orphan_caps: list[str] = []
    for ic_id, caps in ic_to_caps.items():
        if ic_id not in ics_in_list:
            orphan_caps.extend(caps)

    # Rebuild: insert each IC's caps after it
    result: list[str] = list(orphan_caps)  # prepend fixed-IC caps
    for cid in stripped:
        result.append(cid)
        if cid in ic_to_caps:
            result.extend(ic_to_caps[cid])

    return result


def _build_ic_to_caps(bypass_map: dict[str, str]) -> dict[str, list[str]]:
    """Build reverse map: ic_id → [cap_ids]."""
    ic_to_caps: dict[str, list[str]] = defaultdict(list)
    for cap_id, ic_id in bypass_map.items():
        ic_to_caps[ic_id].append(cap_id)
    return ic_to_caps


def _find_cap_power_pins(cap: Component, ic: Component,
                         net_graph: dict[str, list[str]],
                         ) -> list[tuple[Pin, Pin]]:
    """Find matching power pin pairs between cap and IC.

    Returns list of (cap_pin, ic_pin) tuples for shared power nets.
    """
    pairs = []
    for net_id, addrs in net_graph.items():
        if cap.id not in addrs or ic.id not in addrs:
            continue
        cap_pin = None
        ic_pin = None
        for pin in cap.pins:
            if pin.id == net_id:
                cap_pin = pin
                break
        for pin in ic.pins:
            if pin.id == net_id:
                ic_pin = pin
                break
        if cap_pin and ic_pin:
            pairs.append((cap_pin, ic_pin))
    return pairs


def _allowed_side(board: Board, preferred: Side) -> Side:
    """Clamp *preferred* side to the board's smd_side constraint.

    If the board restricts SMD to one side (e.g. "front"), override the
    preferred side so we never place SMD caps on the forbidden side.
    """
    if board.smd_side == "front":
        return Side.FRONT
    if board.smd_side == "back":
        return Side.BACK
    return preferred  # "both" — keep preferred


@dataclass
class CapOffset:
    """Pre-computed bypass cap position relative to IC center at rotation=0."""
    cap_id: str
    dx: float     # mm offset from IC center x
    dy: float     # mm offset from IC center y
    rotation: float  # cap rotation in degrees


def _compute_cap_offsets(ic: Component, cap_ids: list[str],
                         comp_map: dict[str, Component],
                         net_graph: dict[str, list[str]],
                         ) -> list[CapOffset]:
    """Pre-compute bypass cap positions relative to IC center.

    Places caps adjacent to their supply pins, side by side when
    multiple caps share the same pin. All offsets are relative to
    IC center at rotation=0, front side.
    """
    from ..geometry import classify_pins_by_edge

    edge_map = classify_pins_by_edge(ic)
    ic_hw = ic.width / 2
    ic_hh = ic.height / 2

    # Compute outermost pin extent per edge — caps must clear ALL IC pads,
    # not just the one they connect to. This prevents caps from overlapping
    # adjacent IC pins and creating shorts.
    edge_extent: dict[str, float] = {"N": 0.0, "S": 0.0, "E": 0.0, "W": 0.0}
    for edge_name, pins in edge_map.items():
        if not pins:
            continue
        if edge_name == "N":
            edge_extent["N"] = max(abs(p.y - ic_hh) for p in pins)
        elif edge_name == "S":
            edge_extent["S"] = max(abs(p.y - ic_hh) for p in pins)
        elif edge_name == "W":
            edge_extent["W"] = max(abs(p.x - ic_hw) for p in pins)
        elif edge_name == "E":
            edge_extent["E"] = max(abs(p.x - ic_hw) for p in pins)

    # Clearance from IC body edge to cap edge. Must clear the courtyard
    # which typically extends 0.25-0.5mm beyond the outermost pads,
    # plus manufacturing clearance (0.3mm JLCPCB minimum body-to-body).
    PAD_CLEARANCE = 0.8  # mm — courtyard excess + manufacturing clearance

    # Find each cap's supply pin position (relative to IC center)
    cap_pin_info = []
    for cap_id in cap_ids:
        cap = comp_map.get(cap_id)
        if cap is None:
            continue
        pin_pairs = _find_cap_power_pins(cap, ic, net_graph)
        if not pin_pairs:
            continue

        # Find supply pin (non-GND) on both IC and cap
        supply_pin = None
        supply_cap_pin = None
        for cap_pin_item, ic_pin in pin_pairs:
            if ic_pin.id.lower() not in ("hv", "gnd", "agnd", "dgnd", "pgnd"):
                supply_pin = ic_pin
                supply_cap_pin = cap_pin_item
                break
        if supply_pin is None:
            supply_pin = pin_pairs[0][1]  # fallback to any pin
            supply_cap_pin = pin_pairs[0][0]

        # Pin position relative to IC center (at rotation=0)
        pin_dx = supply_pin.x - ic_hw
        pin_dy = supply_pin.y - ic_hh

        # Determine which edge this pin is on
        best_edge = "S"
        best_dist = float("inf")
        for edge, pins in edge_map.items():
            for p in pins:
                if p.id == supply_pin.id:
                    # Direct match
                    if edge == "N":
                        best_edge = "N"
                    elif edge == "S":
                        best_edge = "S"
                    elif edge == "E":
                        best_edge = "E"
                    elif edge == "W":
                        best_edge = "W"
                    best_dist = 0
                    break
            if best_dist == 0:
                break
        if best_dist > 0:
            # Fallback: nearest edge
            dists = {
                "N": abs(supply_pin.y),
                "S": abs(supply_pin.y - ic.height),
                "W": abs(supply_pin.x),
                "E": abs(supply_pin.x - ic.width),
            }
            best_edge = min(dists, key=dists.get)  # type: ignore

        cap_pin_info.append((cap_id, cap, pin_dx, pin_dy, best_edge, supply_cap_pin))

    # Group ALL caps by edge — lay out as one continuous row per edge
    # to prevent caps from different pins overlapping.
    edge_groups: dict[str, list[tuple]] = defaultdict(list)
    for cap_id, cap, pin_dx, pin_dy, edge, s_cap_pin in cap_pin_info:
        edge_groups[edge].append((cap_id, cap, pin_dx, pin_dy, s_cap_pin))

    # Clearance from IC body edge to cap inner pad
    BYPASS_GAP = 0.8  # mm — clears courtyard + manufacturing
    # Gap between adjacent caps
    CAP_GAP = 0.5  # mm between cap courtyards

    offsets: list[CapOffset] = []

    for edge, caps_on_edge in edge_groups.items():
        n_caps = len(caps_on_edge)
        if n_caps == 0:
            continue

        # Orient caps perpendicular to edge (pads toward/away from IC)
        sample_cap = caps_on_edge[0][1]
        cap_w, cap_h = sample_cap.width, sample_cap.height
        if edge in ("N", "S"):
            if cap_h >= cap_w:
                cap_rot = 0.0
                cap_ew, cap_eh = cap_w, cap_h
            else:
                cap_rot = 90.0
                cap_ew, cap_eh = cap_h, cap_w
        else:
            if cap_w >= cap_h:
                cap_rot = 0.0
                cap_ew, cap_eh = cap_w, cap_h
            else:
                cap_rot = 90.0
                cap_ew, cap_eh = cap_h, cap_w

        # Perpendicular distance: just outside IC body
        clear = max(edge_extent.get(edge, 0),
                    ic_hh if edge in ("N", "S") else ic_hw)
        perp = clear + BYPASS_GAP + cap_eh / 2

        # Sort caps by their pin position along the edge so the row
        # follows the pin order. For N/S edges sort by pin_dx,
        # for W/E edges sort by pin_dy.
        if edge in ("N", "S"):
            caps_on_edge.sort(key=lambda t: t[2])  # sort by pin_dx
        else:
            caps_on_edge.sort(key=lambda t: t[3])  # sort by pin_dy

        # Compute the center of all pins on this edge
        if edge in ("N", "S"):
            pin_center = sum(t[2] for t in caps_on_edge) / n_caps
        else:
            pin_center = sum(t[3] for t in caps_on_edge) / n_caps

        # Lay out as one continuous row centered on the pin centroid
        cap_spacing = cap_ew + CAP_GAP
        total_width = n_caps * cap_ew + (n_caps - 1) * CAP_GAP
        start = -total_width / 2 + cap_ew / 2

        for i, (cap_id, cap, pin_dx, pin_dy, s_cap_pin) in enumerate(caps_on_edge):
            lateral = start + i * cap_spacing

            if edge == "N":
                dx = pin_center + lateral
                dy = -perp
            elif edge == "S":
                dx = pin_center + lateral
                dy = perp
            elif edge == "W":
                dx = -perp
                dy = pin_center + lateral
            else:  # E
                dx = perp
                dy = pin_center + lateral

            # Ensure the cap's supply pin faces the IC.
            # Compute supply pin position at cap_rot relative to cap center.
            # If it points away from the IC, flip 180°.
            final_rot = cap_rot
            if s_cap_pin is not None:
                from ..geometry import rotate_point
                rpx, rpy = rotate_point(s_cap_pin.x, s_cap_pin.y,
                                        cap.width, cap.height, cap_rot)
                pin_off_x = rpx - cap_ew / 2
                pin_off_y = rpy - cap_eh / 2
                # Supply pin should point toward IC (opposite to offset direction)
                wrong_side = False
                if edge == "N" and pin_off_y < 0:
                    wrong_side = True  # pin faces north, IC is south
                elif edge == "S" and pin_off_y > 0:
                    wrong_side = True  # pin faces south, IC is north
                elif edge == "W" and pin_off_x < 0:
                    wrong_side = True  # pin faces west, IC is east
                elif edge == "E" and pin_off_x > 0:
                    wrong_side = True  # pin faces east, IC is west
                if wrong_side:
                    final_rot = (cap_rot + 180.0) % 360.0

            offsets.append(CapOffset(cap_id=cap_id, dx=dx, dy=dy, rotation=final_rot))

    return offsets


def _expand_ic_for_caps(ic: Component, offsets: list[CapOffset],
                        comp_map: dict[str, Component]) -> None:
    """Expand IC's padding to include space for its bypass caps.

    This reserves space around the IC so other components don't
    occupy the caps' positions during wavefront placement.
    """
    if not offsets:
        return

    ic_hw = ic.width / 2
    ic_hh = ic.height / 2

    # Find the extent of all cap positions relative to IC center
    extra_left = 0.0
    extra_right = 0.0
    extra_top = 0.0
    extra_bottom = 0.0

    for off in offsets:
        cap = comp_map.get(off.cap_id)
        if cap is None:
            continue
        cew, ceh = rotated_dims(cap.width, cap.height, off.rotation)
        # Cap bbox relative to IC center
        cap_left = off.dx - cew / 2
        cap_right = off.dx + cew / 2
        cap_top = off.dy - ceh / 2
        cap_bottom = off.dy + ceh / 2

        # How far does this cap extend beyond the IC body?
        extra_left = max(extra_left, -ic_hw - cap_left)
        extra_right = max(extra_right, cap_right - ic_hw)
        extra_top = max(extra_top, -ic_hh - cap_top)
        extra_bottom = max(extra_bottom, cap_bottom - ic_hh)

    # Add to IC's padding (don't reduce existing padding)
    ic.pad_left = max(ic.pad_left, extra_left)
    ic.pad_right = max(ic.pad_right, extra_right)
    ic.pad_top = max(ic.pad_top, extra_top)
    ic.pad_bottom = max(ic.pad_bottom, extra_bottom)


def _extract_cap_placements(ic_placement: PlacedComponent,
                            ic: Component,
                            offsets: list[CapOffset],
                            ctx: PlacementContext,
                            placements: dict[str, PlacedComponent],
                            ) -> None:
    """Extract individual cap positions from IC placement + pre-computed offsets.

    Temporarily unregisters the IC (which has expanded padding that covers
    cap positions), places caps, then re-registers with original padding.
    """
    from ..geometry import rotate_point

    # Unregister IC so caps can be placed in its expanded padding zone
    ctx.unregister(ic.id)

    ew, eh = rotated_dims(ic.width, ic.height, ic_placement.rotation)
    ic_cx = ic_placement.x + ew / 2
    ic_cy = ic_placement.y + eh / 2

    for off in offsets:
        # Transform offset from IC-local (rotation=0, front) to world coords.
        # Use the same geometry as pin_world_position: effective_point handles
        # rotation and side flipping.
        from ..geometry import effective_point
        # Offset is relative to IC center; convert to bbox-relative
        local_x = ic.width / 2 + off.dx
        local_y = ic.height / 2 + off.dy
        ex, ey = effective_point(local_x, local_y, ic.width, ic.height,
                                 ic_placement.rotation, ic_placement.side)
        wx = ic_placement.x + ex
        wy = ic_placement.y + ey

        cap_rot = (off.rotation + ic_placement.rotation) % 360
        if ic_placement.side == Side.BACK:
            # Back side mirrors rotation direction
            cap_rot = (360 - off.rotation + ic_placement.rotation) % 360

        # Get cap component for registration
        cap = ctx.get_component(off.cap_id)
        if cap is None:
            continue

        cew, ceh = rotated_dims(cap.width, cap.height, cap_rot)
        tl_x = wx - cew / 2
        tl_y = wy - ceh / 2

        # Clamp to board bounds
        tl_x = max(0.5, min(tl_x, ctx.board.width - cew - 0.5))
        tl_y = max(0.5, min(tl_y, ctx.board.height - ceh - 0.5))

        cap_side = _allowed_side(ctx.board, ic_placement.side)
        ctx.register(cap, tl_x, tl_y, cap_side, rotation=cap_rot)
        placements[off.cap_id] = PlacedComponent(
            component_id=off.cap_id, x=tl_x, y=tl_y,
            rotation=cap_rot, side=cap_side)

    # Re-register IC with original padding (not expanded)
    ctx.register(ic, ic_placement.x, ic_placement.y,
                 ic_placement.side, rotation=ic_placement.rotation)


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------


def _comp_priority_key(comp: Component) -> float:
    """Sort key: most connections first, then largest area."""
    connections = len(comp.pins)
    area = comp.width * comp.height
    return -(connections * 10 + area)


@register("wavefront")
def wavefront(board: Board, ctx: PlacementContext,
              params: dict) -> list[PlacedComponent]:
    """BFS wavefront expansion from fixed anchors with multi-region grid."""
    free_comps = ctx.free_components()
    if not free_comps:
        return []

    comp_map = {c.id: c for c in free_comps}
    free_ids = set(comp_map.keys())
    fixed_ids = {c.id for c in ctx.fixed_components()}

    net_graph = ctx.net_graph()

    # Build circuits
    all_ids = free_ids | fixed_ids
    circuits = build_circuits(net_graph, all_ids)
    id_to_circuit = {}
    for circuit in circuits:
        for cid in circuit:
            id_to_circuit[cid] = circuit

    # Wave distances
    wave_map, orphans = compute_wave_distances(net_graph, fixed_ids, free_ids)
    max_wave = max(wave_map.values()) if wave_map else -1

    # Circuit areas
    circuit_area = {}
    for circuit in circuits:
        area = sum(comp_map[a].width * comp_map[a].height
                   for a in circuit if a in comp_map)
        circuit_area[id(circuit)] = area

    # Build grid
    zones = params.get("placement_exclusions", [])
    grid_points, grid_step = _build_multi_region_grid(
        ctx, len(comp_map), margin=1.0, zones=zones)

    # Build wavefront order
    ordered: list[str] = []
    for wave in range(max_wave + 1):
        wave_by_circuit: dict[int, list[str]] = defaultdict(list)
        for cid, w in wave_map.items():
            if w == wave:
                circuit = id_to_circuit.get(cid)
                if circuit is not None:
                    wave_by_circuit[id(circuit)].append(cid)

        sorted_cids = sorted(wave_by_circuit.keys(),
                             key=lambda c: -circuit_area.get(c, 0))
        for cid in sorted_cids:
            addrs = sorted(wave_by_circuit[cid],
                           key=lambda a: _comp_priority_key(comp_map[a]))
            ordered.extend(addrs)

    ordered.extend(sorted(orphans,
                          key=lambda a: _comp_priority_key(comp_map[a])))

    # Composite bypass cap placement: pre-compute cap positions relative
    # to each IC, expand IC padding to reserve space, then extract
    # individual cap positions after the IC is placed.
    bypass_map = ctx.bypass_map()
    bypass_ids = set(bypass_map.keys())
    ic_to_caps = _build_ic_to_caps(bypass_map)
    ordered = [cid for cid in ordered if cid not in bypass_ids]

    rot_net_graph = ctx.rotation_net_graph()

    # Pre-compute cap offsets for each IC and expand IC padding
    ic_offsets: dict[str, list[CapOffset]] = {}
    for ic_id, cap_ids in ic_to_caps.items():
        ic = ctx.get_component(ic_id)
        if ic is None:
            continue
        offsets = _compute_cap_offsets(ic, cap_ids, comp_map, rot_net_graph)
        if offsets:
            ic_offsets[ic_id] = offsets
            _expand_ic_for_caps(ic, offsets, comp_map)

    # Re-register fixed ICs with expanded padding
    for ic_id in fixed_ids:
        if ic_id in ic_offsets:
            ic = ctx.get_component(ic_id)
            if ic and ic.fixed:
                ctx.unregister(ic_id)
                ctx.register(ic, ic.x, ic.y, ic.side, rotation=ic.rotation)

    # Place
    auto_rotate = params.get("auto_rotate", False)
    placements: dict[str, PlacedComponent] = {}

    # Extract cap positions for fixed ICs
    for ic_id in fixed_ids:
        if ic_id not in ic_offsets:
            continue
        ic = ctx.get_component(ic_id)
        if ic is None or not ic.fixed:
            continue
        ic_p = PlacedComponent(component_id=ic_id,
                               x=ic.x, y=ic.y,
                               rotation=ic.rotation, side=ic.side)
        _extract_cap_placements(ic_p, ic, ic_offsets[ic_id],
                                ctx, placements)

    for cid in ordered:
        comp = comp_map[cid]

        # Pin-aware targeting: jointly optimize position + rotation
        tx, ty, rotation = _best_position_and_rotation(
            comp, rot_net_graph, placements, ctx)

        if not auto_rotate:
            rotation = 0.0

        gx, gy, grid_points = _claim_grid_point(
            grid_points, tx, ty, comp, grid_step,
            zones=zones, comp_id=cid)

        p = ctx.place_component_at_center(comp, gx, gy, rotation=rotation,
                                placed=placements)
        placements[cid] = p

        # Extract bypass cap positions from pre-computed offsets
        if cid in ic_offsets:
            _extract_cap_placements(p, comp, ic_offsets[cid],
                                    ctx, placements)

    return list(placements.values())


@register("wavefront_circuit")
def wavefront_circuit(board: Board, ctx: PlacementContext,
                      params: dict) -> list[PlacedComponent]:
    """Circuit-first variant: place all components of one module before next."""
    free_comps = ctx.free_components()
    if not free_comps:
        return []

    comp_map = {c.id: c for c in free_comps}
    free_ids = set(comp_map.keys())
    fixed_ids = {c.id for c in ctx.fixed_components()}
    net_graph = ctx.net_graph()

    # Wave distances
    wave_map, orphans = compute_wave_distances(net_graph, fixed_ids, free_ids)

    # Group by module prefix
    module_groups: dict[str, list[str]] = defaultdict(list)
    for cid in comp_map:
        prefix = cid.split(".")[0] if "." in cid else "_root"
        module_groups[prefix].append(cid)

    # Sort modules by total connections
    module_conns = {}
    for prefix, ids in module_groups.items():
        total = sum(len(comp_map[a].pins) for a in ids)
        module_conns[prefix] = total

    sorted_modules = sorted(module_groups.keys(),
                            key=lambda p: -module_conns.get(p, 0))

    def _priority(cid):
        wave = wave_map.get(cid, 999)
        comp = comp_map[cid]
        return (wave, _comp_priority_key(comp))

    # Build grid
    zones = params.get("placement_exclusions", [])
    grid_points, grid_step = _build_multi_region_grid(
        ctx, len(comp_map), zones=zones)

    auto_rotate = params.get("auto_rotate", False)
    placements: dict[str, PlacedComponent] = {}
    rot_net_graph = ctx.rotation_net_graph()

    # Composite bypass cap placement
    bypass_map = ctx.bypass_map()
    bypass_ids = set(bypass_map.keys())
    ic_to_caps = _build_ic_to_caps(bypass_map)

    # Pre-compute cap offsets and expand IC padding
    ic_offsets: dict[str, list[CapOffset]] = {}
    for ic_id, cap_ids in ic_to_caps.items():
        ic = ctx.get_component(ic_id)
        if ic is None:
            continue
        offsets = _compute_cap_offsets(ic, cap_ids, comp_map, rot_net_graph)
        if offsets:
            ic_offsets[ic_id] = offsets
            _expand_ic_for_caps(ic, offsets, comp_map)

    for ic_id in fixed_ids:
        if ic_id in ic_offsets:
            ic = ctx.get_component(ic_id)
            if ic and ic.fixed:
                ctx.unregister(ic_id)
                ctx.register(ic, ic.x, ic.y, ic.side, rotation=ic.rotation)

    # Extract cap positions for fixed ICs
    for ic_id in fixed_ids:
        if ic_id not in ic_offsets:
            continue
        ic = ctx.get_component(ic_id)
        if ic is None or not ic.fixed:
            continue
        ic_p = PlacedComponent(component_id=ic_id,
                               x=ic.x, y=ic.y,
                               rotation=ic.rotation, side=ic.side)
        _extract_cap_placements(ic_p, ic, ic_offsets[ic_id], ctx, placements)

    for prefix in sorted_modules:
        module_ids = [a for a in module_groups[prefix]
                      if a in comp_map and a not in bypass_ids]
        if not module_ids:
            continue
        module_ids.sort(key=_priority)

        for cid in module_ids:
            comp = comp_map[cid]
            tx, ty, rotation = _best_position_and_rotation(
                comp, rot_net_graph, placements, ctx)

            if not auto_rotate:
                rotation = 0.0

            gx, gy, grid_points = _claim_grid_point(
                grid_points, tx, ty, comp, grid_step,
                zones=zones, comp_id=cid)

            p = ctx.place_component_at_center(comp, gx, gy, rotation=rotation,
                                    placed=placements)
            placements[cid] = p

            if cid in ic_offsets:
                _extract_cap_placements(p, comp, ic_offsets[cid], ctx, placements)

    # Orphans last (excluding bypass caps)
    orphan_ids = sorted([o for o in orphans if o not in bypass_ids],
                        key=lambda a: _comp_priority_key(comp_map[a]))
    for cid in orphan_ids:
        comp = comp_map[cid]
        tx, ty, rotation = _best_position_and_rotation(
            comp, rot_net_graph, placements, ctx)
        if not auto_rotate:
            rotation = 0.0
        gx, gy, grid_points = _claim_grid_point(
            grid_points, tx, ty, comp, grid_step,
            zones=zones, comp_id=cid)
        p = ctx.place_component_at_center(comp, gx, gy, rotation=rotation,
                                          placed=placements)
        placements[cid] = p
        if cid in ic_offsets:
            _extract_cap_placements(p, comp, ic_offsets[cid], ctx, placements)

    return list(placements.values())


@register("wavefront_direct")
def wavefront_direct(board: Board, ctx: PlacementContext,
                     params: dict) -> list[PlacedComponent]:
    """Two-pass BFS wavefront with direct pin-aware placement.

    Pass 1: Place at pin-edge connectivity targets.
    Pass 2: Compute alignment padding, re-place with spacing.
    """
    free_comps = ctx.free_components()
    if not free_comps:
        return []

    comp_map = {c.id: c for c in free_comps}
    free_ids = set(comp_map.keys())
    fixed_ids = {c.id for c in ctx.fixed_components()}
    net_graph = ctx.net_graph()

    # Build circuits + waves
    all_ids = free_ids | fixed_ids
    circuits = build_circuits(net_graph, all_ids)
    id_to_circuit = {}
    for circuit in circuits:
        for cid in circuit:
            id_to_circuit[cid] = circuit

    wave_map, orphans = compute_wave_distances(net_graph, fixed_ids, free_ids)
    max_wave = max(wave_map.values()) if wave_map else -1

    circuit_area = {}
    for circuit in circuits:
        area = sum(comp_map[a].width * comp_map[a].height
                   for a in circuit if a in comp_map)
        circuit_area[id(circuit)] = area

    # Build order
    ordered: list[str] = []
    for wave in range(max_wave + 1):
        wave_by_circuit: dict[int, list[str]] = defaultdict(list)
        for cid, w in wave_map.items():
            if w == wave:
                circuit = id_to_circuit.get(cid)
                if circuit is not None:
                    wave_by_circuit[id(circuit)].append(cid)

        sorted_cids = sorted(wave_by_circuit.keys(),
                             key=lambda c: -circuit_area.get(c, 0))
        for cid in sorted_cids:
            addrs = sorted(wave_by_circuit[cid],
                           key=lambda a: _comp_priority_key(comp_map[a]))
            ordered.extend(addrs)

    ordered.extend(sorted(orphans,
                          key=lambda a: _comp_priority_key(comp_map[a])))

    # Composite bypass cap placement
    bypass_map = ctx.bypass_map()
    bypass_ids = set(bypass_map.keys())
    ic_to_caps = _build_ic_to_caps(bypass_map)
    ordered = [cid for cid in ordered if cid not in bypass_ids]

    auto_rotate = params.get("auto_rotate", False)
    rot_net_graph = ctx.rotation_net_graph()

    # Pre-compute cap offsets and expand IC padding
    ic_offsets: dict[str, list[CapOffset]] = {}
    for ic_id, cap_ids in ic_to_caps.items():
        ic = ctx.get_component(ic_id)
        if ic is None:
            continue
        offsets = _compute_cap_offsets(ic, cap_ids, comp_map, rot_net_graph)
        if offsets:
            ic_offsets[ic_id] = offsets
            _expand_ic_for_caps(ic, offsets, comp_map)

    for ic_id in fixed_ids:
        if ic_id in ic_offsets:
            ic = ctx.get_component(ic_id)
            if ic and ic.fixed:
                ctx.unregister(ic_id)
                ctx.register(ic, ic.x, ic.y, ic.side, rotation=ic.rotation)

    placements: dict[str, PlacedComponent] = {}

    # Extract cap positions for fixed ICs
    for ic_id in fixed_ids:
        if ic_id not in ic_offsets:
            continue
        ic = ctx.get_component(ic_id)
        if ic is None or not ic.fixed:
            continue
        ic_p = PlacedComponent(component_id=ic_id,
                               x=ic.x, y=ic.y,
                               rotation=ic.rotation, side=ic.side)
        _extract_cap_placements(ic_p, ic, ic_offsets[ic_id], ctx, placements)

    for cid in ordered:
        comp = comp_map[cid]
        tx, ty, rotation = _best_position_and_rotation(
            comp, rot_net_graph, placements, ctx)

        if not auto_rotate:
            rotation = 0.0

        pad = _escape_padding(comp)
        p = ctx.place_component_at_center(comp, tx, ty, rotation=rotation,
                                placed=placements, padding=pad)
        placements[cid] = p

        if cid in ic_offsets:
            _extract_cap_placements(p, comp, ic_offsets[cid], ctx, placements)

    return list(placements.values())
