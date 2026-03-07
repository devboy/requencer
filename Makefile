.PHONY: all test build clean dev lint flash \
	test-rust test-web test-firmware \
	build-wasm build-web build-firmware \
	lint-rust lint-web \
	hw-build hw-footprints hw-faceplate hw-place hw-route hw-export hw-all hw-clean \
	hw-export-layout hw-fetch-pcb \
	hw-docker-build hw-docker hw-all-inner

all: test

# === Tests ===

test: test-rust test-web test-firmware

test-rust:
	cargo test --workspace

test-web:
	cd web && npm test

test-firmware:
	cd crates/firmware && cargo test --lib --target x86_64-unknown-linux-gnu

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
PCB_SRC     := hardware/elec/layout/default/default.kicad_pcb
PCB_PLACED  := hardware/build/placed.kicad_pcb
PCB_ROUTED  := hardware/build/routed.kicad_pcb
MFG_DIR     := hardware/build/manufacturing

hw-build:
	@# Remove stale layout to avoid atopile "duplicate designator" error on rebuild
	rm -f $(PCB_SRC) $(PCB_SRC).bak
	cd hardware && PATH="$$HOME/.local/bin:$$PATH" ato build

hw-footprints:
	python3 hardware/scripts/generate_footprints.py

hw-faceplate:
	python3 hardware-faceplate/scripts/generate_faceplate.py

hw-place:
	$(KICAD_ENV) $(KICAD_PYTHON) hardware/scripts/place_components.py $(PCB_SRC) $(PCB_PLACED)
	$(KICAD_ENV) $(KICAD_PYTHON) hardware/scripts/export_layout.py \
		$(PCB_PLACED) hardware/component-map.json web/src/panel-layout.json

hw-export-layout:
	$(KICAD_ENV) $(KICAD_PYTHON) hardware/scripts/export_layout.py \
		$(PCB_PLACED) hardware/component-map.json web/src/panel-layout.json

hw-fetch-pcb:
	gh run download --name placed-pcb-latest -D hardware/build/

hw-route:
	hardware/scripts/autoroute.sh $(PCB_PLACED) $(PCB_ROUTED)

hw-export:
	PATH="$(KICAD_APP)/Contents/MacOS:$$PATH" \
	python3 hardware/scripts/export_manufacturing.py $(PCB_ROUTED) $(MFG_DIR)

# Full pipeline: each step feeds into the next
hw-all: hw-build hw-footprints hw-faceplate hw-place hw-route hw-export
	@echo "=== Hardware pipeline complete ==="
	@echo "  Routed PCB: $(PCB_ROUTED)"
	@echo "  Manufacturing: $(MFG_DIR)/"

# === Hardware (Docker) ===

hw-docker-build:
	docker build -t $(HW_IMAGE) hardware/docker/

hw-docker:
	docker run --rm -v $(PWD):/work -w /work $(HW_IMAGE) make hw-all-inner

hw-all-inner:
	rm -f $(PCB_SRC) $(PCB_SRC).bak
	cd hardware && ato --non-interactive build
	python3 hardware/scripts/generate_footprints.py
	python3 hardware-faceplate/scripts/generate_faceplate.py
	python3 hardware/scripts/place_components.py $(PCB_SRC) $(PCB_PLACED)
	python3 hardware/scripts/export_layout.py $(PCB_PLACED) hardware/component-map.json web/src/panel-layout.json
	hardware/scripts/autoroute.sh $(PCB_PLACED) $(PCB_ROUTED)
	python3 hardware/scripts/export_manufacturing.py $(PCB_ROUTED) $(MFG_DIR)
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
	rm -rf hardware/build/placed.kicad_pcb hardware/build/routed.kicad_pcb
	rm -rf hardware/build/manufacturing hardware/build/gerbers
