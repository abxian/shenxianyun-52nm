pub const BUNDLE_ID: &str = "io.github.clash-verge-rev.clash-verge-rev";

/// Shared legacy configuration/core resources require one running client. Only
/// raise a window after identifying the same product and the same build.
pub fn can_raise_existing(identity: Option<(&str, &str)>, version: &str) -> bool {
    identity.is_some_and(|(bundle_id, running_version)| bundle_id == BUNDLE_ID && running_version == version)
}

#[derive(Debug)]
pub struct ExistingClientConflict;

impl std::fmt::Display for ExistingClientConflict {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("another client or build is using the shared runtime")
    }
}

impl std::error::Error for ExistingClientConflict {}

pub fn show_conflict_notice() {
    // Constant AppleScript: no application paths, profile names or user input
    // are interpolated into executable source. Called on the startup thread.
    let _ = std::process::Command::new("/usr/bin/osascript")
        .args([
            "-e",
            "display alert \"吾爱云\" message \"检测到旧版或其他客户端仍在运行。请先从菜单栏退出吾爱云、Clash Verge或旧版吾爱云，再打开新版吾爱云。为避免共用配置，请勿同时运行。\" buttons {\"知道了\"} default button 1",
        ])
        .status();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn never_raises_unidentified_or_other_brand_clients() {
        assert!(!can_raise_existing(None, "2.5.46+test.240"));
        assert!(!can_raise_existing(
            Some(("io.github.clash-verge-rev.clash-verge-rev", "2.5.46+test.240")),
            "2.5.46+test.240"
        ));
    }

    #[test]
    fn never_raises_an_older_build_of_the_same_product() {
        assert!(!can_raise_existing(
            Some((BUNDLE_ID, "2.5.46+test.239")),
            "2.5.46+test.240"
        ));
    }

    #[test]
    fn raises_the_matching_running_build() {
        assert!(can_raise_existing(
            Some((BUNDLE_ID, "2.5.46+test.240")),
            "2.5.46+test.240"
        ));
    }
}
