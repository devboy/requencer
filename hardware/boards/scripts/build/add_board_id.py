#!/usr/bin/env python3
"""Add board identification text to PCB silkscreen.

Stamps a board name and revision on the B.SilkS layer so each
fabricated board is identifiable. Text is placed near the bottom-right
corner of the board outline.

Usage:
    python3 add_board_id.py <input.kicad_pcb> [output.kicad_pcb] [--board-id TEXT]

    If output is omitted, modifies in-place.
    If --board-id is omitted, derives the name from the input filename.
"""

import os
import sys
import pcbnew

# Default board IDs per board name
BOARD_IDS = {
    "control": "requencer control proto001",
    "main": "requencer main proto001",
}


def add_board_id(pcb_path, output_path=None, board_id=None):
    """Add board identification text to B.SilkS."""
    if output_path is None:
        output_path = pcb_path

    board = pcbnew.LoadBoard(pcb_path)

    # Derive board ID from filename if not provided
    if board_id is None:
        basename = os.path.splitext(os.path.basename(pcb_path))[0]
        for key, default_id in BOARD_IDS.items():
            if key in basename:
                board_id = default_id
                break
        if board_id is None:
            board_id = f"requencer {basename} proto001"

    # Place text near bottom-right of board outline
    bbox = board.GetBoardEdgesBoundingBox()
    margin = pcbnew.FromMM(2.0)
    x = bbox.GetRight() - margin
    y = bbox.GetBottom() - margin

    layer_id = board.GetLayerID("B.SilkS")

    text = pcbnew.PCB_TEXT(board)
    text.SetText(board_id)
    text.SetPosition(pcbnew.VECTOR2I(x, y))
    text.SetLayer(layer_id)
    text.SetTextSize(pcbnew.VECTOR2I(pcbnew.FromMM(1.0), pcbnew.FromMM(1.0)))
    text.SetTextThickness(pcbnew.FromMM(0.15))
    text.SetHorizJustify(pcbnew.GR_TEXT_H_ALIGN_RIGHT)
    text.SetVertJustify(pcbnew.GR_TEXT_V_ALIGN_BOTTOM)
    board.Add(text)

    board.Save(output_path)
    print(f"  Board ID: \"{board_id}\" on B.SilkS")
    print(f"  Saved: {output_path}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: add_board_id.py <input.kicad_pcb> [output.kicad_pcb] [--board-id TEXT]")
        sys.exit(1)

    pcb_path = sys.argv[1]
    output_path = None
    board_id = None

    i = 2
    while i < len(sys.argv):
        if sys.argv[i] == "--board-id":
            board_id = sys.argv[i + 1]
            i += 2
        elif output_path is None and not sys.argv[i].startswith("--"):
            output_path = sys.argv[i]
            i += 1
        else:
            i += 1

    add_board_id(pcb_path, output_path, board_id)
