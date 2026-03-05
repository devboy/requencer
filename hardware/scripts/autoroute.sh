#!/usr/bin/env bash
# Autoroute a KiCad PCB using Freerouting (headless).
#
# Usage: ./autoroute.sh <input.kicad_pcb> [output.kicad_pcb]
#
# Workflow:
#   1. Export DSN from KiCad PCB
#   2. Run Freerouting headless (Docker)
#   3. Import routed SES back into KiCad PCB
#
# Requires: kicad-cli, Docker

set -euo pipefail

INPUT_PCB="${1:?Usage: $0 <input.kicad_pcb> [output.kicad_pcb]}"
OUTPUT_PCB="${2:-$INPUT_PCB}"
WORK_DIR="$(mktemp -d)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

echo "=== Autorouting $INPUT_PCB ==="

# Step 1: Export DSN (Specctra Design) from KiCad
echo "Exporting DSN..."
cp "$INPUT_PCB" "$WORK_DIR/board.kicad_pcb"
kicad-cli pcb export dsn "$WORK_DIR/board.kicad_pcb" -o "$WORK_DIR/board.dsn"

# Step 2: Run Freerouting headless
echo "Running Freerouting (headless)..."
docker run --rm \
  -v "$WORK_DIR:/work" \
  ghcr.io/freerouting/freerouting \
  -de /work/board.dsn \
  -do /work/board.ses \
  -dr /work/board.rules \
  -mp 20 \
  2>&1 | tail -20

if [ ! -f "$WORK_DIR/board.ses" ]; then
  echo "ERROR: Freerouting did not produce a .ses file"
  exit 1
fi

# Step 3: Import routed SES back into KiCad
echo "Importing routed traces..."
cp "$INPUT_PCB" "$OUTPUT_PCB"
kicad-cli pcb import ses "$OUTPUT_PCB" "$WORK_DIR/board.ses"

echo "=== Autorouting complete: $OUTPUT_PCB ==="

# Step 4: Run DRC
echo "Running DRC..."
kicad-cli pcb drc "$OUTPUT_PCB" -o "$WORK_DIR/drc-report.json" --format json 2>&1 || true

if [ -f "$WORK_DIR/drc-report.json" ]; then
  violations=$(python3 -c "
import json, sys
with open('$WORK_DIR/drc-report.json') as f:
    r = json.load(f)
v = len(r.get('violations', []))
u = len(r.get('unconnected', []))
print(f'{v} violations, {u} unconnected')
if v > 0 or u > 0:
    sys.exit(1)
" 2>&1) || true
  echo "DRC: $violations"
fi
