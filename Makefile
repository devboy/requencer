.PHONY: all test build clean dev lint flash rust web hardware

all: test

# === Rust — test + lint + build firmware ===

rust:
	cargo test --workspace
	cargo clippy --workspace -- -D warnings
	cargo build --release -p requencer-firmware --target thumbv8m.main-none-eabihf

# === Web — test + lint + build (WASM + bundle) ===

web:
	wasm-pack build crates/web --target web --out-dir ../../web/pkg
	cd web && npm test && npm run check && npm run build

# === Hardware — delegates to hardware/Makefile ===

hardware:
	$(MAKE) -C hardware

# === Dev server ===

dev:
	wasm-pack build crates/web --target web --out-dir ../../web/pkg
	cd web && npm run dev

# === Convenience ===

test:
	cargo test --workspace
	cd web && npm test
	$(MAKE) -C hardware test-hw

lint:
	cargo clippy --workspace -- -D warnings
	cd web && npm run check

build: rust web

flash:
	probe-rs run --chip RP2350 target/thumbv8m.main-none-eabihf/release/requencer-firmware

clean:
	cargo clean
	cd web && rm -rf dist pkg
