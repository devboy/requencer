"""KiCad ↔ Placer translation layer.

Converts KiCad footprints into placer's simple rectangle model and
applies placement results back. This module is the ONLY place where
pcbnew concepts appear — the placer library itself never imports pcbnew.

Coordinate model:
  - KiCad uses footprint origin (pin 1 for THT, pad center for SMD)
  - Placer uses bbox top-left
  - This module stores the offset between them per component and
    converts in both directions.
"""

from __future__ import annotations

from collections import defaultdict

from .dtypes import (
    AffinityRule, BlockedZone, Board, Component, Net, Pin,
    PlacedComponent, Side, SidePadding, ZoneSide,
)


# ---------------------------------------------------------------------------
# Extraction: KiCad → Placer
# ---------------------------------------------------------------------------


class ComponentBridge:
    """Holds the conversion data for one component."""
    __slots__ = ("component", "origin_to_bbox_dx", "origin_to_bbox_dy",
                 "raw_width", "raw_height", "cx_off", "cy_off")

    def __init__(self, component: Component,
                 origin_to_bbox_dx: float, origin_to_bbox_dy: float,
                 raw_width: float, raw_height: float,
                 cx_off: float, cy_off: float):
        self.component = component
        # Offset from footprint origin to bbox top-left at rotation=0
        self.origin_to_bbox_dx = origin_to_bbox_dx
        self.origin_to_bbox_dy = origin_to_bbox_dy
        # Raw dimensions before padding (for coordinate conversion back)
        self.raw_width = raw_width
        self.raw_height = raw_height
        # Bbox center offset from origin at rotation=0
        self.cx_off = cx_off
        self.cy_off = cy_off


def extract_component(addr: str, fp, pcbnew, power_nets: set[str],
                      is_fixed: bool = False,
                      fixed_x: float = 0.0, fixed_y: float = 0.0,
                      fixed_side: str = "F",
                      fixed_rotation: float = 0.0,
                      ) -> ComponentBridge:
    """Extract a placer Component from a KiCad footprint.

    Measures the footprint at rotation=0, position=(0,0) to get the
    canonical (unrotated) dimensions and origin-to-bbox offset.

    For fixed components, computes the actual bbox top-left in world
    coords accounting for rotation and side.

    Returns a ComponentBridge holding the Component and the coordinate
    offset needed to convert back to KiCad's footprint origin.
    """
    # Save current state
    orig_pos = fp.GetPosition()
    orig_rot = fp.GetOrientationDegrees()
    orig_layer = fp.GetLayer()

    # Reset to rotation=0, position=(0,0) for measurement
    # If the footprint was flipped to B.Cu, flip it back to F.Cu first
    is_on_back = orig_layer != fp.GetBoard().GetLayerID("F.Cu") if fp.GetBoard() else False
    if is_on_back:
        fp.Flip(fp.GetPosition(), False)
    fp.SetOrientationDegrees(0)
    fp.SetPosition(pcbnew.VECTOR2I(0, 0))

    # Measure bbox at rotation=0
    bbox = fp.GetBoundingBox(False, False)
    w = max(pcbnew.ToMM(bbox.GetWidth()), 1.0)
    h = max(pcbnew.ToMM(bbox.GetHeight()), 1.0)
    # cx_offset/cy_offset = bbox center relative to footprint origin at rot=0
    cx_off = (pcbnew.ToMM(bbox.GetLeft()) + pcbnew.ToMM(bbox.GetRight())) / 2
    cy_off = (pcbnew.ToMM(bbox.GetTop()) + pcbnew.ToMM(bbox.GetBottom())) / 2

    # Offset from fp origin to bbox top-left at rotation=0
    origin_to_bbox_dx = cx_off - w / 2
    origin_to_bbox_dy = cy_off - h / 2

    # Extract pin positions relative to bbox top-left at rotation=0.
    # Include ALL pads (signal + power) so rotation scoring can orient
    # bypass caps toward their parent IC's power pins.
    pins = []
    for pad in fp.Pads():
        net_name = pad.GetNetname()
        if not net_name:
            continue
        pos = pad.GetPosition()
        # Pad position relative to fp origin (which is at 0,0 now, rot=0)
        pad_rel_x = pcbnew.ToMM(pos.x)
        pad_rel_y = pcbnew.ToMM(pos.y)
        # Convert to bbox-relative
        pin_x = pad_rel_x - origin_to_bbox_dx
        pin_y = pad_rel_y - origin_to_bbox_dy
        pins.append(Pin(id=net_name, x=pin_x, y=pin_y))

    # Restore original state
    if is_on_back:
        # Put back on B.Cu: flip, then set rotation, then position
        fp.SetPosition(orig_pos)
        fp.Flip(fp.GetPosition(), False)
        fp.SetOrientationDegrees(orig_rot)
    else:
        fp.SetOrientationDegrees(orig_rot)
        fp.SetPosition(orig_pos)

    # Tags
    is_tht = any(pad.GetAttribute() == pcbnew.PAD_ATTRIB_PTH
                 for pad in fp.Pads())
    tags = {"tht"} if is_tht else {"smd"}

    # Group from address prefix
    group = addr.split(".")[0] if "." in addr else None

    # Compute fixed component's bbox top-left in world coords.
    # The center offset (cx_off, cy_off) gets rotated (and mirrored for
    # B.Cu), then we subtract half the rotated dims to get top-left.
    if is_fixed:
        co_x, co_y = cx_off, cy_off
        if fixed_side == "B":
            co_x = -co_x  # B.Cu mirrors X
        rco_x, rco_y = _rotate_offset(co_x, co_y, fixed_rotation)
        from .geometry import rotated_dims
        ew, eh = rotated_dims(w, h, fixed_rotation)
        comp_x = fixed_x + rco_x - ew / 2
        comp_y = fixed_y + rco_y - eh / 2
    else:
        comp_x = 0.0
        comp_y = 0.0

    side = Side.FRONT if fixed_side == "F" else Side.BACK
    comp = Component(
        id=addr,
        width=w,
        height=h,
        pins=pins,
        tags=tags,
        fixed=is_fixed,
        x=comp_x,
        y=comp_y,
        rotation=fixed_rotation if is_fixed else 0.0,
        side=side if is_fixed else Side.FRONT,
        group=group,
    )

    return ComponentBridge(comp, origin_to_bbox_dx, origin_to_bbox_dy,
                           raw_width=w, raw_height=h,
                           cx_off=cx_off, cy_off=cy_off)


