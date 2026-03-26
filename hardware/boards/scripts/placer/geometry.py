"""Pure coordinate math for rectangle placement.

All functions are stateless. No external dependencies beyond types.
Rotation convention: positive degrees = CCW viewed from front (KiCad convention).
Only 0/90/180/270 supported.
"""

from __future__ import annotations

from .dtypes import Component, Pin, Side, SidePadding


def rotated_dims(width: float, height: float, rotation: float) -> tuple[float, float]:
    """Return (width, height) after rotation (0/90/180/270)."""
    deg = int(rotation) % 360
    if deg in (90, 270):
        return height, width
    return width, height


def rotate_point(px: float, py: float, w: float, h: float,
                 rotation: float) -> tuple[float, float]:
    """Rotate a point (px, py) within a rect of size (w, h).

    Point is relative to bbox top-left at rotation=0.
    Returns new (px, py) relative to the rotated bbox top-left.
    CCW rotation convention.
    """
    deg = int(rotation) % 360
    if deg == 0:
        return px, py
    if deg == 90:
        # (px, py) -> (py, w - px)  but new bbox is (h, w)
        return py, w - px
    if deg == 180:
        return w - px, h - py
    if deg == 270:
        return h - py, px
    raise ValueError(f"Only 0/90/180/270 supported, got {rotation}")


def mirror_x_point(px: float, width: float) -> float:
    """Mirror a point horizontally (for back-side flip).

    Returns new x coordinate within the same width.
    """
    return width - px


def effective_point(px: float, py: float, w: float, h: float,
                    rotation: float, side: Side) -> tuple[float, float]:
    """Transform a pin position for actual placement geometry.

    For FRONT: just rotate.
    For BACK: mirror X first (physical flip), then rotate.
    """
    x, y = px, py
    if side == Side.BACK:
        x = mirror_x_point(x, w)
    return rotate_point(x, y, w, h, rotation)


def effective_dims(comp: Component, rotation: float) -> tuple[float, float]:
    """Return effective (width, height) of component after rotation."""
    return rotated_dims(comp.width, comp.height, rotation)


def padded_rect(x: float, y: float, w: float, h: float,
                padding: SidePadding,
                rotation: float = 0.0) -> tuple[float, float, float, float]:
    """Return (x, y, w, h) expanded by rotated padding.

    Padding sides rotate with the component.
    """
    # Rotate the padding to match component rotation
    top, right, bottom, left = _rotate_padding(padding, rotation)
    return (x - left, y - top, w + left + right, h + top + bottom)


def _rotate_padding(padding: SidePadding, rotation: float) -> tuple[float, float, float, float]:
    """Rotate padding (top, right, bottom, left) by rotation degrees CCW.

    Returns (top, right, bottom, left) after rotation.
    """
    deg = int(rotation) % 360
    t, r, b, l = padding.top, padding.right, padding.bottom, padding.left
    if deg == 0:
        return t, r, b, l
    if deg == 90:
        return r, b, l, t
    if deg == 180:
        return b, l, t, r
    if deg == 270:
        return l, t, r, b
    raise ValueError(f"Only 0/90/180/270 supported, got {rotation}")


def center_of_rect(x: float, y: float, w: float, h: float) -> tuple[float, float]:
    """Return center (cx, cy) of a rectangle given top-left (x, y) and dims."""
    return x + w / 2, y + h / 2


def topleft_from_center(cx: float, cy: float, w: float, h: float) -> tuple[float, float]:
    """Return top-left (x, y) given center and dims."""
    return cx - w / 2, cy - h / 2


def pin_world_position(comp: Component, pin: Pin,
                       x: float, y: float,
                       rotation: float, side: Side) -> tuple[float, float]:
    """World position of a pin given component placement.

    Args:
        comp: The component (for width/height at rotation=0)
        pin: The pin (position relative to bbox top-left at rot=0, front)
        x, y: Component bbox top-left in world coords
        rotation: Component rotation
        side: Which side the component is on
    """
    px, py = effective_point(pin.x, pin.y, comp.width, comp.height,
                             rotation, side)
    return x + px, y + py


def classify_pins_by_edge(comp: Component) -> dict[str, list[Pin]]:
    """Classify pins into N/S/E/W edges based on position within bbox.

    Uses the same algorithm as the original extract_pad_sides:
    finds extent of pins, skips center/thermal pins, assigns to nearest edge.
    """
    if not comp.pins:
        return {"N": [], "S": [], "E": [], "W": []}

    xs = [p.x for p in comp.pins]
    ys = [p.y for p in comp.pins]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    cx = (min_x + max_x) / 2
    cy = (min_y + max_y) / 2
    span_x = max_x - min_x
    span_y = max_y - min_y

    center_thresh_x = span_x * 0.2 if span_x > 0 else 0.1
    center_thresh_y = span_y * 0.2 if span_y > 0 else 0.1

    sides: dict[str, list[Pin]] = {"N": [], "S": [], "E": [], "W": []}

    for pin in comp.pins:
        # Skip center/thermal pads
        if (abs(pin.x - cx) < center_thresh_x and
                abs(pin.y - cy) < center_thresh_y):
            continue

        dist_w = abs(pin.x - min_x)
        dist_e = abs(pin.x - max_x)
        dist_n = abs(pin.y - min_y)
        dist_s = abs(pin.y - max_y)

        min_dist = min(dist_w, dist_e, dist_n, dist_s)
        if min_dist == dist_w:
            sides["W"].append(pin)
        elif min_dist == dist_e:
            sides["E"].append(pin)
        elif min_dist == dist_n:
            sides["N"].append(pin)
        else:
            sides["S"].append(pin)

    return sides


def rotate_edge_map(edge_map: dict[str, list], rotation: float) -> dict[str, list]:
    """Rotate an N/S/E/W edge mapping by rotation degrees CCW.

    Works for any dict with N/S/E/W keys.
    """
    deg = int(rotation) % 360
    if deg == 0:
        return dict(edge_map)
    # CCW rotation: N→W, W→S, S→E, E→N per 90° step
    _CCW = {"N": "W", "W": "S", "S": "E", "E": "N"}
    steps = {90: 1, 180: 2, 270: 3}.get(deg)
    if steps is None:
        raise ValueError(f"Only 0/90/180/270 supported, got {rotation}")
    mapping = dict(_CCW)
    for _ in range(steps - 1):
        mapping = {k: _CCW[v] for k, v in mapping.items()}
    return {mapping[edge]: list(v) for edge, v in edge_map.items()}


def mirror_x_edge_map(edge_map: dict[str, list]) -> dict[str, list]:
    """Mirror an edge mapping across X-axis (back-side flip).

    Swaps E <-> W. N and S unchanged.
    """
    _MIRROR = {"E": "W", "W": "E", "N": "N", "S": "S"}
    return {_MIRROR[edge]: list(v) for edge, v in edge_map.items()}


def effective_edge_map(edge_map: dict[str, list], rotation: float,
                       side: Side) -> dict[str, list]:
    """Get edge map with effective geometry for a given side and rotation."""
    result = edge_map
    if side == Side.BACK:
        result = mirror_x_edge_map(result)
    return rotate_edge_map(result, rotation)


def edge_offset(edge: str, distance: float) -> tuple[float, float]:
    """Return (dx, dy) offset for a given edge direction and distance."""
    offsets = {
        "W": (-distance, 0.0),
        "E": (distance, 0.0),
        "N": (0.0, -distance),
        "S": (0.0, distance),
    }
    return offsets.get(edge, (0.0, 0.0))


OPPOSITE_EDGE = {"N": "S", "S": "N", "E": "W", "W": "E"}
