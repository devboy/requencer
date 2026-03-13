# Parallel Placement Optimization

Run multiple placement algorithms in parallel, route each variant independently,
score the results, and keep the best routed board.

## Problem

The current placement script produces a single deterministic output per board.
If FreeRouting fails to complete routing (unconnected nets) or produces a
suboptimal result (excessive vias, long traces), the only option is manual
tweaking. Different component arrangements can produce dramatically different
routing outcomes, but we only ever try one.

## Solution

Three pluggable placement algorithms, each parameterized to produce 2-3 variants,
all running in parallel through placement → routing → scoring → selection.

## Architecture

### Strategy Interface

All placement algorithms implement the same protocol. The pipeline injects the
algorithm — strategies have no knowledge of the pipeline, Makefile, or scoring.

```python
@dataclass
class ComponentInfo:
    address: str          # atopile address (stable identifier)
    width: float          # footprint bounding box mm
    height: float
    is_tht: bool
    pin_count: int
    nets: list[str]       # connected net names (non-power)

@dataclass
class Placement:
    x: float              # center, mm
    y: float
    side: str             # "F" or "B"
    rotation: float       # degrees

@dataclass
class BoardContext:
    width: float
    height: float
    fixed: dict[str, Placement]       # address → locked position
    free: dict[str, ComponentInfo]    # address → needs placing
    net_graph: dict[str, list[str]]   # net → list of component addresses
    config: dict                      # board-config.json placement section

class PlacementStrategy(Protocol):
    def place(self, ctx: BoardContext, params: dict) -> dict[str, Placement]:
        """Return address → Placement for all free components."""
        ...
```

### Shared Helpers

Extracted from the existing `place_components.py` into a shared module, available
to all strategies:

- `CollisionTracker` — AABB collision detection, expanding ring search (`find_free`),
  largest free rectangle finder, repulsion, overlap reporting. Dual-side aware
  (THT occupies both sides, SMD only its own).
- `extract_footprint_dims(footprint) -> (width, height)` — bounding box from pcbnew
- `build_net_graph(board, power_threshold) -> dict[str, list[str]]` — net connectivity,
  filtering power nets by name pattern + fanout
- `connectivity_sort(components, net_graph) -> list[str]` — greedy BFS ordering by
  strongest connection to already-placed set
- `size_sort(components) -> list[str]` — largest bounding box first
- `estimate_hpwl(placements, net_graph) -> float` — half-perimeter wirelength estimate

### Fixed Components

Both boards have components locked to specific positions:

**Control board:** THT components positioned by faceplate layout (jacks, buttons,
encoders), plus named SMD positions from config (connector headers, MIDI opto).
All remaining SMDs (front and back) are free.

**Main board:** Bridge connector headers, USB-C, and BOOTSEL button are fixed.
All other components (MCU, DACs, op-amps, passives) are free.

Fixed positions come from `board-config.json` `named_positions` and
`panel-layout.json`. The strategy receives these as `BoardContext.fixed` and
must not move them.

## Algorithms

### 1. Constructive

The current approach, cleaned up behind the strategy interface. Places components
one at a time, choosing position via `CollisionTracker.find_free()` (expanding
ring search from a target position — typically centroid of connected components).

**What varies:**
- `order`: `"connectivity"` | `"size"` | `"module_grouped"` — determines which
  component is placed first. Most-connected-first clusters related components;
  largest-first reserves space for big ICs; module-grouped places by functional
  block.
- `padding`: extra clearance (mm) added to collision checks. Looser padding
  leaves routing channels but risks not fitting.

**Characteristics:** Fast (< 1s), deterministic, greedy (no backtracking).

### 2. Force-Directed

Models nets as springs pulling connected components together. Iterates force
equilibrium, then legalizes by snapping to collision-free positions.

**Flow:**
1. Initialize free components at centroid of their connected fixed neighbors
   (or board center if no fixed connections)
2. For N iterations: compute attraction forces (spring pull toward connected
   components) + repulsion forces (push apart when overlapping) → update positions
