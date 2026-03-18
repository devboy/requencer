#!/usr/bin/env python3
"""Generate STEP 3D models for custom components.

Creates parametric STEP files for components that don't have manufacturer-provided
3D models. Uses direct STEP AP214 output (no CAD library dependencies).

Components generated:
  - TC002-RGB: Illuminated tactile switch with long actuator for panel mount
  - PB6149L: 6x6mm illuminated tactile switch with translucent cap
  - PGA2350: Pimoroni PGA2350 RP2350B module (25.4mm square PCB + pins)

Usage:
    python3 generate_3d_models.py
"""

import math
from datetime import datetime
from pathlib import Path

BOARDS_DIR = Path(__file__).resolve().parent.parent.parent
PARTS_DIR = BOARDS_DIR / "elec" / "src" / "components"


# ─────────────────────────────────────────────────────────────────────────────
# STEP writer — generates ISO 10303-21 (AP214 AUTOMOTIVE_DESIGN) geometry
# ─────────────────────────────────────────────────────────────────────────────


class StepWriter:
    """Builds STEP geometry from boxes and prisms, outputs valid AP214 file."""

    def __init__(self, name: str, description: str = ""):
        self.name = name
        self.description = description or name
        self._id = 0
        self._entities: list[str] = []
        self._solid_ids: list[int] = []

        # Pre-allocate shared entities (origin, axes, units, context)
        self._origin = self._next("#origin = CARTESIAN_POINT('Origin', (0.0, 0.0, 0.0));")
        self._dir_z = self._next("#dir_z = DIRECTION('Z', (0.0, 0.0, 1.0));")
        self._dir_x = self._next("#dir_x = DIRECTION('X', (1.0, 0.0, 0.0));")
        self._dir_y = self._next("#dir_y = DIRECTION('Y', (0.0, 1.0, 0.0));")
        self._dir_nz = self._next("#nz = DIRECTION('-Z', (0.0, 0.0, -1.0));")
        self._dir_nx = self._next("#nx = DIRECTION('-X', (-1.0, 0.0, 0.0));")
        self._dir_ny = self._next("#ny = DIRECTION('-Y', (0.0, -1.0, 0.0));")
        self._placement = self._next(
            f"#pl = AXIS2_PLACEMENT_3D('', #{self._origin}, #{self._dir_z}, #{self._dir_x});"
        )
        self._lu = self._next(
            "#lu = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );"
        )
        self._au = self._next(
            "#au = ( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) );"
        )
        self._su = self._next(
            "#su = ( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() );"
        )
        self._um = self._next(
            f"#um = UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.0E-7), #{self._lu}, "
            "'distance_accuracy_value', 'NONE');"
        )
        self._ctx = self._next(
            f"#ctx = ( GEOMETRIC_REPRESENTATION_CONTEXT(3) "
            f"GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#{self._um})) "
            f"GLOBAL_UNIT_ASSIGNED_CONTEXT((#{self._lu}, #{self._au}, #{self._su})) "
            f"REPRESENTATION_CONTEXT('Context3D', '3D Context with 1e-7 uncertainty') );"
        )

    def _next(self, template: str) -> int:
        """Allocate next entity ID and store the entity line."""
        self._id += 1
        # Replace #name = with #N =
        import re
        line = re.sub(r"^#\w+ =", f"#{self._id} =", template)
        self._entities.append(line)
        return self._id

    def _point(self, x: float, y: float, z: float) -> int:
        return self._next(
            f"#p = CARTESIAN_POINT('', ({x:.6f}, {y:.6f}, {z:.6f}));"
        )

    def _vertex(self, point_id: int) -> int:
        return self._next(f"#v = VERTEX_POINT('', #{point_id});")

    def _direction(self, dx: float, dy: float, dz: float) -> int:
        return self._next(f"#d = DIRECTION('', ({dx:.6f}, {dy:.6f}, {dz:.6f}));")

    def _vector(self, dir_id: int, magnitude: float) -> int:
        return self._next(f"#v = VECTOR('', #{dir_id}, {magnitude:.6f});")

    def _line(self, point_id: int, vector_id: int) -> int:
        return self._next(f"#l = LINE('', #{point_id}, #{vector_id});")

    def _edge_curve(self, v1: int, v2: int, curve: int, forward: bool = True) -> int:
        sense = ".T." if forward else ".F."
        return self._next(f"#ec = EDGE_CURVE('', #{v1}, #{v2}, #{curve}, {sense});")

    def _oriented_edge(self, edge: int, forward: bool = True) -> int:
        sense = ".T." if forward else ".F."
        return self._next(f"#oe = ORIENTED_EDGE('', *, *, #{edge}, {sense});")

    def _edge_loop(self, edges: list[int]) -> int:
        refs = ", ".join(f"#{e}" for e in edges)
        return self._next(f"#el = EDGE_LOOP('', ({refs}));")

    def _face_outer_bound(self, loop: int) -> int:
        return self._next(f"#fob = FACE_OUTER_BOUND('', #{loop}, .T.);")

    def _plane(self, point_id: int, normal_id: int, ref_dir_id: int) -> int:
        ap = self._next(
            f"#ap = AXIS2_PLACEMENT_3D('', #{point_id}, #{normal_id}, #{ref_dir_id});"
        )
        return self._next(f"#pl = PLANE('', #{ap});")

    def _advanced_face(self, bound: int, surface: int, same_sense: bool = True) -> int:
        sense = ".T." if same_sense else ".F."
        return self._next(f"#af = ADVANCED_FACE('', (#{bound}), #{surface}, {sense});")

    def _make_line_edge(self, v1: int, p1: int, v2: int, p2: int,
                        dx: float, dy: float, dz: float, length: float) -> int:
        """Create a line edge between two vertices."""
        d = self._direction(dx, dy, dz)
        vec = self._vector(d, length)
        line = self._line(p1, vec)
        return self._edge_curve(v1, v2, line)

    def add_box(self, x1: float, y1: float, z1: float,
                x2: float, y2: float, z2: float, label: str = "Box") -> int:
        """Add an axis-aligned box solid. Returns the MANIFOLD_SOLID_BREP ID."""
        dx = x2 - x1
        dy = y2 - y1
        dz = z2 - z1

        # 8 corner points and vertices
        corners = [
            (x1, y1, z1), (x2, y1, z1), (x2, y2, z1), (x1, y2, z1),  # bottom
            (x1, y1, z2), (x2, y1, z2), (x2, y2, z2), (x1, y2, z2),  # top
        ]
        pts = [self._point(*c) for c in corners]
        vts = [self._vertex(p) for p in pts]

        # 12 edges (4 bottom, 4 top, 4 vertical)
        # Bottom: 0→1, 1→2, 2→3, 3→0
        e_b01 = self._make_line_edge(vts[0], pts[0], vts[1], pts[0], 1, 0, 0, dx)
        e_b12 = self._make_line_edge(vts[1], pts[1], vts[2], pts[1], 0, 1, 0, dy)
        e_b23 = self._make_line_edge(vts[2], pts[2], vts[3], pts[2], -1, 0, 0, dx)
        e_b30 = self._make_line_edge(vts[3], pts[3], vts[0], pts[3], 0, -1, 0, dy)
        # Top: 4→5, 5→6, 6→7, 7→4
        e_t45 = self._make_line_edge(vts[4], pts[4], vts[5], pts[4], 1, 0, 0, dx)
        e_t56 = self._make_line_edge(vts[5], pts[5], vts[6], pts[5], 0, 1, 0, dy)
        e_t67 = self._make_line_edge(vts[6], pts[6], vts[7], pts[6], -1, 0, 0, dx)
        e_t74 = self._make_line_edge(vts[7], pts[7], vts[4], pts[7], 0, -1, 0, dy)
        # Vertical: 0→4, 1→5, 2→6, 3→7
        e_v04 = self._make_line_edge(vts[0], pts[0], vts[4], pts[0], 0, 0, 1, dz)
        e_v15 = self._make_line_edge(vts[1], pts[1], vts[5], pts[1], 0, 0, 1, dz)
        e_v26 = self._make_line_edge(vts[2], pts[2], vts[6], pts[2], 0, 0, 1, dz)
        e_v37 = self._make_line_edge(vts[3], pts[3], vts[7], pts[3], 0, 0, 1, dz)

        faces = []

        # Bottom face (-Z normal): 0→3→2→1 (inward-facing)
        loop = self._edge_loop([
            self._oriented_edge(e_b30, False),
            self._oriented_edge(e_b23, False),
            self._oriented_edge(e_b12, False),
            self._oriented_edge(e_b01, False),
        ])
        plane = self._plane(pts[0], self._dir_nz, self._dir_x)
        faces.append(self._advanced_face(self._face_outer_bound(loop), plane))

        # Top face (+Z normal): 4→5→6→7
        loop = self._edge_loop([
            self._oriented_edge(e_t45, True),
            self._oriented_edge(e_t56, True),
            self._oriented_edge(e_t67, True),
            self._oriented_edge(e_t74, True),
        ])
        plane = self._plane(pts[4], self._dir_z, self._dir_x)
        faces.append(self._advanced_face(self._face_outer_bound(loop), plane))

        # Front face (-Y): 0→1→5→4
        ny = self._direction(0, -1, 0)
        loop = self._edge_loop([
            self._oriented_edge(e_b01, True),
            self._oriented_edge(e_v15, True),
            self._oriented_edge(e_t45, False),
            self._oriented_edge(e_v04, False),
        ])
        plane = self._plane(pts[0], ny, self._dir_x)
        faces.append(self._advanced_face(self._face_outer_bound(loop), plane))

        # Back face (+Y): 2→3→7→6
        py = self._direction(0, 1, 0)
        loop = self._edge_loop([
            self._oriented_edge(e_b23, True),
            self._oriented_edge(e_v37, True),
            self._oriented_edge(e_t67, False),
            self._oriented_edge(e_v26, False),
        ])
        plane = self._plane(pts[2], py, self._dir_nx)
        faces.append(self._advanced_face(self._face_outer_bound(loop), plane))

        # Left face (-X): 3→0→4→7
        nx = self._direction(-1, 0, 0)
        loop = self._edge_loop([
            self._oriented_edge(e_b30, True),
            self._oriented_edge(e_v04, True),
            self._oriented_edge(e_t74, False),
            self._oriented_edge(e_v37, False),
        ])
        plane = self._plane(pts[3], nx, self._dir_y)
        faces.append(self._advanced_face(self._face_outer_bound(loop), plane))

        # Right face (+X): 1→2→6→5
        px = self._direction(1, 0, 0)
        loop = self._edge_loop([
            self._oriented_edge(e_b12, True),
            self._oriented_edge(e_v26, True),
            self._oriented_edge(e_t56, False),
            self._oriented_edge(e_v15, False),
        ])
        plane = self._plane(pts[1], px, self._dir_y)
        faces.append(self._advanced_face(self._face_outer_bound(loop), plane))

        # Assemble solid
        face_refs = ", ".join(f"#{f}" for f in faces)
        shell = self._next(f"#sh = CLOSED_SHELL('', ({face_refs}));")
        solid = self._next(f"#so = MANIFOLD_SOLID_BREP('{label}', #{shell});")
        self._solid_ids.append(solid)
        return solid

    def add_prism(self, cx: float, cy: float, z1: float, z2: float,
                  radius: float, sides: int = 16, label: str = "Prism") -> int:
        """Add a regular polygonal prism (cylinder approximation). Returns solid ID."""
        dz = z2 - z1
        n = sides

        # Generate polygon vertices
        bottom_pts = []
        bottom_vts = []
        top_pts = []
        top_vts = []
        for i in range(n):
            angle = 2 * math.pi * i / n
            x = cx + radius * math.cos(angle)
            y = cy + radius * math.sin(angle)
            bp = self._point(x, y, z1)
            bv = self._vertex(bp)
            tp = self._point(x, y, z2)
            tv = self._vertex(tp)
            bottom_pts.append(bp)
            bottom_vts.append(bv)
            top_pts.append(tp)
            top_vts.append(tv)

        # Bottom edges (polygon)
        bottom_edges = []
        for i in range(n):
            j = (i + 1) % n
            dx = radius * math.cos(2 * math.pi * j / n) - radius * math.cos(2 * math.pi * i / n)
            dy = radius * math.sin(2 * math.pi * j / n) - radius * math.sin(2 * math.pi * i / n)
            length = math.sqrt(dx * dx + dy * dy)
            edge = self._make_line_edge(
                bottom_vts[i], bottom_pts[i], bottom_vts[j], bottom_pts[j],
                dx / length, dy / length, 0, length
            )
            bottom_edges.append(edge)

        # Top edges (polygon)
        top_edges = []
        for i in range(n):
            j = (i + 1) % n
            dx = radius * math.cos(2 * math.pi * j / n) - radius * math.cos(2 * math.pi * i / n)
            dy = radius * math.sin(2 * math.pi * j / n) - radius * math.sin(2 * math.pi * i / n)
            length = math.sqrt(dx * dx + dy * dy)
            edge = self._make_line_edge(
                top_vts[i], top_pts[i], top_vts[j], top_pts[j],
                dx / length, dy / length, 0, length
            )
            top_edges.append(edge)

        # Vertical edges
        vert_edges = []
        for i in range(n):
            edge = self._make_line_edge(
                bottom_vts[i], bottom_pts[i], top_vts[i], top_pts[i],
                0, 0, 1, dz
            )
            vert_edges.append(edge)

        faces = []

        # Bottom face (-Z normal)
        oes = [self._oriented_edge(bottom_edges[n - 1 - i], False) for i in range(n)]
        loop = self._edge_loop(oes)
        plane = self._plane(bottom_pts[0], self._dir_nz, self._dir_x)
        faces.append(self._advanced_face(self._face_outer_bound(loop), plane))

        # Top face (+Z normal)
        oes = [self._oriented_edge(top_edges[i], True) for i in range(n)]
        loop = self._edge_loop(oes)
        plane = self._plane(top_pts[0], self._dir_z, self._dir_x)
        faces.append(self._advanced_face(self._face_outer_bound(loop), plane))

        # Side faces
        for i in range(n):
            j = (i + 1) % n
            # Outward normal for this side
            mx = (math.cos(2 * math.pi * i / n) + math.cos(2 * math.pi * j / n)) / 2
            my = (math.sin(2 * math.pi * i / n) + math.sin(2 * math.pi * j / n)) / 2
            nm = math.sqrt(mx * mx + my * my)
            normal = self._direction(mx / nm, my / nm, 0)
            # Tangent direction along the bottom edge
            tx = math.cos(2 * math.pi * j / n) - math.cos(2 * math.pi * i / n)
            ty = math.sin(2 * math.pi * j / n) - math.sin(2 * math.pi * i / n)
            tn = math.sqrt(tx * tx + ty * ty)
            tangent = self._direction(tx / tn, ty / tn, 0)

            oes = [
                self._oriented_edge(bottom_edges[i], True),
                self._oriented_edge(vert_edges[j], True),
                self._oriented_edge(top_edges[i], False),
                self._oriented_edge(vert_edges[i], False),
            ]
            loop = self._edge_loop(oes)
            ap = self._next(
                f"#ap = AXIS2_PLACEMENT_3D('', #{bottom_pts[i]}, #{normal}, #{tangent});"
            )
            plane_id = self._next(f"#pl = PLANE('', #{ap});")
            faces.append(self._advanced_face(self._face_outer_bound(loop), plane_id))

        face_refs = ", ".join(f"#{f}" for f in faces)
        shell = self._next(f"#sh = CLOSED_SHELL('', ({face_refs}));")
        solid = self._next(f"#so = MANIFOLD_SOLID_BREP('{label}', #{shell});")
        self._solid_ids.append(solid)
        return solid

    def write(self, filepath: Path) -> None:
        """Write the complete STEP file."""
        solid_refs = ", ".join(f"#{s}" for s in self._solid_ids)

        # Shape representation
        rep = self._next(
            f"#rep = ADVANCED_BREP_SHAPE_REPRESENTATION('{self.name}', "
            f"({solid_refs}, #{self._placement}), #{self._ctx});"
        )

        # Product structure
        app_ctx = self._next("#ac = APPLICATION_CONTEXT('automotive_design');")
        self._next(
            f"#apd = APPLICATION_PROTOCOL_DEFINITION('international standard', "
            f"'automotive_design', 2000, #{app_ctx});"
        )
        prod_ctx = self._next(f"#pc = PRODUCT_CONTEXT('', #{app_ctx}, 'mechanical');")
        prod = self._next(
            f"#pr = PRODUCT('{self.name}', '{self.name}', '{self.description}', (#{prod_ctx}));"
        )
        pdf = self._next(f"#pdf = PRODUCT_DEFINITION_FORMATION('', '', #{prod});")
        pdc = self._next(
            f"#pdc = PRODUCT_DEFINITION_CONTEXT('part definition', #{app_ctx}, 'design');"
        )
        pd = self._next(f"#pd = PRODUCT_DEFINITION('design', '', #{pdf}, #{pdc});")
        pds = self._next(f"#pds = PRODUCT_DEFINITION_SHAPE('', '', #{pd});")
        self._next(f"#sdr = SHAPE_DEFINITION_REPRESENTATION(#{pds}, #{rep});")

        # Assemble file
        timestamp = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
        lines = [
            "ISO-10303-21;",
            "HEADER;",
            "FILE_DESCRIPTION((''), '2;1');",
            f"FILE_NAME('{filepath.name}', '{timestamp}', (''), (''), "
            "'Python STEP generator', '', '');",
            "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));",
            "ENDSEC;",
            "",
            "DATA;",
        ]
        lines.extend(self._entities)
        lines.extend(["ENDSEC;", "END-ISO-10303-21;", ""])

        filepath.write_text("\n".join(lines))
        size_kb = filepath.stat().st_size / 1024
        print(f"  Written: {filepath.name} ({size_kb:.1f} KB, {len(self._solid_ids)} solid(s))")


