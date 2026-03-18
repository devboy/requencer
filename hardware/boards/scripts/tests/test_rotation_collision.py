"""Minimal test: does our collision tracker match KiCad's actual bounding box
when a component is rotated?

Uses real KiCad footprints loaded from the control board PCB.
"""

import pytest
import os
import sys

# Skip if pcbnew not available (CI / non-KiCad environment)
pcbnew = pytest.importorskip("pcbnew")

CONTROL_PCB = os.path.join(
    os.path.dirname(__file__), "..", "..", "elec", "layout", "control", "control.kicad_pcb"
)


def _load_footprint(addr):
    """Load a single footprint from the control board by atopile address."""
    board = pcbnew.LoadBoard(CONTROL_PCB)
    for fp in board.GetFootprints():
        if fp.HasFieldByName("atopile_address"):
            if fp.GetFieldText("atopile_address") == addr:
                return fp, board
    pytest.fail(f"Footprint {addr} not found")


def _kicad_bbox(fp, board, x, y, rotation):
    """Place footprint in KiCad and return its actual bounding box."""
    fp.SetOrientationDegrees(0)  # reset first
    fp.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(x), pcbnew.FromMM(y)))
    fp.SetOrientationDegrees(rotation)
    bb = fp.GetBoundingBox(False, False)
    return (
        pcbnew.ToMM(bb.GetLeft()),
        pcbnew.ToMM(bb.GetTop()),
        pcbnew.ToMM(bb.GetRight()),
        pcbnew.ToMM(bb.GetBottom()),
    )


def _our_bbox(info, x, y, rotation):
    """Compute bounding box using our rotated_info logic."""
    from placement.strategies import rotated_info
    r = rotated_info(info, rotation) if rotation else info
    cx = x + r.cx_offset
    cy = y + r.cy_offset
    return (
        cx - r.width / 2,
        cy - r.height / 2,
        cx + r.width / 2,
        cy + r.height / 2,
    )


def _extract_info(fp, board):
    """Extract ComponentInfo from a footprint."""
    from placement.helpers import extract_footprint_dims, is_tht, \
        get_component_nets, extract_pad_sides, identify_power_nets
    from placement.strategies import ComponentInfo

    power_nets = identify_power_nets(board)
    w, h, cx_off, cy_off = extract_footprint_dims(fp, pcbnew)
    tht = is_tht(fp, pcbnew)
    pin_count = len(list(fp.Pads()))
    nets = get_component_nets(fp, power_nets)
    pad_sides = extract_pad_sides(fp, pcbnew, power_nets)
    edge_signal_count = {e: len(n) for e, n in pad_sides.items()}
    addr = fp.GetFieldText("atopile_address")
    return ComponentInfo(
        address=addr, width=w, height=h, is_tht=tht,
        pin_count=pin_count, nets=nets,
        cx_offset=cx_off, cy_offset=cy_off,
        pad_sides=pad_sides, edge_signal_count=edge_signal_count,
    )


class TestRotationBboxMatch:
    """Our rotated_info bbox must match KiCad's actual bbox for every rotation."""

    @pytest.mark.parametrize("rotation", [0, 90, 180, 270])
    def test_sip9_resistor_network(self, rotation):
        """SIP-9 (buttons.rn1) — asymmetric, origin at pin 1."""
        fp, board = _load_footprint("buttons.rn1")
        info = _extract_info(fp, board)
        x, y = 50.0, 50.0

        kicad = _kicad_bbox(fp, board, x, y, rotation)
        ours = _our_bbox(info, x, y, rotation)

        assert abs(kicad[0] - ours[0]) < 0.2, \
            f"left: kicad={kicad[0]:.1f} ours={ours[0]:.1f} at {rotation}°"
        assert abs(kicad[1] - ours[1]) < 0.2, \
            f"top: kicad={kicad[1]:.1f} ours={ours[1]:.1f} at {rotation}°"
        assert abs(kicad[2] - ours[2]) < 0.2, \
            f"right: kicad={kicad[2]:.1f} ours={ours[2]:.1f} at {rotation}°"
        assert abs(kicad[3] - ours[3]) < 0.2, \
            f"bottom: kicad={kicad[3]:.1f} ours={ours[3]:.1f} at {rotation}°"

    @pytest.mark.parametrize("rotation", [0, 90, 180, 270])
    def test_soic16_shift_register(self, rotation):
        """SOIC-16 (buttons.sr1) — symmetric, center origin."""
        fp, board = _load_footprint("buttons.sr1")
        info = _extract_info(fp, board)
        x, y = 50.0, 50.0

        kicad = _kicad_bbox(fp, board, x, y, rotation)
        ours = _our_bbox(info, x, y, rotation)

        assert abs(kicad[0] - ours[0]) < 0.2, \
            f"left: kicad={kicad[0]:.1f} ours={ours[0]:.1f} at {rotation}°"
        assert abs(kicad[1] - ours[1]) < 0.2, \
            f"top: kicad={kicad[1]:.1f} ours={ours[1]:.1f} at {rotation}°"
        assert abs(kicad[2] - ours[2]) < 0.2, \
            f"right: kicad={kicad[2]:.1f} ours={ours[2]:.1f} at {rotation}°"
        assert abs(kicad[3] - ours[3]) < 0.2, \
            f"bottom: kicad={kicad[3]:.1f} ours={ours[3]:.1f} at {rotation}°"

    @pytest.mark.parametrize("rotation", [0, 90, 180, 270])
    def test_htssop32_led_driver(self, rotation):
        """HTSSOP-32 (leds.tlc1) — center origin."""
        fp, board = _load_footprint("leds.tlc1")
        info = _extract_info(fp, board)
        x, y = 50.0, 50.0

        kicad = _kicad_bbox(fp, board, x, y, rotation)
        ours = _our_bbox(info, x, y, rotation)

        assert abs(kicad[0] - ours[0]) < 0.2, \
            f"left: kicad={kicad[0]:.1f} ours={ours[0]:.1f} at {rotation}°"
        assert abs(kicad[1] - ours[1]) < 0.2, \
            f"top: kicad={kicad[1]:.1f} ours={ours[1]:.1f} at {rotation}°"
        assert abs(kicad[2] - ours[2]) < 0.2, \
            f"right: kicad={kicad[2]:.1f} ours={ours[2]:.1f} at {rotation}°"
        assert abs(kicad[3] - ours[3]) < 0.2, \
            f"bottom: kicad={kicad[3]:.1f} ours={ours[3]:.1f} at {rotation}°"


