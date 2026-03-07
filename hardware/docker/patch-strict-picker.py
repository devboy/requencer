#!/usr/bin/env python3
"""Monkey-patch faebryk's picker to raise on missing footprints.

atopile silently drops components that have no pickers and no footprint,
logging a warning instead of erroring. This script patches the installed
picker.py to raise an exception instead, so CI fails immediately.

Run inside the Docker image after `uv tool install atopile`.
"""

import glob
import re
import sys


def find_picker_py():
    """Find faebryk's picker.py in uv tool install paths."""
    patterns = [
        "/root/.local/share/uv/tools/atopile/**/faebryk/libs/picker/picker.py",
        "/root/.local/**/faebryk/libs/picker/picker.py",
    ]
    for pattern in patterns:
        matches = glob.glob(pattern, recursive=True)
        if matches:
            return matches[0]
    return None


def patch(path):
    with open(path) as f:
        source = f.read()

    # The warning we want to turn into an error:
    #   logger.warning(
    #       f"ATTENTION: No pickers and no footprint for ..."
    #   )
    # Also catch the "No footprint for" variant used in newer versions.
    #
    # Replace logger.warning with raise RuntimeError for these specific messages.

    patched = source

    # Pattern 1: "No pickers and no footprint"
    patched = re.sub(
        r'logger\.warning\(\s*f"ATTENTION: No pickers and no footprint',
        'raise RuntimeError(f"FATAL: No pickers and no footprint',
        patched,
    )

    # Pattern 2: "No footprint for" (BOM warning in newer versions)
    patched = re.sub(
        r'logger\.warning\(\s*f"No footprint for',
        'raise RuntimeError(f"FATAL: No footprint for',
        patched,
    )

    if patched == source:
        print(f"WARNING: No matching patterns found in {path}", file=sys.stderr)
        print("The picker warning format may have changed.", file=sys.stderr)
        # Print relevant lines for debugging
        for i, line in enumerate(source.splitlines(), 1):
            if "footprint" in line.lower() and "warn" in line.lower():
                print(f"  Line {i}: {line.strip()}", file=sys.stderr)
        return False

    with open(path, "w") as f:
        f.write(patched)

    return True


def main():
    path = find_picker_py()
    if not path:
        print("ERROR: Could not find faebryk picker.py", file=sys.stderr)
        sys.exit(1)

    print(f"Found picker.py at: {path}")

    if patch(path):
        print("Patched: logger.warning → raise RuntimeError for missing footprints")
    else:
        print("WARNING: Could not patch — patterns not found", file=sys.stderr)
        print("Build will continue but missing footprints won't be caught early", file=sys.stderr)


if __name__ == "__main__":
    main()
