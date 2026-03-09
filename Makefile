.PHONY: all test build clean dev lint flash \
	test-rust test-web \
	build-wasm build-web build-firmware \
	lint-rust lint-web \
	hw-build hw-footprints hw-faceplate hw-place hw-route hw-export hw-all hw-clean \
	hw-export-layout hw-fetch-pcb \
	hw-docker-build hw-docker hw-docker-local hw-all-inner \
	hw-local

all: test

# === Tests ===

test: test-rust test-web

test-rust:
	cargo test --workspace

test-web:
	cd web && npm test

# === Builds ===

build: build-wasm build-web

build-wasm:
	wasm-pack build crates/web --target web --out-dir ../../web/pkg

build-web: build-wasm
	cd web && npm run build

build-firmware:
	cargo build --release -p requencer-firmware --target thumbv8m.main-none-eabihf

# === Hardware (Atopile) ===
#
# Full pipeline: ato source → schematic/PCB → footprints → placement → routing → manufacturing
# Run `make hw-all` to rebuild everything from .ato source files.
#
# Tool paths (macOS native ARM)
KICAD_APP    := /Applications/KiCad/KiCad.app
KICAD_CLI    := $(KICAD_APP)/Contents/MacOS/kicad-cli
KICAD_PYTHON := $(KICAD_APP)/Contents/Frameworks/Python.framework/Versions/3.9/bin/python3
KICAD_ENV    := DYLD_FRAMEWORK_PATH=$(KICAD_APP)/Contents/Frameworks PYTHONPATH=$(KICAD_APP)/Contents/Frameworks/Python.framework/Versions/3.9/lib/python3.9/site-packages

# Docker image
HW_IMAGE := ghcr.io/devboy/requencer-hw-tools:latest

# Build artifacts
PCB_SRC     := hardware/pcb/elec/layout/default/default.kicad_pcb
PCB_PLACED  := hardware/pcb/build/placed.kicad_pcb
PCB_ROUTED  := hardware/pcb/build/routed.kicad_pcb
MFG_DIR     := hardware/pcb/build/manufacturing

hw-build:
	@# Remove stale layout to avoid atopile "duplicate designator" error on rebuild
	rm -f $(PCB_SRC) $(PCB_SRC).bak
	cd hardware/pcb && PATH="$$HOME/.local/bin:$$PATH" ato build

hw-footprints:
	python3 hardware/pcb/scripts/generate_footprints.py

hw-faceplate:
	python3 hardware/faceplate/scripts/generate_faceplate.py

hw-place:
	$(KICAD_ENV) $(KICAD_PYTHON) hardware/pcb/scripts/place_components.py $(PCB_SRC) $(PCB_PLACED)
	$(KICAD_ENV) $(KICAD_PYTHON) hardware/pcb/scripts/export_layout.py \
		$(PCB_PLACED) hardware/pcb/component-map.json web/src/panel-layout.json

hw-export-layout:
	$(KICAD_ENV) $(KICAD_PYTHON) hardware/pcb/scripts/export_layout.py \
		$(PCB_PLACED) hardware/pcb/component-map.json web/src/panel-layout.json

hw-fetch-pcb:
	gh run download --name placed-pcb-latest -D hardware/pcb/build/

hw-route:
	hardware/pcb/scripts/autoroute.sh $(PCB_PLACED) $(PCB_ROUTED)

hw-export:
	PATH="$(KICAD_APP)/Contents/MacOS:$$PATH" \
	python3 hardware/pcb/scripts/export_manufacturing.py $(PCB_ROUTED) $(MFG_DIR)

# Full pipeline: each step feeds into the next
hw-all: hw-build hw-footprints hw-faceplate hw-place hw-route hw-export
	@echo "=== Hardware pipeline complete ==="
	@echo "  Routed PCB: $(PCB_ROUTED)"
	@echo "  Manufacturing: $(MFG_DIR)/"

# === Hardware (Native macOS, maxed out) ===
# Full pipeline running natively on macOS with aggressive FreeRouting params.
# Requires: KiCad 9 (/Applications/KiCad/), Java (brew openjdk), atopile (~/.local/bin/ato)

