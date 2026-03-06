#!/usr/bin/env bash
# Autoroute a KiCad PCB using Freerouting (headless, all native ARM).
#
# Usage: ./autoroute.sh <input.kicad_pcb> [output.kicad_pcb]
#
# Workflow:
#   1. Export DSN from KiCad PCB (via pcbnew Python API)
#   2. Run Freerouting headless (native Java)
#   3. Import routed SES back into KiCad PCB (via pcbnew Python API)
#
# Requires: KiCad 9 (/Applications/KiCad/), Java (brew openjdk)

set -euo pipefail

INPUT_PCB="${1:?Usage: $0 <input.kicad_pcb> [output.kicad_pcb]}"
OUTPUT_PCB="${2:-$INPUT_PCB}"
WORK_DIR="$(mktemp -d)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Tool paths (env vars with macOS defaults)
KICAD_PYTHON="${KICAD_PYTHON:-/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/3.9/bin/python3}"
KICAD_PYPATH="${KICAD_PYPATH:-/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/3.9/lib/python3.9/site-packages}"
KICAD_FWPATH="${KICAD_FWPATH:-/Applications/KiCad/KiCad.app/Contents/Frameworks}"
KICAD_CLI="${KICAD_CLI:-/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli}"
JAVA="${JAVA:-/opt/homebrew/opt/openjdk/bin/java}"
FREEROUTING_JAR="${FREEROUTING_JAR:-$SCRIPT_DIR/../tools/freerouting.jar}"

# Verify tools exist (check as command for executables, file for JAR)
for cmd in "$KICAD_PYTHON" "$JAVA" "$KICAD_CLI"; do
  if ! command -v "$cmd" &>/dev/null && [ ! -f "$cmd" ]; then
    echo "ERROR: Missing tool: $cmd"
    exit 1
  fi
done
if [ ! -f "$FREEROUTING_JAR" ]; then
  echo "ERROR: Missing FreeRouting JAR: $FREEROUTING_JAR"
  exit 1
fi

cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

echo "=== Autorouting $INPUT_PCB ==="

# Step 1: Export DSN and save patched board (with fixed refs) for SES import later
echo "Step 1: Exporting DSN..."
DYLD_FRAMEWORK_PATH="$KICAD_FWPATH" PYTHONPATH="$KICAD_PYPATH" "$KICAD_PYTHON" 2>/dev/null << PYEOF
import pcbnew, os, sys

board = pcbnew.LoadBoard("$(cd "$(dirname "$INPUT_PCB")" && pwd)/$(basename "$INPUT_PCB")")
print(f"  Loaded: {len(board.GetFootprints())} footprints, {board.GetNetCount()} nets")

# Fix unassigned reference designators (atopile leaves some as REF**)
existing_refs = set()
unassigned = []
for fp in board.GetFootprints():
    ref = fp.GetReference()
    if ref == 'REF**' or ref.startswith('REF*'):
        unassigned.append(fp)
    else:
        existing_refs.add(ref)

if unassigned:
    print(f"  Fixing {len(unassigned)} unassigned reference designators...")
    for i, fp in enumerate(unassigned):
        new_ref = f"X{i+1}"
        while new_ref in existing_refs:
            new_ref = f"X{i+1000}"
            i += 1000
        fp.SetReference(new_ref)
        existing_refs.add(new_ref)

# Set design rules (atopile doesn't set these)
ds = board.GetDesignSettings()
ds.m_TrackMinWidth = pcbnew.FromMM(0.2)
ds.m_MinClearance = pcbnew.FromMM(0.2)
ds.m_ViasMinSize = pcbnew.FromMM(0.5)
ds.m_ViasMinDrill = pcbnew.FromMM(0.2)

# Save patched board (with fixed refs + design rules) for SES import later
patched_path = "$WORK_DIR/board_patched.kicad_pcb"
pcbnew.SaveBoard(patched_path, board)
print(f"  Patched board saved: {os.path.getsize(patched_path)} bytes")

dsn_path = "$WORK_DIR/board.dsn"
ok = pcbnew.ExportSpecctraDSN(board, dsn_path)
if not ok:
    print("  ERROR: DSN export failed!")
    sys.exit(1)

print(f"  DSN exported: {os.path.getsize(dsn_path)} bytes")
PYEOF

if [ ! -f "$WORK_DIR/board.dsn" ]; then
  echo "ERROR: DSN file was not created"
  exit 1
fi

# Step 2: Run Freerouting headless (native ARM Java)
echo "Step 2: Running Freerouting (headless, native ARM)..."
"$JAVA" -Duser.language=en -jar "$FREEROUTING_JAR" \
  -de "$WORK_DIR/board.dsn" \
  -do "$WORK_DIR/board.ses" \
  -dr "$WORK_DIR/board.rules" \
  -mp 20 \
  2>&1 | tail -30

if [ ! -f "$WORK_DIR/board.ses" ]; then
  echo "ERROR: Freerouting did not produce a .ses file"
  exit 1
fi
echo "  SES produced: $(wc -c < "$WORK_DIR/board.ses") bytes"

# Step 3: Import routed SES back into KiCad PCB
# Must use the patched board (with fixed refs matching the DSN/SES)
echo "Step 3: Importing routed SES..."

DYLD_FRAMEWORK_PATH="$KICAD_FWPATH" PYTHONPATH="$KICAD_PYPATH" "$KICAD_PYTHON" 2>/dev/null << PYEOF
import pcbnew, sys

board = pcbnew.LoadBoard("$WORK_DIR/board_patched.kicad_pcb")
ok = pcbnew.ImportSpecctraSES(board, "$WORK_DIR/board.ses")
if not ok:
    print("  ERROR: SES import failed!")
    sys.exit(1)

pcbnew.SaveBoard("$OUTPUT_PCB", board)
print(f"  Routed PCB saved: $OUTPUT_PCB")
print(f"  Tracks: {len(board.GetTracks())}")
PYEOF

echo "=== Autorouting complete: $OUTPUT_PCB ==="

# Step 4: Export gerbers from routed board
echo "Step 4: Exporting gerbers..."
GERBER_DIR="$(dirname "$OUTPUT_PCB")/gerbers"
mkdir -p "$GERBER_DIR"
"$KICAD_CLI" pcb export gerbers \
  "$OUTPUT_PCB" -o "$GERBER_DIR/" 2>&1 || echo "  Gerber export failed (non-critical)"

"$KICAD_CLI" pcb export drill \
  "$OUTPUT_PCB" -o "$GERBER_DIR/" 2>&1 || echo "  Drill export failed (non-critical)"

echo "  Gerbers in: $GERBER_DIR"

# Step 5: Run DRC
echo "Step 5: Running DRC..."
"$KICAD_CLI" pcb drc \
  "$OUTPUT_PCB" -o "$WORK_DIR/drc-report.json" --format json 2>&1 || true

if [ -f "$WORK_DIR/drc-report.json" ]; then
  python3 -c "
import json
with open('$WORK_DIR/drc-report.json') as f:
    r = json.load(f)
v = len(r.get('violations', []))
u = len(r.get('unconnected', []))
print(f'  DRC: {v} violations, {u} unconnected')
" 2>&1 || true
fi

echo "=== Done ==="
