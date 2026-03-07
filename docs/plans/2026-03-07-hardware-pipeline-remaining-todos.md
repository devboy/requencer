# Hardware Pipeline — Remaining TODOs & Known Shortcomings

Status: Pipeline runs end-to-end in Docker (locally and CI). Build, footprints, faceplate, and placement all pass. Autoroute and DRC are functional but have issues noted below.

## What Works

- **Docker toolchain**: Multi-arch image (amd64/arm64) with atopile, KiCad, FreeRouting, Java 21
- **`ato build`**: Completes successfully, generates PCB with 255 placed components
- **Footprint generation**: All custom parts have local `.kicad_mod` and `.kicad_sym` files
- **Faceplate generation**: Generates faceplate PCB from `panel-layout.json`
- **Component placement**: Places 255/255 components using layout coordinates
- **CI workflow**: Full pipeline runs on GitHub Actions (amd64 ubuntu-latest)
- **Local Docker**: `make hw-docker-build && make hw-docker` runs full pipeline

## Shortcomings

### 1. Build Speed (~15 min for `ato build`)

Atopile's constraint solver processes a 78K-vertex / 180K-edge graph. The "Picking parts" stage alone takes ~520-870s depending on caching.

**Partial mitigations available:**
- `--keep-picked-parts` reuses previous picks from existing PCB (~40% faster, 520s vs 870s)
- `--frozen` similar effect
- Neither flag skips the solver — no true incremental build in atopile 0.14

**CI caching not yet implemented:**
- Cache the PCB file between CI runs (GitHub Actions cache) so `--keep-picked-parts` can reuse it
- Cache the Docker image pull (already works once image is on GHCR after first merge to main)

### 2. Missing Components (39 warnings, 3 critical)

Three components have no picker and no footprint — they are **completely absent from the PCB**:

| Component | Type | Location | Purpose |
|-----------|------|----------|---------|
| `display.q_bl` | `new MOSFET` | `display.ato:28` | LCD backlight switching |
| `mcu.d_usb` | `new Diode` | `mcu.ato:143` | USB VBUS protection |
| `mcu.d_vb` | `new Diode` | `mcu.ato:86` | Power input diode |

**Fix:** Add specific constraints (package, voltage, current) or explicit `has_part_picked::by_supplier` traits so atopile's LCSC picker can resolve them. The remaining 34 warnings are KiCad plugin messages and solver diagnostics (non-critical).

### 3. PGA2350 Supplier Workaround

`PGA2350.ato` uses `supplier_id="lcsc"` with a placeholder part number (`C0000`) because atopile only supports LCSC as a supplier. Pimoroni parts can't be auto-picked. This is cosmetic — the part has a local footprint and symbol, so it appears correctly in the PCB. The BOM will show an invalid LCSC part number for this component.

### 4. KiCad 9 Not Available on arm64

The KiCad 9 PPA (`kicad/kicad-9.0-releases`) only publishes amd64 packages. On arm64 (Apple Silicon Macs), the Docker image gets KiCad 7, which cannot read KiCad 9 format PCBs.

**Impact:**
- `place_components.py`, `autoroute.sh`, `export_manufacturing.py` fail locally on arm64 Macs via Docker
- CI runs on amd64 and works fine
- Local macOS-native builds (via `make hw-place` etc.) still work since KiCad 9 is installed natively

**Possible fix:** Build KiCad 9 from source for arm64 in the Docker image (very slow image build, but one-time cost).

### 5. FreeRouting Speed (~30-60 min)

FreeRouting with `-mp 20` (20 max passes) on a 255-component board takes 30-60 minutes. This is inherent to the routing algorithm.

**Possible mitigations:**
- Reduce `-mp` (max passes) — trades routing quality for speed
- Cache the routed PCB and only re-route when netlist changes
- Use FreeRouting's incremental routing if available

### 6. Autoroute Script Had Duplicate Steps

Fixed in latest commit: removed gerber export and DRC from `autoroute.sh` since those are separate workflow steps. Previously they ran twice.

### 7. DRC on Routed Board

DRC now runs after routing (correct order). Expected to find violations since:
- 3 components are missing from the board entirely (see #2)
- Auto-placed SMD components may have clearance issues
- FreeRouting may leave some nets unconnected

DRC should become a blocking check once the design is complete and all components are present.

## Recommended Next Steps (priority order)

1. **Fix the 3 missing components** — add MOSFET/Diode constraints so they get picked and appear on the PCB
2. **Add CI caching** — cache PCB artifact between runs + use `--keep-picked-parts` to cut build time
3. **Push Docker image to GHCR** — happens automatically once this PR merges to main; subsequent CI runs will `docker pull` instead of build
4. **Reduce FreeRouting passes** — consider `-mp 5` or `-mp 10` for CI, full 20 passes for release builds
5. **Investigate arm64 KiCad 9** — either build from source or accept as CI-only capability
