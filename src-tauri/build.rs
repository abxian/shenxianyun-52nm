use std::{collections::HashMap, fs, path::PathBuf, process};

fn profile_error(message: &str) -> ! {
    eprintln!("site profile error: {message}");
    process::exit(1);
}

fn site_profile() -> HashMap<String, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let Some(repository_root) = manifest_dir.parent() else {
        profile_error("src-tauri must have a repository parent");
    };
    let path = repository_root.join("site-profile.properties");
    println!("cargo:rerun-if-changed={}", path.display());
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) => profile_error(&format!("cannot read site-profile.properties: {error}")),
    };
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
    let Some(client_name) = profile.get("client.name") else {
        profile_error("site-profile.properties must define client.name");
    };
    let Some(managed_import_scheme) = profile.get("deep.link.scheme") else {
        profile_error("site-profile.properties must define deep.link.scheme");
    };
    println!("cargo:rustc-env=CLIENT_DISPLAY_NAME={client_name}");
    println!("cargo:rustc-env=MANAGED_IMPORT_SCHEME={managed_import_scheme}");

    #[cfg(feature = "clippy")]
    {
        println!("cargo:warning=Skipping tauri_build during Clippy");
    }

    #[cfg(not(feature = "clippy"))]
    tauri_build::build();
}
