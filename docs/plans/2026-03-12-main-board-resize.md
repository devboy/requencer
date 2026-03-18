# Main Board Resize Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status (2026-03-18):** Partially implemented. Board height reduced to 84mm (matches plan). Board width is 140mm (plan target was 103mm). SMD placement is front-side only (`smd_side: "F"`) — dual-side not yet enabled. Fixed component positions configured in board-config.json. Strategy: `compact-grid`.

**Goal:** Shrink the main board from 177.88×107.5mm to 103×84mm with symmetric connector overhang, dual-side SMD placement, and relocated USB-C + power header.

**Architecture:** The main board plugs into the control board via 2×ShroudedHeader2x16 connectors at PCB (15, 42) and (88, 42). The new board dimensions are derived by adding equal overhang (15mm H, 42mm V) around the connector centers. MCU placed centrally between connectors. All SMDs use both board sides. USB-C edge-mounts on the right edge. Power header moves inboard. Top-left corners of control and main boards remain aligned (shared PCB origin).

**Tech Stack:** Python (pcbnew API), KiCad, Make

---

## Context

### Current state
- Main board: 177.88×107.5mm (matches control board 1:1)
- 146 components: 4 THT headers, 3+ ICs, ~139 passives
- All SMDs placed on back side only — front side empty except bridge headers
- Bridge connectors at (25, 28) and (40, 28) — 15mm span, poor mechanical stability
- USB-C edge-mounted at x=172.88 (right edge of full-width board)
- Power header at (165, 15) — far right

### New state
- Main board: **103×84mm** — 45% of original area
- Bridge connectors at **(15, 42)** and **(88, 42)** — matching control board positions (already changed)
- 73mm horizontal span + 15mm symmetric overhang → no bolt holes needed
- SMDs on **both sides** (front and back) to compensate for smaller area
- MCU (PGA2350) centered between connectors at ~(51, 42) on front
- USB-C edge-mounted at new right edge (x≈103)
- Power header moved inboard to ~(51, 75) area

### Key constraints
- Top-left corner aligns with control board (PCB origin 0,0 = same position)
- Bridge header positions MUST match control board exactly: (15, 42) and (88, 42)
- PGA2350 is THT (64-pin PGA, 27.4mm courtyard) — occupies both sides
- USB-C is SMD (attr smd) — receptacle must be edge-accessible from rack side
- Power header is THT (2×5, 11×15mm courtyard) — ribbon cable must be accessible
- EurorackPowerHeader needs access from behind — position on back side, near a board edge

### Component footprint sizes (for zone planning)
| Component | Courtyard | Type | Notes |
|-----------|-----------|------|-------|
| ShroudedHeader2x16 | 11.2 × 42.9mm | THT | Bridge connectors |
| PGA2350 | 27.4 × 27.4mm | THT | MCU module |
| EurorackPowerHeader | 11 × 15mm | THT | 2×5 IDC |
| USB_C_Receptacle | ~9 × 7mm | SMD | Edge-mount |
| DAC8568 (TSSOP-16) | ~6 × 5mm | SMD | 2 instances |
| OPA4172 (TSSOP-14) | ~6 × 5mm | SMD | Op-amp |
| Passives (0402/0603) | ~2 × 1mm | SMD | ~139 total |

### Board area budget
- New board area: 103 × 84 = **8,652mm²**
- Both sides available for SMD: **~17,300mm²** effective
- THT exclusion zones (both sides): ~2×(11×43) + 1×(27×27) + 1×(11×15) = ~1,900mm²
- Available for SMD: ~15,400mm² — plenty for ~145 SMD components

---

## Files to modify

| File | Change |
|------|--------|
| `hardware/boards/scripts/place_components.py` | Rewrite `place_main_board()` — new dimensions, THT positions, dual-side SMD zones |
| `hardware/boards/scripts/export_3d_assembly.py` | Update main board X offset (no longer aligned at right edge) |
| `hardware/boards/component-map.json` | Add `main_pcb` section with new dimensions |

No web UI changes needed — the main board is not rendered in the panel preview.

---

### Task 1: Update main board dimensions and THT placement

**Files:**
- Modify: `hardware/boards/scripts/place_components.py` — `place_main_board()` function (lines 449-675)

- [ ] **Step 1: Update board dimensions**

Change `board_w` and `board_h` from control board dimensions to the new symmetric values:

```python
# Board dimensions: sized symmetrically around bridge connectors.
# Connectors at (15, 42) and (88, 42) on control board.
# Equal overhang on all sides → 103 x 84mm.
board_w = 103.0
board_h = 84.0
margin = 3.0
```

- [ ] **Step 2: Update THT positions**

Replace the `tht_positions` dict and USB-C placement with new positions:

```python
# THT positions aligned with control board connector positions.
# Bridge headers must match control board exactly.
# MCU centered between connectors.
# Power header on back side, bottom area (accessible from behind).
tht_positions = {
    "connector.header_a": (15, 42, True),     # front, matches control board
    "connector.header_b": (88, 42, True),     # front, matches control board
    "mcu.pga":            (51, 42, True),     # front, centered between headers
    "power.header":       (51, 74, False),    # back, bottom-center (cable access from behind)
    "display.header":     (51, 14, False),    # back, top-center near MCU
}
```

USB-C edge-mount position:
```python
usb_x = board_w - 5.0   # inset from new right edge (103mm)
usb_y = board_h / 2      # vertically centered (42mm)
```