hw-local:
	rm -f $(PCB_SRC) $(PCB_SRC).bak
	cd hardware/pcb && $$HOME/.local/bin/ato --non-interactive build --keep-picked-parts --keep-net-names --keep-designators
	python3 hardware/pcb/scripts/generate_footprints.py
	python3 hardware/faceplate/scripts/generate_faceplate.py
	$(KICAD_ENV) $(KICAD_PYTHON) hardware/pcb/scripts/place_components.py $(PCB_SRC) $(PCB_PLACED)
	$(KICAD_ENV) $(KICAD_PYTHON) hardware/pcb/scripts/export_layout.py \
		$(PCB_PLACED) hardware/pcb/component-map.json web/src/panel-layout.json
	FREEROUTING_MP=80 FREEROUTING_MT=1 FREEROUTING_OIT=1 \
		FREEROUTING_TIMEOUT=7200 FREEROUTING_HEADLESS=false \
		FREEROUTING_JAVA_OPTS="-Xmx32g" \
		FREEROUTING_JAR=hardware/pcb/tools/freerouting-1.9.0.jar \
		hardware/pcb/scripts/autoroute.sh $(PCB_PLACED) $(PCB_ROUTED)
	PATH="$(KICAD_APP)/Contents/MacOS:$$PATH" \
		python3 hardware/pcb/scripts/export_manufacturing.py $(PCB_ROUTED) $(MFG_DIR)
	@echo "=== Hardware pipeline complete (native) ==="
	@echo "  Routed PCB: $(PCB_ROUTED)"
	@echo "  Manufacturing: $(MFG_DIR)/"

# === Hardware (Docker) ===

hw-docker-build:
	docker build -t $(HW_IMAGE) hardware/docker/

hw-docker:
	docker run --rm -v $(PWD):/work -w /work $(HW_IMAGE) make hw-all-inner

hw-docker-local:
	docker run --rm -v $(PWD):/work -w /work \
		-e PYTHONUNBUFFERED=1 \
		-e FREEROUTING_MP=80 \
		-e FREEROUTING_TIMEOUT=7200 \
		-e FREEROUTING_JAVA_OPTS="-Xmx16g" \
		$(HW_IMAGE) make hw-all-inner

hw-all-inner:
	rm -f $(PCB_SRC) $(PCB_SRC).bak
	cd hardware/pcb && ato --non-interactive build
	python3 hardware/pcb/scripts/generate_footprints.py
	python3 hardware/faceplate/scripts/generate_faceplate.py
	python3 hardware/pcb/scripts/place_components.py $(PCB_SRC) $(PCB_PLACED)
	python3 hardware/pcb/scripts/export_layout.py $(PCB_PLACED) hardware/pcb/component-map.json web/src/panel-layout.json
	hardware/pcb/scripts/autoroute.sh $(PCB_PLACED) $(PCB_ROUTED)
	python3 hardware/pcb/scripts/export_manufacturing.py $(PCB_ROUTED) $(MFG_DIR)
	@echo "=== Hardware pipeline complete (Docker) ==="
	@echo "  Routed PCB: $(PCB_ROUTED)"
	@echo "  Manufacturing: $(MFG_DIR)/"

# === Dev ===

dev: build-wasm
	cd web && npm run dev

# === Lint ===

lint: lint-rust lint-web

lint-rust:
	cargo clippy --workspace -- -D warnings

lint-web:
	cd web && npm run check

# === Flash ===

flash:
	probe-rs run --chip RP2350 target/thumbv8m.main-none-eabihf/release/requencer-firmware

# === Clean ===

clean:
	cargo clean
	cd web && rm -rf dist pkg

hw-clean:
	rm -rf hardware/pcb/build/placed.kicad_pcb hardware/pcb/build/routed.kicad_pcb
	rm -rf hardware/pcb/build/manufacturing hardware/pcb/build/gerbers
	rm -rf hardware/pcb/build/route-cache
