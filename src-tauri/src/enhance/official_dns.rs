use serde_yaml_ng::{Mapping, Value};

const ROOTS: [&str; 1] = ["52nm.de"];
const SERVERS: [&str; 2] = [
    "https://223.5.5.5/dns-query#DIRECT",
    "https://1.12.12.12/dns-query#DIRECT",
];

fn official_domain(key: &str) -> bool {
    let normalized = key.trim().trim_end_matches('.').to_ascii_lowercase();
    let domain = normalized
        .strip_prefix("+.")
        .or_else(|| normalized.strip_prefix("*."))
        .unwrap_or(&normalized);
    ROOTS
        .iter()
        .any(|root| domain == *root || domain.ends_with(&format!(".{root}")))
}

/// The website's connection and its DNS lookup must both survive a dead proxy.
/// Apply last: subscription scripts and optional DNS overrides run before this.
/// IP-based DoH avoids bootstrap DNS interception; #DIRECT bypasses selectable
/// "direct" groups even when respect-rules or global mode is in use.
pub fn apply(config: &mut Mapping) -> Result<(), String> {
    let Some(dns) = config.get_mut("dns") else {
        return Ok(());
    };
    if dns.is_null() {
        return Ok(());
    }
    let dns = dns.as_mapping_mut().ok_or("dns must be a mapping")?;
    if dns.get("enable").and_then(Value::as_bool) != Some(true) {
        return Ok(());
    }
    let value = dns
        .entry(Value::from("nameserver-policy"))
        .or_insert_with(|| Value::Mapping(Mapping::new()));
    if value.is_null() {
        *value = Value::Mapping(Mapping::new());
    }
    let policy = value
        .as_mapping_mut()
        .ok_or("dns.nameserver-policy must be a mapping")?;
    // Remove more-specific old official policies too; keep unrelated policies.
    policy.retain(|key, _| !key.as_str().is_some_and(official_domain));
    let servers = Value::Sequence(SERVERS.into_iter().map(Value::from).collect());
    for root in ROOTS {
        policy.insert(format!("+.{root}").into(), servers.clone());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    type TestResult = Result<(), Box<dyn std::error::Error>>;

    #[test]
    fn official_dns_bypasses_proxy_without_changing_other_routing() -> TestResult {
        let mut config: Mapping = serde_yaml_ng::from_str(
            "dns:\n  enable: true\n  respect-rules: true\n  nameserver: [https://dns.example/dns-query]\n  nameserver-policy:\n    '+.52nm.de': [223.5.5.5]\n    api.52nm.de: [119.29.29.29]\n    '*.managed.52nm.de.': 8.8.8.8\n    '+.example.com': [8.8.8.8]\n    evil-52nm.de: 1.1.1.1\n    52nm.de.evil.example: 1.1.1.1\nrules: ['DOMAIN,api.52nm.de,DIRECT', 'MATCH,Proxy']\nproxy-groups: [{name: 全球直连, type: select, proxies: [Proxy, DIRECT]}]",
        )?;
        let before = config.clone();
        apply(&mut config)?;
        assert_eq!(config["rules"], before["rules"]);
        assert_eq!(config["proxy-groups"], before["proxy-groups"]);
        assert_eq!(config["dns"]["respect-rules"], true);
        assert_eq!(config["dns"]["nameserver"], before["dns"]["nameserver"]);
        let policy = config["dns"]["nameserver-policy"].as_mapping().ok_or("policy")?;
        assert_eq!(policy.len(), 4);
        assert!(!policy.contains_key("api.52nm.de"));
        assert_eq!(policy["+.52nm.de"][0], SERVERS[0]);
        for domain in ["+.example.com", "evil-52nm.de", "52nm.de.evil.example"] {
            assert_eq!(policy[domain], before["dns"]["nameserver-policy"][domain]);
        }
        let once = config.clone();
        apply(&mut config)?;
        assert_eq!(config, once);
        Ok(())
    }

    #[test]
    fn disabled_dns_is_not_enabled_and_malformed_policy_is_rejected() -> TestResult {
        for input in ["{}", "dns: null", "dns: {enable: false, nameserver-policy: null}"] {
            let mut config: Mapping = serde_yaml_ng::from_str(input)?;
            let before = config.clone();
            apply(&mut config)?;
            assert_eq!(config, before);
        }
        let mut config = serde_yaml_ng::from_str("dns: {enable: true, nameserver-policy: []}")?;
        assert!(apply(&mut config).is_err());
        let mut config = serde_yaml_ng::from_str("dns: {enable: true, nameserver-policy: null}")?;
        apply(&mut config)?;
        assert_eq!(config["dns"]["nameserver-policy"]["+.52nm.de"][0], SERVERS[0]);
        Ok(())
    }
}