def extract_nets(addr_map: dict, pcbnew, power_nets: set[str],
                 include_power: bool = False) -> list[Net]:
    """Extract Net objects from KiCad board footprints.

    Each net connects component pins. Uses net names as pin IDs
    (matching the pin IDs used in extract_component).

    When include_power=False (default), power/bus nets are excluded.
    This is used for placement ordering (signal connectivity graph).

    When include_power=True, all nets are included. This is used for
    rotation scoring where even power pad orientation matters.
    """
    net_to_connections: dict[str, list[tuple[str, str]]] = defaultdict(list)

    for addr, fp in addr_map.items():
        for pad in fp.Pads():
            net_name = pad.GetNetname()
            if not net_name:
                continue
            if not include_power and net_name in power_nets:
                continue
            net_to_connections[net_name].append((addr, net_name))

    nets = []
    for net_name, connections in net_to_connections.items():
        # Only include nets with 2+ components
        comp_ids = {c[0] for c in connections}
        if len(comp_ids) >= 2:
            # Deduplicate: one connection per component per net
            seen = set()
            deduped = []
            for comp_id, pin_id in connections:
                if comp_id not in seen:
                    seen.add(comp_id)
                    deduped.append((comp_id, pin_id))
            nets.append(Net(id=net_name, connections=tuple(deduped)))

    return nets


def build_placer_board(
    board_w: float,
    board_h: float,
    bridges: dict[str, ComponentBridge],
    nets: list[Net],
    affinity_rules: list[AffinityRule] | None = None,
    zones: list[BlockedZone] | None = None,
    clearance: float = 0.5,
    tht_clearance: float = 0.0,
    smd_side: str = "both",
    rotation_nets: list[Net] | None = None,
    power_nets: frozenset[str] | None = None,
) -> Board:
    """Build a placer Board from extracted data."""
    components = [b.component for b in bridges.values()]
    return Board(
        width=board_w,
        height=board_h,
        components=components,
        nets=nets,
        rotation_nets=rotation_nets or [],
        zones=zones or [],
        affinity_rules=affinity_rules or [],
        clearance=clearance,
        tht_clearance=tht_clearance,
        smd_side=smd_side,
        power_nets=power_nets or frozenset(),
    )


# ---------------------------------------------------------------------------
# Application: Placer → KiCad
# ---------------------------------------------------------------------------


def apply_placements(results: list[PlacedComponent],
                     bridges: dict[str, ComponentBridge],
                     addr_map: dict,
                     kicad_board,
                     pcbnew) -> int:
    """Apply placer results back to KiCad footprints.

    Converts bbox top-left coordinates back to footprint origin,
    sets position, side, and rotation.

    Returns number of components applied.
    """
    count = 0
    for placed in results:
        addr = placed.component_id
        if addr not in addr_map or addr not in bridges:
            continue

        fp = addr_map[addr]
        bridge = bridges[addr]

        # Convert bbox top-left → footprint origin.
        # The placer works with padded dimensions, but the origin-to-center
        # offset is from the raw footprint. Use raw dims to find bbox center,
        # then subtract the rotated center offset to get origin.
        from .geometry import rotated_dims
        ew, eh = rotated_dims(bridge.component.width, bridge.component.height,
                              placed.rotation)
        bcx = placed.x + ew / 2
        bcy = placed.y + eh / 2

        co_x, co_y = bridge.cx_off, bridge.cy_off
        if placed.side == Side.BACK:
            co_x = -co_x
        rco_x, rco_y = _rotate_offset(co_x, co_y, placed.rotation)

        fp_x = bcx - rco_x
        fp_y = bcy - rco_y

        fp.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(fp_x),
                                        pcbnew.FromMM(fp_y)))

        # Set side
        target_front = placed.side == Side.FRONT
        current_front = fp.GetLayer() == kicad_board.GetLayerID("F.Cu")
        if target_front != current_front:
            fp.Flip(fp.GetPosition(), False)

        # Additive rotation: placer rotation is on top of flip.
        current_rot = fp.GetOrientationDegrees()
        fp.SetOrientationDegrees(current_rot + placed.rotation)

        count += 1

    return count


def _rotate_offset(dx: float, dy: float,
                   rotation: float) -> tuple[float, float]:
    """Rotate an offset vector by rotation degrees CCW."""
    deg = int(rotation) % 360
    if deg == 0:
        return dx, dy
    if deg == 90:
        return dy, -dx
    if deg == 180:
        return -dx, -dy
    if deg == 270:
        return -dy, dx
    return dx, dy  # Fallback
