# Hardware Docker Toolchain Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Containerize the hardware build pipeline (atopile + KiCad + FreeRouting) in a multi-arch Docker image so the same toolchain runs locally (ARM Mac) and in CI (x86_64 Linux).

**Architecture:** Single Docker image based on Ubuntu 24.04 with KiCad 9 (PPA), atopile (pip), OpenJDK 21 + FreeRouting JAR. Scripts use environment variables with macOS defaults so they work both natively and in Docker. Makefile gets Docker wrapper targets. Two GHA workflows: one to build/push the image, one to use it for hardware builds.

**Tech Stack:** Docker, buildx (multi-arch), GHCR, Make, bash, KiCad 9 PPA, atopile, FreeRouting 2.1.0, OpenJDK 21

---

### Task 1: Create Dockerfile

**Files:**
- Create: `hardware/docker/Dockerfile`

**Step 1: Create directory**

```bash
mkdir -p hardware/docker
```

**Step 2: Write Dockerfile**

Create `hardware/docker/Dockerfile`:

```dockerfile
FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive

# KiCad 9 PPA
RUN apt-get update && \
    apt-get install -y software-properties-common && \
    add-apt-repository -y ppa:kicad/kicad-9.0-releases && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        kicad \
        python3-pcbnew \
        python3-pip \
        python3-venv \
        openjdk-21-jre-headless \
        make \
        git \
        wget \
        ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# FreeRouting JAR
RUN wget -q -O /opt/freerouting.jar \
    https://github.com/freerouting/freerouting/releases/download/v2.1.0/freerouting-2.1.0.jar

# atopile
RUN pip install --break-system-packages atopile

# Environment variables for scripts (Linux paths)
ENV KICAD_PYTHON=python3
ENV KICAD_PYPATH=""
ENV KICAD_FWPATH=""
ENV KICAD_CLI=kicad-cli
ENV JAVA=java
ENV FREEROUTING_JAR=/opt/freerouting.jar

WORKDIR /work
```

**Step 3: Verify Dockerfile builds (local arch only)**

```bash
docker build -t requencer-hw-tools:test hardware/docker/
```

Expected: Image builds successfully. May take several minutes (KiCad is large).

**Step 4: Smoke-test the image**

```bash
docker run --rm requencer-hw-tools:test bash -c "kicad-cli version && python3 -c 'import pcbnew; print(pcbnew.Version())' && java -jar /opt/freerouting.jar --help"
```

Expected: KiCad version, pcbnew version, and FreeRouting help output printed.

---

### Task 2: Update autoroute.sh to use environment variables

**Files:**
- Modify: `hardware/scripts/autoroute.sh`

**Step 1: Replace hardcoded tool paths with env vars (lines 20-25)**

Replace:
```bash
# Tool paths
KICAD_PYTHON="/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/3.9/bin/python3"
KICAD_PYPATH="/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/3.9/lib/python3.9/site-packages"
KICAD_FWPATH="/Applications/KiCad/KiCad.app/Contents/Frameworks"
JAVA="/opt/homebrew/opt/openjdk/bin/java"
FREEROUTING_JAR="$SCRIPT_DIR/../tools/freerouting.jar"
```

With:
```bash
# Tool paths (env vars with macOS defaults)
KICAD_PYTHON="${KICAD_PYTHON:-/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/3.9/bin/python3}"
KICAD_PYPATH="${KICAD_PYPATH:-/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/3.9/lib/python3.9/site-packages}"
KICAD_FWPATH="${KICAD_FWPATH:-/Applications/KiCad/KiCad.app/Contents/Frameworks}"
KICAD_CLI="${KICAD_CLI:-/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli}"
JAVA="${JAVA:-/opt/homebrew/opt/openjdk/bin/java}"
FREEROUTING_JAR="${FREEROUTING_JAR:-$SCRIPT_DIR/../tools/freerouting.jar}"
```

**Step 2: Replace hardcoded kicad-cli calls (lines 133, 136, 143)**

Replace all three occurrences of `/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli` with `"$KICAD_CLI"`.

Line 133:
```bash
"$KICAD_CLI" pcb export gerbers \
```

Line 136:
```bash
"$KICAD_CLI" pcb export drill \
```

Line 143:
```bash
"$KICAD_CLI" pcb drc \
```

**Step 3: Update tool verification (line 28-33)**

The verification loop checks file existence, but in Docker `KICAD_PYTHON=python3` is a command name, not a path. Replace the file-existence check with a command-existence check:

Replace:
```bash
for tool in "$KICAD_PYTHON" "$JAVA" "$FREEROUTING_JAR"; do
  if [ ! -f "$tool" ]; then
    echo "ERROR: Missing tool: $tool"
    exit 1
  fi
done
```

With:
```bash
# Verify tools exist (check as command for executables, file for JAR)
for cmd in "$KICAD_PYTHON" "$JAVA" "$KICAD_CLI"; do
  if ! command -v "$cmd" &>/dev/null && [ ! -f "$cmd" ]; then
    echo "ERROR: Missing tool: $cmd"
    exit 1
  fi
done
if [ ! -f "$FREEROUTING_JAR" ]; then
  echo "ERROR: Missing FreeRouting JAR: $FREEROUTING_JAR"
  exit 1
fi
```

**Step 4: Verify autoroute.sh still parses correctly**

```bash
bash -n hardware/scripts/autoroute.sh
```

Expected: No syntax errors.

---

### Task 3: Update Makefile with Docker targets

**Files:**
- Modify: `Makefile`

**Step 1: Add Docker variables and new targets**

Add after line 5 (`.PHONY` declaration), extend it:
```makefile
.PHONY: ... hw-docker-build hw-docker hw-all-inner
```