# ─────────────────────────────────────────────────────────────────────────────
# Model generators
# ─────────────────────────────────────────────────────────────────────────────


def generate_tc002_rgb():
    """Generate TC002-N11AS1XT-RGB illuminated tactile switch with S1 cap.

    Dimensions (from Well Buying TC002 datasheet):
      Body: 6.0 × 6.0 × 8.2mm above PCB (centered at origin XY, base at Z=0)
      S1 cap: 4.0mm diameter lens, 9.6mm tall, 2.3mm overlap with body
      Cap adds 7.3mm above body top (9.6 - 2.3 overlap)
      Total height above PCB: 8.2 + 7.3 = 15.5mm
      Pins extend 1.8mm below PCB (Z < 0)

    The S1 cap protrudes through the faceplate in the sandwich assembly
    (~1.9mm above faceplate front surface).
    """
    sw = StepWriter("TC002-RGB", "TC002-N11AS1XT-RGB illuminated tactile switch with S1 cap")

    body_half = 3.0  # 6mm body
    body_h = 8.2     # body height above PCB
    cap_r = 2.0      # S1 cap radius (4.0mm diameter lens)
    cap_h = 15.5     # total height from PCB to cap tip (8.2 + 9.6 - 2.3)
    pin_depth = 1.8  # pin length below PCB

    # Body (centered at origin, base at z=0)
    sw.add_box(-body_half, -body_half, 0, body_half, body_half, body_h, "Body")

    # S1 cap (cylinder from overlap point to full height)
    sw.add_prism(0, 0, body_h, cap_h, cap_r, sides=16, label="S1 Cap")

    # Pin representation (simplified: 4 small boxes for corner pins)
    pin_w = 0.5
    pin_positions = [(-2.54, -2.54), (2.54, -2.54), (-2.54, 2.54), (2.54, 2.54)]
    for i, (px, py) in enumerate(pin_positions):
        sw.add_box(
            px - pin_w / 2, py - pin_w / 2, -pin_depth,
            px + pin_w / 2, py + pin_w / 2, 0,
            f"Pin{i + 1}",
        )

    out = PARTS_DIR / "TC002-RGB" / "TC002-N11AS1XT-RGB.step"
    sw.write(out)


