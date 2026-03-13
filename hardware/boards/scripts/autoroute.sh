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

# Cache directory for DSN/SES files (speeds up subsequent runs)
CACHE_DIR="${SCRIPT_DIR}/../build/route-cache"
mkdir -p "$CACHE_DIR"

# Tool paths (env vars with macOS defaults)
KICAD_PYTHON="${KICAD_PYTHON:-/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/3.9/bin/python3}"
KICAD_PYPATH="${KICAD_PYPATH:-/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/3.9/lib/python3.9/site-packages}"
KICAD_FWPATH="${KICAD_FWPATH:-/Applications/KiCad/KiCad.app/Contents/Frameworks}"
KICAD_CLI="${KICAD_CLI:-/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli}"
JAVA="${JAVA:-/opt/homebrew/opt/openjdk/bin/java}"

# Auto-select FreeRouting JAR: v1.9.0 for GUI mode (working optimizer),
# v2.0.1 for headless (only version with --gui.enabled=false, but optimizer broken)
FREEROUTING_HEADLESS="${FREEROUTING_HEADLESS:-true}"
if [ -z "${FREEROUTING_JAR:-}" ]; then
  if [ "$FREEROUTING_HEADLESS" = "false" ] && [ -f "$SCRIPT_DIR/../tools/freerouting-1.9.0.jar" ]; then
    FREEROUTING_JAR="$SCRIPT_DIR/../tools/freerouting-1.9.0.jar"
  else
    FREEROUTING_JAR="$SCRIPT_DIR/../tools/freerouting.jar"
  fi
fi

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

# Apply design rules from shared config (JLCPCB + eurorack best practices).
# These affect BOTH routing (via DSN netclass export) and DRC validation.
# Edit hardware/boards/design-rules.json to change netclasses, clearances, etc.
import sys
sys.path.insert(0, "$SCRIPT_DIR")
from design_rules import apply_rules
apply_rules(board, pcbnew)

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

# Check DSN cache — if DSN hasn't changed, reuse cached SES
DSN_HASH="$(shasum -a 256 "$WORK_DIR/board.dsn" | cut -d' ' -f1)"
CACHED_SES="$CACHE_DIR/$DSN_HASH.ses"
if [ -f "$CACHED_SES" ]; then
  echo "  Cache HIT: reusing SES from previous run (hash: ${DSN_HASH:0:12}...)"
  cp "$CACHED_SES" "$WORK_DIR/board.ses"
else
  echo "  Cache MISS: will run FreeRouting (hash: ${DSN_HASH:0:12}...)"
fi

# Step 2: Run Freerouting (skip if cached SES exists)
#
# Two modes controlled by FREEROUTING_HEADLESS (default: true):
#
# Headless (CI): Uses v2.0.1 with --gui.enabled=false.
#   Optimizer is disabled in headless mode — only --router.max_passes
#   affects quality. -mp short flag is ignored (freerouting#376).
#   v2.1.0: DO NOT UPGRADE — routing regressions (#461, #513).
#
# GUI (local macOS): Uses v1.9.0 for best routing quality.
#   Optimizer fully functional: -mt for threads, -oit for improvement
#   threshold. Pops a GUI window but routes automatically.
#   JAR auto-selected based on mode (see FREEROUTING_JAR logic above).
#
FREEROUTING_MP="${FREEROUTING_MP:-20}"
FREEROUTING_MT="${FREEROUTING_MT:-1}"
FREEROUTING_OIT="${FREEROUTING_OIT:-1}"
FREEROUTING_TIMEOUT="${FREEROUTING_TIMEOUT:-3600}"
# FREEROUTING_HEADLESS already set above (needed for JAR selection)
FREEROUTING_JAVA_OPTS="${FREEROUTING_JAVA_OPTS:--Xmx512m}"

