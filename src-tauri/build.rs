use std::{collections::HashMap, fs, path::PathBuf};

fn site_profile() -> HashMap<String, String> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri must have a repository parent")
        .join("site-profile.properties");
    println!("cargo:rerun-if-changed={}", path.display());
    let content = fs::read_to_string(path).expect("read site-profile.properties");
    content
        .lines()
        .filter_map(|raw| {
            let line = raw.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }
            let (key, value) = line.split_once('=')?;
            Some((key.trim().to_owned(), value.trim().to_owned()))
        })
        .collect()
}

fn main() {
    let profile = site_profile();
    let client_name = profile
        .get("client.name")
        .expect("site-profile.properties must define client.name");
    let managed_import_scheme = profile
        .get("deep.link.scheme")
        .expect("site-profile.properties must define deep.link.scheme");
    println!("cargo:rustc-env=CLIENT_DISPLAY_NAME={client_name}");
    println!("cargo:rustc-env=MANAGED_IMPORT_SCHEME={managed_import_scheme}");

    #[cfg(feature = "clippy")]
    {
        println!("cargo:warning=Skipping tauri_build during Clippy");
    }

    #[cfg(not(feature = "clippy"))]
    tauri_build::build();
}