def generate_pb6149l():
    """Generate PB6149L illuminated tactile switch with translucent cap.

    Dimensions (from AliExpress listing / datasheet drawing):
      Body: 6.2 × 5.4mm, ~4.3mm above PCB (typical 6x6 tact body)
      Translucent cap: Ø5.6mm, 10.3mm tall, press-fit onto actuator
      Total height above PCB: ~18mm (body + cap)
      Pin spacing: 5.08 × 5.08mm (2.54mm grid)
      6 THT pins: 4 switch + 2 LED (extend ~3.5mm below PCB)
    """
    sw = StepWriter("PB6149L", "PB6149L illuminated tactile switch with translucent cap")

    body_hx = 3.1   # 6.2mm body width / 2
    body_hy = 2.7    # 5.4mm body depth / 2
    body_h = 4.3     # body height above PCB
    cap_r = 2.8      # Ø5.6mm cap radius
    cap_base_h = 4.3 # cap starts at top of body
    cap_top_h = 18.0 # total height from PCB
    pin_depth = 3.5  # pin length below PCB

    # Body (centered at origin, base at z=0)
    sw.add_box(-body_hx, -body_hy, 0, body_hx, body_hy, body_h, "Body")

    # Translucent cap (cylinder from body top to full height)
    sw.add_prism(0, 0, cap_base_h, cap_top_h, cap_r, sides=20, label="Cap")

    # 6 THT pins at footprint pad positions
    pin_w = 0.4
    # Pins 1-4: switch contacts at ±2.54mm grid
    switch_pins = [(-2.54, -2.54), (2.54, -2.54), (-2.54, 2.54), (2.54, 2.54)]
    for i, (px, py) in enumerate(switch_pins):
        sw.add_box(
            px - pin_w / 2, py - pin_w / 2, -pin_depth,
            px + pin_w / 2, py + pin_w / 2, 0,
            f"SWPin{i + 1}",
        )
    # Pins 5-6: LED anode/cathode (below body, offset from center)
    led_pins = [(-1.0, 4.04), (1.0, 4.04)]
    for i, (px, py) in enumerate(led_pins):
        sw.add_box(
            px - pin_w / 2, py - pin_w / 2, -pin_depth,
            px + pin_w / 2, py + pin_w / 2, 0,
            f"LEDPin{i + 1}",
        )

    out = PARTS_DIR / "PB6149L" / "PB6149L.step"
    sw.write(out)


