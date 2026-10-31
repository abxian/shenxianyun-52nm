use serde_yaml_ng::{Mapping, Sequence, Value};
use std::collections::HashSet;

const API_DIRECT: &str = "DOMAIN,api.52nm.de,DIRECT";

// Run after subscription scripts: homepage edits must survive subscription refreshes.
// Both keys were written by older editors; neither is a Mihomo runtime field.
pub fn apply(config: &mut Mapping, edits: &Mapping) -> Result<(), String> {
    let mut custom = Sequence::new();
    let mut added = HashSet::from([API_DIRECT.to_owned()]);
    for key in ["prepend-rules", "append-rules"] {
        if let Some(value) = edits.get(key) {
            let rules = value.as_sequence().ok_or_else(|| format!("{key} must be a list"))?;
            for rule in rules {
                let raw = rule
                    .as_str()
                    .ok_or_else(|| format!("{key} must contain rule strings"))?;
                let normalized = normalize(raw);
                if added.insert(normalized) {
                    custom.push(rule.clone());
                }
            }
        }
    }
    let existing = match config.get("rules") {
        Some(Value::Sequence(rules)) => rules.clone(),
        None => Sequence::new(),
        Some(_) => return Err("rules must be a list".into()),
    };
    // Server-managed services form a leading block. Keep its order and policies
    // (some official hosts deliberately use the proxy group), then add user edits.
    let official_end = existing.iter().take_while(|rule| is_official_rule(rule)).count();
    let mut rules = vec![Value::String(API_DIRECT.into())];
    let mut official_seen = HashSet::from([API_DIRECT.to_owned()]);
    for rule in &existing[..official_end] {
        let normalized = rule.as_str().map(normalize).unwrap_or_default();
        if official_seen.insert(normalized) {
            rules.push(rule.clone());
        }
    }
    rules.extend(
        custom
            .into_iter()
            .filter(|rule| rule.as_str().is_none_or(|raw| !official_seen.contains(&normalize(raw)))),
    );
    rules.extend(existing.into_iter().skip(official_end).filter(|rule| {
        rule.as_str().is_none_or(|raw| {
            let normalized = normalize(raw);
            !added.contains(&normalized) && !official_seen.contains(&normalized)
        })
    }));
    config.insert("rules".into(), Value::Sequence(rules));
    config.remove("prepend-rules");
    config.remove("append-rules");
    Ok(())
}

// Match actual service families, never every DIRECT rule or an arbitrary row count.
// New service families must be added here when the backend's official domains move.
fn is_official_rule(rule: &Value) -> bool {
    let Some(raw) = rule.as_str() else {
        return false;
    };
    let parts = raw.split(',').map(str::trim).collect::<Vec<_>>();
    if parts.len() < 3 {
        return false;
    }
    let kind = parts[0].to_ascii_uppercase();
    let value = parts[1].trim_end_matches('.').to_ascii_lowercase();
    match kind.as_str() {
        "DOMAIN" | "DOMAIN-SUFFIX" => ["52nm.de", "52nm.de"]
            .iter()
            .any(|root| value == *root || value.ends_with(&format!(".{root}"))),
        "IP-CIDR" => value == "114.80.36.225/32",
        "DST-PORT" => parts[2] == "DIRECT" && value.parse::<u16>().is_ok_and(|port| port > 0),
        _ => false,
    }
}

fn normalize(rule: &str) -> String {
    rule.split(',').map(str::trim).collect::<Vec<_>>().join(",")
}

#[cfg(test)]
mod tests {
    use super::*;
    type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

    fn mapping(yaml: &str) -> TestResult<Mapping> {
        Ok(serde_yaml_ng::from_str(yaml)?)
    }

    #[test]
    fn full_official_block_precedes_edits_and_keeps_proxy_policies() -> TestResult {
        let edits = mapping("prepend-rules: ['DOMAIN-SUFFIX,52nm.de,REJECT', 'DOMAIN-SUFFIX,example.com,Test']")?;
        let mut config = mapping(
            "rules: ['DST-PORT,5443,DIRECT', 'DOMAIN,52nm.de,Test', 'DOMAIN,www.52nm.de,Test', 'DOMAIN,api.52nm.de,DIRECT', 'DOMAIN,sxy.52nm.de,DIRECT', 'DOMAIN-SUFFIX,acl4.ssr,DIRECT', 'MATCH,Test']",
        )?;
        apply(&mut config, &edits)?;
        assert_eq!(
            config["rules"],
            mapping(
                "rules: ['DOMAIN,api.52nm.de,DIRECT', 'DST-PORT,5443,DIRECT', 'DOMAIN,52nm.de,Test', 'DOMAIN,www.52nm.de,Test', 'DOMAIN,sxy.52nm.de,DIRECT', 'DOMAIN-SUFFIX,52nm.de,REJECT', 'DOMAIN-SUFFIX,example.com,Test', 'DOMAIN-SUFFIX,acl4.ssr,DIRECT', 'MATCH,Test']"
            )?["rules"]
        );
        let once = config.clone();
        apply(&mut config, &edits)?;
        assert_eq!(config, once);
        Ok(())
    }

