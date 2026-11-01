//! Only the app's OnceCell constructor applies these defaults. In-process core
//! restarts, profile refreshes and explicit mode switches keep their current mode.
use serde_yaml_ng::Mapping;

pub(super) fn reset_for_app_start(config: &mut Mapping) {
    config.insert("mode".into(), "rule".into());
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_yaml_ng::Value;

    #[test]
    fn saved_global_direct_or_missing_mode_starts_in_rule() {
        for saved in [Some("global"), Some("direct"), Some("rule"), None] {
            let mut config = Mapping::new();
            if let Some(mode) = saved {
                config.insert("mode".into(), mode.into());
            }
            config.insert("mixed-port".into(), Value::from(23456));
            config.insert("secret".into(), Value::from("isolated-test-secret"));
            reset_for_app_start(&mut config);
            assert_eq!(config["mode"], Value::from("rule"));
            assert_eq!(config["mixed-port"], Value::from(23456));
            assert_eq!(config["secret"], Value::from("isolated-test-secret"));
        }
    }
}
