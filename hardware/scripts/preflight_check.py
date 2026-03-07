#!/usr/bin/env python3
"""Preflight checks for atopile hardware build.

Runs fast, local validation before the slow ato build. Catches issues that
would otherwise only surface after 12+ minutes of part picking.

Exit code 0 = all checks pass, 1 = failures found.
"""

import os
import re
import sys
from pathlib import Path


def find_hardware_root():
    """Find the hardware/ directory relative to this script."""
    script_dir = Path(__file__).resolve().parent
    return script_dir.parent


def check_atomic_parts(hw_root: Path) -> list[str]:
    """Verify that is_atomic_part references point to existing files."""
    errors = []
    parts_dir = hw_root / "parts"
    if not parts_dir.exists():
        errors.append(f"Parts directory not found: {parts_dir}")
        return errors

    for ato_file in parts_dir.rglob("*.ato"):
        content = ato_file.read_text()
        # Extract footprint references
        fp_match = re.search(r'footprint="([^"]+)"', content)
        sym_match = re.search(r'symbol="([^"]+)"', content)

        if fp_match:
            fp_file = ato_file.parent / fp_match.group(1)
            if not fp_file.exists():
                errors.append(
                    f"{ato_file.relative_to(hw_root)}: "
                    f"footprint file missing: {fp_match.group(1)}"
                )

        if sym_match:
            sym_file = ato_file.parent / sym_match.group(1)
            if not sym_file.exists():
                errors.append(
                    f"{ato_file.relative_to(hw_root)}: "
                    f"symbol file missing: {sym_match.group(1)}"
                )

    return errors


def check_pin_count_matches_footprint(hw_root: Path) -> list[str]:
    """Check that parts with is_atomic_part have matching pin/pad counts."""
    errors = []
    parts_dir = hw_root / "parts"
    if not parts_dir.exists():
        return errors

    for ato_file in parts_dir.rglob("*.ato"):
        content = ato_file.read_text()

        # Only check parts with is_atomic_part
        fp_match = re.search(r'footprint="([^"]+)"', content)
        if not fp_match:
            continue

        # Count signal pins in .ato
        pin_matches = re.findall(r"~ pin (\d+)", content)
        if not pin_matches:
            continue
        ato_pin_count = len(pin_matches)
        max_pin = max(int(p) for p in pin_matches)

        # Count pads in .kicad_mod
        fp_file = ato_file.parent / fp_match.group(1)
        if not fp_file.exists():
            continue  # Already caught by check_atomic_parts
        fp_content = fp_file.read_text()
        pad_matches = re.findall(r'\(pad "(\d+)"', fp_content)
        if not pad_matches:
            continue
        fp_pad_count = len(pad_matches)

        if max_pin > fp_pad_count:
            errors.append(
                f"{ato_file.relative_to(hw_root)}: "
                f"max pin number ({max_pin}) > footprint pad count ({fp_pad_count})"
            )

    return errors


def check_duplicate_lcsc(hw_root: Path) -> list[str]:
    """Detect duplicate LCSC part numbers across different components."""
    errors = []
    parts_dir = hw_root / "parts"
    if not parts_dir.exists():
        return errors

    lcsc_map: dict[str, list[str]] = {}
    for ato_file in parts_dir.rglob("*.ato"):
        content = ato_file.read_text()
        match = re.search(r'supplier_partno="(C\d+)"', content)
        if match:
            lcsc = match.group(1)
            part_name = ato_file.parent.name
            lcsc_map.setdefault(lcsc, []).append(part_name)

    for lcsc, parts in lcsc_map.items():
        if len(parts) > 1:
            errors.append(
                f"Duplicate LCSC {lcsc} used by: {', '.join(sorted(parts))}"
            )

    return errors


def check_ato_imports(hw_root: Path) -> list[str]:
    """Check that parts using traits have the required imports."""
    errors = []
    parts_dir = hw_root / "parts"
    if not parts_dir.exists():
        return errors

    for ato_file in parts_dir.rglob("*.ato"):
        content = ato_file.read_text()

        if "is_atomic_part" in content and "import is_atomic_part" not in content:
            errors.append(
                f"{ato_file.relative_to(hw_root)}: "
                f"uses is_atomic_part trait but missing 'import is_atomic_part'"
            )

        if "has_part_picked" in content and "import has_part_picked" not in content:
            errors.append(
                f"{ato_file.relative_to(hw_root)}: "
                f"uses has_part_picked trait but missing 'import has_part_picked'"
            )

    return errors


def main():
    hw_root = find_hardware_root()
    print(f"Hardware root: {hw_root}")

    all_errors = []
    checks = [
        ("Atomic part file references", check_atomic_parts),
        ("Pin count vs footprint pads", check_pin_count_matches_footprint),
        ("Duplicate LCSC part numbers", check_duplicate_lcsc),
        ("Required imports", check_ato_imports),
    ]

    for name, check_fn in checks:
        errors = check_fn(hw_root)
        status = "FAIL" if errors else "OK"
        print(f"  [{status}] {name}")
        for err in errors:
            print(f"         {err}")
        all_errors.extend(errors)

    print()
    if all_errors:
        print(f"Preflight failed: {len(all_errors)} error(s)")
        return 1
    else:
        print("Preflight passed")
        return 0


if __name__ == "__main__":
    sys.exit(main())