    #[test]
    fn ordinary_direct_and_lookalike_domains_stay_below_edits() -> TestResult {
        let edits = mapping("prepend-rules: ['DOMAIN,example.com,Test']")?;
        let mut config = mapping(
            "rules: ['DOMAIN-SUFFIX,52nm.de,DIRECT', 'IP-CIDR,114.80.36.225/32,DIRECT,no-resolve', 'DOMAIN,evil-52nm.de,DIRECT', 'DOMAIN,52nm.de.evil.example,DIRECT', 'DOMAIN-SUFFIX,lan,DIRECT', 'MATCH,Test']",
        )?;
        apply(&mut config, &edits)?;
        assert_eq!(
            config["rules"],
            mapping(
                "rules: ['DOMAIN,api.52nm.de,DIRECT', 'DOMAIN-SUFFIX,52nm.de,DIRECT', 'IP-CIDR,114.80.36.225/32,DIRECT,no-resolve', 'DOMAIN,example.com,Test', 'DOMAIN,evil-52nm.de,DIRECT', 'DOMAIN,52nm.de.evil.example,DIRECT', 'DOMAIN-SUFFIX,lan,DIRECT', 'MATCH,Test']"
            )?["rules"]
        );
        Ok(())
    }

    #[test]
    fn old_editor_files_become_real_rules_after_api_before_subscription() -> TestResult {
        let edits = mapping(
            "prepend-rules: ['DOMAIN-SUFFIX,example.com,DIRECT', 'DOMAIN,api.52nm.de,DIRECT']\nappend-rules: ['IP-CIDR,192.0.2.0/24,Test']",
        )?;
        let mut config =
            mapping("rules: ['DOMAIN-SUFFIX,de,DIRECT', 'MATCH,Test']\nprepend-rules: []\nappend-rules: []")?;
        apply(&mut config, &edits)?;
        assert_eq!(
            config["rules"],
            mapping(
                "rules: ['DOMAIN,api.52nm.de,DIRECT', 'DOMAIN-SUFFIX,example.com,DIRECT', 'IP-CIDR,192.0.2.0/24,Test', 'DOMAIN-SUFFIX,de,DIRECT', 'MATCH,Test']"
            )?["rules"]
        );
        assert!(!config.contains_key("prepend-rules"));
        assert!(!config.contains_key("append-rules"));
        Ok(())
    }

    #[test]
    fn refresh_and_reload_are_idempotent_and_keep_other_fields() -> TestResult {
        let edits = mapping("prepend-rules: ['DOMAIN,example.com,Test', 'DOMAIN,example.com,Test']")?;
        let mut config =
            mapping("mode: rule\nrules: ['DOMAIN, api.52nm.de, DIRECT', 'DOMAIN,example.com,Test', 'MATCH,Test']")?;
        apply(&mut config, &edits)?;
        let saved = serde_yaml_ng::to_string(&config)?;
        apply(&mut config, &edits)?;
        assert_eq!(saved, serde_yaml_ng::to_string(&config)?);
        assert_eq!(config["mode"], Value::String("rule".into()));
        let mut refreshed = mapping("rules: ['DOMAIN,updated.example,DIRECT', 'MATCH,Test']")?;
        apply(&mut refreshed, &edits)?;
        assert_eq!(
            refreshed["rules"],
            mapping(
                "rules: ['DOMAIN,api.52nm.de,DIRECT', 'DOMAIN,example.com,Test', 'DOMAIN,updated.example,DIRECT', 'MATCH,Test']"
            )?["rules"]
        );
        Ok(())
    }

    #[test]
    fn deletion_restores_subscription_order_and_invalid_edits_fail() -> TestResult {
        let mut config = mapping("rules: ['DOMAIN,example.com,Test', 'MATCH,Test']")?;
        apply(&mut config, &Mapping::new())?;
        assert_eq!(
            config["rules"],
            mapping("rules: ['DOMAIN,api.52nm.de,DIRECT', 'DOMAIN,example.com,Test', 'MATCH,Test']")?["rules"]
        );
        assert!(apply(&mut config, &mapping("prepend-rules: invalid")?).is_err());
        assert!(apply(&mut config, &mapping("prepend-rules: [123]")?).is_err());
        Ok(())
    }
}
