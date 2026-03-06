# Hardware Design Strategy

## Decision: Code-First Schematic with Atopile

**Date:** 2026-03-05

### Why Not Flux.ai

We started with Flux.ai's browser-based PCB design tool and its AI copilot. After working through the block-by-block prompts (see `flux-ai-prompt.md` and `flux-ai-prompt-v2.md`), the experience was:

- **Unreliable AI copilot** — generates incorrect circuit topologies, misassigns pins, and proposes wrong component packages. Every block required manual correction.
- **Credit-burning** — the copilot charges credits per interaction, and most interactions produced unusable results that needed to be re-prompted or hand-fixed.
- **No version control** — designs live in Flux's cloud. No git history, no diffing, no review process.
- **Black box** — can't script, test, or automate any part of the design.

For a complex module (26 jacks, 32 RGB buttons, 2 DACs, 4 op-amps, 4 shift registers, 4 LED drivers, LCD, MIDI, Pico MCU), a GUI copilot that gets the basics wrong is slower than writing the circuit by hand.

### Why Atopile

[Atopile](https://atopile.io) is a code-first electronics design tool. You write circuits in `.ato` files (a domain-specific language for hardware), and it compiles to KiCad format.

**Advantages:**
- **Version controlled** — `.ato` files are plain text, live in the repo, get reviewed in PRs
- **Modular** — reusable circuit modules (e.g., `InputProtection` used 6 times across clock/reset/CV inputs)
- **CI-testable** — `ato build` runs in GitHub Actions, catches errors before merge
- **Component library** — `generics` package auto-picks LCSC parts for passives; `ato create part` imports ICs from LCSC by part number
- **KiCad output** — generates standard KiCad files for direct PCB layout and JLCPCB ordering

### Toolchain (Automated Pipeline)

**No EasyEDA Pro. No GUI. Everything scriptable and CI-able.**

```
atopile (.ato source code)
  ↓ ato build
KiCad schematic + netlist
  ↓ Python script (pcbnew API)
KiCad PCB with component placement
  ↓ export DSN → Freerouting (headless Docker) → import SES
Routed KiCad PCB
  ↓ kicad-cli
Gerber + BOM + CPL → upload to JLCPCB
```

Key tools:
- **kicad-cli** — headless Gerber/BOM/CPL export, DRC, DSN/SES conversion
- **Freerouting** (`ghcr.io/freerouting/freerouting`) — headless autorouter via Docker
- **KicadModTree** (PyPI) — parametric footprint generation from datasheet dimensions
- **pcbnew Python API** — scripted component placement using positions from `panel-layout.json`

### Automation Scripts

| Script | Purpose |
|--------|---------|
| `hardware/scripts/generate_footprints.py` | Generate `.kicad_mod` files for TH parts (PJ398SM, TC002, EC11E, Pico, header) |
| `hardware/scripts/place_components.py` | Place components using pcbnew API + positions from `panel-layout.json` |
| `hardware/scripts/autoroute.sh` | Export DSN → Freerouting headless → import SES → run DRC |
| `hardware/scripts/export_manufacturing.py` | Export Gerbers/BOM/CPL via kicad-cli, package for JLCPCB |
| `hardware-faceplate/scripts/generate_faceplate.py` | Generate faceplate PCB from `panel-layout.json` |

### Shared Layout Config

`panel-layout.json` at the repo root is the single source of truth for all panel dimensions and component positions in millimeters. Consumed by:
- `src/ui/panel/faceplate.ts` — browser UI (mm × SCALE → pixels)
- `hardware/scripts/*.py` — PCB generation (mm values directly)
- `hardware-faceplate/scripts/*.py` — faceplate generation

### What's Automated vs Manual

| Task | Automated? | How |
|------|-----------|-----|
| Schematic compilation | Yes | `ato build` in Docker |
| SMD footprints (Tier 2 ICs) | Yes | `ato create part` pulls from LCSC |
| Through-hole footprints | Yes | KicadModTree scripts from datasheet dims |
| Component placement (TH) | Yes | Python script using positions from `panel-layout.json` |
| Component placement (SMD) | Partial | Script groups near connected TH parts; may need fine-tuning |
| Autorouting | Yes-ish | Freerouting handles digital well; analog (DAC/op-amp) may need manual cleanup |
| Gerber/BOM/CPL export | Yes | `kicad-cli` headless |
| DRC (design rule check) | Yes | `kicad-cli pcb drc` |
| Faceplate PCB | Yes | Python script generates KiCad PCB from position constants |
| JLCPCB upload | Manual | Web upload (API exists but poorly documented) |

**Realistic expectation:** The automated pipeline gets us 80-90% there. Analog routing (DAC → op-amp precision traces) will likely need manual review in KiCad GUI.

### CI Pipeline

GitHub Actions workflow (`.github/workflows/atopile.yml`):

| Trigger | Action | Artifacts |
|---------|--------|-----------|
| Push/PR touching `hardware/**` | `ato install` → `ato build` → footprints → DRC → faceplate | None (verify only) |
| Merge to `main` | Full pipeline: build → place → autoroute → export | KiCad output + manufacturing files (Gerbers, BOM, CPL) |

### What Lives Where

| Directory | Contents |
|-----------|----------|
| `panel-layout.json` | Shared layout config (mm positions for all components) |
| `hardware/` | Main PCB atopile project (schematic, components) |
| `hardware/scripts/` | Automation scripts (footprints, placement, routing, export) |
| `hardware-faceplate/` | Front panel atopile project (holes, cutouts, silkscreen) |
| `hardware-faceplate/scripts/` | Faceplate PCB generation script |
| `docs/research/china-pcb-ordering.md` | BOM, costs, manufacturing specs |
| `docs/research/flux-ai-prompt*.md` | (archived) Original Flux.ai prompts |

### Current Status

**Updated 2026-03-06:** Migrated from Raspberry Pi Pico 2 to **Pimoroni PGA2350** (RP2350B, 48 GPIO).

The complete schematic is written in atopile:
- 19 component definitions (all ICs + through-hole parts + PGA2350 + USB-C + SD slot + ESD + BOOTSEL switch)
- 9 circuit modules (power, MCU, DAC+analog, buttons, LEDs, display, input protection, MIDI, I/O jacks)
- Top-level `requencer.ato` wiring everything together — **all components connected, no placeholders**
- Full automation pipeline: footprint generation, placement, autorouting, manufacturing export
- Faceplate generator producing mechanical-only PCB from shared layout config

**Key changes from Pico 2 design:**
- MCU: PGA2350 (48 GPIO) replaces Pico Plus 2 (26 GPIO)
- DACs get dedicated SPI1 bus (no contention with display)
- 4 CV inputs now connected to ADC4-7 (were "future expansion" placeholders)
- Front-panel USB-C for firmware updates
- Front-panel micro SD slot for preset import/export
- 5th TLC5947 LED driver for settings + TBD button LEDs
- TBD button added under T4 (on SR5.D1)
- 15+ spare GPIO for future expansion

### Remaining Steps

1. **Run `ato create part`** for Tier 2 ICs — adds proper LCSC footprints/symbols:
   - DAC8568SPMR (C133572), OPA4172ID (C482288), TLC5947DAP (C147565)
   - 74HC165D (C5613), 6N138 (C14010), AMS1117-3.3 (C6186)
   - AZ1117IH-5.0 (C108494), BAT54S (C85099), 2N3904 (C18536)
2. **Run `ato build`** — verify full compilation
3. **Run placement + autorouting pipeline** — review analog routing quality
4. **Export manufacturing files** → JLCPCB order

### Faceplate Strategy

The front panel is a separate project (`hardware-faceplate/`). It's a PCB with no electrical components — just:
- Drill holes matching jack/button/encoder positions from main PCB
- Rectangular LCD cutout (73.44 × 48.96mm)
- Mounting slots (Intellijel M3 standard)
- White silkscreen labels on matte black soldermask

Generated automatically from `panel-layout.json` by `generate_faceplate.py`. Can be ordered independently (cheaper, faster iteration on fit).
