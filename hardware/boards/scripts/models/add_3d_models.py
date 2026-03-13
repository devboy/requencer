#!/usr/bin/env python3
"""Add KiCad built-in 3D model references to footprint files and PCBs.

Two modes:
  1. Library footprints: Updates .kicad_mod files in hardware/boards/parts/
  2. PCB files: Adds model refs to inline footprints, writing a new output file

Uses ${KICAD9_3DMODEL_DIR} for portability — KiCad resolves this at runtime.

3D model offsets are auto-calculated by comparing pad "1" positions between our
custom footprints and KiCad's standard library footprints. This handles footprints
where we center the origin but KiCad's model expects pin 1 at origin.
"""

from __future__ import annotations

import argparse
import os
import re
from pathlib import Path

BOARDS_DIR = Path(__file__).resolve().parent.parent.parent
PARTS_DIR = BOARDS_DIR / "parts"
BUILD_DIR = BOARDS_DIR / "build"

# KiCad footprint library path — resolved from env or default macOS location
KICAD_FP_DIR = Path(
    os.environ.get(
        "KICAD9_FOOTPRINT_DIR",
        "/Applications/KiCad/KiCad.app/Contents/SharedSupport/footprints",
    )
)

# Footprint file (relative to PARTS_DIR) → KiCad built-in 3D model path
# Offsets are auto-calculated from pad "1" position differences unless
# overridden in OFFSET_OVERRIDES below.
MODEL_MAP: dict[str, str] = {
    "2N3904/SOT-23.kicad_mod": "Package_TO_SOT_SMD.3dshapes/SOT-23.step",
    "2N7002/SOT-23.kicad_mod": "Package_TO_SOT_SMD.3dshapes/SOT-23.step",
    "BAT54S/SOT-23.kicad_mod": "Package_TO_SOT_SMD.3dshapes/SOT-23.step",
    "AMS1117-3.3/SOT-223.kicad_mod": "Package_TO_SOT_SMD.3dshapes/SOT-223.step",
    "AZ1117IH-5.0/SOT-223.kicad_mod": "Package_TO_SOT_SMD.3dshapes/SOT-223.step",
    "PRTR5V0U2X/SOT-143B.kicad_mod": "Package_TO_SOT_SMD.3dshapes/SOT-143.step",
    "B5819W/SOD-123.kicad_mod": "Diode_SMD.3dshapes/D_SOD-123.step",
    "6N138/DIP-8.kicad_mod": "Package_DIP.3dshapes/DIP-8_W7.62mm.step",
    "74HC165D/SOIC-16.kicad_mod": "Package_SO.3dshapes/SOIC-16_3.9x9.9mm_P1.27mm.step",
    "74HCT125D/SOIC-14.kicad_mod": "Package_SO.3dshapes/SOIC-14_3.9x8.7mm_P1.27mm.step",
    "DAC8568SPMR/TSSOP-16.kicad_mod": "Package_SO.3dshapes/TSSOP-16_4.4x5mm_P0.65mm.step",
    "OPA4172ID/TSSOP-14.kicad_mod": "Package_SO.3dshapes/TSSOP-14_4.4x5mm_P0.65mm.step",
    "TLC5947DAP/HTSSOP-32.kicad_mod": "Package_SO.3dshapes/HTSSOP-32-1EP_6.1x11mm_P0.65mm_EP5.2x11mm.step",
    "PinHeader1x9/PinHeader1x9.kicad_mod": "Connector_PinHeader_2.54mm.3dshapes/PinHeader_1x09_P2.54mm_Vertical.step",
    "ResistorNetwork9/SIP-9.kicad_mod": "Resistor_THT.3dshapes/R_Array_SIP9.step",
    "EurorackPowerHeader/EurorackPowerHeader_2x5.kicad_mod": "Connector_IDC.3dshapes/IDC-Header_2x05_P2.54mm_Vertical.step",
    "ShroudedHeader2x16/ShroudedHeader2x16.kicad_mod": "Connector_PinHeader_2.54mm.3dshapes/PinHeader_2x16_P2.54mm_Vertical.step",
    "ShroudedSocket2x16/ShroudedSocket2x16.kicad_mod": "Connector_PinSocket_2.54mm.3dshapes/PinSocket_2x16_P2.54mm_Vertical.step",
    "TactileSwitch/SW_SPST_PTS645.kicad_mod": "Button_Switch_THT.3dshapes/SW_PUSH_6mm_H5mm.step",
    "RaspberryPiPico/RaspberryPiPico.kicad_mod": "Module.3dshapes/RaspberryPi_Pico.step",
    "USB_C_Receptacle/USB_C_Receptacle.kicad_mod": "Connector_USB.3dshapes/USB_C_Receptacle_GCT_USB4085.step",
    "MicroSD_Slot/MicroSD_Slot.kicad_mod": "Connector_Card.3dshapes/microSD_HC_Hirose_DM3AT-SF-PEJM5.step",
}