- [ ] **Step 3: Run placement and verify**

```bash
make hw-place-main
```

Expected: `Overlap check: PASS`, `Board dimensions: 103.0 x 84.0 mm`, all 146 components placed.

---

### Task 2: Implement dual-side SMD placement

**Files:**
- Modify: `hardware/boards/scripts/place_components.py` — IC and passive placement sections in `place_main_board()`

- [ ] **Step 1: Replace single-side IC/passive zones with dual-side layout**

Current code places all ICs and passives on back side only. Replace with a strategy that uses both sides, avoiding THT penetration zones.

ICs go on back side (opposite MCU), passives split across both sides:

```python
# ICs on back side — they need thermal relief and routing space.
# Place in the area not occupied by power header and display header.
ic_zone = (margin, margin, board_w - 2 * margin, board_h - 2 * margin)
for i, addr in enumerate(ics):
    col = i % ic_cols
    row = i // ic_cols
    if row % 2 == 1:
        col = ic_cols - 1 - col
    x = margin + 5 + col * ic_spacing
    y = margin + 5 + row * ic_spacing
    place_collision_free(addr, x, y, front=False, zone_bounds=ic_zone)

# Passives: split roughly 50/50 between front and back.
# Front-side passives go around the MCU (which is also front-side THT).
# Back-side passives go around ICs and power header.
half = len(passives) // 2
front_passives = passives[:half]
back_passives = passives[half:]

passive_zone = (margin, margin, board_w - 2 * margin, board_h - 2 * margin)
for i, addr in enumerate(front_passives):
    col = i % p_cols
    row = i // p_cols
    if row % 2 == 1:
        col = p_cols - 1 - col
    x = margin + 2 + col * passive_spacing
    y = margin + 2 + row * passive_spacing
    place_collision_free(addr, x, y, front=True, zone_bounds=passive_zone)

for i, addr in enumerate(back_passives):
    col = i % p_cols
    row = i // p_cols
    if row % 2 == 1:
        col = p_cols - 1 - col
    x = margin + 2 + col * passive_spacing
    y = margin + 2 + row * passive_spacing
    place_collision_free(addr, x, y, front=False, zone_bounds=passive_zone)
```

- [ ] **Step 2: Recalculate zone sizing for smaller board**

Adjust `ic_spacing`, `passive_spacing`, `ic_cols`, `p_cols` for the 103mm width:

```python
ic_spacing = 12.0
ic_cols = max(1, int((board_w - 2 * margin) / ic_spacing))
passive_spacing = 5.0
p_cols = max(1, int((board_w - 2 * margin) / passive_spacing))
```

- [ ] **Step 3: Run placement and verify both sides used**

```bash
make hw-place-main
```

Expected: `Overlap check: PASS`, components placed on both F and B sides.

---

### Task 3: Update 3D assembly export

**Files:**
- Modify: `hardware/boards/scripts/export_3d_assembly.py`

- [ ] **Step 1: Document the main board offset**

The main board top-left aligns with control board top-left (both at PCB origin). No X/Y offset needed in the assembly. But the printed summary should note the smaller board size.

Add after the stack-up printout:

```python
print(f"  Main board size: 103.0 x 84.0 mm (control: 177.88 x 107.5 mm)")
```

- [ ] **Step 2: Export and verify**

```bash
make hw-3d-export hw-export-gltf
```

Expected: All 3 STEP files generated. GLTF conversion successful.

---

### Task 4: Add main board dimensions to component-map.json

**Files:**
- Modify: `hardware/boards/component-map.json`

- [ ] **Step 1: Add main_pcb section**

After the `pcb` section (which describes the control board), add the main board dimensions:

```json
"main_pcb": {
    "_note": "Main board is smaller than control board. Top-left corners align. Sized symmetrically around bridge connector centers.",
    "width_mm": 103.0,
    "height_mm": 84.0
},
```

- [ ] **Step 2: Update place_main_board() to read dimensions from component-map**

Instead of hardcoded 103/84, read from `component-map.json`:

```python
with open(COMPONENT_MAP_PATH) as f:
    comp_map = json.load(f)

main_dims = comp_map.get("main_pcb", {})
board_w = main_dims.get("width_mm", 103.0)
board_h = main_dims.get("height_mm", 84.0)
```

---

### Task 5: Full pipeline verification

- [ ] **Step 1: Run the full hardware pipeline**

```bash
make hw-place-control hw-place-main hw-3d-models hw-3d-export hw-export-gltf
```

- [ ] **Step 2: Verify control board**

- 0 collisions
- Bridge connectors at (15, 42) and (88, 42)
- Standoff holes at PCB (3.5, 3.0) and (3.5, 104.5)

- [ ] **Step 3: Verify main board**

- 0 collisions
- Board size: 103 × 84mm
- Bridge connectors at (15, 42) and (88, 42) — matching control board
- MCU at ~(51, 42)
- USB-C at right edge (~x=98, y=42)
- Power header at bottom-center area
- Components on both front and back sides

- [ ] **Step 4: Verify 3D export**

- All 3 STEP files generated
- GLTF conversion successful
- Main board visibly smaller than control board in 3D view

- [ ] **Step 5: Start dev server and verify web preview**

```bash
make dev
```

Web preview should be unaffected (main board is not rendered).
