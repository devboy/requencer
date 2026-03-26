"""KiCad roundtrip test: extract → place → apply → re-extract → verify.

Tests that the pipeline: extract_component → PlacedComponent → apply_placements
→ re-extract preserves positions correctly across all rotations and sides.

Uses REAL KiCad footprints from the control board PCB. Requires pcbnew
(gracefully skipped if unavailable).
"""

import os
import pytest

pcbnew = pytest.importorskip("pcbnew")

from placer.kicad_bridge import extract_component, apply_placements, ComponentBridge
from placer.dtypes import PlacedComponent, Side
from placer.geometry import pin_world_position, rotated_dims

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BOARDS_DIR = os.path.join(SCRIPT_DIR, "..", "..", "..")
CONTROL_PCB = os.path.join(
    BOARDS_DIR, "elec", "layout", "control", "control.kicad_pcb"
)


def _find_resistor_addr(board):
    """Find a resistor footprint address containing 'r_' in the control board."""
    for fp in board.GetFootprints():
        if fp.HasField("atopile_address"):
            addr = fp.GetFieldText("atopile_address")
            if ".r_" in addr or addr.startswith("r_"):
                return addr
    pytest.fail("No resistor footprint found in control board")


def _get_footprint(board, addr):
    """Get footprint by atopile address."""
    for fp in board.GetFootprints():
        if fp.HasField("atopile_address"):
            if fp.GetFieldText("atopile_address") == addr:
                return fp
    pytest.fail(f"Footprint {addr!r} not found")


# -----------------------------------------------------------------------
# Roundtrip position test
# -----------------------------------------------------------------------

@pytest.mark.parametrize("rotation", [0.0, 90.0, 180.0, 270.0])
@pytest.mark.parametrize("side", [Side.FRONT, Side.BACK])
class TestKicadRoundtrip:
    """Place a component via apply_placements, re-extract, verify position."""

    TARGET_X = 30.0
    TARGET_Y = 25.0

    def test_position_roundtrip(self, rotation, side):
        """extract → place → apply → re-extract → bbox top-left matches."""
        board = pcbnew.LoadBoard(CONTROL_PCB)
        addr = _find_resistor_addr(board)
        fp = _get_footprint(board, addr)

        # Step 1: Extract as non-fixed (canonical dims at rot=0)
        bridge = extract_component(
            addr, fp, pcbnew, power_nets=set(), is_fixed=False,
        )
        comp = bridge.component

        # Step 2: Create a PlacedComponent at known position
        placed = PlacedComponent(
            component_id=addr,
            x=self.TARGET_X,
            y=self.TARGET_Y,
            rotation=rotation,
            side=side,
        )

        # Step 3: Apply via apply_placements
        addr_map = {addr: fp}
        bridges = {addr: bridge}
        count = apply_placements([placed], bridges, addr_map, board, pcbnew)
        assert count == 1

        # Step 4: Read back KiCad state
        kicad_pos = fp.GetPosition()
        kicad_x = pcbnew.ToMM(kicad_pos.x)
        kicad_y = pcbnew.ToMM(kicad_pos.y)
        kicad_rot = fp.GetOrientationDegrees()
        kicad_layer = fp.GetLayerName()

        # Verify side was applied
        if side == Side.FRONT:
            assert kicad_layer == "F.Cu", \
                f"Expected F.Cu, got {kicad_layer}"
        else:
            assert kicad_layer == "B.Cu", \
                f"Expected B.Cu, got {kicad_layer}"

        # Step 5: Re-extract as fixed (using actual KiCad state)
        fixed_side = "F" if kicad_layer == "F.Cu" else "B"
        bridge2 = extract_component(
            addr, fp, pcbnew, power_nets=set(),
            is_fixed=True,
            fixed_x=kicad_x,
            fixed_y=kicad_y,
            fixed_side=fixed_side,
            fixed_rotation=kicad_rot,
        )
        comp2 = bridge2.component

        # Step 6: Verify re-extracted bbox top-left matches original target
        assert comp2.x == pytest.approx(self.TARGET_X, abs=0.5), \
            f"x: placed={self.TARGET_X}, re-extracted={comp2.x} " \
            f"(rot={rotation}, side={side.value})"
        assert comp2.y == pytest.approx(self.TARGET_Y, abs=0.5), \
            f"y: placed={self.TARGET_Y}, re-extracted={comp2.y} " \
            f"(rot={rotation}, side={side.value})"

        # Verify dimensions are unchanged
        assert comp2.width == pytest.approx(comp.width, abs=0.01)
        assert comp2.height == pytest.approx(comp.height, abs=0.01)


# -----------------------------------------------------------------------
# Pin position roundtrip test
# -----------------------------------------------------------------------

@pytest.mark.parametrize("rotation", [0.0, 90.0, 180.0, 270.0])
@pytest.mark.parametrize("side", [Side.FRONT, Side.BACK])
class TestPinPositionRoundtrip:
    """After apply_placements, pad world positions must match pin_world_position."""

    TARGET_X = 30.0
    TARGET_Y = 25.0

    def test_pin_positions(self, rotation, side):
        """KiCad pad positions match pin_world_position predictions."""
        board = pcbnew.LoadBoard(CONTROL_PCB)
        addr = _find_resistor_addr(board)
        fp = _get_footprint(board, addr)

        # Extract canonical component
        bridge = extract_component(
            addr, fp, pcbnew, power_nets=set(), is_fixed=False,
        )
        comp = bridge.component

        # Must have pins to test
        if not comp.pins:
            pytest.skip(f"{addr} has no pins")

        # Apply placement
        placed = PlacedComponent(
            component_id=addr,
            x=self.TARGET_X,
            y=self.TARGET_Y,
            rotation=rotation,
            side=side,
        )
        addr_map = {addr: fp}
        bridges = {addr: bridge}
        apply_placements([placed], bridges, addr_map, board, pcbnew)

        # Read actual pad positions from KiCad
        kicad_pad_positions = {}
        for pad in fp.Pads():
            net_name = pad.GetNetname()
            if not net_name:
                continue
            pos = pad.GetPosition()
            kicad_pad_positions[net_name] = (
                pcbnew.ToMM(pos.x),
                pcbnew.ToMM(pos.y),
            )

        # Compare with pin_world_position predictions
        for pin in comp.pins:
            if pin.id not in kicad_pad_positions:
                continue
            predicted_x, predicted_y = pin_world_position(
                comp, pin,
                self.TARGET_X, self.TARGET_Y,
                rotation, side,
            )
            actual_x, actual_y = kicad_pad_positions[pin.id]

            assert predicted_x == pytest.approx(actual_x, abs=0.5), \
                f"Pin {pin.id} x: predicted={predicted_x:.3f}, " \
                f"actual={actual_x:.3f} (rot={rotation}, side={side.value})"
            assert predicted_y == pytest.approx(actual_y, abs=0.5), \
                f"Pin {pin.id} y: predicted={predicted_y:.3f}, " \
                f"actual={actual_y:.3f} (rot={rotation}, side={side.value})"
