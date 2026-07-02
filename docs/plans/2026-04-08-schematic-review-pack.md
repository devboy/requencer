# Schematic Review Pack Implementation Plan

**Goal:** Generate **local, shareable PDF files** (one per board) with human-readable schematic diagrams from the committed `.kicad_pcb` files, so a reviewer who cannot read `.ato` code can validate the design. Final deliverable = PDF the user can email/share.

**Architecture:** Two-stage Python pipeline under `hardware/boards/scripts/review/`:
1. **Extractor** (uses KiCad's `pcbnew`): reads a `.kicad_pcb`, groups footprints by the `atopile_address` field (first segment = subcircuit), captures pads→nets, emits JSON.
2. **Renderer** (pure Python, no pcbnew): consumes JSON, draws schematic-style SVGs using a handwritten symbol library, grid layout per subcircuit, force-directed layout for board overview. SVG→PDF via `rsvg-convert`, per-subcircuit PDFs merged into one PDF per board via `pypdf`.

**Final output:** `hardware/boards/build/review/control.pdf`, `main.pdf`, `faceplate.pdf` — each is a single self-contained PDF with a cover page (overview) + one page per subcircuit. No Makefile target, no git changes. Invoked by hand: `KICAD_PYTHON hardware/boards/scripts/review/gen_review_pack.py --out build/review`.

**Tech Stack:** Python 3 (venv + KiCad's Python 3.9), pcbnew 10.0.0, rsvg-convert (Homebrew), no npm/Node, no Graphviz.

**Style choice (2c-hybrid):** proper schematic symbols for passives and actives, IC/connector as labeled rectangles, **no wires drawn between components** — instead every pin gets a short stub with a net-label. This is a legitimate "flat net-label schematic" style used in dense professional schematics; it sidesteps the auto-routing problem entirely while still looking schematic-like.

---

## File Structure

```
hardware/boards/scripts/review/
  __init__.py
  extract.py                 # pcbnew-based PCB extractor → JSON
  symbols.py                 # component symbol SVG library
  layout.py                  # grid + force-directed placement helpers
  render_subcircuit.py       # one subcircuit → one SVG
  render_overview.py         # board overview → one SVG
  render_index.py            # index.html + board landing pages
  gen_review_pack.py         # main entry point (orchestrates all boards)
  tests/
    __init__.py
    conftest.py
    test_extract.py          # runs against committed main-placed.kicad_pcb
    test_symbols.py          # pure-Python symbol tests
    test_layout.py           # grid/force-directed layout tests
    test_render_subcircuit.py
    fixtures/                # tiny synthetic JSON fixtures
```

Output directory (gitignored via existing `build/*` rule):
```
hardware/boards/build/review/
  index.html                 # top-level landing: pick a board
  control/
    index.html
    00_overview.svg + .pdf
    01_<subcircuit>.svg + .pdf
    ...
  main/
    (same)
  faceplate/
    (same)
```

Makefile target `make review-pack` with dependency on committed `*-placed.kicad_pcb` + faceplate, invokes gen_review_pack.py via KICAD_PYTHON.

---

## Stage 0: Setup

### Task 0.1: Create directory and empty module

- [ ] Create `hardware/boards/scripts/review/__init__.py` (empty)
- [ ] Create `hardware/boards/scripts/review/tests/__init__.py` (empty)
- [ ] Create `hardware/boards/scripts/review/tests/conftest.py` with sys.path fixup so `from review import …` works:

```python
import sys
from pathlib import Path

# Make the review package importable under tests.
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
```

---

## Stage 1: Extractor (TDD)

### Task 1.1: Define the JSON schema as a dataclass module

**Files:** Create `hardware/boards/scripts/review/extract.py`

The schema we emit per board:
```python
{
  "board": "main",
  "source": "path/to/main-placed.kicad_pcb",
  "bbox_mm": {"x": 0, "y": 0, "w": 100, "h": 100},
  "subcircuits": {
    "dac": {
      "name": "dac",
      "components": [
        {
          "ref": "U1",
          "value": "DAC80508ZRTER",
          "footprint": "package:QFN-40",
          "atopile_address": "dac.dac1",
          "pads": [
            {"number": "1", "name": "VREF", "net": "c_ref1_hf-power-hv"},
            ...
          ]
        },
        ...
      ]
    },
    ...
  },
  "nets_per_subcircuit": {
    "dac": ["net_a", "net_b", ...]   # all unique nets touched by this subcircuit
  },
  "cross_subcircuit_nets": [
    {"net": "SCLK", "subcircuits": ["dac", "mcu", "swd_header"]},
    ...
  ]
}
```

- [ ] Write the extractor skeleton that:
  - Takes `board_name`, `pcb_path`, optional `out_path`
  - Imports pcbnew (fail loudly if not available)
  - Loads board, iterates footprints, extracts ref / value / fpid / atopile_address / pads with nets
  - Groups by first segment of `atopile_address` (components without the field land in `__unsorted__`)
  - Computes `nets_per_subcircuit` and `cross_subcircuit_nets` (nets appearing in ≥2 subcircuits)
  - Returns the dict; if `out_path` is given, also writes JSON to disk

- [ ] Add a `__main__` guard so it can be invoked: `KICAD_PYTHON extract.py <board> <pcb_path> <out_json>`

### Task 1.2: Integration test against committed main-placed.kicad_pcb

**Files:** Create `hardware/boards/scripts/review/tests/test_extract.py`

- [ ] Test that extracting `main-placed.kicad_pcb` produces expected top-level keys
- [ ] Test that `dac` subcircuit is present and has ≥30 components (we counted 79)
- [ ] Test that every component has a non-empty `ref` and `atopile_address`
- [ ] Test that `cross_subcircuit_nets` contains at least one net appearing in both `dac` and `mcu` (SPI nets: SCLK, DIN, SDO)
- [ ] Run test under KICAD_PYTHON, verify all pass

```python
def test_extract_main_board(pcb_main):
    data = extract_board("main", pcb_main)
    assert data["board"] == "main"
    assert "dac" in data["subcircuits"]
    assert len(data["subcircuits"]["dac"]["components"]) >= 30
    for sub in data["subcircuits"].values():
        for c in sub["components"]:
            assert c["ref"]
            assert c["atopile_address"]
    cross_nets = {n["net"] for n in data["cross_subcircuit_nets"]}
    # SPI nets cross dac ↔ mcu
    assert any(n in cross_nets for n in ["SCLK", "DIN", "SDO"])
```

The `pcb_main` fixture reads `/Users/devboy/dev/devboy/requencer/hardware/boards/build/main-placed.kicad_pcb`.

---

## Stage 2: Symbol Library (TDD)

### Task 2.1: Define the Symbol interface

**Files:** Create `hardware/boards/scripts/review/symbols.py`

Each symbol is a class with:
- `width` and `height` in SVG user units (1 unit ≈ 1 mm on final SVG)
- `pins` — dict of `{pin_name: (x, y, side)}` where side ∈ `{"l", "r", "t", "b"}`
- `render(cx, cy, refdes, value) -> str` that returns an SVG `<g>` group positioned at (cx, cy)

Symbol types to implement (in priority order):
1. **IC** — rectangle, pins on sides, auto-sized by pin count. Handles DAC, MCU, op-amp, regulator, shift-reg, etc.
2. **Connector** — rectangle with pin labels on one side. Handles headers, USB-C, SD, FPC.
3. **R** — resistor zigzag (classic IEC rectangle style is simpler and also valid — use rectangle with "R" marker inside). 2 pins.
4. **C** — two parallel plates. 2 pins.
5. **C_polar** — C with curved plate + polarity marker. 2 pins.
6. **L** — arc loops. 2 pins. (fallback to rectangle with "L" marker is fine)
7. **D** — triangle + cathode line. 2 pins.
8. **LED** — D with arrow marks. 2 pins.
9. **Q_NPN** / **Q_PNP** — BJT circle with B/C/E. 3 pins.
10. **Q_NMOS** / **Q_PMOS** — MOSFET. 3 pins.
11. **Crystal (Y)** — rectangle with wave marker. 2 pins.
12. **Fuse (F)** — rectangle with wavy line. 2 pins.
13. **Test point (TP)** — circle. 1 pin.
14. **Generic** — fallback rectangle with `?` marker, any number of pins.

A `symbol_for(component)` function picks the right symbol class from:
- `component["ref"][0]` (R, C, L, D, Q, U, J, Y, F, TP, etc.) — primary signal
- `component["value"]` for disambiguation (e.g. `Q_NPN` vs `Q_PMOS`, `C` vs `C_polar` by uF value or footprint)
- `component["footprint"]` as secondary disambiguation

### Task 2.2: Test symbol_for classification

**Files:** Create `hardware/boards/scripts/review/tests/test_symbols.py`

- [ ] Test R → R symbol
- [ ] Test C → C symbol
- [ ] Test U → IC symbol
- [ ] Test Q with `NPN` in value → Q_NPN
- [ ] Test unknown prefix → Generic
- [ ] Test that every Symbol class has `width > 0`, `height > 0`, at least one pin

### Task 2.3: Implement render() for each symbol

- [ ] IC: rectangle sized by max(pin_count_left, pin_count_right) × pin_spacing, pin labels inside, refdes/value above
- [ ] R: `<rect>` 4×10 units, "R" letter inside, two pin stubs top/bottom, refdes/value right
- [ ] C: two parallel horizontal lines, two pin stubs top/bottom, refdes/value right
- [ ] C_polar: as C but one curved plate, "+" near positive pin
- [ ] D: triangle path, cathode bar, refdes/value right
- [ ] LED: D + two outward arrows
- [ ] Q_NPN/Q_PNP: circle + base line + two emitter/collector lines; arrow on emitter (in/out)
- [ ] Q_NMOS/Q_PMOS: circle + gate insulator + 3 channel segments
- [ ] Connector: rectangle, pins on right side only, labels inside
- [ ] Y/F/TP/L/Generic: simpler — just rectangle with marker character

- [ ] Snapshot test: each symbol's SVG output matches a recorded snapshot (tiny string compare)

---

## Stage 3: Layout Helpers (TDD)

### Task 3.1: Grid placement

**Files:** Create `hardware/boards/scripts/review/layout.py`

- [ ] `grid_place(items, max_cols, col_gap, row_gap)` → list of `(item, cx, cy)` tuples. Width of each cell = max item width in that column. Items are sorted by symbol type priority (ICs first, then connectors, then passives grouped by value) to keep related components adjacent.
- [ ] Test grid returns correct positions for 6 items, 3 cols
- [ ] Test grid handles rows with varying heights

### Task 3.2: Force-directed layout for board overview

- [ ] `force_layout(nodes, edges, iterations=200)` — simple Fruchterman-Reingold implementation. Each node has `width`, `height`. Edges pull nodes together, all nodes repel. Returns positions.
- [ ] Test convergence: 4 nodes in a square topology → positions don't collide
- [ ] Test determinism: same input with same seed → same output

---

## Stage 4: Subcircuit Renderer

### Task 4.1: Render one subcircuit to SVG

**Files:** Create `hardware/boards/scripts/review/render_subcircuit.py`

- [ ] `render_subcircuit(subcircuit, out_path, title_block)` function
- [ ] For each component, pick a symbol via `symbol_for()`, grid-place them
- [ ] For each pin of each component, draw a short stub (4 units) and a net label at the end
- [ ] Title block at top: board name, subcircuit name, component count, ports list
- [ ] Color coding: power nets (5V, 3V3, GND, -5V, etc.) highlighted, signal nets plain
- [ ] Write SVG to disk

### Task 4.2: Integration test — render dac subcircuit from extracted JSON

**Files:** `hardware/boards/scripts/review/tests/test_render_subcircuit.py`

- [ ] Build a synthetic subcircuit dict with 3 components
- [ ] Render to a temp SVG file
- [ ] Assert the file exists, is non-empty, contains `<svg`, contains each refdes, contains ≥1 net label

---

## Stage 5: Overview Renderer

### Task 5.1: Render the board overview SVG

**Files:** Create `hardware/boards/scripts/review/render_overview.py`

- [ ] Each subcircuit becomes a node with size = `f(component_count)`
- [ ] Inter-block nets become edges (labeled with net name)
- [ ] Run `force_layout` to position nodes
- [ ] Power nets routed to a distinct "power bus" at the bottom (skip force layout for them)
- [ ] Title block: board name, total component count, subcircuit count, cross-net count
- [ ] Click handlers (`<a xlink:href="01_dac.svg">`) so SVG links into the detail pages when opened in a browser

---

## Stage 6: Index + PDF export

### Task 6.1: index.html per board

**Files:** Create `hardware/boards/scripts/review/render_index.py`

- [ ] Per-board `index.html` with:
  - Board name + summary (component count, subcircuit count)
  - Inline overview SVG at top
  - List of subcircuit links with component counts
- [ ] Top-level `review/index.html` with links to each board

### Task 6.2: SVG → PDF conversion

- [ ] Helper that shells out to `rsvg-convert -f pdf -o out.pdf in.svg`
- [ ] Skip PDF for overview pages (they'll be too big — PDF is per subcircuit only)
- [ ] Bundle all subcircuit PDFs into a single `review.pdf` per board using a simple page concat: since `rsvg-convert` emits one page per file, concatenate via `pdfunite` OR simply keep separate PDFs and link them from the index

Check for pdfunite availability; if not installed, skip the merged PDF and just emit per-subcircuit PDFs.

---

## Stage 7: Orchestrator

### Task 7.1: gen_review_pack.py

**Files:** Create `hardware/boards/scripts/review/gen_review_pack.py`

- [ ] Reads `hardware/boards/build/control-placed.kicad_pcb`, `main-placed.kicad_pcb`, `hardware/faceplate/elec/layout/faceplate.kicad_pcb`
- [ ] For each board: extract → render overview + each subcircuit → generate index.html + PDFs
- [ ] Writes to `hardware/boards/build/review/`
- [ ] `if __name__ == "__main__"` with arg handling: `gen_review_pack.py [--board control|main|faceplate|all] [--out DIR]`

### Task 7.2: Smoke test running the full pipeline

- [ ] Run `gen_review_pack.py --board main` end-to-end
- [ ] Verify `build/review/main/00_overview.svg` exists
- [ ] Verify `build/review/main/index.html` exists
- [ ] Verify at least one subcircuit SVG+PDF exists
- [ ] Open the PDF and visually check it's readable (I'll render it to PNG and inspect it)

---

## Stage 8: Makefile target

### Task 8.1: Add `review-pack` target

**Files:** Modify `hardware/Makefile`

- [ ] Add variables near top:
```makefile
REVIEW_DIR     := $(BUILD)/review
REVIEW_SCRIPT  := $(SCRIPTS)/review/gen_review_pack.py
REVIEW_DEPS    := $(CONTROL_PLACED) $(MAIN_PLACED) $(FACEPLATE_PCB) $(shell find $(SCRIPTS)/review -name '*.py' 2>/dev/null)
```

- [ ] Add target:
```makefile
.PHONY: review-pack review-pack-clean
review-pack: $(REVIEW_DIR)/index.html ## Generate schematic review pack (SVG + PDF per board)

$(REVIEW_DIR)/index.html: $(REVIEW_DEPS)
	@echo "== Generating schematic review pack =="
	@$(KICAD_ENV) $(KICAD_PYTHON) $(REVIEW_SCRIPT) --out $(REVIEW_DIR)
	@echo "== Review pack ready: open $(REVIEW_DIR)/index.html =="

review-pack-clean:
	@rm -rf $(REVIEW_DIR)
```

- [ ] Add to the top-of-file help block.

---

## Stage 9: Code Review

### Task 9.1: Run superpowers:code-reviewer on the whole review/ module

- [ ] Dispatch code-reviewer agent with scope = `hardware/boards/scripts/review/` + Makefile diff
- [ ] Address any HIGH/CRITICAL findings inline
- [ ] MEDIUM findings: fix if quick, note in plan if deferred
- [ ] LOW/style findings: skip unless trivial

### Task 9.2: Verify final output

- [ ] Re-run `make review-pack` from scratch on a clean output dir
- [ ] Open `build/review/index.html` — verify nav works
- [ ] Render final overview SVG and one detail SVG to PNG, inspect visually
- [ ] Confirm PDFs exist and are non-empty

---

## Self-Review Checklist

- [x] All stages covered by tasks?
- [x] Every file path is absolute or relative from a documented root?
- [x] No "TODO later" placeholders in any task?
- [x] TDD used where it adds value (extract, symbols, layout) and skipped where it doesn't (SVG visual rendering — that gets visual verification instead)?
- [x] The symbol classification in Task 2.1 matches the component types actually present in main/control (IC, R, C, L, D, LED, Q, connectors, crystal confirmed from grep)?
- [x] Inter-subcircuit net computation handles the SPI and power rails that cross boundaries?
- [x] Makefile target fits existing conventions (uses KICAD_ENV + KICAD_PYTHON, file-based deps)?
