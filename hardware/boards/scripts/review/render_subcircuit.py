"""Per-subcircuit SVG renderer.

Consumes the extract.py JSON schema + symbols.py + layout.py to produce
one SVG file per subcircuit. The rendering style is "flat net-label
schematic" — components are drawn with proper symbols, pins are terminated
with short stubs and labeled with the net name. No wires are drawn between
components; reviewers follow net names instead. This sidesteps the auto-
routing problem entirely and is a legitimate style for dense professional
schematics.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from review import classify, layout, symbols


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PIN_STUB_LENGTH = 4.0          # how far a pin extends before its net label
NET_LABEL_MAX_CHARS = 24       # truncate longer net names
TITLE_HEIGHT = 26.0            # vertical space reserved at top for title block

# Padding added around the entire grid so rotated top/bottom labels and
# long side labels never clip the SVG viewBox.
PAGE_PAD = 40.0

# Grid inner margin — kept as a named constant so we can reliably undo it
# when offsetting into the SVG's padded layout.
GRID_MARGIN = 0.0


# Stylesheet embedded in every rendered SVG.
CSS = """
  .title { font: bold 5.5px -apple-system, 'Helvetica Neue', sans-serif;
           fill: #111; }
  .subtitle { font: 3.5px -apple-system, 'Helvetica Neue', sans-serif;
              fill: #666; }
  .refdes { font: bold 2.6px -apple-system, 'Helvetica Neue', sans-serif;
            fill: #111; }
  .value { font: 2.3px -apple-system, 'Helvetica Neue', sans-serif;
           fill: #444; }
  .netlabel { font: 2.2px 'Menlo', 'SF Mono', monospace; fill: #0b4fad; }
  .netlabel-power { font: bold 2.2px 'Menlo', 'SF Mono', monospace;
                    fill: #b04500; }
  .padnum { font: 1.8px 'Menlo', 'SF Mono', monospace; fill: #888; }

  .body-stroke { stroke: #222; stroke-width: 0.35; fill: none; }
  .body-fill { fill: #fffbe6; }
  .conn-fill { fill: #e8f0fa; }
  .lead { stroke: #222; stroke-width: 0.35; }
  .plate { stroke: #222; stroke-width: 0.5; }
  .cathode-bar { stroke: #222; stroke-width: 0.6; }
  .arc { stroke: #222; stroke-width: 0.35; fill: none; }
  .led-ray { stroke: #c86a00; stroke-width: 0.3; }
  .polarity { font: bold 2px 'Helvetica'; fill: #b04500; }
  .stub { stroke: #555; stroke-width: 0.3; }
  .stub-power { stroke: #b04500; stroke-width: 0.45; }
  .panel-border { stroke: #888; stroke-width: 0.4; fill: none; }
  .section-box { fill: #f8f8f8; stroke: #ccc; stroke-width: 0.25; }
  .page-bg { fill: #ffffff; }
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _truncate(s: str, n: int = NET_LABEL_MAX_CHARS) -> str:
    return s if len(s) <= n else s[: n - 1] + "…"


@dataclass
class PlacedComponent:
    """A Symbol placed at a grid location, plus the source component dict."""
    comp: dict[str, Any]
    symbol: symbols.Symbol
    x: float
    y: float
    # Derived for convenience: bounding box including label margins
    width: float = 0.0
    height: float = 0.0


def _pin_stub_svg(side: str, ax: float, ay: float, net_name: str, pad_num: str) -> str:
    """Render a pin stub + net label at absolute pin position (ax, ay).

    Returns a chunk of SVG. Handles L/R/T/B sides with appropriate
    text rotation so labels don't overlap the symbol body.
    """
    if not net_name:
        # Unconnected pin — draw a small "NC" mark
        net_name = "NC"
    is_power = classify.is_power_net(net_name)
    net_class = "netlabel-power" if is_power else "netlabel"
    stub_class = "stub-power" if is_power else "stub"
    label = _escape(_truncate(net_name))

    if side == "l":
        x2 = ax - PIN_STUB_LENGTH
        y2 = ay
        label_x = x2 - 0.6
        label_y = y2 + 0.7
        return (
            f'<line x1="{ax:.2f}" y1="{ay:.2f}" '
            f'x2="{x2:.2f}" y2="{y2:.2f}" class="{stub_class}"/>'
            f'<text x="{label_x:.2f}" y="{label_y:.2f}" '
            f'text-anchor="end" class="{net_class}">{label}</text>'
            f'<text x="{ax+0.6:.2f}" y="{ay-0.5:.2f}" '
            f'class="padnum">{_escape(pad_num)}</text>'
        )

    if side == "r":
        x2 = ax + PIN_STUB_LENGTH
        y2 = ay
        label_x = x2 + 0.6
        label_y = y2 + 0.7
        return (
            f'<line x1="{ax:.2f}" y1="{ay:.2f}" '
            f'x2="{x2:.2f}" y2="{y2:.2f}" class="{stub_class}"/>'
            f'<text x="{label_x:.2f}" y="{label_y:.2f}" '
            f'text-anchor="start" class="{net_class}">{label}</text>'
            f'<text x="{ax-0.6:.2f}" y="{ay-0.5:.2f}" text-anchor="end" '
            f'class="padnum">{_escape(pad_num)}</text>'
        )

    if side == "t":
        x2 = ax
        y2 = ay - PIN_STUB_LENGTH
        # Rotate label -90° around (label_x, label_y)
        label_x = x2
        label_y = y2 - 0.6
        return (
            f'<line x1="{ax:.2f}" y1="{ay:.2f}" '
            f'x2="{x2:.2f}" y2="{y2:.2f}" class="{stub_class}"/>'
            f'<text x="{label_x:.2f}" y="{label_y:.2f}" '
            f'text-anchor="start" class="{net_class}" '
            f'transform="rotate(-90 {label_x:.2f} {label_y:.2f})">{label}</text>'
            f'<text x="{ax+0.6:.2f}" y="{ay+1.8:.2f}" class="padnum">{_escape(pad_num)}</text>'
        )

    if side == "b":
        x2 = ax
        y2 = ay + PIN_STUB_LENGTH
        label_x = x2
        label_y = y2 + 0.6
        return (
            f'<line x1="{ax:.2f}" y1="{ay:.2f}" '
            f'x2="{x2:.2f}" y2="{y2:.2f}" class="{stub_class}"/>'
            f'<text x="{label_x:.2f}" y="{label_y:.2f}" '
            f'text-anchor="end" class="{net_class}" '
            f'transform="rotate(-90 {label_x:.2f} {label_y:.2f})">{label}</text>'
            f'<text x="{ax+0.6:.2f}" y="{ay-1.0:.2f}" class="padnum">{_escape(pad_num)}</text>'
        )

    return ""


# ---------------------------------------------------------------------------
# Subcircuit renderer
# ---------------------------------------------------------------------------

def render_subcircuit(
    board_name: str,
    subcircuit: dict[str, Any],
    cross_nets_for_sub: list[str],
    out_path: str,
) -> tuple[float, float]:
    """Render one subcircuit to an SVG file.

    Returns the (width, height) of the SVG in user units.
    """
    comps = subcircuit["components"]
    sub_name = subcircuit["name"]

    # Build Symbol instances
    placed = []
    for c in comps:
        sym = symbols.symbol_for(c)
        placed.append(
            PlacedComponent(
                comp=c,
                symbol=sym,
                x=0,
                y=0,
                width=sym.width,
                height=sym.height,
            )
        )

    # Sort: ICs first (biggest), then connectors, then passives grouped by type
    def sort_key(p: PlacedComponent) -> tuple:
        sym = p.symbol
        type_priority = {
            symbols.IC: 0,
            symbols.Connector: 1,
            symbols.Transistor: 2,
            symbols.Diode: 3,
            symbols.Crystal: 4,
            symbols.Inductor: 5,
            symbols.Capacitor: 6,
            symbols.Resistor: 7,
            symbols.TestPoint: 8,
        }
        prio = type_priority.get(type(sym), 9)
        # Within a type, sort by display_name (roughly groups related parts)
        return (prio, p.comp.get("display_name", ""), p.comp.get("ref", ""))

    placed.sort(key=sort_key)

    # Auto-pick columns: IC-dense layouts want fewer columns; passive-dense
    # layouts want more.
    n = len(placed)
    ic_count = sum(1 for p in placed if isinstance(p.symbol, (symbols.IC, symbols.Connector)))
    if ic_count >= n * 0.6:
        cols = max(1, min(3, n))  # IC/connector heavy: few wide columns
    elif n <= 4:
        cols = n
    elif n <= 16:
        cols = 4
    elif n <= 36:
        cols = 6
    else:
        cols = 8

    placed_items, layout_w, layout_h = layout.grid_place(
        placed,
        cols=cols,
        col_gap=30.0,   # room for right-side net labels
        row_gap=26.0,   # room for top/bottom net labels
        margin=GRID_MARGIN,  # outer margin handled by PAGE_PAD below
    )

    # Propagate back to PlacedComponent objects
    for pi in placed_items:
        pi.item.x = pi.x
        pi.item.y = pi.y

    # Page layout:
    #   - PAGE_PAD on all sides (for overflowing labels)
    #   - title block at top (below padding)
    #   - grid below title
    title_offset = TITLE_HEIGHT
    content_offset_x = PAGE_PAD
    content_offset_y = PAGE_PAD + title_offset
    total_w = layout_w + 2 * PAGE_PAD
    total_h = layout_h + title_offset + 2 * PAGE_PAD

    svg_body: list[str] = []

    # Title block
    comp_count = len(comps)
    svg_body.append(
        f'<g class="title-block">'
        f'<text x="{total_w/2:.2f}" y="{PAGE_PAD + 8:.2f}" '
        f'text-anchor="middle" class="title">'
        f'{_escape(board_name)} / {_escape(sub_name)}</text>'
        f'<text x="{total_w/2:.2f}" y="{PAGE_PAD + 14:.2f}" '
        f'text-anchor="middle" class="subtitle">'
        f'{comp_count} component{"s" if comp_count != 1 else ""} '
        f'· {len(cross_nets_for_sub)} cross-block nets</text>'
        f'</g>'
    )

    # Render each component + its pins. Grid was placed with margin=0,
    # so we simply translate by (PAGE_PAD, PAGE_PAD + TITLE_HEIGHT).
    for p in placed:
        ox = p.x + content_offset_x
        oy = p.y + content_offset_y
        svg_body.append('<g class="component">')
        svg_body.append(p.symbol.body_svg(ox, oy))
        svg_body.append(
            p.symbol.label_svg(
                ox,
                oy,
                p.comp.get("ref", ""),
                _short_value(p.comp),
            )
        )
        # Map pad number → net name from the component dict.
        # Footprints can have multiple physical pads sharing the same number
        # (e.g. USB-C shields, switch contacts, thermal pads on QFNs). Keep
        # the first net we see for a given pad number so we don't silently
        # overwrite it with a later entry.
        pad_to_net: dict[str, str] = {}
        for pad in p.comp.get("pads", []):
            num = pad.get("number", "")
            if num and num not in pad_to_net:
                pad_to_net[num] = pad.get("net", "")
        for pin in p.symbol.pins:
            ax, ay = pin.abs_xy(ox, oy)
            net = pad_to_net.get(pin.num, "")
            svg_body.append(_pin_stub_svg(pin.side, ax, ay, net, pin.num))
        svg_body.append("</g>")

    # White background (so exported PDFs are opaque, not transparent)
    background = (
        f'<rect x="0" y="0" width="{total_w:.2f}" height="{total_h:.2f}" '
        f'class="page-bg"/>'
    )
    # Thin border inside the padding
    border = (
        f'<rect x="{PAGE_PAD/2:.2f}" y="{PAGE_PAD/2:.2f}" '
        f'width="{total_w - PAGE_PAD:.2f}" height="{total_h - PAGE_PAD:.2f}" '
        f'class="panel-border"/>'
    )

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {total_w:.2f} {total_h:.2f}" '
        f'width="{total_w*3:.0f}" height="{total_h*3:.0f}">'
        f'<style>{CSS}</style>'
        f'{background}'
        f'{border}'
        + "".join(svg_body)
        + "</svg>"
    )

    with open(out_path, "w") as f:
        f.write(svg)

    return total_w, total_h


def _short_value(comp: dict[str, Any]) -> str:
    """Choose the most informative short label for a component value.

    For annotated passives: the value (e.g. "10kΩ").
    For unannotated active components (REF**): the display_name (atopile
    final segment), since value is often just the footprint name.
    """
    ref = comp.get("ref", "")
    value = comp.get("value", "")
    display = comp.get("display_name", "")
    footprint = comp.get("footprint", "")

    if ref.startswith("REF"):
        # Prefer display_name for unannotated components
        if display:
            return display
    if value:
        return value
    return display or footprint
