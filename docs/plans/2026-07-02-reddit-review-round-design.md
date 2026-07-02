# Reddit Review Round — Design

**Goal:** Get the repo, website, and artifacts into shape for a Reddit post asking the
synth-DIY community to review the hardware design before manufacturing. All tests pass
locally; what's missing is presentation, up-to-date docs, downloadable KiCad artifacts,
and a clear review ask.

**Date:** 2026-07-02

---

## 1. Single-source manual — `docs/manual.md`

One markdown file is the user manual for both GitHub and the web app. Written
**mouse/touch-first**; keyboard shortcuts are a short, low-priority section at the end.

Structure:

1. **What is this?** — 4-track eurorack-style step sequencer; live-performance backstory
   (replaces 4 sequencers + utility modules); polymetric randomization concept.
2. **Quick start (mouse & touch)** — click buttons to interact; press-and-hold a button
   while pressing another for hold combos; **double-click any holdable button for sticky
   hold** (one-handed operation — click again or click elsewhere to release); drag or
   scroll on encoders to turn them, click to push; everything works on touch screens
   (multi-touch combos supported).
3. **Tracks & subtracks** — 4 tracks × 4 subtracks (gate/pitch/velocity/mod), each with
   independent length (1–64) and clock divider → polymeter.
4. **Randomizer** — the hierarchy first: randomize *everything*, *one track*, or *one
   subtrack layer* (hold track or subtrack button + RAND). Then per-track config (scale,
   root, range, density, velocity), the four gate algorithms (RAND/EUCL/SYNC/CLST), and
   the 8 factory presets + saving custom presets.
5. **Drift** — per-subtrack stochastic mutation over time.
6. **Transpose** — per-track semitone offset, range, scale quantization.
7. **Routing** — any subtrack output to any of the 4 output jacks.
8. **Mute & patterns** — mute screen, pattern screen.
9. **Settings** — BPM, clock source (INT/MIDI/EXT), MIDI device/channels.
10. **Keyboard shortcuts** — brief: "every control also has a key; press `?` in the app
    for the full keymap." No full table here (the in-app `?` modal remains the reference).

### Consumption

- **Web app:** `instructions-modal.ts` imports the file at build time via Vite
  `?raw` (`import manual from '../../../docs/manual.md?raw'`) and renders it with
  **`marked`** (new dependency in `web/package.json`). The hardcoded `SECTIONS` array is
  deleted. Modal styling stays as-is; markdown output is styled with a small scoped CSS
  block (headings, paragraphs, lists, `<strong>`).
- **README:** links to `docs/manual.md` (GitHub renders it natively). No duplicated
  manual content remains in the README.

### Testing

- Unit test: modal renders headings/sections from the imported markdown (jsdom).
- Existing modal toggle tests keep passing.

## 2. README rewrite

New structure, top to bottom:

1. Pitch (2–3 sentences) + screenshot + **Try it live** link.
2. **⚡ Help wanted: hardware design review** — what the module is electrically
   (RP2350, DAC8568 CV outs, three-board stack, eurorack power), links to: schematic
   review PDFs, the GitHub Release with KiCad files, and the live demo. States what
   feedback is sought and that the design has not been manufactured yet.
3. Features overview (short prose, no key tables) + link to `docs/manual.md`.
4. Architecture summary (Rust crates, TS web preview, hardware dirs) — condensed from
   CLAUDE.md wording.
5. Development commands (`make dev`, `make test`, …).
6. License section (MIT code / CERN-OHL-S hardware).

## 3. In-app discoverability

- Always-visible **"MANUAL"** and **"?"** buttons on the page (small fixed control near
  the panel, matching the existing debug-menu aesthetic) wired to `toggleInstructions()`
  and `toggleHelp()`. Debug-menu entries stay.
- **First-visit auto-open:** on load, if `localStorage['requencer-manual-seen']` is
  unset, open the manual modal and set the flag. Closing works as today (click outside /
  any key).

## 4. KiCad artifacts — `make release-artifacts`

CI cannot build hardware, so artifacts are built locally and published as a GitHub
Release via `gh` CLI. **Claude builds the tooling; the user runs it** (no commits, tags,
or releases made by Claude).

- New script `hardware/boards/scripts/export/package_release.py` (plain `python3`, no
  pcbnew — handles prereq checks, README.txt generation, and zip assembly) that assembles
  `build/release/requencer-hardware-<tag>.zip` containing:
  - `kicad/control/` — `control-poured.kicad_pcb` + `.kicad_pro`/`.kicad_prl`
  - `kicad/main/` — same for main
  - `kicad/faceplate/` — faceplate KiCad project
  - `review/` — `control.pdf`, `main.pdf` from the schematic review pack
  - `manufacturing/` — gerber/BOM outputs from `make export`
    (`build/manufacturing/{control,main,faceplate}`)
  - `3d/` — STEP files
  - `README.txt` — what's inside, which KiCad version, pointer to the repo/post
- Target lives in `hardware/Makefile` with a top-level `make release-artifacts`
  passthrough: `make release-artifacts TAG=hw-review-r1` →
  builds zip, then `gh release create <TAG> <zip> --title … --notes-file …`
  (idempotent-ish: fail with a clear message if the tag exists; `gh release upload
  --clobber` for re-runs).
- Prereq check: fail early with a readable error if expected inputs
  (poured PCBs, review PDFs, manufacturing exports) are missing, telling the user which
  make target produces them.
- The untracked `hardware/boards/scripts/review/` module and its plan doc get committed
  **by the user** as part of this round.

## 5. Licenses

- `LICENSE` (repo root): MIT, copyright Dominic Graefen — covers all code.
- `hardware/LICENSE`: CERN-OHL-S v2 — covers hardware design files (`hardware/`).
- README license section explaining the split.

## 6. Reddit post draft + link previews

- `docs/reddit-post.md`: 2–3 title options; body with: what the module is, live demo
  link, one-paragraph architecture, **specific review asks** (eurorack power entry &
  regulators, DAC8568 output stage / 1V-oct scaling & offset, board-to-board connector
  pinout & stackup, USB-C, SD card, MIDI input circuit, anything the production-check
  can't catch), links to release zip / review PDFs / repo, and a note that it's
  open-source (MIT + CERN-OHL-S). Target subs noted: r/synthdiy, r/modular,
  r/AskElectronics (crosspost etiquette: tailor the ask).
- `web/index.html`: proper `<title>` ("Requencer — 4-track polymetric eurorack
  sequencer"), meta description, Open Graph + Twitter card tags using
  `docs/screenshot.png` (copied/served as a static asset in `web/public/` so the
  deployed site can reference it with an absolute URL).

## Out of scope

Demo GIF/video, hardware CI builds, changes to the review-pack renderer itself,
faceplate review PDF (mostly mechanical), engine/firmware changes.

## Error handling

- Release target: hard fail with actionable message on missing artifacts or existing tag.
- Manual import: build-time — a missing `docs/manual.md` fails the Vite build (desired).

## Testing summary

- `make web` (tests + lint + build) green after modal/manual changes.
- New jsdom test for markdown-rendered modal.
- `make release-artifacts` dry-run path verified locally (zip contents listed); the
  actual `gh release create` is exercised by the user.
