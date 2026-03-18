# Hardware Pipeline — Status & Known Shortcomings

> Updated 2026-03-18. Originally written 2026-03-07.

Status: Pipeline runs end-to-end locally via Make. No CI/CD automation yet. Build, footprints, faceplate, placement (5 strategies), routing, 3D export all functional.

## What Works

- **Atopile build**: `ato build` generates KiCad PCBs for control + main boards
- **Footprint generation**: All custom parts have local `.kicad_mod` and `.kicad_sym` files
- **Faceplate generation**: Generates faceplate PCB from `panel-layout.json`
- **Component placement**: 5 strategies (constructive, force-directed, grid-spread, SA-refine, wavefront) with parallel execution and post-routing selection
- **FreeRouting autoroute**: Functional via `make hw-route`
- **3D export**: STEP → GLB conversion pipeline for web viewer
- **Ground pours**: Automated ground fill after routing
- **Manufacturing export**: Gerbers + BOM export via `make hw-export`
- **11 Make targets**: `hw-all`, `hw-build`, `hw-footprints`, `hw-place`, `hw-faceplate`, `hw-route`, `hw-gnd-pours`, `hw-3d`, `hw-3d-models`, `hw-export`, `hw-clean`

## Resolved Issues

### ~~Missing Components~~ (Fixed)
All 3 previously-missing components are resolved:
- `display.q_bl` — now `q_lcd_bl = new _2N7002` in control.ato
- `mcu.d_vb` — now `d_vb = new B5819W` in mcu.ato
- `mcu.d_usb` — intentionally omitted (USB data lines wired directly, no ESD diode needed for prototype)

### ~~Autoroute Script Duplicate Steps~~ (Fixed)
Removed gerber export and DRC from autoroute script — now separate workflow steps.

## Remaining Shortcomings

### 1. No CI/CD Pipeline
Hardware build is local-only. No GitHub Actions workflow exists for automated builds. Could add CI for `ato build` + placement + DRC checks.

### 2. Build Speed (~15 min for `ato build`)
Atopile's constraint solver processes a large graph. `--keep-picked-parts` reuses previous picks (~40% faster). No true incremental build in atopile 0.14.

### 3. PGA2350 Supplier Workaround
`PGA2350.ato` uses a placeholder LCSC part number (`C0000`) because Pimoroni parts can't be auto-picked. Cosmetic only — part has local footprint and symbol.

### 4. FreeRouting Speed (~30-60 min)
FreeRouting with `-mp 20` on a full board takes 30-60 minutes. Possible mitigations: reduce max passes for iteration, cache routed PCB when netlist unchanged.

### 5. DRC Status
DRC runs after routing. Expect some violations until design is fully finalized. Should become a blocking check before manufacturing submission.

## Recommended Next Steps

1. **Add CI workflow** — at minimum run `ato build` + placement on PRs to catch regressions
2. **Reduce FreeRouting passes for iteration** — use `-mp 5` for quick checks, full 20 for final
3. **DRC as gate** — make DRC pass a requirement before manufacturing export
