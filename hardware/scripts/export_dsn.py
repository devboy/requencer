#!/usr/bin/env python3
"""Export a KiCad PCB to Specctra DSN format using the pcbnew Python API.

Handles atopile-generated boards that lack design rules by injecting
sensible defaults before export.

Usage:
    # Must be run with KiCad's bundled Python:
    PYTHONPATH=/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/3.9/lib/python3.9/site-packages \
    DYLD_FRAMEWORK_PATH=/Applications/KiCad/KiCad.app/Contents/Frameworks \
    /Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/3.9/bin/python3 \
    export_dsn.py <input.kicad_pcb> <output.dsn>
"""
import re
import shutil
import sys
import tempfile
from pathlib import Path

# Design rule defaults for 2-layer JLCPCB fabrication
DESIGN_RULES = """
	(net_class "Default" ""
		(clearance 0.2)
		(trace_width 0.25)
		(via_dia 0.6)
		(via_drill 0.3)
		(uvia_dia 0.3)
		(uvia_drill 0.1)
	)
"""


def patch_pcb_design_rules(pcb_text: str) -> str:
    """Inject design rules into a .kicad_pcb file that lacks them."""
    # Check if net_class already exists
    if "net_class" in pcb_text:
        return pcb_text

    # Insert net_class block before the first (net declaration or before closing )
    # In KiCad 8+ format, net classes go in the setup section or at top level
    # We'll insert right after the (setup ...) block closes

    # Find the end of the setup block - match the closing paren
    # Strategy: insert before the first (net line
    net_match = re.search(r'^\t\(net ', pcb_text, re.MULTILINE)
    if net_match:
        insert_pos = net_match.start()
        return pcb_text[:insert_pos] + DESIGN_RULES + "\n" + pcb_text[insert_pos:]

    # Fallback: insert before the last closing paren
    last_paren = pcb_text.rfind(")")
    return pcb_text[:last_paren] + DESIGN_RULES + "\n" + pcb_text[last_paren:]


def main():
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <input.kicad_pcb> <output.dsn>")
        sys.exit(1)

    input_pcb = Path(sys.argv[1]).resolve()
    output_dsn = Path(sys.argv[2]).resolve()

    if not input_pcb.exists():
        print(f"ERROR: Input file not found: {input_pcb}")
        sys.exit(1)

    # Create a temp copy with patched design rules
    with tempfile.TemporaryDirectory() as tmpdir:
        patched_pcb = Path(tmpdir) / "patched.kicad_pcb"

        pcb_text = input_pcb.read_text()
        patched_text = patch_pcb_design_rules(pcb_text)
        patched_pcb.write_text(patched_text)

        print(f"Patched design rules into temp PCB: {patched_pcb}")

        # Now load with pcbnew and export DSN
        import wx
        app = wx.App(False)

        import pcbnew

        board = pcbnew.LoadBoard(str(patched_pcb))
        print(f"Board loaded: {board.GetBoardEdgesBoundingBox()}")

        # Also set design settings via API as belt-and-suspenders
        ds = board.GetDesignSettings()
        ds.m_TrackMinWidth = pcbnew.FromMM(0.15)
        ds.m_ViasMinSize = pcbnew.FromMM(0.5)
        ds.m_ViasMinDrill = pcbnew.FromMM(0.2)
        ds.m_MinClearance = pcbnew.FromMM(0.15)

        # Try to set default track width
        try:
            ds.SetCurrentTrackWidth(pcbnew.FromMM(0.25))
        except AttributeError:
            pass

        result = pcbnew.ExportSpecctraDSN(board, str(output_dsn))
        if result:
            print(f"DSN exported successfully: {output_dsn}")
        else:
            print("ERROR: ExportSpecctraDSN returned False")
            # Try saving the patched board and reporting
            save_path = Path(tmpdir) / "debug_board.kicad_pcb"
            pcbnew.SaveBoard(str(save_path), board)
            print(f"Debug board saved to: {save_path}")
            sys.exit(1)


if __name__ == "__main__":
    main()