Add after the `KICAD_ENV` line (line 41), add Docker config:
```makefile
# Docker image
HW_IMAGE := ghcr.io/devboy/requencer-hw-tools:latest
```

Add new targets after `hw-all` (after line 74):

```makefile
# === Hardware (Docker) ===

hw-docker-build:
	docker build -t $(HW_IMAGE) hardware/docker/

hw-docker:
	docker run --rm -v $(PWD):/work -w /work $(HW_IMAGE) make hw-all-inner

hw-all-inner:
	rm -f $(PCB_SRC) $(PCB_SRC).bak
	cd hardware && ato build
	python3 hardware/scripts/generate_footprints.py
	python3 hardware-faceplate/scripts/generate_faceplate.py
	python3 hardware/scripts/place_components.py $(PCB_SRC) $(PCB_PLACED)
	hardware/scripts/autoroute.sh $(PCB_PLACED) $(PCB_ROUTED)
	python3 hardware/scripts/export_manufacturing.py $(PCB_ROUTED) $(MFG_DIR)
	@echo "=== Hardware pipeline complete (Docker) ==="
	@echo "  Routed PCB: $(PCB_ROUTED)"
	@echo "  Manufacturing: $(MFG_DIR)/"
```

**Step 2: Verify Makefile parses**

```bash
make -n hw-all-inner
```

Expected: Prints the commands that would run (dry-run).

---

### Task 4: Create Docker image build/push workflow

**Files:**
- Create: `.github/workflows/docker-hw-tools.yml`

**Step 1: Write the workflow**

```yaml
name: Build Hardware Tools Image

on:
  push:
    branches: [main]
    paths:
      - 'hardware/docker/**'
  workflow_dispatch:

permissions:
  contents: read
  packages: write

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push multi-arch image
        uses: docker/build-push-action@v6
        with:
          context: hardware/docker
          platforms: linux/amd64,linux/arm64
          push: true
          tags: |
            ghcr.io/devboy/requencer-hw-tools:latest
            ghcr.io/devboy/requencer-hw-tools:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

---

### Task 5: Update atopile CI workflow to use container image

**Files:**
- Modify: `.github/workflows/atopile.yml`

**Step 1: Replace setup-atopile with container image**

Replace the entire workflow with:

```yaml
name: Atopile Hardware Build

on:
  push:
    branches: [main]
    paths:
      - 'hardware/**'
      - 'hardware-faceplate/**'
      - 'panel-layout.json'
  pull_request:
    paths:
      - 'hardware/**'
      - 'hardware-faceplate/**'
      - 'panel-layout.json'

jobs:
  build:
    runs-on: ubuntu-latest
    container:
      image: ghcr.io/devboy/requencer-hw-tools:latest

    steps:
      - uses: actions/checkout@v4

      - name: Build schematic
        run: |
          rm -f hardware/elec/layout/default/default.kicad_pcb
          cd hardware && ato build

      - name: Generate through-hole footprints
        run: python3 hardware/scripts/generate_footprints.py

      - name: Generate faceplate PCB
        run: python3 hardware-faceplate/scripts/generate_faceplate.py

      - name: Run DRC (verification)
        working-directory: hardware
        run: |
          PCB="elec/layout/default/default.kicad_pcb"
          if [ -f "$PCB" ]; then
            kicad-cli pcb drc "$PCB" -o drc-report.json --format json 2>&1 || true
            if [ -f drc-report.json ]; then
              python3 -c "
          import json
          with open('drc-report.json') as f:
              r = json.load(f)
          v = len(r.get('violations', []))
          u = len(r.get('unconnected', []))
          print(f'DRC: {v} violations, {u} unconnected')
          "
            fi
          else
            echo 'PCB file not found, skipping DRC'
          fi

      # --- Full pipeline (main branch only) ---

      - name: Place components
        if: github.ref == 'refs/heads/main'
        run: |
          PCB="hardware/elec/layout/default/default.kicad_pcb"
          if [ -f "$PCB" ]; then
            python3 hardware/scripts/place_components.py "$PCB" hardware/build/placed.kicad_pcb
          fi

      - name: Autoroute
        if: github.ref == 'refs/heads/main'
        run: |
          PCB="hardware/build/placed.kicad_pcb"
          if [ -f "$PCB" ]; then
            chmod +x hardware/scripts/autoroute.sh
            hardware/scripts/autoroute.sh "$PCB" hardware/build/routed.kicad_pcb
          fi

      - name: Export manufacturing files
        if: github.ref == 'refs/heads/main'
        run: |
          PCB="hardware/build/routed.kicad_pcb"
          if [ -f "$PCB" ]; then
            python3 hardware/scripts/export_manufacturing.py "$PCB" hardware/build/manufacturing
          fi

      - name: Upload KiCad output
        if: github.ref == 'refs/heads/main'
        uses: actions/upload-artifact@v4
        with:
          name: kicad-output-${{ github.sha }}
          path: hardware/elec/layout/default/
          retention-days: 90

      - name: Upload manufacturing files
        if: github.ref == 'refs/heads/main'
        uses: actions/upload-artifact@v4
        with:
          name: manufacturing-${{ github.sha }}
          path: |
            hardware/build/manufacturing/
            hardware-faceplate/elec/layout/
          retention-days: 90
```

---

### Task 6: Test Docker pipeline locally

**Step 1: Build image locally**

```bash
make hw-docker-build
```

Expected: Image builds successfully.

**Step 2: Run full pipeline in Docker**

```bash
make hw-docker
```

Expected: Full hw-all-inner pipeline runs inside container. This validates that all tools work with Linux paths.

**Step 3: Verify native macOS still works**

```bash
make hw-route
```

Expected: autoroute.sh still works with macOS defaults (env vars not set, falls through to hardcoded macOS paths).