# Manual offset overrides for footprints where auto-calculation fails.
# Needed when our simplified custom footprint has a different pad layout than the
# KiCad standard (e.g. USB-C uses "A1"/"B1" pad names, MicroSD has reversed pin order).
# Values: (dx, dy, dz) in 3D model coordinates (Y inverted from PCB).
# Use (0, 0, 0) when both footprints are body-centered.
OFFSET_OVERRIDES: dict[str, tuple[float, float, float]] = {
    "USB_C_Receptacle/USB_C_Receptacle.kicad_mod": (-2.975, 2.43, 0),
    "MicroSD_Slot/MicroSD_Slot.kicad_mod": (0, 0, 0),
    "ShroudedSocket2x16/ShroudedSocket2x16.kicad_mod": (1.27, 19.05, 0),
}

# Manual rotation overrides for footprints whose orientation differs from the
# KiCad standard (e.g. our SIP-9 runs vertically but the standard is horizontal).
# Values: (rx, ry, rz) in degrees.
ROTATION_OVERRIDES: dict[str, tuple[float, float, float]] = {
    "ResistorNetwork9/SIP-9.kicad_mod": (0, 0, 90),
}

# Local STEP files (relative to PARTS_DIR) — these use ${KIPRJMOD} relative paths
# Format: footprint .kicad_mod path → (step_file_path, offset_xyz, rotate_xyz)
# offset/rotate are (x, y, z) tuples; None means (0, 0, 0)
# Local models have no KiCad standard reference, so offsets remain manual.
LOCAL_MODEL_MAP: dict[str, tuple[str, tuple | None, tuple | None]] = {
    "EC11E/EC11E.kicad_mod": ("EC11E/EC11E.step", None, None),
    "TC002-RGB/TC002-N11AS1XT-RGB.kicad_mod": ("TC002-RGB/TC002-N11AS1XT-RGB.step", None, None),
    "PJ398SM/PJ398SM.kicad_mod": ("PJ398SM/PJ398SM.step", None, None),
    "PJ366ST/PJ366ST.kicad_mod": ("PJ366ST/PJ366ST.step", None, None),
    "PGA2350/PGA2350.kicad_mod": ("PGA2350/PGA2350.step", None, None),
    "FPC_18P_05MM/FPC_18P_05MM.kicad_mod": ("FPC_18P_05MM/FPC_18P_05MM.step", None, None),
    "PJS008U/PJS008U.kicad_mod": ("PJS008U/PJS008U.step", None, None),
}


def extract_pad1_position(content: str) -> tuple[float, float] | None:
    """Extract the (x, y) position of pad "1" from footprint content.

    Returns None if no pad "1" is found.
    """
    # Match pad "1" with at (x y) — handles both inline and multiline formats
    # Inline: (pad "1" thru_hole rect (at -3.81 -3.81) ...)
    # Multiline: (pad "1" ...\n\t\t(at 0 0)\n...)
    m = re.search(
        r'\(pad\s+"1"\s+\w+\s+\w+[^)]*\(at\s+([-\d.]+)\s+([-\d.]+)',
        content,
    )
    if not m:
        # Try multiline: pad "1" on one line, (at ...) on the next
        m = re.search(
            r'\(pad\s+"1"\s+.*?\(at\s+([-\d.]+)\s+([-\d.]+)',
            content,
            re.DOTALL,
        )
    if m:
        return float(m.group(1)), float(m.group(2))
    return None