def generate_pga2350():
    """Generate Pimoroni PGA2350 RP2350B module.

    Dimensions:
      PCB: 25.4 × 25.4 × 1.6mm
      RP2350B chip: ~7 × 7 × 1mm (centered on top of PCB)
      Keep-out / component area: ~20 × 20 × 2mm on top
      64 pins in perimeter layout, extending 3mm below PCB
      Pins at 2.54mm pitch, 0.5mm square

    Pin layout: 2-wide ring around perimeter of 10×10 grid.
    """
    sw = StepWriter("PGA2350", "Pimoroni PGA2350 RP2350B module")

    pcb_half = 12.7   # 25.4mm / 2
    pcb_h = 1.6       # PCB thickness
    chip_half = 3.5    # 7mm chip
    chip_h = 1.0       # chip height
    comp_half = 10.0   # component area
    comp_h = 2.0       # component height
    pin_len = 3.0      # pin length below PCB
    pin_w = 0.5        # pin cross-section

    # PCB substrate (green)
    sw.add_box(-pcb_half, -pcb_half, 0, pcb_half, pcb_half, pcb_h, "PCB")

    # Component area on top (simplified: slightly raised area for passives)
    sw.add_box(-comp_half, -comp_half, pcb_h, comp_half, comp_half, pcb_h + comp_h, "Components")

    # RP2350B chip (centered, on top of components)
    sw.add_box(
        -chip_half, -chip_half, pcb_h + comp_h,
        chip_half, chip_half, pcb_h + comp_h + chip_h,
        "RP2350B",
    )

    # Generate pin positions — 2-wide perimeter of 10×10 grid at 2.54mm pitch
    pitch = 2.54
    half_grid = 4.5 * pitch  # center of 10×10 grid

    pin_positions = []
    for row in range(10):
        for col in range(10):
            # Only outer 2 rings
            if 2 <= row <= 7 and 2 <= col <= 7:
                continue  # inner 6×6 is empty
            x = -half_grid + col * pitch
            y = -half_grid + row * pitch
            pin_positions.append((x, y))

    for i, (px, py) in enumerate(pin_positions):
        sw.add_box(
            px - pin_w / 2, py - pin_w / 2, -pin_len,
            px + pin_w / 2, py + pin_w / 2, 0,
            f"Pin{i + 1}",
        )

    out = PARTS_DIR / "PGA2350" / "PGA2350.step"
    sw.write(out)


