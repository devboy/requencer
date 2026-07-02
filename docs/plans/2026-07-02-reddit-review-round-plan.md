# Reddit Review Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the repo, website, and artifacts ready for a Reddit post asking the synth-DIY community to review the hardware design before manufacturing.

**Architecture:** A single `docs/manual.md` becomes the source of truth for user docs — the web instructions modal imports it at build time (`?raw` + `marked`), the README links to it. Hardware artifacts (KiCad + review PDFs + gerbers + STEP) are zipped by a plain-python script and published as a GitHub Release via a make target the *user* runs. Licenses (MIT + CERN-OHL-S), OG meta tags, and a drafted Reddit post round it out.

**Tech Stack:** TypeScript/Vite/vitest (web), `marked` (new dep), Python 3 stdlib (release packaging, tested with pytest), GNU make, `gh` CLI.

**Spec:** `docs/plans/2026-07-02-reddit-review-round-design.md`

## Global Constraints

- **NO git commits.** Project rule: Claude never commits. Finish each task, verify, and report; the user commits. Ignore any commit steps implied by process skills.
- **Never run `gh release create`** — build the tooling only; publishing is done by the user.
- Engine purity does not apply here (all changes are UI/docs/tooling), but keep `web/src/engine/` untouched.
- Web checks that must stay green: `cd web && npm test && npm run check` (biome) and `npm run build` (tsc + vite).
- Live site URL: `https://devboy.github.io/requencer/` (vite `base: '/requencer/'`).
- Repo URL: `https://github.com/devboy/requencer`.

---

### Task 1: Write `docs/manual.md` (single-source manual)

**Files:**
- Create: `docs/manual.md`

**Interfaces:**
- Produces: `docs/manual.md` — imported by Task 2 via `?raw`. Heading contract used by Task 2's test: document starts with `# ` title and contains the `## ` sections listed below (exact strings): `## Quick start (mouse & touch)`, `## Tracks & subtracks`, `## Randomizer`, `## Keyboard shortcuts`.

- [ ] **Step 1: Create the manual**

Write `docs/manual.md` with exactly this content:

````markdown
# Requencer Manual

A 4-track eurorack-style step sequencer. Each track generates gate, pitch,
velocity and modulation for one synth voice. The design goal: replace a live
setup of four separate sequencers plus utility modules with a single,
hands-on module built around **polymetric randomization** — quick-generate
musical patterns at independent lengths, then sculpt them while they play.

This browser version is a faithful preview of the hardware: the on-screen
panel is the real faceplate layout, and every control works with the mouse or
a touch screen.

## Quick start (mouse & touch)

- **Click** any button to press it. Click a track button (T1–T4) to select a
  track, a subtrack button (GATE/PITCH/VEL/MOD) to pick what you're editing,
  and step buttons to toggle steps.
- **Hold combos:** many functions live behind "hold this + press that".
  Press and hold one button, then press another — e.g. hold **T1** and press
  **RAND** to randomize track 1. On a touch screen, just use two fingers.
- **Double-click for sticky hold:** double-click any holdable button to lock
  it down (it stays "held" so you can work one-handed). Click it again — or
  anywhere else — to release. `Esc` also releases.
- **Encoders:** drag up/down or use the scroll wheel to turn, click to push.
  Encoder A scrolls/edits values, encoder B changes pages/parameters.
- **Transport:** the play button starts and stops the clock; reset returns
  all playheads to step 1.

Press **PLAY**, then double-click **RAND** (sticky hold) to randomize
everything — you have a pattern. Everything else is sculpting.

## Tracks & subtracks

4 tracks, each with 4 independent subtracks: **gate** (rhythm), **pitch**
(melody), **velocity** (dynamics), and **mod** (modulation). Every subtrack
has its own step length (1–64) and clock divider — a track can run a 7-step
gate pattern at ÷2 alongside a 12-step pitch sequence at ÷1, creating
evolving polymetric patterns.

Hold a track button + turn encoder A to set all its subtrack lengths at
once; hold a subtrack button instead to set just that layer's length and
divider.

## Randomizer

The core workflow. Open it with the **RAND** button. You can randomize at
three levels:

- **Everything** — hold RAND alone: all four tracks, all layers.
- **One track** — hold a track button (T1–T4) + press RAND.
- **One layer** — hold a subtrack button (GATE/PITCH/VEL/MOD) + press RAND
  to regenerate only that layer, e.g. new melody over the same rhythm.

Each track has its own randomizer config: musical scale & root, pitch range,
max distinct notes, fill density (min/max %), velocity range, and gate mode.
Four gate algorithms:

| Mode | Character |
|------|-----------|
| RAND | Shuffled random fills |
| EUCL | Euclidean (evenly spread) rhythms, with random offset |
| SYNC | Offbeat-biased weighted random |
| CLST | Clustered bursts (Markov chain), with continuation probability |

8 factory presets (Bassline, Hypnotic, Acid, Ambient, Percussive, Sparse,
Stab, Driving) shape the randomizer — apply one with the encoder A push, and
save your own from the RAND screen.

## Drift