def resolve_kicad_footprint(model_path: str) -> Path | None:
    """Find the KiCad standard library footprint that corresponds to a 3D model path.

    Model paths look like: "Package_DIP.3dshapes/DIP-8_W7.62mm.step"
    Standard footprint:    KICAD_FP_DIR/Package_DIP.pretty/DIP-8_W7.62mm.kicad_mod
    """
    if not KICAD_FP_DIR.is_dir():
        return None

    # "Package_DIP.3dshapes/DIP-8_W7.62mm.step" → lib="Package_DIP", name="DIP-8_W7.62mm"
    parts = model_path.split("/")
    if len(parts) != 2:
        return None

    lib_name = parts[0].replace(".3dshapes", ".pretty")
    fp_name = parts[1].replace(".step", ".kicad_mod")
    fp_path = KICAD_FP_DIR / lib_name / fp_name
    return fp_path if fp_path.is_file() else None


def compute_model_offset(
    our_footprint: Path, model_path: str
) -> tuple[float, float, float] | None:
    """Auto-calculate offset by comparing pad "1" positions.

    Compares our custom footprint's pad "1" against the KiCad standard library
    footprint's pad "1". The difference is the offset needed for the 3D model.

    Note: KiCad's 3D model offset Y axis is inverted relative to PCB coordinates
    (PCB Y points down, 3D model Y points up), so the Y delta is negated.

    Returns (dx, dy, 0) or None if comparison isn't possible.
    """
    std_fp = resolve_kicad_footprint(model_path)
    if std_fp is None:
        return None

    our_pos = extract_pad1_position(our_footprint.read_text())
    std_pos = extract_pad1_position(std_fp.read_text())

    if our_pos is None or std_pos is None:
        return None

    dx = round(our_pos[0] - std_pos[0], 4) or 0.0  # avoid -0.0
    # Y is inverted: PCB Y-down → 3D model Y-up
    dy = round(-(our_pos[1] - std_pos[1]), 4) or 0.0

    if dx == 0.0 and dy == 0.0:
        return None  # No offset needed

    return (dx, dy, 0)


# PCB footprint name ("Lib:Footprint") → (model_path, is_local, offset, rotate)
# Built at import time; offsets for MODEL_MAP entries are computed lazily in main().
PCB_MODEL_MAP: dict[str, tuple[str, bool, tuple | None, tuple | None]] = {}


def build_pcb_model_map(computed_offsets: dict[str, tuple]) -> None:
    """Build the PCB_MODEL_MAP from MODEL_MAP + LOCAL_MODEL_MAP with computed offsets."""
    PCB_MODEL_MAP.clear()

    for rel_path, model_path in MODEL_MAP.items():
        offset = computed_offsets.get(rel_path)
        lib_name = rel_path.split("/")[0]
        fp_name = rel_path.split("/")[1].removesuffix(".kicad_mod")
        pcb_key = f"{lib_name}:{fp_name}"
        rotate = ROTATION_OVERRIDES.get(rel_path)
        PCB_MODEL_MAP[pcb_key] = (model_path, False, offset, rotate)

    for rel_path, entry in LOCAL_MODEL_MAP.items():
        model_path, offset, rotate = entry
        lib_name = rel_path.split("/")[0]
        fp_name = rel_path.split("/")[1].removesuffix(".kicad_mod")
        pcb_key = f"{lib_name}:{fp_name}"
        PCB_MODEL_MAP[pcb_key] = (model_path, True, offset, rotate)


def make_model_block(
    model_path: str,
    indent: str = "\t",
    local: bool = False,
    offset: tuple | None = None,
    rotate: tuple | None = None,
) -> str:
    if local:
        # Local STEP files relative to build dir (hardware/boards/build/)
        # KIPRJMOD resolves to the .kicad_pro location = build dir
        path = f"${{KIPRJMOD}}/../parts/{model_path}"
    else:
        path = f"${{KICAD9_3DMODEL_DIR}}/{model_path}"
    ox, oy, oz = offset or (0, 0, 0)
    rx, ry, rz = rotate or (0, 0, 0)
    return (
        f'{indent}(model "{path}"\n'
        f"{indent}\t(offset (xyz {ox} {oy} {oz}))\n"
        f"{indent}\t(scale (xyz 1 1 1))\n"
        f"{indent}\t(rotate (xyz {rx} {ry} {rz}))\n"
        f"{indent})"
    )