3. Clamp to board bounds
4. Legalize: use `CollisionTracker.find_free()` on each component, ordered by
   most-connected-first, to resolve remaining overlaps

**What varies:**
- `attraction`: spring constant for net connectivity pull
- `repulsion`: push strength for overlap prevention
- `iterations`: simulation steps (more = better convergence, diminishing returns)

**Characteristics:** Good at global wirelength minimization. Produces different
spatial arrangements than constructive since it optimizes simultaneously rather
than sequentially. Legalization step uses shared `CollisionTracker`.

### 3. Simulated Annealing Refinement

Generates its own constructive starting placement internally (no dependency on
another variant's output), then refines it by iteratively perturbing the solution.

**Move types:**
- **Displace**: pick a random free component, move to a random nearby position.
  Search radius scales with temperature (large moves early, small refinements late).
- **Swap**: pick two free components of similar footprint size, exchange positions.

**Acceptance:** Classic Metropolis criterion — always accept improvements, accept
worse solutions with probability `exp(-delta_cost / temperature)`.

**Cost function:** HPWL (estimated wirelength) — cheap to recompute incrementally
after each move.

**What varies:**
- `initial_temp`: starting temperature (higher = more exploration)
- `cooling_rate`: multiplier per step, 0.90–0.99 (slower cooling = better quality
  but more compute)
- `seed`: random seed for reproducibility

**Characteristics:** Can escape local optima that constructive gets stuck in.
Fully independent — generates its own starting state, runs in parallel with all
other variants.

## Variant Configuration

Variant definitions live in `board-config.json` so they're easy to tune without
code changes:

```json
{
  "placement": {
    "variants": [
      {"name": "constructive-a", "algorithm": "constructive", "params": {"order": "connectivity", "padding": 1.5}},
      {"name": "constructive-b", "algorithm": "constructive", "params": {"order": "size", "padding": 1.0}},
      {"name": "force-directed-a", "algorithm": "force_directed", "params": {"attraction": 1.0, "repulsion": 0.5, "iterations": 200}},
      {"name": "force-directed-b", "algorithm": "force_directed", "params": {"attraction": 2.0, "repulsion": 0.3, "iterations": 200}},
      {"name": "force-directed-c", "algorithm": "force_directed", "params": {"attraction": 1.0, "repulsion": 1.0, "iterations": 300}},
      {"name": "sa-refine-a", "algorithm": "sa_refine", "params": {"initial_temp": 5.0, "cooling_rate": 0.95, "seed": 42}},
      {"name": "sa-refine-b", "algorithm": "sa_refine", "params": {"initial_temp": 10.0, "cooling_rate": 0.90, "seed": 123}},
      {"name": "sa-refine-c", "algorithm": "sa_refine", "params": {"initial_temp": 5.0, "cooling_rate": 0.99, "seed": 7}}
    ]
  }
}
```

8 variants × 2 boards = 16 parallel jobs.

Per-board variant overrides are supported — add a `variants` key inside a
board's placement config to override the shared list. Falls back to the
top-level list if not specified.

## Scoring & Selection

### Post-routing scoring

After each variant is placed and routed through the existing autoroute pipeline
(FreeRouting + DRC), `select_best.py` evaluates the results.

**Disqualifying (variant rejected):**
- Any unconnected nets
- Any unexpected DRC errors

**Ranking (lower is better):**

| Metric | Source | Purpose |
|--------|--------|---------|
| Via count | `board.GetTracks()` via pcbnew | Fewer vias = better signal integrity, cheaper |
| Total trace length | Sum of track lengths from pcbnew | Shorter = less resistance, less crosstalk |
| DRC warnings | DRC JSON report | Tiebreaker |

**Selection logic:**
1. Reject variants with unconnected nets or unexpected DRC errors
2. Rank remaining by weighted score: `via_count * w1 + trace_length_mm * w2 + warnings * w3`
3. Copy winner's placed PCB to `{board}-placed.kicad_pcb` and routed PCB to
   `{board}-routed.kicad_pcb`
4. If **all** variants fail: fail the build. All routed PCB artifacts remain in
   `build/` for inspection.

Score weights are configurable in `board-config.json`.

## Pipeline Integration

### File naming

```
build/control-constructive-a.kicad_pcb         # placed variant
build/control-constructive-a-routed.kicad_pcb  # routed variant
build/control-constructive-a-drc.json          # DRC report
...
build/control-placed.kicad_pcb                 # winner (copy of best placed)
build/control-routed.kicad_pcb                 # winner (copy of best routed)
```

No staging files — the variant name *is* the staging identifier. The `-placed`
suffix is reserved for the selected winner.

### Makefile

```makefile
PARALLEL ?= 16
MAKEFLAGS += -j$(PARALLEL)

# Variant list — derived from board-config.json (single source of truth)
VARIANTS := $(shell python3 -c "import json; cfg=json.load(open('$(BOARD_CONFIG)')); print(' '.join(v['name'] for v in cfg['placement']['variants']))")

CONTROL_RESULT_FILES := $(patsubst %,$(BUILD)/control-%-result.json,$(VARIANTS))
MAIN_RESULT_FILES    := $(patsubst %,$(BUILD)/main-%-result.json,$(VARIANTS))

# Place a single variant
$(BUILD)/control-%.kicad_pcb: $(CONTROL_SRC) $(COMP_MAP) $(BOARD_CONFIG)
	python3 $(SCRIPTS)/placement/place_components.py --board control --variant $* $< $@

$(BUILD)/main-%.kicad_pcb: $(MAIN_SRC) $(BOARD_CONFIG)
	python3 $(SCRIPTS)/placement/place_components.py --board main --variant $* $< $@

# Route a single variant (writes {variant}-result.json, never exits non-zero)
$(BUILD)/control-%-result.json: $(BUILD)/control-%.kicad_pcb
	python3 $(SCRIPTS)/routing/autoroute.py $< $(BUILD)/control-$*-routed.kicad_pcb

$(BUILD)/main-%-result.json: $(BUILD)/main-%.kicad_pcb
	python3 $(SCRIPTS)/routing/autoroute.py $< $(BUILD)/main-$*-routed.kicad_pcb

# Score and select winners (grouped target — runs once, produces both files)
$(CONTROL_PLACED) $(CONTROL_ROUTED) &: $(CONTROL_RESULT_FILES)
	python3 $(SCRIPTS)/placement/select_best.py --board control --build-dir $(BUILD)

$(MAIN_PLACED) $(MAIN_ROUTED) &: $(MAIN_RESULT_FILES)
	python3 $(SCRIPTS)/placement/select_best.py --board main --build-dir $(BUILD)
```

`make -j16` runs all 16 placement+routing jobs in parallel. FreeRouting is the
bottleneck (~2-10 min per variant); placement is < 1s each.

**Memory consideration:** Each FreeRouting instance uses `-Xmx2g`. 16 parallel
instances = 32GB heap. Cap `PARALLEL` based on available RAM or let the user
override.

### Backward compatibility

The rest of the pipeline (ground pours → 3D → export) only sees
`control-placed.kicad_pcb` and `control-routed.kicad_pcb` — unchanged interface.
The variant files are build artifacts that can be cleaned with `make clean`.

## Code Structure

### New files

```
hardware/boards/scripts/
  placement/
    strategies/
      __init__.py              # Strategy registry + protocol
      constructive.py          # Algorithm 1
      force_directed.py        # Algorithm 2
      sa_refine.py             # Algorithm 3
    helpers.py                 # CollisionTracker, net graph, HPWL, sorts
    select_best.py             # Post-routing scoring + selection
  tests/
    conftest.py                # Shared fixtures (synthetic boards, mock nets)
    test_collision_tracker.py
    test_helpers.py
    test_constructive.py
    test_force_directed.py
    test_sa_refine.py
    test_select_best.py
```

### Modified files

- `place_components.py` — refactored to: parse args (including `--variant`),
  build `BoardContext`, look up strategy + params from config, call
  `strategy.place()`, write result to PCB via pcbnew. The 1588 lines of mixed
  concerns get split into strategy-specific modules + shared helpers.
- `board-config.json` — add `variants` list under `placement`
- `Makefile` — variant targets, parallel execution, selection step

### Post-placement step: UUID deduplication

Atopile's footprint library files contain hardcoded pad UUIDs that get cloned
into every instance. The existing `regenerate_duplicate_uuids()` function must
run on every variant PCB after placement and before routing. This is a shared
post-processing step in `place_components.py`, not part of any strategy.

### Also modified

- `autoroute.py` — two changes for parallel safety:
  1. **Routing failure handling**: Replace `sys.exit(1)` calls with a structured
     result. Write a `{variant}-result.json` with status (`pass`/`fail`), metrics
     (via count, trace length, DRC errors/warnings, unconnected count), and failure
     reason. `select_best.py` reads these files instead of depending on routed PCBs
     existing. Failed variants still produce partial PCB artifacts for inspection.
  2. **freerouting.json isolation**: Currently writes to `$TMPDIR` which is shared
     across all parallel instances (race condition). Move `freerouting.json` into the
     per-variant `work_dir` (already created via `tempfile.TemporaryDirectory()`).

### Unchanged

- `import_ses.py`, `add_ground_pours.py`, `design_rules.py` — no changes
- `export_layout.py` — runs on the winner only

## Testing

### Unit tests (pytest)

- **CollisionTracker**: register, collide, find_free, overlap_report with
  known rectangles. Dual-side rules (THT vs SMD).
- **Helpers**: build_net_graph with mock board, connectivity_sort ordering,
  HPWL calculation with known geometry.
- **Constructive**: synthetic 5-component board, verify all placed, no overlaps,
  fixed components unmoved, different orders produce different layouts.
- **Force-directed**: same synthetic board, verify convergence (HPWL decreases),
  no overlaps after legalization.
- **SA refinement**: verify HPWL improves over starting state, fixed components
  unmoved, deterministic with same seed.
- **select_best**: mock DRC reports — disqualification logic, ranking, all-fail
  exit code.

### Integration test

End-to-end: run all variants for a board, verify the winner is copied and the
pipeline continues. Can be slow — run separately from unit tests.

### Running

```makefile
# In top-level Makefile
test-hw:
	cd hardware/boards && python -m pytest scripts/tests/ -v
```

Wire into `make test` alongside Rust + web tests.

## Parallelism Safety

- **Process isolation**: each variant runs as a separate `python3` process
  invoked by Make. No shared pcbnew state, no threading concerns.
- **freerouting.json**: must be written to the per-variant temp directory, not
  the shared `$TMPDIR`. Without this, parallel FreeRouting instances read each
  other's config files (race condition).
- **SES route cache**: keyed by DSN content hash. Different placements produce
  different DSN files, so cache collisions between variants are not possible.
  Re-running the same variant reuses its cached route — this is intentional.
  Changing variant params in config without changing the placement output will
  not bust the cache (the DSN is what matters, not the config).

## Risks

- **FreeRouting memory**: 16 parallel instances × 2GB = 32GB. Mitigated by
  configurable `PARALLEL` and documentation.
- **All variants fail**: Possible on congested boards. Build fails loudly with
  all artifacts preserved for inspection.
- **SA convergence**: Too few iterations = no improvement over constructive.
  Default parameters tuned for 50-100 component boards; configurable if needed.
- **Force-directed legalization**: Overlap removal can undo global optimization
  if many components cluster in one area. Mitigated by ordering legalization
  by connectivity (most-connected placed first, least-connected adjusts).
- **Force-directed initialization clustering**: many free components sharing
  the same fixed neighbors start at the same point. Mitigated by adding small
  seeded random jitter around centroids during initialization.