if [ ! -f "$WORK_DIR/board.ses" ]; then
  # Override stale freerouting.json in $TMPDIR to ensure our CLI settings take effect.
  # v1.9.0 reads/writes settings from $TMPDIR/freerouting.json and a previous GUI
  # session may have saved bad values (e.g. max_passes=1).
  cat > "${TMPDIR:-/tmp}/freerouting.json" << FRJSON
{
  "max_passes": $FREEROUTING_MP,
  "num_threads": $FREEROUTING_MT,
  "board_update_strategy": "GREEDY",
  "item_selection_strategy": "PRIORITIZED",
  "optimization_improvement_threshold": $(echo "$FREEROUTING_OIT" | awk '{printf "%.1f", $1}'),
  "disable_analytics": true,
  "dialog_confirmation_timeout": 0
}
FRJSON
  echo "  Wrote freerouting.json: max_passes=$FREEROUTING_MP, oit=$FREEROUTING_OIT, threads=$FREEROUTING_MT"

  # Verify FreeRouting will read our file (not some other location)
  FR_SETTINGS="${TMPDIR:-/tmp}/freerouting.json"
  FR_MP_CHECK=$(python3 -c "import json; print(json.load(open('$FR_SETTINGS'))['max_passes'])")
  if [ "$FR_MP_CHECK" != "$FREEROUTING_MP" ]; then
    echo "  ERROR: freerouting.json verification failed (max_passes=$FR_MP_CHECK, expected $FREEROUTING_MP)"
    exit 1
  fi

  if [ "$FREEROUTING_HEADLESS" = "false" ]; then
    echo "Step 2: Running Freerouting GUI (max_passes=$FREEROUTING_MP, threads=$FREEROUTING_MT, oit=$FREEROUTING_OIT, timeout=${FREEROUTING_TIMEOUT}s, java=$FREEROUTING_JAVA_OPTS)..."
    timeout -s INT --kill-after=30 "$FREEROUTING_TIMEOUT" \
      "$JAVA" $FREEROUTING_JAVA_OPTS -Duser.language=en -jar "$FREEROUTING_JAR" \
      -de "$WORK_DIR/board.dsn" \
      -do "$WORK_DIR/board.ses" \
      -dr "$WORK_DIR/board.rules" \
      -mp "$FREEROUTING_MP" \
      -mt "$FREEROUTING_MT" \
      -oit "$FREEROUTING_OIT" \
      -dct 0 \
      2>&1 || {
        EXIT_CODE=$?
        if [ "$EXIT_CODE" -eq 124 ]; then
          echo "WARNING: Freerouting timed out after ${FREEROUTING_TIMEOUT}s — using partial result if available"
        else
          echo "WARNING: Freerouting exited with code $EXIT_CODE"
        fi
      }
  else
    echo "Step 2: Running Freerouting headless (max_passes=$FREEROUTING_MP, timeout=${FREEROUTING_TIMEOUT}s, java=$FREEROUTING_JAVA_OPTS)..."
    timeout -s INT --kill-after=30 "$FREEROUTING_TIMEOUT" \
      "$JAVA" $FREEROUTING_JAVA_OPTS -Duser.language=en -jar "$FREEROUTING_JAR" \
      --gui.enabled=false \
      -de "$WORK_DIR/board.dsn" \
      -do "$WORK_DIR/board.ses" \
      -dr "$WORK_DIR/board.rules" \
      --router.max_passes="$FREEROUTING_MP" \
      -dct 0 \
      2>&1 || {
        EXIT_CODE=$?
        if [ "$EXIT_CODE" -eq 124 ]; then
          echo "WARNING: Freerouting timed out after ${FREEROUTING_TIMEOUT}s — using partial result if available"
        else
          echo "WARNING: Freerouting exited with code $EXIT_CODE"
        fi
      }
  fi

  # Check what FreeRouting saved back — detect if it overwrote our settings
  FR_MP_AFTER=$(python3 -c "import json; print(json.load(open('$FR_SETTINGS'))['max_passes'])" 2>/dev/null || echo "?")
  if [ "$FR_MP_AFTER" != "$FREEROUTING_MP" ]; then
    echo "  WARNING: FreeRouting rewrote freerouting.json on exit (max_passes=$FR_MP_AFTER)"
  fi