def generate_fpc_18p_05mm():
    """Generate FPC 18-pin 0.5mm pitch ZIF connector.

    Dimensions (typical for this class of connector):
      Body: 11.5 × 4.0 × 2.5mm (centered at origin XY, base at Z=0)
      Latch: hinged flap on top, ~11.5 × 2.0 × 1.0mm
      No pins below PCB (SMD pads only)
    """
    sw = StepWriter("FPC_18P_05MM", "18-pin 0.5mm FPC ZIF connector")

    body_hw = 5.75   # half-width (11.5mm total)
    body_hd = 2.0    # half-depth (4.0mm total)
    body_h = 2.5     # body height

    # Main body
    sw.add_box(-body_hw, -body_hd, 0, body_hw, body_hd, body_h, "Body")

    # Latch (hinged flap on top)
    sw.add_box(-body_hw, -body_hd, body_h, body_hw, -body_hd + 2.0, body_h + 1.0, "Latch")

    out = PARTS_DIR / "FPC_18P_05MM" / "FPC_18P_05MM.step"
    sw.write(out)


def generate_fpc_32p_05mm():
    """Generate FPC 32-pin 0.5mm pitch ZIF connector.

    Dimensions (typical for JUSHUO AFC01-S32FCA-00):
      Body: 19.0 × 4.0 × 2.5mm (centered at origin XY, base at Z=0)
      32 pins at 0.5mm pitch = 15.5mm span, centered in body
      Latch: hinged flap on top, ~19.0 × 2.0 × 1.0mm
      No pins below PCB (SMD pads only)
    """
    sw = StepWriter("FPC_32P_05MM", "32-pin 0.5mm FPC ZIF connector")

    body_hw = 9.5    # half-width (19.0mm total)
    body_hd = 2.0    # half-depth (4.0mm total)
    body_h = 2.5     # body height

    # Main body
    sw.add_box(-body_hw, -body_hd, 0, body_hw, body_hd, body_h, "Body")

    # Latch (hinged flap on top)
    sw.add_box(-body_hw, -body_hd, body_h, body_hw, -body_hd + 2.0, body_h + 1.0, "Latch")

    out = PARTS_DIR / "FPC_32P_05MM" / "FPC_32P_05MM.step"
    sw.write(out)


