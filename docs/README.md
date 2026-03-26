# Requencer Docs

Design documents and research notes for Requencer development.

## Plans (Active)

- **[feature-roadmap.md](plans/2026-03-01-feature-roadmap.md)** — Feature tiers (all complete) + future/unscheduled items
- **[quality-audit.md](plans/2026-03-03-quality-audit.md)** — Performance baselines, coverage stats, refactoring opportunities
- **[firmware-implementation.md](plans/2026-03-06-firmware-implementation.md)** — RP2350 firmware roadmap (active development)
- **[persistence.md](plans/2026-03-06-persistence.md)** — Postcard serialization plan (web done, firmware SD card pending)
- **[rp2350-memory-constraints.md](plans/2026-03-06-rp2350-memory-constraints.md)** — Memory budget analysis for RP2350
- **[hardware-pipeline-remaining-todos.md](plans/2026-03-07-hardware-pipeline-remaining-todos.md)** — Pipeline status & known issues
- **[main-board-resize.md](plans/2026-03-12-main-board-resize.md)** — Shrink main board (partially implemented)
- **[parallel-placement-optimization.md](plans/2026-03-13-parallel-placement-optimization.md)** — 5-strategy parallel placement architecture
- **[pcb-stacking-restructure.md](plans/pcb-stacking-restructure.md)** — Three-board sandwich architecture (implemented)
- **[rust-engine-remaining-todos.md](plans/rust-engine-remaining-todos.md)** — Storage, cross-validation, firmware integration

## Superpowers Plans & Specs (Active)

- **[placement-strategy-refactor](superpowers/plans/2026-03-15-placement-strategy-refactor.md)** — BoardState toolkit architecture (implemented)
- **[wavefront-placement-design](superpowers/specs/2026-03-17-wavefront-placement-design.md)** — BFS wave placement strategy (implemented)
- **[display-replacement-design](superpowers/specs/2026-03-16-display-replacement-design.md)** — ST7796 32-pin FPC migration (implemented)
- **[placement-strategy-refactor-design](superpowers/specs/2026-03-15-placement-strategy-refactor-design.md)** — Config-driven placement design (implemented)

## Research (Active)

**Hardware reference:**
- [mechanical-standards](research/eurorack-mechanical-standards.md), [pcb-best-practices](research/eurorack-pcb-best-practices.md) — Eurorack specs
- [continuous-cv-outputs](research/continuous-cv-outputs.md) — CV output design for firmware
- [pcb-stacking](research/pcb-stacking.md) — Three-board sandwich depth budget & connectors
- [component-mounting-depths](research/component-mounting-depths.md) — Physical depth specs for panel-mounted parts
- [faceplate-connectors](research/faceplate-connectors.md) — USB-C & MicroSD front-panel placement
- [thermal-placement-analysis](research/thermal-placement-analysis.md) — Power dissipation & thermal gradients

**Design reference:**
- [sequencer-comparison](research/sequencer-comparison.md) — Competitor analysis
- [feature-ideas](research/feature-ideas.md) — Feature brainstorm with implementation status
- [3d-assembly-viewer](research/3d-assembly-viewer.md) — Three.js exploded view (planned)
- [3d-preview-rendering](research/3d-preview-rendering.md) — Studio-quality 3D rendering (aspirational)

**Audits:**
- [schematic-review-2026-03-16](research/schematic-review-2026-03-16.md) — Pre-production audit (all fixes applied)
- [pcb-placement-review](research/pcb-placement-review.md) — Component placement audit

**Sourcing:**
- [aliexpress-parts-sourcing](research/aliexpress-parts-sourcing.md) — THT parts sourcing (all ordered)
- [github-actions-autoroute-timeout](research/2026-03-07-github-actions-autoroute-timeout.md) — FreeRouting CI workarounds

## Archive

Completed feature plans, superseded research, and historical design decisions. See [`archive/`](archive/) directory.
