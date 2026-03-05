.PHONY: all test build clean dev lint flash \
	test-rust test-web \
	build-wasm build-web build-firmware \
	lint-rust lint-web \
	hw-build hw-footprints hw-faceplate hw-place hw-route hw-export hw-all

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

PCB := hardware/elec/layout/default/default.kicad_pcb

hw-build:
	cd hardware && ato build

hw-footprints:
	python3 hardware/scripts/generate_footprints.py

hw-faceplate:
	python3 hardware-faceplate/scripts/generate_faceplate.py

hw-place:
	python3 hardware/scripts/place_components.py $(PCB)

hw-route:
	hardware/scripts/autoroute.sh $(PCB)

hw-export:
	python3 hardware/scripts/export_manufacturing.py $(PCB) hardware/manufacturing

hw-all: hw-build hw-footprints hw-faceplate hw-place hw-route hw-export

# === Dev ===

dev:
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
