"""Top-level board overview renderer.

Renders one SVG per board showing each subcircuit as a box, with
inter-subcircuit nets drawn as labeled lines between boxes. Power nets
are routed to a distinct bottom bus to avoid visual clutter.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from review import classify, layout


# ---------------------------------------------------------------------------
# Constants / style
# ---------------------------------------------------------------------------

OV_PAGE_PAD = 30.0
OV_TITLE_HEIGHT = 30.0
OV_BUS_HEIGHT = 40.0   # reserved at the bottom for the power bus

CSS = """
  .ov-title { font: bold 11px -apple-system, 'Helvetica Neue', sans-serif;
              fill: #111; }
  .ov-subtitle { font: 5px -apple-system, 'Helvetica Neue', sans-serif;
                 fill: #666; }
  .sub-box { fill: #fffbe6; stroke: #222; stroke-width: 0.9; rx: 2; ry: 2; }
  .sub-box-int { fill: #e8f0fa; stroke: #222; stroke-width: 0.9; rx: 2; ry: 2; }
  .sub-name { font: bold 5px -apple-system, 'Helvetica Neue', sans-serif;
              fill: #111; text-anchor: middle; }
  .sub-count { font: 3.5px -apple-system, 'Helvetica Neue', sans-serif;
               fill: #666; text-anchor: middle; }
  .edge { stroke: #5c6bc0; stroke-width: 0.8; fill: none; opacity: 0.7; }
  .edge-label { font: 3px 'Menlo', 'SF Mono', monospace; fill: #283593;
                text-anchor: middle; }
  .power-bus { fill: #fff3e6; stroke: #b04500; stroke-width: 1.2;
               stroke-dasharray: 3,2; }
  .power-bus-label { font: bold 4px -apple-system, sans-serif; fill: #b04500;
                     text-anchor: middle; }
  .power-edge { stroke: #b04500; stroke-width: 0.7; opacity: 0.55; }
  .power-net-text { font: 3px 'Menlo', monospace; fill: #b04500;
                    text-anchor: middle; }
  .panel-border { stroke: #888; stroke-width: 0.4; fill: none; }
  .page-bg { fill: #ffffff; }
"""


@dataclass
class _OverviewBox:
    """Subcircuit box with position (cx, cy) at its center."""
    key: str
    width: float
    height: float
    cx: float = 0.0
    cy: float = 0.0


def _escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _is_interface_subcircuit(name: str) -> bool:
    """Connectors/external interfaces get a different fill color."""
    interface_hints = (
        "connector", "usb", "sd", "lcd", "fpc", "midi", "enc_",
        "swd", "header", "jack",
    )
    return any(h in name.lower() for h in interface_hints)


# ---------------------------------------------------------------------------
# Sizing
# ---------------------------------------------------------------------------

def _subcircuit_box_size(comp_count: int) -> tuple[float, float]:
    """Return (width, height) for a subcircuit box scaled by its component count.

    Uses a logarithmic scale so a 79-component DAC doesn't dwarf a 1-component
    connector, but the relative size is still visible.
    """
    base_w = 50.0
    base_h = 30.0
    # Cap scale factor between 1.0 and 2.2
    scale = 1.0 + min(1.2, math.log10(max(1, comp_count)) * 0.7)
    return base_w * scale, base_h * scale


# ---------------------------------------------------------------------------
# Overview rendering
# ---------------------------------------------------------------------------

def render_overview(
    board_data: dict[str, Any],
    out_path: str,
) -> tuple[float, float]:
    """Render the top-level overview SVG for one board.

    Returns (width, height) of the SVG.
    """
    board_name = board_data["board"]
    subcircuits = board_data["subcircuits"]
    cross_nets = board_data["cross_subcircuit_nets"]

    # Sort subcircuits by component count (largest first) so big blocks
    # (dac, buttons, etc.) land in the top row of the grid.
    sub_order = sorted(
        subcircuits.keys(),
        key=lambda k: -len(subcircuits[k]["components"]),
    )

    # Build sizable boxes, scaled by component count
    nodes: list[_OverviewBox] = []
    node_by_key: dict[str, _OverviewBox] = {}
    for name in sub_order:
        comp_count = len(subcircuits[name]["components"])
        w, h = _subcircuit_box_size(comp_count)
        box = _OverviewBox(key=name, width=w, height=h)
        nodes.append(box)
        node_by_key[name] = box

    # Split nets: power → bus, signal → direct edges
    signal_edges: list[tuple[str, str, str]] = []
    power_nets: dict[str, set[str]] = {}

    for entry in cross_nets:
        net = entry["net"]
        subs = [s for s in entry["subcircuits"] if s in node_by_key]
        if len(subs) < 2:
            continue
        if classify.is_power_net(net):
            power_nets.setdefault(net, set()).update(subs)
            continue
        # For signal nets spanning ≥3 subcircuits, draw a star — connect the
        # first (by sort order) to all the others.
        subs_sorted = sorted(subs, key=lambda s: sub_order.index(s))
        hub = subs_sorted[0]
        for other in subs_sorted[1:]:
            signal_edges.append((hub, other, net))

    # Grid placement — no overlaps, predictable, biggest blocks on top row.
    placed, grid_w, grid_h = layout.grid_place(
        nodes,
        cols=None,
        col_gap=35.0,
        row_gap=35.0,
        margin=OV_PAGE_PAD,
    )
    for pi in placed:
        box = pi.item
        box.cx = pi.x + box.width / 2
        box.cy = pi.y + box.height / 2 + OV_TITLE_HEIGHT

    total_w = grid_w
    total_h = grid_h + OV_TITLE_HEIGHT + OV_BUS_HEIGHT

    svg_body: list[str] = []

    # Background + border
    svg_body.append(
        f'<rect x="0" y="0" width="{total_w:.2f}" height="{total_h:.2f}" '
        f'class="page-bg"/>'
    )
    svg_body.append(
        f'<rect x="5" y="5" width="{total_w - 10:.2f}" '
        f'height="{total_h - 10:.2f}" class="panel-border"/>'
    )

    # Title
    total_comp_count = sum(
        len(subcircuits[k]["components"]) for k in subcircuits
    )
    svg_body.append(
        f'<g class="title-block">'
        f'<text x="{total_w/2:.2f}" y="16" class="ov-title" '
        f'text-anchor="middle">{_escape(board_name)} — board overview</text>'
        f'<text x="{total_w/2:.2f}" y="23" class="ov-subtitle" '
        f'text-anchor="middle">'
        f'{len(subcircuits)} subcircuits · {total_comp_count} components · '
        f'{len(cross_nets)} cross-block nets</text>'
        f'</g>'
    )

    # Draw signal edges as straight lines first (behind boxes)
    drawn_edge_pairs: set[tuple[str, str]] = set()
    for a, b, net in signal_edges:
        pair = (min(a, b), max(a, b))
        if pair in drawn_edge_pairs:
            continue
        drawn_edge_pairs.add(pair)
        na = node_by_key[a]
        nb = node_by_key[b]
        svg_body.append(
            f'<line x1="{na.cx:.2f}" y1="{na.cy:.2f}" '
            f'x2="{nb.cx:.2f}" y2="{nb.cy:.2f}" class="edge"/>'
        )
        # Edge label: sum of all net names that cross this pair
        nets_for_pair = sorted(
            {n for s1, s2, n in signal_edges
             if (min(s1, s2), max(s1, s2)) == pair}
        )
        label = ", ".join(nets_for_pair[:3])
        if len(nets_for_pair) > 3:
            label += f" +{len(nets_for_pair) - 3}"
        mid_x = (na.cx + nb.cx) / 2
        mid_y = (na.cy + nb.cy) / 2
        svg_body.append(
            f'<text x="{mid_x:.2f}" y="{mid_y - 1:.2f}" '
            f'class="edge-label">{_escape(label)}</text>'
        )

    # Draw subcircuit boxes
    for node in nodes:
        cls = "sub-box-int" if _is_interface_subcircuit(node.key) else "sub-box"
        x = node.cx - node.width / 2
        y = node.cy - node.height / 2
        comp_count = len(subcircuits[node.key]["components"])
        svg_body.append(
            f'<rect x="{x:.2f}" y="{y:.2f}" '
            f'width="{node.width:.2f}" height="{node.height:.2f}" class="{cls}"/>'
            f'<text x="{node.cx:.2f}" y="{node.cy - 1:.2f}" class="sub-name">'
            f'{_escape(node.key)}</text>'
            f'<text x="{node.cx:.2f}" y="{node.cy + 5:.2f}" class="sub-count">'
            f'{comp_count} component{"s" if comp_count != 1 else ""}</text>'
        )

    # Power bus at bottom
    if power_nets:
        bus_y = total_h - OV_BUS_HEIGHT + 6
        bus_x = OV_PAGE_PAD
        bus_w = total_w - 2 * OV_PAGE_PAD
        bus_h = 18
        svg_body.append(
            f'<rect x="{bus_x:.2f}" y="{bus_y:.2f}" '
            f'width="{bus_w:.2f}" height="{bus_h:.2f}" class="power-bus"/>'
            f'<text x="{total_w/2:.2f}" y="{bus_y - 2:.2f}" class="power-bus-label">'
            f'POWER BUS</text>'
        )

        sorted_power = sorted(power_nets.keys())
        if sorted_power:
            step = bus_w / max(1, len(sorted_power))
            for i, net in enumerate(sorted_power):
                x = bus_x + step * (i + 0.5)
                svg_body.append(
                    f'<text x="{x:.2f}" y="{bus_y + bus_h/2 + 1:.2f}" '
                    f'class="power-net-text">{_escape(net)}</text>'
                )
                # Draw a dotted line from each connected subcircuit to the bus
                for sub in power_nets[net]:
                    node = node_by_key[sub]
                    svg_body.append(
                        f'<line x1="{node.cx:.2f}" y1="{node.cy + node.height/2:.2f}" '
                        f'x2="{x:.2f}" y2="{bus_y:.2f}" class="power-edge"/>'
                    )

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {total_w:.2f} {total_h:.2f}" '
        f'width="{total_w*2:.0f}" height="{total_h*2:.0f}">'
        f'<style>{CSS}</style>'
        + "".join(svg_body)
        + "</svg>"
    )

    with open(out_path, "w") as f:
        f.write(svg)

    return total_w, total_h
