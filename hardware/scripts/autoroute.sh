#!/usr/bin/env bash
# Autoroute a KiCad PCB using Freerouting (headless).
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

# Step 2: Run Freerouting headless
# --router.max_passes: max routing passes (long-form — -mp is ignored in headless mode, see
#   https://github.com/freerouting/freerouting/issues/376)
# -mt: thread count (2 for CI runners, match core count locally)
# -dct 0: auto-dismiss any dialogs immediately
# timeout: hard kill to prevent infinite loops
FREEROUTING_MP="${FREEROUTING_MP:-20}"
FREEROUTING_MT="${FREEROUTING_MT:-2}"
FREEROUTING_TIMEOUT="${FREEROUTING_TIMEOUT:-3600}"
echo "Step 2: Running Freerouting (headless, mp=$FREEROUTING_MP, mt=$FREEROUTING_MT, timeout=${FREEROUTING_TIMEOUT}s)..."
timeout "$FREEROUTING_TIMEOUT" \
  "$JAVA" -Duser.language=en -jar "$FREEROUTING_JAR" \
  --gui.enabled=false \
  -de "$WORK_DIR/board.dsn" \
  -do "$WORK_DIR/board.ses" \
  -dr "$WORK_DIR/board.rules" \
  --router.max_passes="$FREEROUTING_MP" \
  -mt "$FREEROUTING_MT" \
  -dct 0 \
  2>&1 || {
    EXIT_CODE=$?
    if [ "$EXIT_CODE" -eq 124 ]; then
      echo "WARNING: Freerouting timed out after ${FREEROUTING_TIMEOUT}s"
    else
      echo "WARNING: Freerouting exited with code $EXIT_CODE"
    fi
  }

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
