"""Orchestrator: generate per-board review PDFs from committed *-placed.kicad_pcb.

Pipeline for each board:
  1. extract.extract_board(...)    — pcbnew → dict
  2. render_overview(...)          — SVG overview page
  3. render_subcircuit(...)        — one SVG per subcircuit
  4. rsvg-convert                  — each SVG → PDF (one page each)
  5. pdfunite                      — merge per-board PDFs into <board>.pdf

Output files are written under <out_dir>/ by default:
  <out>/control.pdf
  <out>/main.pdf
  <out>/<board>.svg files are also kept for inspection

Faceplate is skipped (no electrical components — purely mechanical PCB).

Usage (under KICAD_PYTHON):
    python gen_review_pack.py --out hardware/boards/build/review
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

# Allow `from review import ...` regardless of the current working directory
# when invoked as a script (python review/gen_review_pack.py).
_SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from review import extract, render_overview, render_subcircuit  # noqa: E402


# -----------------------------------------------------------------------------
# Board config
# -----------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[4]

BOARD_CONFIGS = {
    "main": {
        "pcb": REPO_ROOT / "hardware/boards/build/main-placed.kicad_pcb",
    },
    "control": {
        "pcb": REPO_ROOT / "hardware/boards/build/control-placed.kicad_pcb",
    },
    # Faceplate intentionally excluded — mechanical-only PCB, no components
}


# -----------------------------------------------------------------------------
# External tools
# -----------------------------------------------------------------------------

def _check_tool(name: str) -> str:
    """Return absolute path to an external tool or exit with error."""
    path = shutil.which(name)
    if not path:
        print(
            f"ERROR: required tool '{name}' not found on PATH.\n"
            f"  macOS:         brew install librsvg poppler\n"
            f"  Debian/Ubuntu: apt-get install librsvg2-bin poppler-utils",
            file=sys.stderr,
        )
        raise SystemExit(1)
    return path


def svg_to_pdf(svg_path: Path, pdf_path: Path, rsvg_convert: str) -> None:
    """Convert a single SVG file to a single-page PDF."""
    subprocess.run(
        [rsvg_convert, "-f", "pdf", "-o", str(pdf_path), str(svg_path)],
        check=True,
    )


def merge_pdfs(inputs: list[Path], output: Path, pdfunite: str) -> None:
    """Merge multiple single-page PDFs into one multi-page PDF."""
    if not inputs:
        return
    cmd = [pdfunite] + [str(p) for p in inputs] + [str(output)]
    subprocess.run(cmd, check=True)


# -----------------------------------------------------------------------------
# Per-board rendering
# -----------------------------------------------------------------------------

def _safe_name(s: str) -> str:
    """Sanitize a subcircuit name for use as a filename."""
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in s)


def _cross_nets_for_sub(data: dict[str, Any], sub_name: str) -> list[str]:
    return [
        n["net"]
        for n in data["cross_subcircuit_nets"]
        if sub_name in n["subcircuits"]
    ]


def generate_board(
    board_name: str,
    pcb_path: Path,
    out_dir: Path,
    rsvg_convert: str,
    pdfunite: str,
) -> Path:
    """Generate the review artifacts for one board. Returns the merged PDF path."""
    board_dir = out_dir / board_name
    board_dir.mkdir(parents=True, exist_ok=True)

    # Delete any existing merged PDF so a failed run doesn't silently
    # surface stale output from a previous successful run.
    merged_pdf = out_dir / f"{board_name}.pdf"
    if merged_pdf.exists():
        merged_pdf.unlink()

    print(f"\n[{board_name}] extracting PCB...")
    data = extract.extract_board(board_name, pcb_path)

    sub_count = len(data["subcircuits"])
    comp_count = sum(
        len(s["components"]) for s in data["subcircuits"].values()
    )
    print(
        f"[{board_name}] {sub_count} subcircuits, {comp_count} components, "
        f"{len(data['cross_subcircuit_nets'])} cross-block nets"
    )

    # -- overview ----------------------------------------------------------
    overview_svg = board_dir / "00_overview.svg"
    print(f"[{board_name}] rendering overview → {overview_svg.name}")
    render_overview.render_overview(data, str(overview_svg))

    # -- subcircuits -------------------------------------------------------
    # Page order: real subcircuits first (by descending component count),
    # then "protection", then "discretes". The latter two are catch-all
    # groups for singleton passives/protection clamps and go at the end
    # because they're the least interesting for a design review.
    # Tuple (False < True), so `kv[0] == "discretes"` pushes discretes last.
    sub_items = sorted(
        data["subcircuits"].items(),
        key=lambda kv: (
            kv[0] == "discretes",          # discretes last
            kv[0] == "protection",          # protection second-to-last
            -len(kv[1]["components"]),      # then descending by size
            kv[0],                          # then alphabetic tiebreak
        ),
    )

    subcircuit_svgs: list[Path] = []
    for idx, (sub_name, sub) in enumerate(sub_items, start=1):
        svg_path = board_dir / f"{idx:02d}_{_safe_name(sub_name)}.svg"
        cross = _cross_nets_for_sub(data, sub_name)
        render_subcircuit.render_subcircuit(
            board_name, sub, cross, str(svg_path)
        )
        subcircuit_svgs.append(svg_path)
        print(f"[{board_name}]   {svg_path.name} ({len(sub['components'])} comps)")

    # -- SVG → PDF per page ------------------------------------------------
    pdf_pages: list[Path] = []

    overview_pdf = board_dir / "00_overview.pdf"
    svg_to_pdf(overview_svg, overview_pdf, rsvg_convert)
    pdf_pages.append(overview_pdf)

    for svg_path in subcircuit_svgs:
        pdf_path = svg_path.with_suffix(".pdf")
        svg_to_pdf(svg_path, pdf_path, rsvg_convert)
        pdf_pages.append(pdf_path)

    # -- merge -------------------------------------------------------------
    print(f"[{board_name}] merging {len(pdf_pages)} pages → {merged_pdf.name}")
    merge_pdfs(pdf_pages, merged_pdf, pdfunite)

    return merged_pdf


# -----------------------------------------------------------------------------
# Entry point
# -----------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate schematic review PDFs per board."
    )
    parser.add_argument(
        "--out",
        default="hardware/boards/build/review",
        help="Output directory (default: hardware/boards/build/review)",
    )
    parser.add_argument(
        "--board",
        choices=list(BOARD_CONFIGS.keys()) + ["all"],
        default="all",
        help="Which board(s) to render (default: all)",
    )
    args = parser.parse_args()

    rsvg_convert = _check_tool("rsvg-convert")
    pdfunite = _check_tool("pdfunite")

    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    boards = (
        list(BOARD_CONFIGS.keys()) if args.board == "all" else [args.board]
    )

    results: list[Path] = []
    for bn in boards:
        cfg = BOARD_CONFIGS[bn]
        if not cfg["pcb"].exists():
            print(f"SKIP {bn}: {cfg['pcb']} not found", file=sys.stderr)
            continue
        pdf = generate_board(bn, cfg["pcb"], out_dir, rsvg_convert, pdfunite)
        results.append(pdf)

    print("\nFinal PDFs:")
    for p in results:
        size_kb = p.stat().st_size / 1024
        print(f"  {p} ({size_kb:.0f} KB)")

    if not results:
        print("ERROR: no PDFs were produced.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
