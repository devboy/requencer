fn main() {
    // Only emit linker args when building for ARM (not during host tests)
    if std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default() == "arm" {
        // Copy memory.x to OUT_DIR so cortex-m-rt's link.x can find it
        let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
        std::fs::copy("memory.x", out.join("memory.x")).unwrap();
        println!("cargo:rustc-link-search={}", out.display());

        println!("cargo:rustc-link-arg-bins=--nmagic");
        println!("cargo:rustc-link-arg-bins=-Tlink.x");
        println!("cargo:rustc-link-arg-bins=-Tdefmt.x");

        println!("cargo:rerun-if-changed=memory.x");
    }
}