def generate_pjs008u():
    """Generate Yamaichi PJS008U-3000-0 vertical MicroSD connector.

    The PJS008U is a thin sheet-metal card cage for vertical microSD insertion.
    A microSD card is 11 × 15 × 1mm.  The connector is essentially a thin
    metal housing barely wider/deeper than the card itself.

    Real-world dimensions (from datasheet + measurement):
      Body width: ~12mm (card 11mm + housing walls)
      Body depth/thickness: ~2.5mm (card 1mm + spring contacts + walls)
      Height above PCB: 14.18mm (card inserts vertically from top)
      Pin area: centered around origin, pins at Y=-3.3 and Y=-1.1
      Mounting tabs: at X=±5.0, Y=-3.3

    The silkscreen outline (14×13mm) is a keep-out zone, NOT the physical body.
    """
    sw = StepWriter("PJS008U", "Yamaichi PJS008U-3000-0 vertical MicroSD")

    # Connector body dimensions (thin vertical cage)
    # Body MUST be centered at footprint origin (0,0) so the faceplate
    # cutout (also placed at the footprint origin) aligns perfectly.
    body_hw = 6.0     # half-width: 12mm total (card 11mm + 0.5mm walls)
    body_hd = 1.25    # half-depth: 2.5mm total (thin profile)
    h_total = 14.18   # total height above PCB
    pin_depth = 3.5   # pin length below PCB
    wall = 0.3        # sheet metal wall thickness

    # Card slot opening dimensions
    slot_hw = 5.5     # 11mm card width

    # 1. Base on PCB (centered at origin)
    sw.add_box(-body_hw, -body_hd, 0,
               body_hw, body_hd, 1.5, "Base")

    # 2. Thin card cage walls (open at top for card insertion)
    cage_bot = 1.5

    # Left wall
    sw.add_box(-body_hw, -body_hd, cage_bot,
               -body_hw + wall, body_hd, h_total, "WallLeft")
    # Right wall
    sw.add_box(body_hw - wall, -body_hd, cage_bot,
               body_hw, body_hd, h_total, "WallRight")
    # Back wall (thin panel)
    sw.add_box(-body_hw + wall, body_hd - wall, cage_bot,
               body_hw - wall, body_hd, h_total, "WallBack")
    # Front wall — split around card slot opening
    sw.add_box(-body_hw + wall, -body_hd, cage_bot,
               -slot_hw, -body_hd + wall, h_total, "FrontL")
    sw.add_box(slot_hw, -body_hd, cage_bot,
               body_hw - wall, -body_hd + wall, h_total, "FrontR")
    # Top bar (closes the top above the card slot)
    sw.add_box(-slot_hw, -body_hd, h_total - 1.5,
               slot_hw, -body_hd + wall, h_total, "FrontTop")

    # 3. Card guide rails inside (two thin internal ridges)
    rail_w = 0.2
    sw.add_box(-slot_hw, -body_hd + wall, cage_bot + 0.5,
               -slot_hw + rail_w, body_hd - wall, h_total - 2.0, "GuideL")
    sw.add_box(slot_hw - rail_w, -body_hd + wall, cage_bot + 0.5,
               slot_hw, body_hd - wall, h_total - 2.0, "GuideR")

    # 4. THT signal pins at actual footprint pad positions
    pin_w = 0.3
    signal_pins = [
        (-1.65, -3.30), (-0.55, -3.30), (0.55, -3.30), (1.65, -3.30),
        (-1.65, -1.10), (-0.55, -1.10),
    ]
    for i, (px, py) in enumerate(signal_pins):
        sw.add_box(px - pin_w / 2, py - pin_w / 2, -pin_depth,
                   px + pin_w / 2, py + pin_w / 2, 0, f"Pin{i + 1}")

    # Card detect pin (pad 9)
    sw.add_box(2.75 - pin_w / 2, -pin_w / 2, -pin_depth,
               2.75 + pin_w / 2, pin_w / 2, 0, "PinCD")

    # Shield/ground pin (pad 10)
    sw.add_box(-2.75 - 0.25, -0.25, -pin_depth,
               -2.75 + 0.25, 0.25, 0, "PinShield")

    # Mounting tabs (at ±5.0, -3.3)
    tab_w = 0.7
    for side_x in [-5.0, 5.0]:
        sw.add_box(side_x - tab_w / 2, -3.3 - tab_w / 2, -pin_depth,
                   side_x + tab_w / 2, -3.3 + tab_w / 2, 0, "MountTab")

    out = PARTS_DIR / "PJS008U" / "PJS008U.step"
    sw.write(out)


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────


def main():
    print("Generating 3D models...\n")

    print("TC002-RGB (illuminated button, long actuator):")
    generate_tc002_rgb()

    print("\nPB6149L (illuminated button with translucent cap):")
    generate_pb6149l()

    print("\nPGA2350 (RP2350B module):")
    generate_pga2350()

    print("\nFPC_18P_05MM (18-pin FPC ZIF connector):")
    generate_fpc_18p_05mm()

    print("\nFPC_32P_05MM (32-pin FPC ZIF connector):")
    generate_fpc_32p_05mm()

    print("\nPJS008U (vertical MicroSD connector):")
    generate_pjs008u()

    print("\nDone.")


if __name__ == "__main__":
    main()
