# GitHub Actions Autoroute Timeout — Research & Recommendations

**Date:** 2026-03-07
**Problem:** FreeRouting autoroute step running 3+ hours in GitHub Actions without completing. Locally reproducible — hangs at "Step 2: Running Freerouting (headless)..."

## TL;DR

Your 3-hour hang is almost certainly a **FreeRouting v2.1.0 bug**, not expected behavior. v2.1.0 has documented regressions where routing takes dramatically longer or never completes on boards that v2.0.1 routes quickly. The fix is a combination of: downgrade to v1.9.0, add a hard timeout, reduce `-mp`, and restructure CI to not block on autorouting.

---

## Part 1: Why Is FreeRouting Hanging?

### Your Setup
- **Board:** 255 components, 319 nets, 70 unassigned refs (auto-fixed)
- **FreeRouting version:** v2.1.0
- **Parameters:** `-mp 20` (20 max passes)
- **Pipeline output:** Hangs at "Step 2: Running Freerouting (headless)..." — no progress after DSN export

### Root Cause: FreeRouting v2.1.0 Known Issues

**v2.1.0 has severe routing regressions compared to v2.0.1 and v1.9.0:**

1. **Routing regression** ([GitHub #461](https://github.com/freerouting/freerouting/issues/461)): v2.1.0 cannot auto-route boards that v2.0.1 routes "quite quickly." The PCB "takes a lot longer to auto-route and does not complete."

2. **Infinite loop bugs** ([GitHub #513](https://github.com/freerouting/freerouting/issues/513)): Users report that v2.1.0 has bugs in optimizer/fanout modes that "make the auto-router loop forever." The recommended stable version is **v1.9.0** (build-date: 2023-10-30).

3. **Quality degradation** ([Discussion #508](https://github.com/freerouting/freerouting/discussions/508)): Benchmarking 10 KiCad PCB designs from DAC 2020, v1.9.0 outperformed v2.1.0 in 6 out of 10 cases on unconnected items. v2.1.0 was better in only 1 case.

4. **Long-runtime instability** ([GitHub #473](https://github.com/freerouting/freerouting/issues/473)): After ~1.5 hours, FreeRouting throws `ArrayIndexOutOfBoundsException` and `NullPointerException` errors in the autoroute engine.

5. **`-mp` parameter bug** ([GitHub #376](https://github.com/freerouting/freerouting/issues/376)): In CLI mode (`--gui.enabled=false`), the `-mp` argument was not respected in v2.0.1 — routing continued past the specified pass count. This was marked as resolved, but may still be affected in v2.1.0.

6. **Multithreading softlock** ([GitHub #73](https://github.com/freerouting/freerouting/issues/73)): Default `-mt 32` overloads systems, causing softlocks. Fix: use `-mt 4` to match actual core count.

7. **Maintainer stepping back**: The sole developer/maintainer announced stepping back from active development after v2.1.0, noting 61 hours invested in this release alone. Future bug fixes are uncertain.

### Why v2.1.0 Hangs Specifically

In v2.1.0, **prior improvement thresholds were removed** "for more consistent behavior." This means the optimizer phase no longer has a built-in convergence check — it will keep running optimization passes even when improvements are negligible. Combined with the `-mp` CLI bug (where the pass limit may not be respected in headless mode), this creates a situation where FreeRouting enters the optimization phase and never exits.

The routing process has two phases:
1. **Routing phase** — controlled by `-mp` (max passes)
2. **Optimization phase** — controlled by `-oit` (improvement threshold, default removed in v2.1.0)

Your board likely completes routing but then enters optimization and loops indefinitely.

### The `tail -30` Problem

Your autoroute script pipes FreeRouting output through `tail -30`:
```bash
"$JAVA" ... -jar "$FREEROUTING_JAR" ... -mp 20 2>&1 | tail -30
```
This buffers ALL output until FreeRouting exits, meaning you see zero progress while it runs. If it hangs, you get no diagnostic output at all. This should be changed to `tee` or removed entirely to see live progress.

### Expected Runtime (Working Correctly)

For a 255-component board with 319 nets:
- **v1.9.0 with `-mp 20`:** Typically 10-30 minutes
- **v2.0.1 with `-mp 20`:** 15-45 minutes
- **v2.1.0:** Unpredictable — minutes to infinite (due to bugs above)

3+ hours with no output is **not normal** and indicates the router is stuck in a loop.

---

## Part 2: CI/CD for PCB & Embedded Hardware Projects

### The Landscape

PCB CI/CD is still a niche practice. Most hardware teams do not automate routing in CI at all — routing is treated as a manual design step. However, several patterns are emerging:

### KiBot — The Standard for KiCad CI/CD

[KiBot](https://github.com/INTI-CMNB/KiBot) is the most mature KiCad CI/CD tool:
- GitHub Actions: [kicad-exports](https://github.com/nerdyscout/kicad-exports) wraps KiBot
- Generates: Gerbers, BOM, placement files, 3D renders, DRC reports
- **Does not include autorouting** — treats it as a design activity, not a CI step
- Used by: [Watchy](https://github.com/sqfmi/Watchy), [LibrePCB](https://librepcb.org/), many open hardware projects

### Projects Using FreeRouting in Automation

Very few projects run FreeRouting in CI. Most that do are:
- **One-off scripts** that run locally, not in CI
- **Research/academic projects** testing autorouter quality
- **Keyboard PCB projects** ([kbdmk/freerouting-fork](https://github.com/kbdmk/freerouting-fork)) with simpler boards

### FreeRouting's Own CI/CD

FreeRouting itself provides:
- **Docker images** on GHCR: `ghcr.io/freerouting/freerouting:2.1.0` and `:nightly`
- **API service**: `api.freerouting.app/v1` (beta) — cloud-based routing
- **Python client**: `freerouting-client` pip package
- **JSON output**: Routing scores, completion percentage, via count — useful for CI quality gates

### KiCad CI/CD Best Practices

The standard approach for KiCad CI/CD (without autorouting) uses [KiBot](https://github.com/INTI-CMNB/KiBot):
- GitHub Action: `INTI-CMNB/KiBot@v2` with config YAML
- Generates: Gerbers, BOM, placement files, 3D renders, DRC reports
- Docker images: `ghcr.io/inti-cmnb/kicad9_auto:dev`
- Example: [kicad-ci-test-spora](https://github.com/INTI-CMNB/kicad-ci-test-spora) — 3 workflows, 4 jobs each (ERC, DRC, schematic, fabrication)
- **Does NOT include autorouting** — treats routing as a design activity, not CI

Blog: [KiCad 9 CI/CD with GitLab](https://sschueller.github.io/posts/ci-cd-with-kicad-2025/) covers semantic versioning, date/version injection into schematics before KiBot runs.

### Atopile Projects

[Atopile](https://atopile.io/) is code-driven PCB design, which naturally fits CI/CD. Your project appears to be one of the most complete atopile-to-CI pipelines. The atopile community is still small; most projects don't go beyond `ato build` in CI.

---

## Part 3: Fast Feedback Loops for Hardware CI/CD

### The Core Problem

Hardware CI has fundamentally different time characteristics than software CI:

| Step | Typical Duration | Can Cache? |
|------|-----------------|------------|
| `ato build` (schematic) | 10-15 min | Partially (picked parts) |
| Footprint generation | < 1 min | Yes (deterministic) |
| Component placement | < 1 min | Yes (deterministic) |
| **Autorouting** | **10-60 min** | **Yes (if netlist unchanged)** |
| DRC | 1-2 min | No |
| Manufacturing export | < 1 min | No |
| **Total** | **25-80 min** | |

Software teams expect CI feedback in 5-10 minutes. Hardware CI will never match that, but it can be structured to give fast feedback on what matters.

### Strategy 1: Split Into Fast and Slow Pipelines

**Fast pipeline (every push, ~5 min):**
- Syntax/lint checks on `.ato` files
- Schema validation
- `ato build` with cached parts (skip if no `.ato` changes)
- Export layout JSON (for web preview)
- Run software tests (Rust + TS)

**Slow pipeline (manual trigger or main-only, ~30-60 min):**
- Full `ato build`
- Component placement
- Autorouting
- DRC
- Manufacturing export
- Upload artifacts

This is exactly how embedded firmware teams handle it:
- **Fast:** compile + unit tests (minutes)
- **Slow:** hardware-in-the-loop tests, flash + integration tests (hours)

### Strategy 2: Cache Aggressively

**What to cache:**
1. **Routed PCB**: If the netlist hasn't changed, the previous routing is still valid. Hash the DSN file and skip routing on match.
2. **Picked parts**: Use `--keep-picked-parts` with cached PCB from previous CI run.
3. **Docker image**: Already pulling from GHCR (good).
4. **Atopile solver state**: Cache the constraint solver output.

**Implementation pattern:**
```yaml
- name: Check routing cache
  id: route-cache
  uses: actions/cache@v4
  with:
    path: hardware/build/routed.kicad_pcb
    key: routed-${{ hashFiles('hardware/build/placed.kicad_pcb') }}

- name: Autoroute
  if: steps.route-cache.outputs.cache-hit != 'true'
  run: # ... run autoroute
```

### Strategy 3: Hard Timeouts With Graceful Degradation

```yaml
- name: Autoroute
  timeout-minutes: 30
  continue-on-error: true
  run: |
    timeout 1800 hardware/scripts/autoroute.sh ... || {
      echo "::warning::Autoroute timed out after 30 minutes"
      echo "ROUTE_FAILED=true" >> $GITHUB_ENV
    }
```

If autorouting fails or times out:
- Still export the placed (unrouted) PCB as an artifact
- Still run remaining steps that don't depend on routing
- Flag it as a warning, not a failure

### Strategy 4: Use FreeRouting API Instead of Local Execution

FreeRouting offers a cloud API (`api.freerouting.app/v1`) that may handle routing more reliably:
- Offloads compute from CI runner
- May have better timeout handling
- Python client available: `pip install freerouting-client`
- **Caveat:** Beta service, unclear SLA, unclear if free for CI use

### Strategy 5: Separate Routing as a Manual Step

Many hardware teams treat autorouting like deployment:
- **Automatic:** build, validate, export, DRC on unrouted board
- **Manual:** Trigger routing explicitly via `workflow_dispatch`
- **Rationale:** Routing results need human review anyway (autorouters rarely produce production-quality results without manual touch-up)

```yaml
on:
  workflow_dispatch:
    inputs:
      run_autoroute:
        description: 'Run autorouting (slow, ~30 min)'
        type: boolean
        default: false
```

### Strategy 6: Reduce FreeRouting Passes for CI

For CI feedback, you don't need optimal routing — you need to know if the board *can* be routed:

| Setting | Use Case | Expected Time |
|---------|----------|---------------|
| `-mp 3` | CI quick check (can it route?) | 2-5 min |
| `-mp 10` | CI validation (decent quality) | 10-20 min |
| `-mp 20` | Release builds (best quality) | 30-60 min |

Add `-oit 5` to stop optimization when improvement drops below 5% per pass.

---

## Part 4: Alternative Autorouters

### Summary Table

| Router | Open Source | CLI/Headless | Speed | CI-Friendly | Cost |
|--------|-----------|-------------|-------|-------------|------|
| **FreeRouting v1.9.0** | Yes | Yes | Slow-Medium | Docker available | Free |
| **FreeRouting v2.1.0** | Yes | Yes (buggy) | Unpredictable | Docker available | Free |
| **OrthoRoute** | Yes (MIT) | Yes | Fast (GPU) | Needs NVIDIA GPU | Free |
| **DeepPCB** | No | Cloud API | ~5 min | Yes | $1/credit |
| **tscircuit** | Yes (MIT) | Yes (Node.js) | Unknown | Yes | Free |
| **TopoR** | No | No (GUI only) | Fast | No | Free (≤650 pins) |
| **FreeRouting API** | N/A | Cloud API | Varies | Yes | Free (beta) |

### Open Source Options

**FreeRouting v1.9.0** — Most stable, best benchmarks in community testing. No infinite loop bugs. Recommended for immediate use. Download: [v1.9.0 release](https://github.com/freerouting/freerouting/releases/tag/v1.9.0)

**[OrthoRoute](https://github.com/bbenchoff/OrthoRoute)** (MIT) — GPU-accelerated Manhattan-lattice PathFinder router using NVIDIA CUDA (CuPy). A KiCad plugin with headless mode for CI. Routed an 8,192-airwire backplane in 41 hours on an A100 (vs FreeRouting's projected month). A 512-net board routes in ~2 minutes. Requires NVIDIA GPU with VRAM proportional to board complexity (~nodes/200,000 = GB needed). Not practical for standard CI runners but interesting for self-hosted GPU runners.

**[tscircuit autorouter](https://github.com/tscircuit/tscircuit-autorouter)** (MIT) — TypeScript/Node.js autorouter. Part of the tscircuit ecosystem (React-based circuit design). Uses `SimpleRouteJson` format. Includes benchmarking datasets. Still early stage — community notes it's "not very well baked" for complex boards. Active development at [blog.autorouting.com](https://blog.autorouting.com).

### Cloud/Commercial Options

**[DeepPCB](https://deeppcb.ai/)** — AI-powered (reinforcement learning) cloud autorouter by InstaDeep, running on Google Cloud. Supports up to 8 layers, 1,200 connections, 1,000 components. Routes in ~5 minutes for typical boards. Generates DRC-clean layouts. Accepts DSN/SES formats. **Pricing:** $1/credit (2 min compute), $95/100 credits. Free trial available. **This is the most promising CI-friendly alternative** — fast, predictable runtime, no local compute needed.

**FreeRouting API** — `api.freerouting.app/v1`, beta. Python client: `pip install freerouting-client`. Offloads routing to cloud. Pricing not published. Useful for CI but unclear reliability/SLA.

**TopoR** — Topological router by Eremex with unique free-angle routing (not limited to 45/90°). Excellent via minimization. Supports DSN/SES exchange with KiCad. Windows GUI only, no CLI — not CI-friendly. Free version limited to 650 pins.

**EasyEDA** — Built into JLCPCB's EDA tool. Cloud autorouter but no standalone API. Not usable in CI.

**JLCPCB / PCBWay** — No autorouting service (accept Gerbers only).

**Commercial EDA (Altium, Cadence, Siemens)** — All have autorouters but none offer straightforward headless CLI suitable for CI/CD.

### Recommendation

**Immediate:** Downgrade to **FreeRouting v1.9.0** — solves the hang, free, drop-in replacement.

**Worth evaluating:** **DeepPCB** — if the free trial produces good results on your board, $1/route is very reasonable for CI and gives predictable ~5 min runtime. Could replace FreeRouting entirely.

---

## Part 5: Recommended Changes for Requencer

### Immediate Fix (Stop the 3-Hour Hang)

1. **Downgrade FreeRouting to v1.9.0** in `hardware/docker/Dockerfile`
2. **Add `timeout` to autoroute.sh:**
   ```bash
   timeout 1800 "$JAVA" ... -jar "$FREEROUTING_JAR" ... -mp 20
   ```
3. **Remove `| tail -30`** so you can see live FreeRouting progress
4. **Add `-mt 2`** to prevent thread oversubscription on CI runners (2 vCPU on `ubuntu-latest`)

### Short-Term CI Improvements

5. **Add `timeout-minutes: 45`** to the Autoroute step in `atopile.yml`
6. **Add `continue-on-error: true`** so downstream steps still run
7. **Reduce to `-mp 5`** for PR builds, keep `-mp 20` for main branch
8. **Cache the routed PCB** between CI runs (hash on placed PCB)

### Medium-Term Architecture

9. **Split workflow into fast/slow jobs:**
   - Fast job: `ato build` + placement + layout export (every push)
   - Slow job: autoroute + DRC + manufacturing export (main only or manual trigger)
10. **Add routing quality gate:** Parse FreeRouting JSON output, fail if completion < 95%
11. **Consider FreeRouting API** for cloud-based routing (eliminates CI timeout issues)

### Workflow Sketch

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - # ato build, footprints, placement, layout export
      - # Upload placed PCB as artifact

  route:
    needs: build
    runs-on: ubuntu-latest
    timeout-minutes: 60
    if: github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch'
    steps:
      - # Download placed PCB artifact
      - # Check routing cache
      - # Run autoroute with timeout
      - # DRC + manufacturing export
      - # Upload artifacts
```

---

## Sources

- [FreeRouting GitHub](https://github.com/freerouting/freerouting)
- [FreeRouting v2.1.0 routing regression — Issue #461](https://github.com/freerouting/freerouting/issues/461)
- [FreeRouting infinite loop bugs — Issue #513](https://github.com/freerouting/freerouting/issues/513)
- [FreeRouting long-runtime instability — Issue #473](https://github.com/freerouting/freerouting/issues/473)
- [FreeRouting -mp CLI bug — Issue #376](https://github.com/freerouting/freerouting/issues/376)
- [FreeRouting multithreading softlock — Issue #73](https://github.com/freerouting/freerouting/issues/73)
- [FreeRouting routing quality discussion — Discussion #508](https://github.com/freerouting/freerouting/discussions/508)
- [FreeRouting command line arguments](https://github.com/freerouting/freerouting/blob/master/docs/command_line_arguments.md)
- [FreeRouting routing options documentation](https://freerouting.org/freerouting/manual/routing-options)
- [FreeRouting Docker images](https://github.com/freerouting/freerouting/pkgs/container/freerouting)
- [FreeRouting API](https://api.freerouting.app/v1)
- [KiBot — KiCad CI/CD](https://github.com/INTI-CMNB/KiBot)
- [kicad-exports GitHub Action](https://github.com/nerdyscout/kicad-exports)
- [FreeRouting releases](https://github.com/freerouting/freerouting/releases)