def remove_model_blocks(content: str) -> str:
    """Remove all (model ...) blocks from footprint content."""
    while True:
        idx = content.find("(model ")
        if idx == -1:
            break
        # Find start of the line containing (model
        line_start = content.rfind("\n", 0, idx)
        if line_start == -1:
            line_start = 0
        else:
            line_start += 1  # skip the newline itself
        # Find end of the model block
        model_end = find_footprint_end(content, idx)
        if model_end == -1:
            break
        end = model_end + 1
        # Also consume trailing newline
        if end < len(content) and content[end] == "\n":
            end += 1
        content = content[:line_start] + content[end:]
    return content


def add_model_to_footprint(
    filepath: Path,
    model_path: str,
    local: bool = False,
    offset: tuple | None = None,
    rotate: tuple | None = None,
) -> bool:
    """Insert or replace model block in a .kicad_mod file. Returns True if modified."""
    content = filepath.read_text()

    had_model = "(model " in content
    if had_model:
        content = remove_model_blocks(content)

    last_paren = content.rstrip().rfind(")")
    if last_paren == -1:
        print(f"  ERROR (no closing paren): {filepath.relative_to(PARTS_DIR)}")
        return False

    model_block = make_model_block(model_path, local=local, offset=offset, rotate=rotate)
    new_content = content[:last_paren] + model_block + "\n" + content[last_paren:]

    filepath.write_text(new_content)
    action = "REPLACED" if had_model else "ADDED"
    offset_str = f" (offset {offset})" if offset else ""
    print(f"  {action}: {filepath.relative_to(PARTS_DIR)} → {model_path}{offset_str}")
    return True


