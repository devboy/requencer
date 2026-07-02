"""Schematic symbol library (pure Python, no external deps).

Each symbol draws itself as an SVG `<g>` at an arbitrary (x, y) origin.
Symbols expose their bounding box and a dict of pin connection points
(absolute coordinates once placed) so the renderer can draw pin stubs
and net labels without knowing the symbol's internals.

Style is a mix of IEC (rectangles for R) and ANSI (triangles for D,
circles for Q) — optimized for readability rather than strict standards
compliance. All coordinates are in SVG user units; the renderer sets
viewBox so 1 unit ≈ 1 mm in the printed PDF.

Symbol classes implement:
    width: float
    height: float
    pins: list[Pin]     # Pin(num, name, rel_x, rel_y, side)
    body_svg(origin_x, origin_y) -> str
    label_svg(origin_x, origin_y, refdes, value) -> str
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


Side = Literal["l", "r", "t", "b"]


@dataclass
class Pin:
    num: str
    name: str
    rel_x: float  # relative to symbol origin (top-left)
    rel_y: float
    side: Side

    def abs_xy(self, origin_x: float, origin_y: float) -> tuple[float, float]:
        return (origin_x + self.rel_x, origin_y + self.rel_y)


# ---------------------------------------------------------------------------
# Base class
# ---------------------------------------------------------------------------

@dataclass
class Symbol:
    """Base class. Subclasses override body_svg(); the rest is shared."""
    pads: list[dict[str, Any]] = field(default_factory=list)
    width: float = 0.0
    height: float = 0.0
    pins: list[Pin] = field(default_factory=list)

    def body_svg(self, ox: float, oy: float) -> str:
        raise NotImplementedError

    def label_svg(self, ox: float, oy: float, refdes: str, value: str) -> str:
        """Refdes above the symbol, value below."""
        cx = ox + self.width / 2
        top_y = oy - 1.5
        bot_y = oy + self.height + 4.0
        refdes = _escape(refdes)
        value = _escape(value)
        return (
            f'<text x="{cx:.2f}" y="{top_y:.2f}" class="refdes" '
            f'text-anchor="middle">{refdes}</text>'
            f'<text x="{cx:.2f}" y="{bot_y:.2f}" class="value" '
            f'text-anchor="middle">{value}</text>'
        )

    def pin_abs(self, ox: float, oy: float) -> list[tuple[Pin, float, float]]:
        out = []
        for p in self.pins:
            ax, ay = p.abs_xy(ox, oy)
            out.append((p, ax, ay))
        return out


def _escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


# ---------------------------------------------------------------------------
# Passive 2-pin symbols
# ---------------------------------------------------------------------------

class Resistor(Symbol):
    """IEC rectangle resistor — 4×10 unit body, pins top/bottom."""

    def __init__(self, pads):
        super().__init__(pads=pads)
        self.width = 4.0
        self.height = 14.0
        # Pin 1 = top, Pin 2 = bottom
        nums = [p["number"] for p in pads[:2]] or ["1", "2"]
        names = [p.get("pin_name", "") for p in pads[:2]] + ["", ""]
        self.pins = [
            Pin(nums[0], names[0], 2.0, 0.0, "t"),
            Pin(nums[1], names[1], 2.0, 14.0, "b"),
        ]

    def body_svg(self, ox: float, oy: float) -> str:
        x = ox
        y = oy + 2.0  # leave room for pin stubs
        return (
            f'<rect x="{x:.2f}" y="{y:.2f}" width="4" height="10" '
            f'class="body-stroke body-fill"/>'
            # connect-to-pin leads
            f'<line x1="{ox+2:.2f}" y1="{oy:.2f}" '
            f'x2="{ox+2:.2f}" y2="{oy+2:.2f}" class="lead"/>'
            f'<line x1="{ox+2:.2f}" y1="{oy+12:.2f}" '
            f'x2="{ox+2:.2f}" y2="{oy+14:.2f}" class="lead"/>'
        )


class Capacitor(Symbol):
    """Two parallel plates — 6×10 unit, pins top/bottom."""

    def __init__(self, pads, polarized: bool = False):
        super().__init__(pads=pads)
        self.width = 8.0
        self.height = 14.0
        self.polarized = polarized
        nums = [p["number"] for p in pads[:2]] or ["1", "2"]
        names = [p.get("pin_name", "") for p in pads[:2]] + ["", ""]
        self.pins = [
            Pin(nums[0], names[0], 4.0, 0.0, "t"),
            Pin(nums[1], names[1], 4.0, 14.0, "b"),
        ]

    def body_svg(self, ox: float, oy: float) -> str:
        cx = ox + 4.0
        # Upper plate at y = oy+6, lower plate at y = oy+8
        # Leads from (cx, oy) to (cx, oy+6) and (cx, oy+8) to (cx, oy+14)
        s = (
            f'<line x1="{cx:.2f}" y1="{oy:.2f}" '
            f'x2="{cx:.2f}" y2="{oy+6:.2f}" class="lead"/>'
            f'<line x1="{ox:.2f}" y1="{oy+6:.2f}" '
            f'x2="{ox+8:.2f}" y2="{oy+6:.2f}" class="plate"/>'
        )
        if self.polarized:
            # Curved lower plate
            s += (
                f'<path d="M{ox:.2f},{oy+8.5:.2f} '
                f'Q{cx:.2f},{oy+10:.2f} {ox+8:.2f},{oy+8.5:.2f}" '
                f'class="plate"/>'
                f'<text x="{ox-1.5:.2f}" y="{oy+5.5:.2f}" '
                f'class="polarity">+</text>'
            )
        else:
            s += (
                f'<line x1="{ox:.2f}" y1="{oy+8:.2f}" '
                f'x2="{ox+8:.2f}" y2="{oy+8:.2f}" class="plate"/>'
            )
        s += (
            f'<line x1="{cx:.2f}" y1="{oy+8:.2f}" '
            f'x2="{cx:.2f}" y2="{oy+14:.2f}" class="lead"/>'
        )
        return s


class Inductor(Symbol):
    """Three arcs — 8×10, pins top/bottom."""

    def __init__(self, pads):
        super().__init__(pads=pads)
        self.width = 8.0
        self.height = 14.0
        nums = [p["number"] for p in pads[:2]] or ["1", "2"]
        names = [p.get("pin_name", "") for p in pads[:2]] + ["", ""]
        self.pins = [
            Pin(nums[0], names[0], 4.0, 0.0, "t"),
            Pin(nums[1], names[1], 4.0, 14.0, "b"),
        ]

    def body_svg(self, ox: float, oy: float) -> str:
        cx = ox + 4.0
        # Three half-circles stacked vertically
        y0 = oy + 2.0
        arcs = []
        for i in range(3):
            ay = y0 + i * 3.0
            arcs.append(
                f'<path d="M{cx-1.5:.2f},{ay:.2f} '
                f'a1.5,1.5 0 0 1 3,0" class="arc"/>'
            )
        return (
            f'<line x1="{cx:.2f}" y1="{oy:.2f}" '
            f'x2="{cx:.2f}" y2="{oy+2:.2f}" class="lead"/>'
            + "".join(arcs)
            + f'<line x1="{cx:.2f}" y1="{oy+11:.2f}" '
            f'x2="{cx:.2f}" y2="{oy+14:.2f}" class="lead"/>'
        )


class Diode(Symbol):
    """Triangle + cathode bar — 8×10, anode top, cathode bottom."""

    def __init__(self, pads, is_led: bool = False):
        super().__init__(pads=pads)
        self.width = 8.0
        self.height = 14.0
        self.is_led = is_led
        nums = [p["number"] for p in pads[:2]] or ["1", "2"]
        names = [p.get("pin_name", "") for p in pads[:2]] + ["", ""]
        # Pad 1 is anode (top), pad 2 is cathode (bottom) by convention
        self.pins = [
            Pin(nums[0], names[0], 4.0, 0.0, "t"),
            Pin(nums[1], names[1], 4.0, 14.0, "b"),
        ]

    def body_svg(self, ox: float, oy: float) -> str:
        cx = ox + 4.0
        # Triangle points down (anode at top, cathode bar below)
        # Anode lead from (cx, oy) to (cx, oy+3)
        # Triangle from (cx-3, oy+3) down to (cx+3, oy+3) to (cx, oy+9)
        # Cathode bar at y=oy+9 from (cx-3, oy+9) to (cx+3, oy+9)
        # Cathode lead from (cx, oy+9) to (cx, oy+14)
        s = (
            f'<line x1="{cx:.2f}" y1="{oy:.2f}" '
            f'x2="{cx:.2f}" y2="{oy+3:.2f}" class="lead"/>'
            f'<path d="M{cx-3:.2f},{oy+3:.2f} L{cx+3:.2f},{oy+3:.2f} '
            f'L{cx:.2f},{oy+9:.2f} Z" class="body-stroke body-fill"/>'
            f'<line x1="{cx-3:.2f}" y1="{oy+9:.2f}" '
            f'x2="{cx+3:.2f}" y2="{oy+9:.2f}" class="cathode-bar"/>'
            f'<line x1="{cx:.2f}" y1="{oy+9:.2f}" '
            f'x2="{cx:.2f}" y2="{oy+14:.2f}" class="lead"/>'
        )
        if self.is_led:
            # Two outward arrows from the right side of the triangle
            s += (
                f'<line x1="{cx+3:.2f}" y1="{oy+5.5:.2f}" '
                f'x2="{cx+6:.2f}" y2="{oy+3.5:.2f}" class="led-ray"/>'
                f'<line x1="{cx+6:.2f}" y1="{oy+3.5:.2f}" '
                f'x2="{cx+5:.2f}" y2="{oy+3.8:.2f}" class="led-ray"/>'
                f'<line x1="{cx+6:.2f}" y1="{oy+3.5:.2f}" '
                f'x2="{cx+5.7:.2f}" y2="{oy+4.8:.2f}" class="led-ray"/>'
                f'<line x1="{cx+3.5:.2f}" y1="{oy+6.5:.2f}" '
                f'x2="{cx+6.5:.2f}" y2="{oy+4.5:.2f}" class="led-ray"/>'
            )
        return s


class Crystal(Symbol):
    """Two plates + body rectangle, 2 pins."""

    def __init__(self, pads):
        super().__init__(pads=pads)
        self.width = 10.0
        self.height = 14.0
        nums = [p["number"] for p in pads[:2]] or ["1", "2"]
        names = [p.get("pin_name", "") for p in pads[:2]] + ["", ""]
        self.pins = [
            Pin(nums[0], names[0], 5.0, 0.0, "t"),
            Pin(nums[1], names[1], 5.0, 14.0, "b"),
        ]

    def body_svg(self, ox: float, oy: float) -> str:
        cx = ox + 5.0
        return (
            f'<line x1="{cx:.2f}" y1="{oy:.2f}" '
            f'x2="{cx:.2f}" y2="{oy+3:.2f}" class="lead"/>'
            f'<line x1="{cx-3:.2f}" y1="{oy+3:.2f}" '
            f'x2="{cx+3:.2f}" y2="{oy+3:.2f}" class="plate"/>'
            f'<rect x="{cx-2:.2f}" y="{oy+4:.2f}" width="4" height="6" '
            f'class="body-stroke body-fill"/>'
            f'<line x1="{cx-3:.2f}" y1="{oy+11:.2f}" '
            f'x2="{cx+3:.2f}" y2="{oy+11:.2f}" class="plate"/>'
            f'<line x1="{cx:.2f}" y1="{oy+11:.2f}" '
            f'x2="{cx:.2f}" y2="{oy+14:.2f}" class="lead"/>'
        )


class TestPoint(Symbol):
    """Single circle, 1 pin."""

    def __init__(self, pads):
        super().__init__(pads=pads)
        self.width = 4.0
        self.height = 10.0
        nums = [p["number"] for p in pads[:1]] or ["1"]
        names = [p.get("pin_name", "") for p in pads[:1]] + [""]
        self.pins = [Pin(nums[0], names[0], 2.0, 10.0, "b")]

    def body_svg(self, ox: float, oy: float) -> str:
        cx = ox + 2.0
        return (
            f'<circle cx="{cx:.2f}" cy="{oy+3:.2f}" r="2.5" '
            f'class="body-stroke body-fill"/>'
            f'<line x1="{cx:.2f}" y1="{oy+5.5:.2f}" '
            f'x2="{cx:.2f}" y2="{oy+10:.2f}" class="lead"/>'
        )


# ---------------------------------------------------------------------------
# 3-pin transistor
# ---------------------------------------------------------------------------

class Transistor(Symbol):
    """Generic 3-pin transistor symbol.

    Circle with base line on the left, collector (top-right) and
    emitter (bottom-right). We don't try to distinguish BJT/MOSFET
    variants; the footprint name is shown in the value label for context.
    """

    def __init__(self, pads):
        super().__init__(pads=pads)
        self.width = 16.0
        self.height = 18.0
        nums = [p["number"] for p in pads[:3]] or ["1", "2", "3"]
        names = [p.get("pin_name", "") for p in pads[:3]] + ["", "", ""]
        # For SOT-23 BJT (most common): 1=B, 2=E, 3=C
        # Pin 1 (base) on left, pin 3 (collector) top-right,
        # pin 2 (emitter) bottom-right. Purely a rendering convention —
        # the rendered symbol matches most commonly used orientation.
        self.pins = [
            Pin(nums[0], names[0], 0.0, 9.0, "l"),   # base
            Pin(nums[1], names[1], 14.0, 17.0, "b"),  # emitter (bottom)
            Pin(nums[2], names[2], 14.0, 1.0, "t"),   # collector (top)
        ]

    def body_svg(self, ox: float, oy: float) -> str:
        cx = ox + 8.0
        cy = oy + 9.0
        # Body circle
        s = (
            f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="6" '
            f'class="body-stroke"/>'
            # Base lead (left)
            f'<line x1="{ox:.2f}" y1="{cy:.2f}" '
            f'x2="{cx-3:.2f}" y2="{cy:.2f}" class="lead"/>'
            # Vertical base line inside circle
            f'<line x1="{cx-3:.2f}" y1="{cy-3:.2f}" '
            f'x2="{cx-3:.2f}" y2="{cy+3:.2f}" class="lead"/>'
            # Collector line from base to top-right
            f'<line x1="{cx-3:.2f}" y1="{cy-1.5:.2f}" '
            f'x2="{cx+3.5:.2f}" y2="{cy-4:.2f}" class="lead"/>'
            f'<line x1="{cx+3.5:.2f}" y1="{cy-4:.2f}" '
            f'x2="{ox+14:.2f}" y2="{oy+1:.2f}" class="lead"/>'
            # Emitter line from base to bottom-right
            f'<line x1="{cx-3:.2f}" y1="{cy+1.5:.2f}" '
            f'x2="{cx+3.5:.2f}" y2="{cy+4:.2f}" class="lead"/>'
            f'<line x1="{cx+3.5:.2f}" y1="{cy+4:.2f}" '
            f'x2="{ox+14:.2f}" y2="{oy+17:.2f}" class="lead"/>'
        )
        return s


# ---------------------------------------------------------------------------
# IC / connector (N-pin rectangle)
# ---------------------------------------------------------------------------

PIN_SPACING = 3.5
IC_LABEL_MARGIN = 6.0
IC_MIN_WIDTH = 28.0


class IC(Symbol):
    """N-pin rectangle with pins on left and right.

    Sized dynamically based on pin count. Pin order:
      - First half of pads go down the LEFT side
      - Second half go up the RIGHT side (so pin N+1 is bottom-right,
        pin 2N is top-right — matching standard DIP/QFP convention).
    """

    def __init__(self, pads):
        super().__init__(pads=pads)
        n = len(pads)
        left_count = (n + 1) // 2
        right_count = n - left_count
        rows = max(left_count, right_count, 2)
        self.width = max(IC_MIN_WIDTH, 26.0)
        self.height = rows * PIN_SPACING + 2.0 * IC_LABEL_MARGIN
        self.pins = []

        for i in range(left_count):
            pad = pads[i]
            y = IC_LABEL_MARGIN + (i + 0.5) * PIN_SPACING
            self.pins.append(
                Pin(pad["number"], pad.get("pin_name", ""), 0.0, y, "l")
            )
        for j in range(right_count):
            pad = pads[left_count + j]
            # Going up the right side: bottom → top
            i_from_bottom = right_count - 1 - j
            y = IC_LABEL_MARGIN + (i_from_bottom + 0.5) * PIN_SPACING
            self.pins.append(
                Pin(pad["number"], pad.get("pin_name", ""), self.width, y, "r")
            )

    def body_svg(self, ox: float, oy: float) -> str:
        return (
            f'<rect x="{ox:.2f}" y="{oy:.2f}" '
            f'width="{self.width:.2f}" height="{self.height:.2f}" '
            f'class="body-stroke body-fill"/>'
        )


class Connector(Symbol):
    """N-pin rectangle with pins on the right side only.

    For headers, jacks, sockets — anything that's topologically a bundle
    of external signals rather than an active component. Pin labels go
    inside the rectangle next to each pin.
    """

    def __init__(self, pads):
        super().__init__(pads=pads)
        n = len(pads)
        rows = max(n, 1)
        self.width = 22.0
        self.height = rows * PIN_SPACING + 2.0 * IC_LABEL_MARGIN
        self.pins = []
        for i, pad in enumerate(pads):
            y = IC_LABEL_MARGIN + (i + 0.5) * PIN_SPACING
            self.pins.append(
                Pin(pad["number"], pad.get("pin_name", ""), self.width, y, "r")
            )

    def body_svg(self, ox: float, oy: float) -> str:
        return (
            f'<rect x="{ox:.2f}" y="{oy:.2f}" '
            f'width="{self.width:.2f}" height="{self.height:.2f}" '
            f'class="body-stroke conn-fill"/>'
        )


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------

def _starts_with(s: str, prefixes: tuple[str, ...]) -> bool:
    return any(s.startswith(p) for p in prefixes)


def symbol_for(comp: dict[str, Any]) -> Symbol:
    """Choose an appropriate Symbol subclass for a component dict.

    Classification rules (first match wins):
      1. Refdes prefix (R → Resistor, C → Capacitor, etc.)
      2. REF** unannotated — use atopile_address or footprint
      3. Footprint hint (SOT-23 → Transistor, SOD-123 → Diode, QFN → IC)
      4. Pad count (2 → generic-2, 3 → generic-3, ≥4 → IC rectangle)
    """
    ref = (comp.get("ref") or "").upper()
    value = (comp.get("value") or "").lower()
    fp = (comp.get("footprint") or "").lower()
    addr_last = (comp.get("display_name") or "").lower()
    pads = comp.get("pads", [])
    n_pads = len(pads)

    # Rule 1: refdes prefix
    if ref.startswith("R") and not ref.startswith("REF"):
        return Resistor(pads)
    if ref.startswith("C") and not ref.startswith("CONN"):
        is_polar = "electro" in fp or "tantalum" in fp or "polar" in fp
        return Capacitor(pads, polarized=is_polar)
    if ref.startswith("L"):
        return Inductor(pads)
    if ref.startswith("LED"):
        return Diode(pads, is_led=True)
    if ref.startswith("D"):
        return Diode(pads, is_led="led" in value)
    if ref.startswith("Q") or ref.startswith("M"):
        return Transistor(pads) if n_pads == 3 else IC(pads)
    if ref.startswith("Y") or ref.startswith("X"):
        return Crystal(pads)
    if ref.startswith("TP") or ref.startswith("PAD"):
        return TestPoint(pads) if n_pads <= 1 else IC(pads)
    if ref.startswith("J") or ref.startswith("P"):
        return Connector(pads)
    if ref.startswith("U"):
        return IC(pads)
    if ref.startswith("SW"):
        return Connector(pads)

    # Rule 2: unannotated (REF**), fall back to atopile name
    if ref.startswith("REF"):
        if addr_last.startswith("r_"):
            return Resistor(pads)
        if addr_last.startswith("c_"):
            return Capacitor(pads)
        if addr_last.startswith("l_"):
            return Inductor(pads)
        if addr_last.startswith("d_"):
            return Diode(pads, is_led="led" in addr_last)
        if addr_last.startswith("q_") or addr_last.startswith("m_"):
            return Transistor(pads) if n_pads == 3 else IC(pads)
        if addr_last.startswith("y_") or addr_last.startswith("x_"):
            return Crystal(pads)
        if addr_last.startswith("tp_"):
            return TestPoint(pads)
        if addr_last.startswith("f_"):
            return Resistor(pads)  # fuse: visually similar; TODO dedicated symbol

    # Rule 3: footprint hints
    if _starts_with(fp, ("sot-23", "sot23", "sot-223", "sot223", "to-92", "to-252", "dpak")):
        if n_pads == 3:
            return Transistor(pads)
        return IC(pads)
    if _starts_with(fp, ("sod-", "sod", "do-")):
        return Diode(pads)
    if "led" in fp or "led" in addr_last:
        return Diode(pads, is_led=True)
    connector_hints = (
        "header",
        "socket",
        "usb",
        "sd",
        "fpc",
        "jack",
        "midi",
        "shroud",
        "receptacle",
        "eurorack",
        "pinheader",
        "encoder",
        "ec11",
        "button",
        "tactile",
        "sw_",
        "switch",
    )
    if any(h in fp for h in connector_hints) or any(h in addr_last for h in connector_hints):
        return Connector(pads)

    # Rule 4: pad count fallback
    if n_pads == 2:
        return Resistor(pads)  # best generic 2-pin
    if n_pads == 3:
        return Transistor(pads)
    return IC(pads)