Open with the **DIV/DRIFT** button. Per-track stochastic mutation: each
subtrack has an independent drift rate that controls how quickly steps
mutate over time. Small rates slowly evolve a pattern while it plays; high
rates churn it.

## Transpose

Per-track transposition with semitone offset, note range (low/high), and
scale quantization. Transpose applies to the pitch output in real time.

## Routing

Open the route screen with the **ROUTE** button. Each track's 4 subtrack
outputs (gate/pitch/vel/mod) can be freely routed to any of the 4 output
jacks (A–D), enabling multi-voice or layered configurations.

## Mute & patterns

The **MUTE** screen toggles per-track mute patterns (with their own length
and divider). The **PAT** button opens the pattern screen for storing and
switching patterns.

## Settings

The **SET** button (jack zone) opens global settings. Clock section: BPM and
clock source (INT / MIDI / EXT). MIDI section: global MIDI on/off, device
selection, and per-output MIDI channel assignment (1–16).

## Keyboard shortcuts

Every on-screen control also has a keyboard binding, so the whole sequencer
is playable without a mouse — track buttons on `1–4`, subtracks on
`Q/W/E/R`, steps on `Z–,`, encoders on the arrow keys. Press **`?`** in the
app for the complete keymap.
````

- [ ] **Step 2: Verify it renders**

Run: `grep -c '^## ' docs/manual.md`
Expected: `9` (nine `##` sections). Also eyeball the markdown for broken tables/lists.

---

### Task 2: Render the manual in the instructions modal (single source)

**Files:**
- Modify: `web/package.json` (add `marked` dependency — via npm install)
- Create: `web/src/vite-env.d.ts`
- Modify: `web/src/ui/instructions-modal.ts` (replace hardcoded `SECTIONS` with rendered `docs/manual.md`)
- Test: `web/src/ui/__tests__/instructions-modal.test.ts`

**Interfaces:**
- Consumes: `docs/manual.md` from Task 1.
- Produces: `renderManualHtml(markdown: string): string` exported from `instructions-modal.ts`; `toggleInstructions(): void` and `isInstructionsOpen(): boolean` keep their existing signatures (Task 3 uses them).

- [ ] **Step 1: Install marked**

Run: `cd web && npm install marked`
Expected: `marked` appears under `dependencies` in `web/package.json`.

- [ ] **Step 2: Add vite client types**

Create `web/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
```

(This provides the `*?raw` module declaration for `tsc`; `assembly-viewer.ts` has an inline reference already, this makes it project-wide.)

- [ ] **Step 3: Write the failing test**

Create `web/src/ui/__tests__/instructions-modal.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
// biome-ignore lint/style/useImportType: raw import
import manualSource from '../../../../docs/manual.md?raw'
import { renderManualHtml } from '../instructions-modal'

describe('manual rendering', () => {
  it('converts markdown headings to HTML', () => {
    const html = renderManualHtml('# Title\n\n## Section\n\nbody text')
    expect(html).toContain('<h1')
    expect(html).toContain('<h2')
    expect(html).toContain('body text')
  })

  it('renders tables', () => {
    const html = renderManualHtml('| a | b |\n|---|---|\n| 1 | 2 |')
    expect(html).toContain('<table')
  })

  it('the real manual contains the expected sections', () => {
    expect(manualSource.startsWith('# Requencer Manual')).toBe(true)
    for (const section of [
      '## Quick start (mouse & touch)',
      '## Tracks & subtracks',
      '## Randomizer',
      '## Keyboard shortcuts',
    ]) {
      expect(manualSource).toContain(section)
    }
  })

  it('the real manual renders without error', () => {
    const html = renderManualHtml(manualSource)
    expect(html).toContain('<h1')
    expect(html.length).toBeGreaterThan(1000)
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd web && npx vitest run src/ui/__tests__/instructions-modal.test.ts`
Expected: FAIL — `renderManualHtml` is not exported.

- [ ] **Step 5: Rewrite instructions-modal.ts**

Replace the entire contents of `web/src/ui/instructions-modal.ts` with:

```ts
/**
 * Manual modal — renders docs/manual.md, the single source of truth
 * shared with the README. Toggle from the MANUAL button or debug menu.
 */

import { marked } from 'marked'
import manualSource from '../../../docs/manual.md?raw'

export function renderManualHtml(markdown: string): string {
  return marked.parse(markdown, { async: false })
}

const MANUAL_CSS = `
  .manual-body h1 { margin: 0 0 16px; font-size: 15px; color: #fff; letter-spacing: 2px; text-align: center; }
  .manual-body h2 { font-size: 11px; color: #888; letter-spacing: 1.5px; margin: 18px 0 6px; border-bottom: 1px solid #333; padding-bottom: 4px; text-transform: uppercase; }
  .manual-body p, .manual-body li { color: #aaa; line-height: 1.5; margin: 6px 0; }
  .manual-body ul { padding-left: 18px; margin: 6px 0; }
  .manual-body strong { color: #ddd; }
  .manual-body code { color: #e8a0bf; }
  .manual-body table { border-collapse: collapse; margin: 8px 0; }
  .manual-body th, .manual-body td { border: 1px solid #333; padding: 3px 8px; color: #aaa; font-size: 12px; text-align: left; }
`

let overlay: HTMLDivElement | null = null

function createOverlay(): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = `
    position: fixed; inset: 0; z-index: 10000;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.7); backdrop-filter: blur(4px);
  `

  const card = document.createElement('div')
  card.className = 'manual-body'
  card.style.cssText = `
    background: #1a1a2e; border: 1px solid #555; border-radius: 8px;
    padding: 24px 32px; color: #ccc; font: 13px 'JetBrains Mono', monospace;
    max-width: 560px; width: 90%; max-height: 85vh; overflow-y: auto;
  `

  const style = document.createElement('style')
  style.textContent = MANUAL_CSS
  card.appendChild(style)

  const body = document.createElement('div')
  body.innerHTML = renderManualHtml(manualSource)
  card.appendChild(body)

  const hint = document.createElement('div')
  hint.textContent = 'Press any key or click outside to close'
  hint.style.cssText = `
    margin-top: 16px; text-align: center;
    font-size: 11px; color: #666;
  `
  card.appendChild(hint)

  el.appendChild(card)

  // Click outside card to close
  el.addEventListener('click', (e) => {
    if (e.target === el) toggleInstructions()
  })

  return el
}

export function toggleInstructions(): void {
  if (overlay) {
    overlay.remove()
    overlay = null
  } else {
    overlay = createOverlay()
    document.body.appendChild(overlay)
  }
}

export function isInstructionsOpen(): boolean {
  return overlay !== null
}
```

Note: `innerHTML` with marked output is acceptable here — the input is our own
committed markdown, not user content.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd web && npx vitest run src/ui/__tests__/instructions-modal.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Full web check**

Run: `cd web && npm test && npm run check && npm run build`
Expected: all green. If `npm run check` (biome) complains about the
`biome-ignore` comment in the test, adjust to whatever biome accepts (e.g.
drop the comment if unneeded).

- [ ] **Step 8: Visual check**

Run: `make dev`, open the printed localhost URL, open the manual from the
debug menu ("Instructions" button). Verify: headings styled, table renders,
no raw markdown visible. Stop the server.

---

### Task 3: Visible MANUAL/? buttons + first-visit auto-open

**Files:**
- Create: `web/src/ui/help-buttons.ts`
- Test: `web/src/ui/__tests__/help-buttons.test.ts`
- Modify: `web/src/main.ts` (wire up after `createDebugMenu(...)` call around line 173)
- Modify: `web/src/ui/debug-menu.ts` (rename button labels: `Instructions` → `Manual`)

**Interfaces:**
- Consumes: `toggleInstructions()`, `isInstructionsOpen()` from `instructions-modal.ts`; `toggleHelp()` from `help-modal.ts`.
- Produces: `createHelpButtons(): void`, `maybeAutoOpenManual(store?: KeyValueStore): void`, `shouldAutoOpenManual(store: KeyValueStore): boolean`, `interface KeyValueStore { getItem(key: string): string | null; setItem(key: string, value: string): void }`.

- [ ] **Step 1: Write the failing test**

Create `web/src/ui/__tests__/help-buttons.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { shouldAutoOpenManual } from '../help-buttons'

function fakeStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  }
}

describe('shouldAutoOpenManual', () => {
  it('returns true on first visit and marks the store', () => {
    const store = fakeStore()
    expect(shouldAutoOpenManual(store)).toBe(true)
    expect(store.getItem('requencer-manual-seen')).toBe('1')
  })

  it('returns false on subsequent visits', () => {
    const store = fakeStore({ 'requencer-manual-seen': '1' })
    expect(shouldAutoOpenManual(store)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/ui/__tests__/help-buttons.test.ts`
Expected: FAIL — module `../help-buttons` not found.

- [ ] **Step 3: Implement help-buttons.ts**

Create `web/src/ui/help-buttons.ts`:

```ts
/**
 * Always-visible MANUAL and ? buttons (bottom-right), plus first-visit
 * auto-open of the manual so new visitors get an explanation up front.
 */

import { toggleHelp } from './help-modal'
import { isInstructionsOpen, toggleInstructions } from './instructions-modal'

const SEEN_KEY = 'requencer-manual-seen'

export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** True exactly once per store — marks the store as seen. */
export function shouldAutoOpenManual(store: KeyValueStore): boolean {
  if (store.getItem(SEEN_KEY)) return false
  store.setItem(SEEN_KEY, '1')
  return true
}

const BTN_CSS = `
  padding: 6px 12px; background: #1a1a2e; border: 1px solid #444;
  color: #ccc; font: 13px monospace; border-radius: 6px; cursor: pointer;
`

export function createHelpButtons(): void {
  const bar = document.createElement('div')
  bar.style.cssText = `
    position: fixed; bottom: 12px; right: 12px; z-index: 9998;
    display: flex; gap: 6px;
  `

  const manualBtn = document.createElement('button')
  manualBtn.textContent = 'MANUAL'
  manualBtn.style.cssText = BTN_CSS
  manualBtn.addEventListener('click', () => toggleInstructions())

  const keysBtn = document.createElement('button')
  keysBtn.textContent = '?'
  keysBtn.style.cssText = BTN_CSS
  keysBtn.title = 'Keyboard shortcuts'
  keysBtn.addEventListener('click', () => toggleHelp())

  bar.append(manualBtn, keysBtn)
  document.body.appendChild(bar)
}

export function maybeAutoOpenManual(store?: KeyValueStore): void {
  let s = store
  if (!s) {
    try {
      s = window.localStorage
    } catch {
      return // storage blocked (privacy mode) — skip auto-open
    }
  }
  if (shouldAutoOpenManual(s) && !isInstructionsOpen()) toggleInstructions()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/ui/__tests__/help-buttons.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire into main.ts**

In `web/src/main.ts`, add to the imports near the `createDebugMenu` import:

```ts
import { createHelpButtons, maybeAutoOpenManual } from './ui/help-buttons'
```

Immediately after the `createDebugMenu({ ... })` call (around line 173, after
its closing `})`), add:

```ts
createHelpButtons()
maybeAutoOpenManual()
```

- [ ] **Step 6: Rename debug-menu label**

In `web/src/ui/debug-menu.ts`, change `instrBtn.textContent = 'Instructions'`
to `instrBtn.textContent = 'Manual'`.

- [ ] **Step 7: Full web check + visual check**

Run: `cd web && npm test && npm run check && npm run build`
Expected: green.

Run `make dev`, open the URL in a private/incognito window (fresh
localStorage): the manual should auto-open once; close it, reload — it should
NOT auto-open again. Verify the MANUAL and ? buttons sit bottom-right and
work, and don't overlap the panel or debug menu. Stop the server.

---

### Task 4: Licenses (MIT + CERN-OHL-S)

**Files:**
- Create: `LICENSE`
- Create: `hardware/LICENSE`

**Interfaces:**
- Produces: license files referenced by Task 5 (README) and Task 8 (Reddit post).

- [ ] **Step 1: Create MIT LICENSE at repo root**

Create `LICENSE`:

```text
MIT License

Copyright (c) 2026 Dominic Graefen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Fetch CERN-OHL-S v2 full text**

Run:
```bash
curl -fsSL -o hardware/LICENSE https://raw.githubusercontent.com/spdx/license-list-data/main/text/CERN-OHL-S-2.0.txt
```

- [ ] **Step 3: Verify the license text**

Run: `head -3 hardware/LICENSE && grep -c "Strongly Reciprocal" hardware/LICENSE`
Expected: header mentions "CERN Open Hardware Licence Version 2 - Strongly Reciprocal"; grep count ≥ 1. If the URL fails, fetch from the official source instead: <https://ohwr.org/cern_ohl_s_v2.txt> (or the CERN OHL wiki uploads page) and re-verify.

---

### Task 5: README rewrite

**Files:**
- Modify: `README.md` (full replacement)

**Interfaces:**
- Consumes: `docs/manual.md` (Task 1), licenses (Task 4). Links to the GitHub Releases page that Task 6/7's target populates.

- [ ] **Step 1: Replace README.md**

Replace the entire contents of `README.md` with:

````markdown
# Requencer

A 4-track eurorack step sequencer built around **polymetric randomization** —
each track has independent gate, pitch, velocity and mod subtracks with their
own lengths and clock dividers, and a randomizer that regenerates everything,
one track, or a single layer at the press of a button. It replaces a live
setup of four sequencers plus utility modules with one hands-on module.

**[▶ Try it live](https://devboy.github.io/requencer/)** — the browser
preview is the real faceplate layout; everything works with mouse or touch.
See the **[manual](docs/manual.md)** for how to play it.

![screenshot](docs/screenshot.png)

## ⚡ Help wanted: hardware design review

The firmware, engine, and web preview are working and tested — but I'm a
software developer, not a hardware engineer, and this design is about to go
to manufacturing. **I'd be grateful for experienced eyes on the electronics
before I order boards.**

The module is a three-board stack behind a eurorack faceplate:

- **Control board** — buttons, encoders, jacks, LED drivers, shift
  registers, USB-C, SD card, MIDI in.
- **Main board** — RP2350 (PGA2350), DAC8568 CV outputs with op-amp output
  stages (1V/oct), eurorack power entry and regulators.
- Board-to-board via 2×16 shrouded headers.

**Review materials:**

- 📄 **Schematic review PDFs** (one page per subcircuit, net-label style) and
  the full **KiCad projects, gerbers, and STEP files** are attached to the
  latest [GitHub Release](https://github.com/devboy/requencer/releases).
- The design source is [atopile](https://atopile.io/) (`hardware/boards/elec/src/`),
  compiled to KiCad — the PDFs and KiCad files are what you want to look at
  if you don't read `.ato`.

Particularly unsure about: power entry & regulation, the DAC output stage
(1V/oct scaling/offset accuracy), the board-to-board pinout, and the USB-C /
SD / MIDI input circuits. Issues and PRs welcome.

## Features

- 4 tracks × 4 subtracks (gate / pitch / velocity / mod), each with
  independent step length (1–64) and clock divider — polymetric by default.
- Randomizer with per-track scale, root, range, density and velocity config;
  four gate algorithms (RAND / EUCL / SYNC / CLST); 8 factory presets plus
  user presets.
- Drift (per-subtrack stochastic mutation) and per-track transpose with
  scale quantization.
- Free output routing: any subtrack to any of the 4 output jacks.
- Internal, MIDI, or external clock; per-output MIDI channels.

Full documentation: **[docs/manual.md](docs/manual.md)** (also built into
the web app — the MANUAL button).

## Architecture

| Part | What it is |
|------|------------|
| `crates/engine` | `no_std` pure Rust sequencer logic (runs in WASM and on the RP2350) |
| `crates/renderer` | `no_std` display rendering via embedded-graphics |
| `crates/web` | WASM bindings + Canvas2D target for the browser |
| `crates/firmware` | RP2350 firmware: SPI display, DACs, buttons/encoders |
| `web/` | TypeScript preview: Tone.js audio, Web MIDI, canvas faceplate UI |
| `hardware/` | atopile PCB projects (control + main + faceplate) and the build pipeline |

## Development

```bash
make dev      # Vite dev server (builds WASM first)
make test     # All tests: Rust + web + hardware scripts
make rust     # Test + lint + build firmware
make web      # Test + lint + build web bundle
make hardware # Full hardware pipeline (KiCad + FreeRouting required)
```

## License

- Code: [MIT](LICENSE)
- Hardware design (`hardware/`): [CERN-OHL-S v2](hardware/LICENSE) —
  strongly reciprocal open hardware licence.
````

- [ ] **Step 2: Verify links**

Run:
```bash
ls docs/manual.md docs/screenshot.png LICENSE hardware/LICENSE
```
Expected: all four exist. Preview the markdown (e.g. in an editor) for table/link rendering.

---

### Task 6: Release packaging script + tests

**Files:**
- Create: `hardware/boards/scripts/export/package_release.py`
- Test: `hardware/boards/scripts/tests/test_package_release.py`

**Interfaces:**
- Produces: CLI `python3 package_release.py --hardware-dir <hardware/> --tag <tag> --out <dir>` → writes `<dir>/requencer-hardware-<tag>.zip` and `<dir>/release-notes.md`. Python API used by tests: `artifact_manifest(hw: Path) -> list[Artifact]`, `check_missing(items: list[Artifact]) -> list[str]`, `build_zip(hw: Path, tag: str, out_dir: Path) -> Path`. `Artifact = tuple[str, Path, bool]` = (arcname, source path, required).
- Consumed by: Task 7's Makefile target.

- [ ] **Step 1: Write the failing test**

Create `hardware/boards/scripts/tests/test_package_release.py`:

```python
"""Tests for the release packaging script (plain python3, no pcbnew)."""

import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from export.package_release import artifact_manifest, build_zip, check_missing


def make_fake_hardware(root: Path) -> Path:
    """Create a minimal fake hardware/ tree with all required artifacts."""
    hw = root / "hardware"
    build = hw / "boards" / "build"
    (build / "review").mkdir(parents=True)
    (build / "3d").mkdir(parents=True)
    fp = hw / "faceplate" / "elec" / "layout"
    fp.mkdir(parents=True)

    for f in [
        build / "control-poured.kicad_pcb",
        build / "main-poured.kicad_pcb",
        build / "review" / "control.pdf",
        build / "review" / "main.pdf",
        build / "3d" / "control.step",
        fp / "faceplate.kicad_pcb",
    ]:
        f.write_text("fake")

    # manufacturing tree (collected recursively)
    mfg = build / "manufacturing" / "control"
    mfg.mkdir(parents=True)
    (mfg / "control-F_Cu.gbr").write_text("fake gerber")
    return hw


def test_check_missing_reports_required_files(tmp_path):
    hw = tmp_path / "hardware"
    (hw / "boards" / "build").mkdir(parents=True)
    missing = check_missing(artifact_manifest(hw))
    assert any("control-poured.kicad_pcb" in m for m in missing)
    assert any("review/control.pdf" in m or "control.pdf" in m for m in missing)


def test_check_missing_empty_when_complete(tmp_path):
    hw = make_fake_hardware(tmp_path)
    assert check_missing(artifact_manifest(hw)) == []


def test_build_zip_contains_expected_layout(tmp_path):
    hw = make_fake_hardware(tmp_path)
    out = tmp_path / "out"
    zip_path = build_zip(hw, "hw-review-r1", out)

    assert zip_path.name == "requencer-hardware-hw-review-r1.zip"
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
    assert "kicad/control/control-poured.kicad_pcb" in names
    assert "kicad/main/main-poured.kicad_pcb" in names
    assert "kicad/faceplate/faceplate.kicad_pcb" in names
    assert "review/control.pdf" in names
    assert "review/main.pdf" in names
    assert "manufacturing/control/control-F_Cu.gbr" in names
    assert "README.txt" in names
    # release notes written next to the zip
    assert (out / "release-notes.md").exists()


def test_build_zip_fails_loudly_on_missing_required(tmp_path):
    hw = tmp_path / "hardware"
    (hw / "boards" / "build").mkdir(parents=True)
    out = tmp_path / "out"
    try:
        build_zip(hw, "r1", out)
        raise AssertionError("expected SystemExit")
    except SystemExit as e:
        assert e.code != 0
```

- [ ] **Step 2: Run test to verify it fails**

Run (from repo root):
```bash
cd hardware/boards/scripts && PYTHONPATH=. python3 -m pytest tests/test_package_release.py -v
```
Expected: FAIL — `export.package_release` module not found.
(Plain `python3` is fine — the script has no third-party deps. If `pytest`
is missing in that interpreter, use `../../.venv/bin/python3 -m pytest` —
the venv used by `make test-hw`; create it via `make -C hardware test-hw` once if needed.)

- [ ] **Step 3: Implement package_release.py**

Create `hardware/boards/scripts/export/package_release.py`:

```python
#!/usr/bin/env python3
"""Assemble a hardware release zip for GitHub Releases.

CI cannot build the hardware pipeline, so artifacts are built locally and
uploaded via `make release-artifacts TAG=...`. This script only collects and
zips — it never talks to GitHub.

Contents: KiCad projects (poured control/main + faceplate), schematic review
PDFs, manufacturing exports (gerbers/BOM), and STEP models.
"""

import argparse
import sys
import zipfile
from pathlib import Path

# (arcname, source path, required)
Artifact = tuple[str, Path, bool]

HINTS = {
    "kicad": "run the hardware pipeline: make -C hardware all",
    "review": "generate review PDFs: KiCad python + hardware/boards/scripts/review/gen_review_pack.py",
    "manufacturing": "run: make -C hardware export",
    "3d": "run: make -C hardware 3d",
}


def artifact_manifest(hw: Path) -> list[Artifact]:
    build = hw / "boards" / "build"
    fp = hw / "faceplate" / "elec" / "layout"
    items: list[Artifact] = [
        ("kicad/control/control-poured.kicad_pcb", build / "control-poured.kicad_pcb", True),
        ("kicad/control/control-poured.kicad_pro", build / "control-poured.kicad_pro", False),
        ("kicad/control/control-poured.kicad_prl", build / "control-poured.kicad_prl", False),
        ("kicad/main/main-poured.kicad_pcb", build / "main-poured.kicad_pcb", True),
        ("kicad/main/main-poured.kicad_pro", build / "main-poured.kicad_pro", False),
        ("kicad/main/main-poured.kicad_prl", build / "main-poured.kicad_prl", False),
        ("kicad/faceplate/faceplate.kicad_pcb", fp / "faceplate.kicad_pcb", True),
        ("kicad/faceplate/faceplate.kicad_pro", fp / "faceplate.kicad_pro", False),
        ("review/control.pdf", build / "review" / "control.pdf", True),
        ("review/main.pdf", build / "review" / "main.pdf", True),
        ("3d/control.step", build / "3d" / "control.step", False),
        ("3d/main.step", build / "3d" / "main.step", False),
        ("3d/faceplate.step", build / "3d" / "faceplate.step", False),
    ]
    # Manufacturing exports: collect whole trees, optional as a group.
    mfg = build / "manufacturing"
    if mfg.is_dir():
        for f in sorted(mfg.rglob("*")):
            if f.is_file():
                items.append((f"manufacturing/{f.relative_to(mfg)}", f, False))
    return items


def check_missing(items: list[Artifact]) -> list[str]:
    missing = []
    for arcname, src, required in items:
        if required and not src.is_file():
            hint = HINTS.get(arcname.split("/")[0], "")
            missing.append(f"{arcname}  (expected at {src}){' — ' + hint if hint else ''}")
    return missing


def release_notes(tag: str, items: list[Artifact]) -> str:
    lines = [
        f"# Requencer hardware — {tag}",
        "",
        "Locally built hardware artifacts for design review (CI cannot build these).",
        "",
        "## Contents",
        "",
        "- `kicad/` — routed + poured KiCad projects (control, main, faceplate). KiCad 9+.",
        "- `review/` — schematic review PDFs, one page per subcircuit (net-label style).",
        "- `manufacturing/` — gerbers / drill / BOM exports.",
        "- `3d/` — STEP models of the board stack.",
        "",
        "Design source is atopile (`hardware/boards/elec/src/` in the repo);",
        "the KiCad files here are the compiled output that the PDFs were",
        "generated from.",
        "",
        f"Repo: https://github.com/devboy/requencer",
        "",
        "## Files included",
        "",
    ]
    lines += [f"- {arcname}" for arcname, src, _ in items if src.is_file()]
    return "\n".join(lines) + "\n"


def build_zip(hw: Path, tag: str, out_dir: Path) -> Path:
    items = artifact_manifest(hw)
    missing = check_missing(items)
    if missing:
        print("ERROR: missing required artifacts:\n", file=sys.stderr)
        for m in missing:
            print(f"  - {m}", file=sys.stderr)
        sys.exit(1)

    out_dir.mkdir(parents=True, exist_ok=True)
    notes = release_notes(tag, items)
    (out_dir / "release-notes.md").write_text(notes)

    zip_path = out_dir / f"requencer-hardware-{tag}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("README.txt", notes)
        for arcname, src, _required in items:
            if src.is_file():
                zf.write(src, arcname)
    return zip_path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hardware-dir", type=Path, required=True, help="path to hardware/")
    parser.add_argument("--tag", required=True, help="release tag, e.g. hw-review-r1")
    parser.add_argument("--out", type=Path, required=True, help="output directory")
    args = parser.parse_args()

    zip_path = build_zip(args.hardware_dir.resolve(), args.tag, args.out.resolve())
    print(f"Wrote {zip_path}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd hardware/boards/scripts && PYTHONPATH=. python3 -m pytest tests/test_package_release.py -v
```
Expected: PASS (4 tests).

- [ ] **Step 5: Confirm existing script tests still pass**

Run: `make -C hardware test-hw`
Expected: all pass (the new test file is picked up by the same `tests/` glob).

- [ ] **Step 6: Dry-run against the real tree**

Run (from repo root):
```bash
python3 hardware/boards/scripts/export/package_release.py --hardware-dir hardware --tag dry-run --out /tmp/requencer-release-dryrun 2>&1 | tail -2
unzip -l /tmp/requencer-release-dryrun/requencer-hardware-dry-run.zip | head -25
```
Expected: zip written; listing shows `kicad/`, `review/`, `manufacturing/` entries. (If a required artifact is genuinely missing locally, the error message must name it and the make target that produces it — that is also a valid outcome to report.)

---

### Task 7: Makefile targets (`release-artifacts`)

**Files:**
- Modify: `hardware/Makefile` (add target near the manufacturing export section, after `export-faceplate`)
- Modify: `Makefile` (top-level passthrough)

**Interfaces:**
- Consumes: `package_release.py` CLI from Task 6.
- Produces: `make release-artifacts TAG=<tag>` at repo root — packages the zip, then `gh release create` (user-run).

- [ ] **Step 1: Add target to hardware/Makefile**

After the `export-faceplate` rule in `hardware/Makefile`, add:

```makefile
# --- Release artifacts (GitHub Release; built locally — CI can't build hardware) ---
RELEASE_DIR := $(BUILD)/release

release-artifacts:
	@test -n "$(TAG)" || { echo "Usage: make release-artifacts TAG=hw-review-r1"; exit 1; }
	python3 $(SCRIPTS)/export/package_release.py --hardware-dir . --tag $(TAG) --out $(RELEASE_DIR)
	gh release create $(TAG) $(RELEASE_DIR)/requencer-hardware-$(TAG).zip \
		--title "Hardware review $(TAG)" \
		--notes-file $(RELEASE_DIR)/release-notes.md
	@echo "== Release $(TAG) published. Re-upload a fixed zip with: gh release upload $(TAG) <zip> --clobber =="
```

Also add `release-artifacts` to any `.PHONY` list in that Makefile (or its own `.PHONY: release-artifacts` line next to the target).

- [ ] **Step 2: Add top-level passthrough**

In the root `Makefile`, after the `hardware:` rule, add:

```makefile
# === Release artifacts — zips KiCad/gerbers/PDFs, publishes GitHub Release ===

release-artifacts:
	$(MAKE) -C hardware release-artifacts TAG=$(TAG)
```

And add `release-artifacts` to the `.PHONY` line at the top.

- [ ] **Step 3: Verify guard + packaging (without publishing)**

Run: `make release-artifacts`
Expected: fails with `Usage: make release-artifacts TAG=hw-review-r1`.

Run: `make -C hardware -n release-artifacts TAG=test-tag | head -5`
Expected: dry-run prints the python packaging command and the `gh release create` command with the right paths. **Do not run it without `-n`** — publishing is the user's action.

---

### Task 8: Web page meta tags + OG image

**Files:**
- Create: `web/public/screenshot.png` (copy of `docs/screenshot.png`)
- Modify: `web/index.html`

**Interfaces:**
- Produces: link-preview metadata for the deployed site (used by the Reddit post).

- [ ] **Step 1: Copy the screenshot into web/public**

Run: `cp docs/screenshot.png web/public/screenshot.png`

- [ ] **Step 2: Update index.html**

Replace the contents of `web/index.html` with:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <title>Requencer — 4-track polymetric eurorack sequencer</title>
    <meta
      name="description"
      content="Browser preview of Requencer: a 4-track eurorack step sequencer with polymetric subtracks, scale-aware randomization, drift, and free output routing. Works with mouse or touch."
    />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://devboy.github.io/requencer/" />
    <meta property="og:title" content="Requencer — 4-track polymetric eurorack sequencer" />
    <meta
      property="og:description"
      content="Play the browser preview: polymetric subtracks, scale-aware randomization, drift, free output routing. Open hardware — design review welcome."
    />
    <meta property="og:image" content="https://devboy.github.io/requencer/screenshot.png" />
    <meta name="twitter:card" content="summary_large_image" />
  </head>
  <body>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 3: Verify build serves the image**

Run: `cd web && npm run build && ls dist/screenshot.png`
Expected: build green, `dist/screenshot.png` exists (public/ assets are copied verbatim).

---

### Task 9: Reddit post draft

**Files:**
- Create: `docs/reddit-post.md`

**Interfaces:**
- Consumes: links from Tasks 5–8 (README review section, releases URL, live demo).

- [ ] **Step 1: Write the draft**

Create `docs/reddit-post.md`:

````markdown
# Reddit post draft — hardware review request

Target subs (tailor the ask per sub, don't blanket-crosspost the same day):

- **r/synthdiy** — primary; full post below.
- **r/modular** — shorter version, lead with the live demo.
- **r/AskElectronics** — narrow it to one or two specific circuits (they
  dislike "review my whole board" posts).

Personalize before posting: the backstory paragraph and the "what I'm unsure
about" list should be in your own words — reviewers respond to specifics.

---

## Title options

1. Built a 4-track polymetric eurorack sequencer (RP2350 + DAC8568) — all my
   tests pass, but I'm a software dev, not an EE. Design review before I
   order boards?
2. Open-source eurorack sequencer about to go to fab — would love
   experienced eyes on the schematics (KiCad + PDFs + live browser demo)
3. My first eurorack module: 4-track randomizing sequencer. Free/open
   design — what did I get wrong before I ship it to manufacturing?

## Body

Hi all — I've spent the last months building **Requencer**, a 4-track
eurorack step sequencer designed around polymetric randomization: every
track has independent gate/pitch/velocity/mod subtracks with their own
lengths and clock dividers, plus scale-aware randomization of everything,
one track, or a single layer.

**You can play the whole thing in the browser** (it's the real faceplate
layout, mouse/touch): https://devboy.github.io/requencer/

The catch: I'm a software developer. The firmware and engine are solid and
tested, the PCB pipeline (atopile → KiCad → autorouting → DRC) passes all
its local checks — but *"my tests pass" is not the same as "this circuit is
right"*, and I don't have the hardware background to know what I don't
know. Before I send this to manufacturing, I'd be very grateful for a
design review.

**The hardware** — a three-board stack behind a 3U eurorack faceplate:

- **Control board:** buttons, encoders, jacks, LED drivers, shift
  registers, USB-C, SD card, MIDI in
- **Main board:** RP2350 (PGA2350 module), DAC8568 → op-amp output stages
  for CV (1V/oct), eurorack power entry + regulators
- Board-to-board: 2×16 shrouded headers

**Review materials** (everything is open source, MIT + CERN-OHL-S):

- Schematic review PDFs (one page per subcircuit):
  https://github.com/devboy/requencer/releases — the release zip also has
  the full KiCad projects, gerbers, and STEP files
- Repo: https://github.com/devboy/requencer

**What I'm most unsure about:**

- Eurorack power entry & regulation (reverse polarity, filtering, rail
  budget)
- The DAC8568 output stage — 1V/oct scaling and offset accuracy over 4
  octaves+
- Board-to-board connector pinout (55 signals over 64 pins — anything
  fragile about the assignment?)
- USB-C, SD card, and MIDI input circuits (opto, termination)
- Anything a checklist can't catch — layout smells, footprint mistakes,
  "you'll regret this in rev 2" stuff

Happy to answer anything about the sequencer side in return — the
randomizer algorithms (euclidean, Markov-chain clusters), the polymetric
engine, or the atopile → KiCad pipeline. Thanks!
````

- [ ] **Step 2: Verify links in the draft**

Check each URL in the draft resolves (repo, releases page, live site). The
releases link will be empty until the user runs `make release-artifacts` —
note that in the final report.

---

### Task 10: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full web pipeline**

Run: `make web`
Expected: wasm build + `npm test` + `npm run check` + `npm run build` all green.

- [ ] **Step 2: Hardware script tests**

Run: `make -C hardware test-hw`
Expected: green, including `test_package_release.py`.

- [ ] **Step 3: End-to-end visual pass**

Run `make dev` and verify in the browser: first-visit auto-open (incognito),
MANUAL/? buttons, manual content matches `docs/manual.md`, `?` keymap modal
still works. Stop the server.

- [ ] **Step 4: Report to user**

Summarize for the user, including the exact commands only they should run:

```bash
# 1. Review + commit everything (including hardware/boards/scripts/review/)
# 2. Publish the artifacts:
make release-artifacts TAG=hw-review-r1
# 3. Post using docs/reddit-post.md (personalize first)
```

---

## Self-Review Checklist

- [x] Spec coverage: manual (T1), modal single-source (T2), discoverability +
  auto-open (T3), licenses (T4), README (T5), packaging script (T6), make
  targets (T7), OG meta (T8), Reddit draft (T9), verification (T10).
- [x] No placeholders — all file contents are written out in full.
- [x] Type consistency: `renderManualHtml`, `toggleInstructions`,
  `isInstructionsOpen`, `shouldAutoOpenManual`, `KeyValueStore`,
  `artifact_manifest`/`check_missing`/`build_zip` names match across tasks.
- [x] No-commit rule stated in Global Constraints; no `git commit` steps.
- [x] `gh release create` only ever run by the user (Task 7 uses `-n` dry-run).