class TestTwoComponentCollision:
    """Place two components near each other with rotation and verify
    our collision tracker agrees with KiCad about whether they overlap."""

    def test_rn_and_sr_no_overlap_when_separated(self):
        """SIP-9 at 90° next to SOIC-16 — gap should prevent overlap."""
        from placement.helpers import CollisionTracker
        from placement.strategies import rotated_info

        fp_rn, board = _load_footprint("buttons.rn1")
        info_rn = _extract_info(fp_rn, board)

        fp_sr, _ = _load_footprint("buttons.sr1")
        info_sr = _extract_info(fp_sr, board)

        # Place rn1 at (50, 50) rotated 90°
        r_rn = rotated_info(info_rn, 90)
        rn_x, rn_y = 50.0, 50.0

        # Place sr1 right after rn1's right edge + 1mm gap
        rn_right = rn_x + r_rn.cx_offset + r_rn.width / 2
        sr_x = rn_right + info_sr.width / 2 + 1.0
        sr_y = 50.0

        # Our collision tracker
        tracker = CollisionTracker(200, 200, clearance=0.0)
        rn_cx = rn_x + r_rn.cx_offset
        rn_cy = rn_y + r_rn.cy_offset
        tracker.register(rn_cx, rn_cy, r_rn.width, r_rn.height, "F", False)

        sr_cx = sr_x + info_sr.cx_offset
        sr_cy = sr_y + info_sr.cy_offset
        collides = tracker.collides(sr_cx, sr_cy, info_sr.width, info_sr.height, "F")

        # KiCad verification
        kicad_rn = _kicad_bbox(fp_rn, board, rn_x, rn_y, 90)
        kicad_sr = _kicad_bbox(fp_sr, board, sr_x, sr_y, 0)

        kicad_overlap_x = min(kicad_rn[2], kicad_sr[2]) - max(kicad_rn[0], kicad_sr[0])
        kicad_overlap_y = min(kicad_rn[3], kicad_sr[3]) - max(kicad_rn[1], kicad_sr[1])
        kicad_overlaps = kicad_overlap_x > 0 and kicad_overlap_y > 0

        assert collides == kicad_overlaps, \
            f"Tracker says collides={collides}, KiCad says overlaps={kicad_overlaps}"

    def test_rn_and_sr_overlap_when_close(self):
        """SIP-9 at 90° overlapping SOIC-16 — both should detect overlap."""
        from placement.helpers import CollisionTracker
        from placement.strategies import rotated_info

        fp_rn, board = _load_footprint("buttons.rn1")
        info_rn = _extract_info(fp_rn, board)

        fp_sr, _ = _load_footprint("buttons.sr1")
        info_sr = _extract_info(fp_sr, board)

        # Place rn1 at (50, 50) rotated 90°
        r_rn = rotated_info(info_rn, 90)
        rn_x, rn_y = 50.0, 50.0

        # Place sr1 overlapping rn1's right side
        rn_right = rn_x + r_rn.cx_offset + r_rn.width / 2
        sr_x = rn_right - 2.0  # 2mm inside rn's bbox
        sr_y = 50.0

        # Our collision tracker
        tracker = CollisionTracker(200, 200, clearance=0.0)
        rn_cx = rn_x + r_rn.cx_offset
        rn_cy = rn_y + r_rn.cy_offset
        tracker.register(rn_cx, rn_cy, r_rn.width, r_rn.height, "F", False)

        sr_cx = sr_x + info_sr.cx_offset
        sr_cy = sr_y + info_sr.cy_offset
        collides = tracker.collides(sr_cx, sr_cy, info_sr.width, info_sr.height, "F")

        # KiCad verification
        kicad_rn = _kicad_bbox(fp_rn, board, rn_x, rn_y, 90)
        kicad_sr = _kicad_bbox(fp_sr, board, sr_x, sr_y, 0)

        kicad_overlap_x = min(kicad_rn[2], kicad_sr[2]) - max(kicad_rn[0], kicad_sr[0])
        kicad_overlap_y = min(kicad_rn[3], kicad_sr[3]) - max(kicad_rn[1], kicad_sr[1])
        kicad_overlaps = kicad_overlap_x > 0 and kicad_overlap_y > 0

        assert collides == kicad_overlaps, \
            f"Tracker says collides={collides}, KiCad says overlaps={kicad_overlaps}"
