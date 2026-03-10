.PHONY: all test build clean dev lint flash \
	test-rust test-web \
	build-wasm build-web build-firmware \
	lint-rust lint-web \
	hw-gen-validation hw-build hw-footprints hw-faceplate \
	hw-place hw-place-control hw-place-main hw-3d-models \
	hw-route hw-route-control hw-route-main \
	hw-gnd-pours \
	hw-export hw-all hw-clean \
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
# Two-board pipeline: control board (panel-mount components) + main board (processor/DACs)
# Both built from a single atopile project in hardware/boards/.
# Run `make hw-all` to rebuild everything from .ato source files.
#
# Tool paths (macOS native ARM)
KICAD_APP    := /Applications/KiCad/KiCad.app
KICAD_CLI    := $(KICAD_APP)/Contents/MacOS/kicad-cli
KICAD_PYTHON := $(KICAD_APP)/Contents/Frameworks/Python.framework/Versions/3.9/bin/python3
KICAD_ENV    := DYLD_FRAMEWORK_PATH=$(KICAD_APP)/Contents/Frameworks PYTHONPATH=$(KICAD_APP)/Contents/Frameworks/Python.framework/Versions/3.9/lib/python3.9/site-packages

# Docker image
HW_IMAGE := ghcr.io/devboy/requencer-hw-tools:latest

# Build artifacts — two boards
CONTROL_PCB_SRC  := hardware/boards/elec/layout/control/control.kicad_pcb
MAIN_PCB_SRC     := hardware/boards/elec/layout/main/main.kicad_pcb
CONTROL_PLACED   := hardware/boards/build/control-placed.kicad_pcb
MAIN_PLACED      := hardware/boards/build/main-placed.kicad_pcb
CONTROL_ROUTED   := hardware/boards/build/control-routed.kicad_pcb
MAIN_ROUTED      := hardware/boards/build/main-routed.kicad_pcb
MFG_DIR          := hardware/boards/build/manufacturing

hw-gen-validation:
	python3 hardware/boards/scripts/gen_validation.py

hw-build: hw-gen-validation
	@# Remove stale layouts to avoid atopile "duplicate designator" error on rebuild
	rm -f $(CONTROL_PCB_SRC) $(CONTROL_PCB_SRC).bak
	rm -f $(MAIN_PCB_SRC) $(MAIN_PCB_SRC).bak
	cd hardware/boards && PATH="$$HOME/.local/bin:$$PATH" ato build

hw-footprints:
	python3 hardware/boards/scripts/generate_footprints.py

hw-faceplate:
	python3 hardware/faceplate/scripts/generate_faceplate.py

hw-place-control:
	$(KICAD_ENV) $(KICAD_PYTHON) hardware/boards/scripts/place_components.py $(CONTROL_PCB_SRC) $(CONTROL_PLACED)

hw-place-main:
	$(KICAD_ENV) $(KICAD_PYTHON) hardware/boards/scripts/place_components.py --board main $(MAIN_PCB_SRC) $(MAIN_PLACED)

hw-3d-models:
	python3 hardware/boards/scripts/add_3d_models.py

hw-place: hw-place-control hw-place-main hw-3d-models
	$(KICAD_ENV) $(KICAD_PYTHON) hardware/boards/scripts/export_layout.py \
		$(CONTROL_PLACED) hardware/boards/component-map.json web/src/panel-layout.json

hw-export-layout:
	$(KICAD_ENV) $(KICAD_PYTHON) hardware/boards/scripts/export_layout.py \
		$(CONTROL_PLACED) hardware/boards/component-map.json web/src/panel-layout.json

hw-fetch-pcb:
	gh run download --name placed-pcbs-latest -D hardware/boards/build/

hw-route-control:
	hardware/boards/scripts/autoroute.sh $(CONTROL_PLACED) $(CONTROL_ROUTED)

hw-route-main:
	hardware/boards/scripts/autoroute.sh $(MAIN_PLACED) $(MAIN_ROUTED)

hw-route: hw-route-control hw-route-main

hw-gnd-pours:
	$(KICAD_ENV) $(KICAD_PYTHON) hardware/boards/scripts/add_ground_pours.py $(CONTROL_ROUTED)
	$(KICAD_ENV) $(KICAD_PYTHON) hardware/boards/scripts/add_ground_pours.py $(MAIN_ROUTED)

hw-export:
	PATH="$(KICAD_APP)/Contents/MacOS:$$PATH" \
	python3 hardware/boards/scripts/export_manufacturing.py $(CONTROL_ROUTED) $(MFG_DIR)/control
	PATH="$(KICAD_APP)/Contents/MacOS:$$PATH" \
	python3 hardware/boards/scripts/export_manufacturing.py $(MAIN_ROUTED) $(MFG_DIR)/main

# Full pipeline: each step feeds into the next
hw-all: hw-build hw-footprints hw-faceplate hw-place hw-route hw-gnd-pours hw-export
	@echo "=== Hardware pipeline complete ==="
	@echo "  Control routed: $(CONTROL_ROUTED)"
	@echo "  Main routed:    $(MAIN_ROUTED)"
	@echo "  Manufacturing:  $(MFG_DIR)/"

# === Hardware (Native macOS, maxed out) ===
# Full pipeline running natively on macOS with aggressive FreeRouting params.
# Requires: KiCad 9 (/Applications/KiCad/), Java (brew openjdk), atopile (~/.local/bin/ato)

