//! Build script for requencer firmware.
//! Links the memory layout for the RP2350B (PGA2350 module).

fn main() {
    // Tell the linker where to find memory.x
    println!("cargo:rustc-link-search={}", std::env::var("OUT_DIR").unwrap());

    // Copy memory.x to OUT_DIR so the linker can find it
    let out_dir = std::env::var("OUT_DIR").unwrap();
    let memory_x = include_str!("memory.x");
    std::fs::write(format!("{}/memory.x", out_dir), memory_x).unwrap();

    println!("cargo:rerun-if-changed=memory.x");
    println!("cargo:rerun-if-changed=build.rs");
}
