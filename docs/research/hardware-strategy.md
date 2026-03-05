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
- **KiCad output** — generates standard KiCad files that import into EasyEDA Pro for PCB layout and JLCPCB ordering

### Toolchain

```
atopile (.ato source code)
  ↓ ato build
KiCad schematic + netlist
  ↓ import
EasyEDA Pro (PCB layout, component placement, routing)
  ↓ export
Gerber + BOM + CPL files
  ↓ upload
JLCPCB (fabrication + SMD assembly)
```

### CI Pipeline

GitHub Actions workflow (`.github/workflows/atopile.yml`):

| Trigger | Action | Artifacts |
|---------|--------|-----------|
| Push/PR touching `hardware/**` | `ato install` → `ato build` | None (verify only) |
| Merge to `main` | Same build | KiCad output stored as GitHub artifact |

This means: iterate on branches, verify the build passes, merge to main, download the KiCad output for layout work.

### What Lives Where

| Directory | Contents |
|-----------|----------|
| `hardware/` | Main PCB atopile project (schematic, components) |
| `hardware-faceplate/` | Front panel atopile project (holes, cutouts, silkscreen) |
| `docs/research/china-pcb-ordering.md` | BOM, costs, manufacturing specs |
| `docs/research/flux-ai-prompt*.md` | (archived) Original Flux.ai prompts |

### Current Status

The complete schematic is written in atopile:
- 14 component definitions (all ICs + through-hole parts)
- 9 circuit modules (power, MCU, DAC+analog, buttons, LEDs, display, input protection, MIDI, I/O jacks)
- Top-level `requencer.ato` wiring everything together

### Remaining Steps

1. **Install atopile + KiCad** (or use Docker image `ghcr.io/atopile/atopile-kicad`)
2. **Run `ato install`** to fetch the `generics` package
3. **Run `ato create part`** for Tier 2 ICs — adds proper LCSC footprints/symbols:
   - DAC8568SPMR (C133572), OPA4172ID (C482288), TLC5947DAP (C147565)
   - 74HC165D (C5613), 6N138 (C14010), AMS1117-3.3 (C6186)
   - AZ1117IH-5.0 (C108494), BAT54S (C85099), 2N3904 (C18536)
4. **Source KiCad footprints** for through-hole parts not in LCSC:
   - PJ398SM (Thonkiconn) — SnapEDA or Thonk KiCad library
   - TC002-N11AS1XT-RGB — SnapEDA or build from datasheet
   - EC11E — standard KiCad library
   - Raspberry Pi Pico — RPi Foundation hardware design files
5. **Run `ato build`** — verify full compilation
6. **Import into EasyEDA Pro** — PCB layout + routing
7. **Export Gerbers** → JLCPCB order

### Faceplate Strategy

The front panel is a separate atopile project (`hardware-faceplate/`). It's a PCB with no electrical components — just:
- Drill holes matching jack/button/encoder positions from main PCB
- Rectangular LCD cutout
- Mounting slots (Intellijel M3 standard)
- White silkscreen labels on black soldermask

Building it as a separate PCB project means it can be ordered independently (cheaper, faster iteration on fit).
