#!/usr/bin/env python3
"""Assemble a hardware release zip for GitHub Releases.

CI cannot build the hardware pipeline, so artifacts are built locally and
uploaded via `make release-artifacts TAG=...`. This script only collects and
zips — it never talks to GitHub.

Contents: KiCad projects (poured control/main + faceplate), schematic review
PDFs, manufacturing exports (gerbers/BOM), and STEP models.
"""

import argparse
import sys
import zipfile
from pathlib import Path

# (arcname, source path, required)
Artifact = tuple[str, Path, bool]

HINTS = {
    "kicad": "run the hardware pipeline: make -C hardware all",
    "review": "generate review PDFs: KiCad python + hardware/boards/scripts/review/gen_review_pack.py",
    "manufacturing": "run: make -C hardware export",
    "3d": "run: make -C hardware 3d",
}


def artifact_manifest(hw: Path) -> list[Artifact]:
    build = hw / "boards" / "build"
    fp = hw / "faceplate" / "elec" / "layout"
    items: list[Artifact] = [
        ("kicad/control/control-poured.kicad_pcb", build / "control-poured.kicad_pcb", True),
        ("kicad/control/control-poured.kicad_pro", build / "control-poured.kicad_pro", False),
        ("kicad/control/control-poured.kicad_prl", build / "control-poured.kicad_prl", False),
        ("kicad/main/main-poured.kicad_pcb", build / "main-poured.kicad_pcb", True),
        ("kicad/main/main-poured.kicad_pro", build / "main-poured.kicad_pro", False),
        ("kicad/main/main-poured.kicad_prl", build / "main-poured.kicad_prl", False),
        ("kicad/faceplate/faceplate.kicad_pcb", fp / "faceplate.kicad_pcb", True),
        ("kicad/faceplate/faceplate.kicad_pro", fp / "faceplate.kicad_pro", False),
        ("review/control.pdf", build / "review" / "control.pdf", True),
        ("review/main.pdf", build / "review" / "main.pdf", True),
        ("3d/control.step", build / "3d" / "control.step", False),
        ("3d/main.step", build / "3d" / "main.step", False),
        ("3d/faceplate.step", build / "3d" / "faceplate.step", False),
    ]
    # Manufacturing exports: collect whole trees, optional as a group.
    mfg = build / "manufacturing"
    if mfg.is_dir():
        for f in sorted(mfg.rglob("*")):
            if f.is_file():
                items.append((f"manufacturing/{f.relative_to(mfg)}", f, False))
    return items


def check_missing(items: list[Artifact]) -> list[str]:
    missing = []
    for arcname, src, required in items:
        if required and not src.is_file():
            hint = HINTS.get(arcname.split("/")[0], "")
            missing.append(f"{arcname}  (expected at {src}){' — ' + hint if hint else ''}")
    return missing


def release_notes(tag: str, items: list[Artifact]) -> str:
    lines = [
        f"# Requencer hardware — {tag}",
        "",
        "Locally built hardware artifacts for design review (CI cannot build these).",
        "",
        "## Contents",
        "",
        "- `kicad/` — routed + poured KiCad projects (control, main, faceplate). KiCad 10.",
        "- `review/` — schematic review PDFs, one page per subcircuit (net-label style).",
        "- `manufacturing/` — gerbers / drill / BOM exports.",
        "- `3d/` — STEP models of the board stack.",
        "",
        "Design source is atopile (`hardware/boards/elec/src/` in the repo);",
        "the KiCad files here are the compiled output that the PDFs were",
        "generated from.",
        "",
        "Repo: https://github.com/devboy/requencer",
        "",
        "## Files included",
        "",
    ]
    lines += [f"- {arcname}" for arcname, src, _ in items if src.is_file()]
    return "\n".join(lines) + "\n"


def build_zip(hw: Path, tag: str, out_dir: Path) -> Path:
    items = artifact_manifest(hw)
    missing = check_missing(items)
    if missing:
        print("ERROR: missing required artifacts:\n", file=sys.stderr)
        for m in missing:
            print(f"  - {m}", file=sys.stderr)
        sys.exit(1)

    out_dir.mkdir(parents=True, exist_ok=True)
    notes = release_notes(tag, items)
    (out_dir / "release-notes.md").write_text(notes)

    zip_path = out_dir / f"requencer-hardware-{tag}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("README.txt", notes)
        for arcname, src, _required in items:
            if src.is_file():
                zf.write(src, arcname)
    return zip_path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hardware-dir", type=Path, required=True, help="path to hardware/")
    parser.add_argument("--tag", required=True, help="release tag, e.g. hw-review-r1")
    parser.add_argument("--out", type=Path, required=True, help="output directory")
    args = parser.parse_args()

    zip_path = build_zip(args.hardware_dir.resolve(), args.tag, args.out.resolve())
    print(f"Wrote {zip_path}")


if __name__ == "__main__":
    main()