else
  echo "Step 2: Skipped (using cached SES)"
fi

if [ ! -f "$WORK_DIR/board.ses" ]; then
  echo "ERROR: Freerouting did not produce a .ses file"
  exit 1
fi

SES_SIZE=$(wc -c < "$WORK_DIR/board.ses")
echo "  SES produced: $SES_SIZE bytes"

if [ "$SES_SIZE" -lt 50000 ]; then
  echo "ERROR: SES file too small ($SES_SIZE bytes) — Freerouting likely failed or exited early"
  echo "  Expected ~100KB+ for a routed board. Check Freerouting output above for errors."
  exit 1
fi

# Cache the SES for future runs
cp "$WORK_DIR/board.ses" "$CACHED_SES"
echo "  SES cached: ${DSN_HASH:0:12}..."

# Step 3: Import routed SES back into KiCad PCB
# Uses custom import_ses.py instead of pcbnew.ImportSpecctraSES(),
# which requires an active KiCad GUI window (KiCad GitLab #14339).
echo "Step 3: Importing routed SES..."

# import_ses.py may return non-zero due to KiCad's stdpbase.cpp assert (#14339)
# — check output file exists instead of relying on exit code.
DYLD_FRAMEWORK_PATH="$KICAD_FWPATH" PYTHONPATH="$KICAD_PYPATH" "$KICAD_PYTHON" \
  "$SCRIPT_DIR/import_ses.py" "$WORK_DIR/board_patched.kicad_pcb" "$WORK_DIR/board.ses" "$OUTPUT_PCB" 2>/dev/null || true

if [ ! -f "$OUTPUT_PCB" ]; then
  echo "ERROR: SES import failed — output PCB not created"
  exit 1
fi

# Step 4: Check for unrouted nets (fast check: DSN vs SES net names)
# This catches nets FreeRouting couldn't route at all.
echo "Step 4: Checking for unrouted nets..."
ROUTE_CHECK=0
UNROUTED=$(python3 << PYEOF
import re, sys
dsn = open('$WORK_DIR/board.dsn').read()
ses = open('$WORK_DIR/board.ses').read()
# Match both quoted and unquoted net names in DSN: (net "name" (pins or (net name (pins
dsn_all = re.findall(r'\(net\s+(?:"([^"]+)"|(\S+))\s*\(pins\s+([^)]+)\)', dsn)
dsn_nets = {}
for q, u, pins in dsn_all:
    name = q or u
    pin_count = len(pins.strip().split())
    dsn_nets[name] = pin_count
# Only check routable nets (2+ pads)
routable = {n for n, p in dsn_nets.items() if p >= 2}
# Match both quoted and unquoted net names in SES
ses_nets = set()
for q, u in re.findall(r'\(net\s+(?:"([^"]+)"|(\S+))', ses):
    ses_nets.add(q or u)
ses_nets.discard('')
unrouted = sorted(routable - ses_nets)
print(f'{len(routable)} routable DSN nets, {len(ses_nets)} SES nets')
if unrouted:
    print(f'{len(unrouted)} unrouted:')
    for n in unrouted:
        print(f'  - {n} ({dsn_nets[n]} pads)')
    sys.exit(1)
print('All nets routed')
PYEOF
) || ROUTE_CHECK=$?

echo "  $UNROUTED"
if [ "$ROUTE_CHECK" -ne 0 ]; then
  echo "  WARNING: Routing is incomplete — DRC (Step 6) will report these as unconnected."
fi

