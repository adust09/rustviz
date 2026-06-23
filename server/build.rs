//! Ensure `web/dist` exists at compile time so the rust-embed macro can read it
//! even before the frontend has been built (it will embed zero assets then).

fn main() {
    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        let dist = std::path::Path::new(&manifest).join("../web/dist");
        let _ = std::fs::create_dir_all(&dist);
    }
    println!("cargo:rerun-if-changed=../web/dist");
}
