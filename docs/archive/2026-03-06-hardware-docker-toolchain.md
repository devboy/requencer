# Hardware Docker Toolchain

## Problem

The hardware build pipeline requires multiple tools (atopile, KiCad, FreeRouting/Java) that are:
- Platform-specific to install (KiCad.app on macOS, apt on Linux)
- Different between local (ARM macOS) and CI (x86_64 Linux)
- Hardcoded paths in Makefile (`/Applications/KiCad/...`)

## Proposal: Multi-arch Docker Image

Build a single Docker image containing all tools, published as both `linux/arm64` and `linux/amd64`.

### Image contents

```dockerfile
# Base: Ubuntu 24.04 (has good KiCad PPA support)
FROM ubuntu:24.04

# 1. KiCad 9 (headless, no GUI)
#    - kicad-cli for gerber/drill export
#    - python3-pcbnew for DSN export/SES import
#    PPA: ppa:kicad/kicad-9.0-releases

# 2. Atopile
#    - pip install atopile>=0.14

# 3. FreeRouting
#    - OpenJDK 21 (headless)
#    - freerouting-2.1.0.jar downloaded from GitHub releases

# 4. Python scripts from repo (mounted at runtime)
```

### Key considerations

**KiCad headless works** — confirmed during this session:
- `import pcbnew` works without wx/GUI
- `ExportSpecctraDSN()` / `ImportSpecctraSES()` work headlessly
- `kicad-cli` is fully headless
- The `wx.App()` assertion can be ignored (prints warning, doesn't crash)

**pcbnew quirk**: `ExportSpecctraDSN` fails silently when footprints have duplicate `REF**` refs. Our `autoroute.sh` already fixes this at export time.

**atopile quirk**: `ato build` fails on second run if stale layout has `REF**` duplicates. Must delete layout before rebuild (`rm -f elec/layout/default/default.kicad_pcb`).

### Usage

```makefile
# Makefile
HW_IMAGE := ghcr.io/devboy/requencer-hw-tools:latest

hw-docker-build:
    docker build -t $(HW_IMAGE) --platform linux/$(shell uname -m) hardware/docker/

hw-all:
    docker run --rm -v $(PWD):/work -w /work $(HW_IMAGE) make hw-all-inner

hw-all-inner:  # runs inside container
    rm -f hardware/elec/layout/default/default.kicad_pcb
    cd hardware && ato build
    python3 hardware/scripts/generate_footprints.py
    python3 hardware/scripts/place_components.py $(PCB_SRC) $(PCB_PLACED)
    hardware/scripts/autoroute.sh $(PCB_PLACED) $(PCB_ROUTED)
    python3 hardware/scripts/export_manufacturing.py $(PCB_ROUTED) $(MFG_DIR)
```

### Multi-arch build

```bash
# Build for both architectures (push to GHCR)
docker buildx build --platform linux/arm64,linux/amd64 \
  -t ghcr.io/devboy/requencer-hw-tools:latest \
  --push hardware/docker/
```

### GitHub Actions changes

```yaml
# .github/workflows/atopile.yml
jobs:
  build:
    runs-on: ubuntu-latest  # amd64
    container:
      image: ghcr.io/devboy/requencer-hw-tools:latest
    steps:
      - uses: actions/checkout@v4
      - run: make hw-all-inner
      - uses: actions/upload-artifact@v4
        with:
          name: manufacturing-${{ github.sha }}
          path: hardware/build/manufacturing/
```

Benefits:
- Same toolchain locally and in CI
- No `setup-atopile` action needed (tools in image)
- Image cached in GHCR (free for public repos)
- ARM image for fast local builds on M-series Macs
- No hardcoded `/Applications/KiCad/...` paths

### Open questions

1. **Image size**: KiCad + Java + atopile could be 2-3GB. Acceptable for CI cache?
2. **atopile part picking**: Takes ~7 min, hits LCSC API. Cache `build/cache/` between runs?
3. **GitHub free tier**: Only x86_64 runners. ARM image only useful locally.
4. **Alternative**: Keep `setup-atopile` for GHA (faster, already works for ato build), Docker only for local + route/export steps that need KiCad.

## Current pipeline status (working locally)

```
make hw-all  →  hw-build → hw-footprints → hw-faceplate → hw-place → hw-route → hw-export
                   │            │               │             │           │           │
                ato build   gen .kicad_mod   gen faceplate  pcbnew    freerouting  kicad-cli
                 (~9 min)                                  placement  (~3 min)    gerbers+BOM
```

All steps run natively on ARM macOS. Total: ~13 min (dominated by ato part picking).
