/// The commercial name shown in native UI.
///
/// Internal package, protocol, service, and task identifiers intentionally keep
/// their compatibility names. Only user-facing text should use this constant.
pub const VISIBLE_APP_NAME: &str = env!("CLIENT_DISPLAY_NAME");

/// Replace inherited upstream product names in native user-facing text.
pub fn native_text(text: &str) -> String {
    text.replace("Clash Verge Rev", VISIBLE_APP_NAME)
        .replace("Clash-Verge", VISIBLE_APP_NAME)
        .replace("Clash Verge", VISIBLE_APP_NAME)
        .replace("Verge", VISIBLE_APP_NAME)
}

#[cfg(test)]
mod tests {
    use super::{VISIBLE_APP_NAME, native_text};

    #[test]
    fn replaces_all_inherited_user_facing_brand_variants() {
        for legacy in ["Clash Verge", "Clash Verge Rev", "Clash-Verge", "Verge"] {
            let rendered = native_text(&format!("{legacy} is ready"));
            assert_eq!(rendered, format!("{VISIBLE_APP_NAME} is ready"));
            assert!(!rendered.contains("Clash"));
            assert!(!rendered.contains("Verge"));
        }
    }

    #[test]
    fn preserves_unrelated_localized_text() {
        assert_eq!(native_text("系统代理已开启"), "系统代理已开启");
    }
}