def find_footprint_end(content: str, start: int) -> int:
    """Find the closing paren that ends a (footprint ...) block starting at `start`.

    `start` should point to the '(' of '(footprint'.
    Returns the index of the matching ')'.
    """
    depth = 0
    i = start
    while i < len(content):
        ch = content[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return i
        elif ch == '"':
            # Skip quoted strings (they may contain parens)
            i += 1
            while i < len(content) and content[i] != '"':
                if content[i] == "\\":
                    i += 1  # skip escaped char
                i += 1
        i += 1
    return -1


def add_models_to_pcb_content(content: str) -> tuple[str, int]:
    """Add or replace model references in footprint blocks in PCB content.

    Returns (modified_content, num_updated).
    """
    updated = 0

    # Process in reverse order so insertions don't shift later match positions
    matches = list(re.finditer(r'\(footprint\s+"([^"]+)"', content))
    for match in reversed(matches):
        fp_name = match.group(1)
        if fp_name not in PCB_MODEL_MAP:
            continue

        block_start = match.start()
        block_end = find_footprint_end(content, block_start)
        if block_end == -1:
            print(f"  WARNING: unbalanced parens for {fp_name}")
            continue

        block_text = content[block_start : block_end + 1]
        model_path, is_local, model_offset, model_rotate = PCB_MODEL_MAP[fp_name]

        # Remove existing model blocks from this footprint
        clean_block = remove_model_blocks(block_text)

        # Find closing paren of cleaned block
        clean_end = clean_block.rstrip().rfind(")")
        model_block = make_model_block(
            model_path, indent="\t\t", local=is_local,
            offset=model_offset, rotate=model_rotate,
        )
        new_block = clean_block[:clean_end] + "\n" + model_block + "\n\t" + clean_block[clean_end:]

        if new_block != block_text:
            content = content[:block_start] + new_block + content[block_end + 1:]
            updated += 1

    return content, updated


def add_models_to_pcb_file(input_path: Path, output_path: Path = None) -> int:
    """Add 3D model references to a .kicad_pcb file.

    If output_path is provided, writes to that file (no in-place mutation).
    Otherwise modifies input_path in-place.

    Returns the number of footprints updated.
    """
    content = input_path.read_text()
    content, updated = add_models_to_pcb_content(content)

    if updated > 0:
        dest = output_path or input_path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(content)

    return updated


def compute_all_offsets() -> dict[str, tuple]:
    """Compute 3D model offsets for all MODEL_MAP entries.

    Compares pad "1" positions between our footprints and KiCad's standard library.
    Returns a dict of rel_path → (dx, dy, 0) for entries that need offsets.
    """
    offsets: dict[str, tuple] = {}

    if not KICAD_FP_DIR.is_dir():
        print(f"  WARNING: KiCad footprint library not found at {KICAD_FP_DIR}")
        print(f"  Set KICAD9_FOOTPRINT_DIR to your KiCad footprints path.")
        print(f"  3D model offsets will not be auto-calculated.\n")
        return offsets

    for rel_path, model_path in sorted(MODEL_MAP.items()):
        filepath = PARTS_DIR / rel_path
        if not filepath.exists():
            continue

        if rel_path in OFFSET_OVERRIDES:
            override = OFFSET_OVERRIDES[rel_path]
            if override != (0, 0, 0):
                offsets[rel_path] = override
                print(f"  MANUAL-OFFSET: {rel_path} → ({override[0]}, {override[1]}, {override[2]})")
            else:
                print(f"  MANUAL-OFFSET: {rel_path} → (0, 0, 0) [no offset]")
            continue

        offset = compute_model_offset(filepath, model_path)
        if offset is not None:
            offsets[rel_path] = offset
            print(f"  AUTO-OFFSET: {rel_path} → ({offset[0]}, {offset[1]}, {offset[2]})")

    return offsets


def update_library_footprints(computed_offsets: dict[str, tuple]) -> None:
    print(f"Parts directory: {PARTS_DIR}")
    print(f"Mapping: {len(MODEL_MAP)} built-in + {len(LOCAL_MODEL_MAP)} local\n")

    added = 0
    skipped = 0
    errors = 0

    for rel_path, model_path in sorted(MODEL_MAP.items()):
        filepath = PARTS_DIR / rel_path
        if not filepath.exists():
            print(f"  ERROR (not found): {rel_path}")
            errors += 1
            continue

        offset = computed_offsets.get(rel_path)
        rotate = ROTATION_OVERRIDES.get(rel_path)
        if add_model_to_footprint(filepath, model_path, offset=offset, rotate=rotate):
            added += 1
        else:
            skipped += 1

    for rel_path, entry in sorted(LOCAL_MODEL_MAP.items()):
        model_path, offset, rotate = entry
        filepath = PARTS_DIR / rel_path
        if not filepath.exists():
            print(f"  ERROR (not found): {rel_path}")
            errors += 1
            continue

        if add_model_to_footprint(filepath, model_path, local=True, offset=offset, rotate=rotate):
            added += 1
        else:
            skipped += 1

    print(f"\nLibrary footprints: {added} added, {skipped} skipped, {errors} errors")


def add_models_to_pcbs(input_path: Path = None, output_path: Path = None) -> None:
    """Add 3D model references to PCB files.

    If input_path and output_path are given, processes a single PCB (writes new file).
    Otherwise discovers and updates all PCBs in BUILD_DIR in-place.
    """
    if input_path and output_path:
        print(f"\nAdding 3D models: {input_path.name} → {output_path.name}")
        count = add_models_to_pcb_file(input_path, output_path)
        print(f"  {count} footprints updated → {output_path}")
        return

    pcb_files = sorted(
        list(BUILD_DIR.glob("*-poured.kicad_pcb"))
        + list(BUILD_DIR.glob("*-routed.kicad_pcb"))
    )
    if not pcb_files:
        print(f"\nNo PCB files found in {BUILD_DIR}")
        return

    print(f"\nAdding 3D models to PCB files:")
    for pcb in pcb_files:
        count = add_models_to_pcb_file(pcb)
        print(f"  {pcb.name}: {count} footprints updated")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "input_pcb",
        nargs="?",
        type=Path,
        help="Input PCB file (writes output without modifying input)",
    )
    parser.add_argument(
        "output_pcb",
        nargs="?",
        type=Path,
        help="Output PCB file path (required when input_pcb is given)",
    )
    parser.add_argument(
        "--pcb-only",
        action="store_true",
        help="Only update PCB files (skip library footprints)",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Only report which footprints need offsets, don't modify files",
    )
    args = parser.parse_args()

    print("Computing 3D model offsets from KiCad standard library...")
    computed_offsets = compute_all_offsets()
    if computed_offsets:
        print(f"  {len(computed_offsets)} footprint(s) need offset correction\n")
    else:
        print(f"  All footprints aligned — no offsets needed\n")

    if args.check:
        return

    build_pcb_model_map(computed_offsets)

    if args.input_pcb:
        if not args.output_pcb:
            parser.error("output_pcb is required when input_pcb is given")
        add_models_to_pcbs(args.input_pcb, args.output_pcb)
    else:
        if not args.pcb_only:
            update_library_footprints(computed_offsets)
        add_models_to_pcbs()


if __name__ == "__main__":
    main()
