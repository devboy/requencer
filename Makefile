.PHONY: all test build clean dev lint flash \
	test-rust test-web test-hw \
	build-wasm build-web build-firmware \
	lint-rust lint-web \
	hw-all hw-build hw-footprints hw-place hw-faceplate \
	hw-route hw-gnd-pours hw-3d hw-3d-models hw-export hw-clean

all: test

# === Tests ===

test: test-rust test-web test-hw

test-rust:
	cargo test --workspace

test-web:
	cd web && npm test

test-hw:
	$(MAKE) -C hardware test-hw

# === Builds ===

build: build-wasm build-web

build-wasm:
	wasm-pack build crates/web --target web --out-dir ../../web/pkg

build-web: build-wasm
	cd web && npm run build

build-firmware:
	cargo build --release -p requencer-firmware --target thumbv8m.main-none-eabihf

# === Hardware — delegates to hardware/Makefile ===
#
# Two-board pipeline: control board (panel-mount components) + main board (processor/DACs)
# Both built from a single atopile project in hardware/boards/.
# Run `make hw-all` to rebuild everything, or individual targets for incremental builds.

hw-all:
	$(MAKE) -C hardware all

hw-build:
	$(MAKE) -C hardware build

hw-footprints:
	$(MAKE) -C hardware footprints

hw-place:
	$(MAKE) -C hardware place

hw-faceplate:
	$(MAKE) -C hardware faceplate

hw-route:
	$(MAKE) -C hardware route

hw-gnd-pours:
	$(MAKE) -C hardware gnd-pours

hw-3d:
	$(MAKE) -C hardware 3d

hw-3d-models:
	$(MAKE) -C hardware 3d-models

hw-export:
	$(MAKE) -C hardware export

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
	$(MAKE) -C hardware clean