# Step 5: Cleanup dangling tracks/vias from FreeRouting optimizer artifacts
# FreeRouting's optimizer can leave orphan trace segments (both ends floating).
# Remove these before DRC to reduce noise in the DRC report.
echo "Step 5: Cleaning up dangling tracks and vias..."
CLEANUP_RESULT=$(DYLD_FRAMEWORK_PATH="$KICAD_FWPATH" PYTHONPATH="$KICAD_PYPATH" "$KICAD_PYTHON" << PYEOF 2>/dev/null
import pcbnew

board = pcbnew.LoadBoard("$OUTPUT_PCB")
conn = board.GetConnectivity()

tracks = list(board.GetTracks())
to_remove = []
for t in tracks:
    is_via = t.GetClass() == "PCB_VIA"
    if is_via:
        if conn.TestTrackEndpointDangling(t, True):
            to_remove.append(t)
    else:
        if conn.TestTrackEndpointDangling(t, True) and conn.TestTrackEndpointDangling(t, False):
            to_remove.append(t)

if to_remove:
    for t in to_remove:
        board.Remove(t)
    pcbnew.SaveBoard("$OUTPUT_PCB", board)

print(f"Removed {len(to_remove)} orphaned items ({len(tracks)} -> {len(tracks) - len(to_remove)} tracks+vias)")
PYEOF
)
echo "  $CLEANUP_RESULT"

# Step 6: Run DRC — strict mode, fail on ANY error or unconnected item
# This is the hardware equivalent of a test suite: the board must pass clean.
echo "Step 6: Running design rule check..."
DRC_REPORT="$WORK_DIR/drc-report.json"
"$KICAD_CLI" pcb drc \
  --output "$DRC_REPORT" \
  --format json \
  --severity-all \
  "$OUTPUT_PCB" 2>/dev/null || true

if [ -f "$DRC_REPORT" ]; then
  # Copy report next to output for inspection (always, even if passing)
  DRC_DEST="$(dirname "$OUTPUT_PCB")/$(basename "$OUTPUT_PCB" .kicad_pcb)-drc.json"
  cp "$DRC_REPORT" "$DRC_DEST"

  # Parse DRC results — strict: fail on errors OR unconnected items
  DRC_EXIT=0
  DRC_SUMMARY=$(python3 << PYEOF
import json, sys
with open('$DRC_REPORT') as f:
    report = json.load(f)
violations = report.get('violations', [])
unconnected = report.get('unconnected_items', [])
errors = [v for v in violations if v.get('severity', '') == 'error']
warnings = [v for v in violations if v.get('severity', '') == 'warning']

print(f'{len(errors)} errors, {len(warnings)} warnings, {len(unconnected)} unconnected')

if errors:
    seen = {}
    for v in errors:
        desc = v.get('description', v.get('type', 'unknown'))
        seen[desc] = seen.get(desc, 0) + 1
    for desc, count in sorted(seen.items(), key=lambda x: -x[1]):
        print(f'  - {desc} (x{count})')

if unconnected:
    nets = {}
    for item in unconnected:
        for pad in item.get('items', []):
            d = pad.get('description', '')
            if '[' in d and ']' in d:
                net = d.split('[')[1].split(']')[0]
                nets[net] = nets.get(net, 0) + 1
                break
    top_nets = sorted(nets.items(), key=lambda x: -x[1])[:10]
    print(f'Unconnected nets (top {min(10, len(top_nets))}):')
    for net, count in top_nets:
        print(f'  - {net} ({count} items)')
    if len(nets) > 10:
        print(f'  ... and {len(nets) - 10} more nets')

# STRICT: fail on any errors or any unconnected items
if errors or unconnected:
    sys.exit(1)
PYEOF
  ) || DRC_EXIT=$?
  echo "  $DRC_SUMMARY"
  if [ "$DRC_EXIT" -ne 0 ]; then
    echo "  FAIL: DRC check failed. Review: $DRC_DEST"
    exit 1
  fi
  echo "  PASS: DRC clean"
else
  echo "  ERROR: DRC report not generated — cannot verify board"
  exit 1
fi

echo "=== Autorouting complete: $OUTPUT_PCB ==="
