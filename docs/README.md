# Requencer Docs

Design documents and research notes for Requencer development.

## Plans (Active)

- **[requencer-design.md](plans/2026-02-22-requencer-design.md)** — Core architecture & feature spec (V1 + post-V1 complete)
- **[feature-roadmap.md](plans/2026-03-01-feature-roadmap.md)** — Feature tiers (all complete) + future/unscheduled items
- **[quality-audit.md](plans/2026-03-03-quality-audit.md)** — Performance baselines, coverage stats, refactoring opportunities
- **[firmware-implementation.md](plans/2026-03-06-firmware-implementation.md)** — RP2350 firmware roadmap (next major milestone)
- **[persistence-design.md](plans/2026-03-06-persistence-design.md)** + **[plan](plans/2026-03-06-persistence.md)** — Postcard serialization (web done, firmware pending)
- **[missing-hardware-components](plans/2026-03-06-missing-hardware-components-design.md)** + **[plan](plans/2026-03-06-missing-hardware-components.md)** — 3 remaining parts + footprint fixes
- **[rp2350-memory-constraints.md](plans/2026-03-06-rp2350-memory-constraints.md)** — Memory budget analysis for RP2350
- **[hardware-pipeline-remaining-todos.md](plans/2026-03-07-hardware-pipeline-remaining-todos.md)** — Pipeline status & known issues
- **[rust-engine-remaining-todos.md](plans/rust-engine-remaining-todos.md)** — Storage, cross-validation, firmware integration

## Research (Active)

**Hardware reference:**
- [eurorack-dimensions](research/eurorack-dimensions.md), [mechanical-standards](research/eurorack-mechanical-standards.md), [pcb-best-practices](research/eurorack-pcb-best-practices.md) — Eurorack specs
- [qfn-rp2350-research](research/2026-03-06-qfn-rp2350-research.md) — QFN package research for PGA2350
- [continuous-cv-outputs](research/continuous-cv-outputs.md) — CV output design for firmware

**Design reference:**
- [sequencer-comparison](research/sequencer-comparison.md) — Competitor analysis
- [feature-ideas](research/feature-ideas.md) — Feature brainstorm with implementation status
- [storage-options](research/storage-options.md) — Storage strategy (decision: postcard + SD card + flash)

**Infrastructure:**
- [hardware-strategy](research/hardware-strategy.md) — Prototype timeline & pipeline
- [rust-wasm-engine-renderer](research/rust-wasm-engine-renderer.md) — Rust/WASM architecture (Phase 1+3 complete)
- [china-pcb-ordering](research/china-pcb-ordering.md) — PCB fab ordering info
- [github-actions-autoroute-timeout](research/2026-03-07-github-actions-autoroute-timeout.md) — CI autoroute workaround

## Archive

Completed feature plans and superseded research. See [`archive/`](archive/) directory.