hw-local:
	python3 hardware/boards/scripts/gen_validation.py
	rm -f $(CONTROL_PCB_SRC) $(CONTROL_PCB_SRC).bak
	rm -f $(MAIN_PCB_SRC) $(MAIN_PCB_SRC).bak
	cd hardware/boards && $$HOME/.local/bin/ato --non-interactive build --keep-picked-parts --keep-net-names --keep-designators
	python3 hardware/boards/scripts/generate_footprints.py
	python3 hardware/faceplate/scripts/generate_faceplate.py
	$(KICAD_ENV) $(KICAD_PYTHON) hardware/boards/scripts/place_components.py $(CONTROL_PCB_SRC) $(CONTROL_PLACED)
	$(KICAD_ENV) $(KICAD_PYTHON) hardware/boards/scripts/place_components.py --board main $(MAIN_PCB_SRC) $(MAIN_PLACED)
	python3 hardware/boards/scripts/add_3d_models.py
	$(KICAD_ENV) $(KICAD_PYTHON) hardware/boards/scripts/export_layout.py \
		$(CONTROL_PLACED) hardware/boards/component-map.json web/src/panel-layout.json
	FREEROUTING_MP=80 FREEROUTING_MT=1 FREEROUTING_OIT=1 \
		FREEROUTING_TIMEOUT=7200 FREEROUTING_HEADLESS=false \
		FREEROUTING_JAVA_OPTS="-Xmx32g" \
		FREEROUTING_JAR=hardware/boards/tools/freerouting-1.9.0.jar \
		hardware/boards/scripts/autoroute.sh $(CONTROL_PLACED) $(CONTROL_ROUTED)
	FREEROUTING_MP=80 FREEROUTING_MT=1 FREEROUTING_OIT=1 \
		FREEROUTING_TIMEOUT=7200 FREEROUTING_HEADLESS=false \
		FREEROUTING_JAVA_OPTS="-Xmx32g" \
		FREEROUTING_JAR=hardware/boards/tools/freerouting-1.9.0.jar \
		hardware/boards/scripts/autoroute.sh $(MAIN_PLACED) $(MAIN_ROUTED)
	$(KICAD_ENV) $(KICAD_PYTHON) hardware/boards/scripts/add_ground_pours.py $(CONTROL_ROUTED)
	$(KICAD_ENV) $(KICAD_PYTHON) hardware/boards/scripts/add_ground_pours.py $(MAIN_ROUTED)
	PATH="$(KICAD_APP)/Contents/MacOS:$$PATH" \
		python3 hardware/boards/scripts/export_manufacturing.py $(CONTROL_ROUTED) $(MFG_DIR)/control
	PATH="$(KICAD_APP)/Contents/MacOS:$$PATH" \
		python3 hardware/boards/scripts/export_manufacturing.py $(MAIN_ROUTED) $(MFG_DIR)/main
	@echo "=== Hardware pipeline complete (native) ==="
	@echo "  Control routed: $(CONTROL_ROUTED)"
	@echo "  Main routed:    $(MAIN_ROUTED)"
	@echo "  Manufacturing:  $(MFG_DIR)/"

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
	python3 hardware/boards/scripts/gen_validation.py
	rm -f $(CONTROL_PCB_SRC) $(CONTROL_PCB_SRC).bak
	rm -f $(MAIN_PCB_SRC) $(MAIN_PCB_SRC).bak
	cd hardware/boards && ato --non-interactive build
	python3 hardware/boards/scripts/generate_footprints.py
	python3 hardware/faceplate/scripts/generate_faceplate.py
	python3 hardware/boards/scripts/place_components.py $(CONTROL_PCB_SRC) $(CONTROL_PLACED)
	python3 hardware/boards/scripts/place_components.py --board main $(MAIN_PCB_SRC) $(MAIN_PLACED)
	python3 hardware/boards/scripts/add_3d_models.py
	python3 hardware/boards/scripts/export_layout.py $(CONTROL_PLACED) hardware/boards/component-map.json web/src/panel-layout.json
	hardware/boards/scripts/autoroute.sh $(CONTROL_PLACED) $(CONTROL_ROUTED)
	hardware/boards/scripts/autoroute.sh $(MAIN_PLACED) $(MAIN_ROUTED)
	python3 hardware/boards/scripts/add_ground_pours.py $(CONTROL_ROUTED)
	python3 hardware/boards/scripts/add_ground_pours.py $(MAIN_ROUTED)
	python3 hardware/boards/scripts/export_manufacturing.py $(CONTROL_ROUTED) $(MFG_DIR)/control
	python3 hardware/boards/scripts/export_manufacturing.py $(MAIN_ROUTED) $(MFG_DIR)/main
	@echo "=== Hardware pipeline complete (Docker) ==="
	@echo "  Control routed: $(CONTROL_ROUTED)"
	@echo "  Main routed:    $(MAIN_ROUTED)"
	@echo "  Manufacturing:  $(MFG_DIR)/"

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
	rm -rf hardware/boards/build/control-placed.kicad_pcb hardware/boards/build/main-placed.kicad_pcb
	rm -rf hardware/boards/build/control-routed.kicad_pcb hardware/boards/build/main-routed.kicad_pcb
	rm -rf hardware/boards/build/manufacturing hardware/boards/build/gerbers
	rm -rf hardware/boards/build/route-cache
