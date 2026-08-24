/// Replace the inherited upstream product name in native user-facing text.
///
/// Internal protocol and service identifiers intentionally keep their
/// compatibility names; only text shown to the user should pass through here.
pub fn native_text(text: &str, app_name: &str) -> String {
    text.replace("Clash Verge Rev", app_name)
        .replace("Clash-Verge", app_name)
        .replace("Clash Verge", app_name)
}

#[cfg(test)]
mod tests {
    use super::native_text;

    #[test]
    fn replaces_all_inherited_user_facing_brand_variants() {
        for legacy in ["Clash Verge", "Clash Verge Rev", "Clash-Verge"] {
            let rendered = native_text(&format!("{legacy} is ready"), "吾爱云");
            assert_eq!(rendered, "吾爱云 is ready");
            assert!(!rendered.contains("Clash"));
        }
    }

    #[test]
    fn preserves_unrelated_localized_text() {
        assert_eq!(native_text("系统代理已开启", "吾爱云"), "系统代理已开启");
    }
}
