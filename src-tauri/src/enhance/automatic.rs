use serde_yaml_ng::{Mapping, Value};
use std::collections::HashSet;

const TEST_URL: &str = "https://www.gstatic.com/generate_204";

fn text<'a>(map: &'a Mapping, key: &str) -> &'a str {
    map.get(key).and_then(Value::as_str).unwrap_or_default()
}

fn primary_selector(group: &Mapping) -> bool {
    text(group, "type") == "select"
        && (text(group, "name").contains("节点") || text(group, "name").eq_ignore_ascii_case("proxy"))
}

fn tune_health(group: &mut Mapping) {
    for (key, value) in [
        ("url", Value::from(TEST_URL)),
        ("interval", Value::from(60)),
        ("timeout", Value::from(5000)),
        ("lazy", Value::from(false)),
        ("max-failed-times", Value::from(1)),
        ("expected-status", Value::from("204")),
    ] {
        group.insert(key.into(), value);
    }
}

/// Runtime-only policy: never edits a subscription or the user's saved choice.
/// Keep automatic groups warm even when a manual node is currently selected.
pub fn ensure_automatic_selection(config: &mut Mapping) {
    let Some(mut groups) = config.get("proxy-groups").and_then(Value::as_sequence).cloned() else {
        return;
    };
    let leaf_names: HashSet<std::string::String> = config
        .get("proxies")
        .and_then(Value::as_sequence)
        .into_iter()
        .flatten()
        .filter_map(Value::as_mapping)
        .filter(|proxy| {
            !matches!(text(proxy, "server"), "127.0.0.1" | "localhost" | "::1")
                && !text(proxy, "name").contains("提取码到期")
                && !matches!(text(proxy, "type"), "direct" | "reject")
        })
        .map(|proxy| text(proxy, "name").to_owned())
        .collect();

    let mut automatic = groups.iter().position(|group| {
        group.as_mapping().is_some_and(|group| {
            text(group, "name").contains("自动选择")
                && matches!(text(group, "type"), "url-test" | "fallback" | "load-balance")
        })
    });
    let mut new_primary = None;
    // A subscription without an automatic group gets one from the primary
    // selector's explicit leaf nodes/providers, never from unrelated groups.
    if automatic.is_none()
        && !groups.iter().any(|group| {
            group
                .as_mapping()
                .is_some_and(|group| text(group, "name") == "自动选择")
        })
        && !leaf_names.contains("自动选择")
    {
        let primary = groups
            .iter()
            .enumerate()
            .filter_map(|(index, value)| value.as_mapping().map(|group| (index, group)))
            .find(|(_, group)| primary_selector(group));
        if let Some((primary_index, primary)) = primary {
            let leaves: Vec<Value> = primary
                .get("proxies")
                .and_then(Value::as_sequence)
                .into_iter()
                .flatten()
                .filter(|item| item.as_str().is_some_and(|name| leaf_names.contains(name)))
                .cloned()
                .collect();
            let providers = primary
                .get("use")
                .and_then(Value::as_sequence)
                .cloned()
                .unwrap_or_default();
            if !leaves.is_empty() || !providers.is_empty() {
                let mut group = Mapping::new();
                group.insert("name".into(), "自动选择".into());
                group.insert("type".into(), "url-test".into());
                if !leaves.is_empty() {
                    group.insert("proxies".into(), Value::Sequence(leaves));
                }
                if !providers.is_empty() {
                    group.insert("use".into(), Value::Sequence(providers));
                }
                groups.push(Value::Mapping(group));
                automatic = Some(groups.len() - 1);
                new_primary = Some(primary_index);
            }
        }
    }
    let Some(index) = automatic else { return };
    let Some(group) = groups[index].as_mapping_mut() else {
        return;
    };
    let name = text(group, "name").to_owned();
    tune_health(group);
    if text(group, "type") == "url-test" {
        group.insert("tolerance".into(), 50.into());
    }
    let provider_names: Vec<std::string::String> = if group.get("include-all").and_then(Value::as_bool) == Some(true)
        || group.get("include-all-providers").and_then(Value::as_bool) == Some(true)
    {
        config
            .get("proxy-providers")
            .and_then(Value::as_mapping)
            .into_iter()
            .flat_map(|m| m.keys())
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect()
    } else {
        group
            .get("use")
            .and_then(Value::as_sequence)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect()
    };
    for (position, item) in groups.iter_mut().enumerate() {
        if position == index {
            continue;
        }
        let Some(selector) = item.as_mapping_mut() else {
            continue;
        };
        // Service groups may deliberately default to DIRECT or REJECT. Moving
        // automatic ahead of those changes their routing, including DNS when
        // respect-rules is enabled. Only the node selector gets this default.
        if !primary_selector(selector) {
            continue;
        }
        if Some(position) == new_primary && !selector.contains_key("proxies") {
            selector.insert("proxies".into(), Value::Sequence(vec![]));
        }
        if let Some(Value::Sequence(members)) = selector.get_mut("proxies") {
            let referenced = members.iter().any(|item| item.as_str() == Some(&name));
            if referenced || Some(position) == new_primary {
                members.retain(|item| item.as_str() != Some(&name));
                members.insert(0, Value::from(name.clone()));
            }
        }
    }
    if let Some(providers) = config.get_mut("proxy-providers").and_then(Value::as_mapping_mut) {
        for name in provider_names {
            if let Some(provider) = providers.get_mut(Value::from(name)).and_then(Value::as_mapping_mut) {
                let health = provider
                    .entry(Value::from("health-check"))
                    .or_insert_with(|| Value::Mapping(Mapping::new()));
                if let Some(health) = health.as_mapping_mut() {
                    tune_health(health);
                    health.remove("max-failed-times");
                    health.insert("enable".into(), true.into());
                }
            }
        }
    }
    config.insert("proxy-groups".into(), Value::Sequence(groups));
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    fn parse(s: &str) -> Mapping {
        serde_yaml_ng::from_str(s).expect("fixture YAML")
    }

    #[test]
    fn keeps_automatic_warm_first_and_preserves_rules_and_manual_nodes() {
        let mut config = parse(
            "proxies: [{name: A, type: ss, server: example.test}, {name: B, type: ss, server: example.test}]\nproxy-groups: [{name: 节点选择, type: select, proxies: [A, 自动选择, B]}, {name: 自动选择, type: url-test, proxies: [A, B], lazy: true}]\nrules: [MATCH,节点选择]",
        );
        let before = config.get("rules").cloned();
        ensure_automatic_selection(&mut config);
        let groups = config["proxy-groups"].as_sequence().expect("groups");
        assert_eq!(groups[0]["proxies"][0].as_str(), Some("自动选择"));
        assert_eq!(groups[1]["lazy"].as_bool(), Some(false));
        assert_eq!(groups[1]["interval"].as_u64(), Some(60));
        assert_eq!(groups[1]["max-failed-times"].as_u64(), Some(1));
        assert_eq!(groups[1]["tolerance"].as_u64(), Some(50));
        assert_eq!(config.get("rules"), before.as_ref());
        let once = config.clone();
        ensure_automatic_selection(&mut config);
        assert_eq!(once, config);
    }

    #[test]
    fn creates_missing_auto_from_primary_leaf_nodes_without_direct_or_cycles() {
        let mut config = parse(
            "proxies: [{name: A, type: ss, server: example.test}]\nproxy-groups: [{name: 节点选择, type: select, proxies: [DIRECT, A, Other]}, {name: Other, type: select, proxies: [节点选择]}]",
        );
        ensure_automatic_selection(&mut config);
        let groups = config["proxy-groups"].as_sequence().expect("groups");
        assert_eq!(groups.len(), 3);
        assert_eq!(
            groups[2]["proxies"].as_sequence().expect("members"),
            &vec![Value::from("A")]
        );
    }

    #[test]
    fn provider_health_is_enabled_for_use_members() {
        let mut config = parse(
            "proxy-providers: {remote: {type: file, path: ./nodes.yaml}}\nproxy-groups: [{name: 节点选择, type: select, use: [remote]}, {name: 自动选择, type: fallback, use: [remote]}]",
        );
        ensure_automatic_selection(&mut config);
        assert_eq!(
            config["proxy-providers"]["remote"]["health-check"]["enable"].as_bool(),
            Some(true)
        );
        assert_eq!(
            config["proxy-providers"]["remote"]["health-check"]["lazy"].as_bool(),
            Some(false)
        );
    }

    #[test]
    fn expired_and_empty_profiles_never_gain_a_bypass() {
        for input in [
            "{}",
            "proxies: [{name: 提取码到期，请续费使用, type: socks5, server: 127.0.0.1, port: 1}]\nproxy-groups: [{name: 节点选择, type: select, proxies: [提取码到期，请续费使用]}]",
        ] {
            let mut config = parse(input);
            let before = config.clone();
            ensure_automatic_selection(&mut config);
            assert_eq!(config, before);
        }
    }

    #[test]
    fn existing_user_name_is_not_overwritten() {
        let mut config = parse(
            "proxies: [{name: A, type: ss, server: example.test}]\nproxy-groups: [{name: 自动选择, type: select, proxies: [A]}, {name: 节点选择, type: select, proxies: [A]}]",
        );
        let before = config.clone();
        ensure_automatic_selection(&mut config);
        assert_eq!(config, before);
    }

    #[test]
    fn direct_and_service_group_defaults_are_not_reordered() {
        let mut config = parse(
            "proxies: [{name: A, type: ss, server: example.test}]\nproxy-groups: [{name: 🚀 节点选择, type: select, proxies: [A, ♻️ 自动选择]}, {name: ♻️ 自动选择, type: url-test, proxies: [A]}, {name: 🎯 全球直连, type: select, proxies: [DIRECT, 🚀 节点选择, ♻️ 自动选择]}, {name: 广告过滤, type: select, proxies: [REJECT, ♻️ 自动选择]}]",
        );
        let before = config["proxy-groups"].as_sequence().expect("groups").clone();
        ensure_automatic_selection(&mut config);
        let groups = config["proxy-groups"].as_sequence().expect("groups");
        assert_eq!(groups[0]["proxies"][0].as_str(), Some("♻️ 自动选择"));
        assert_eq!(groups[2], before[2]);
        assert_eq!(groups[3], before[3]);
    }
}
