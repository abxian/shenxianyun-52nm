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

fn pin_routing_choices(config: &Mapping, groups: &mut Vec<Value>, automatic: &str, primary: usize) {
    let Some(members) = groups[primary].get("proxies").and_then(Value::as_sequence) else {
        return;
    };
    let mut members = members.clone();
    let dedicated: HashSet<_> = groups
        .iter()
        .filter_map(Value::as_mapping)
        .filter(|group| {
            text(group, "name")
                .trim_end_matches(|c: char| c.is_ascii_digit())
                .ends_with("最终选择")
        })
        .filter_map(|group| group.get("proxies").and_then(Value::as_sequence))
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    let leaves: HashSet<_> = config
        .get("proxies")
        .and_then(Value::as_sequence)
        .into_iter()
        .flatten()
        .filter_map(Value::as_mapping)
        .filter_map(|proxy| {
            let name = text(proxy, "name");
            let host = text(proxy, "server");
            let eligible = !host.is_empty()
                && host != "localhost"
                && !host
                    .parse::<std::net::IpAddr>()
                    .is_ok_and(|ip| ip.is_loopback() || ip.is_unspecified())
                && !matches!(text(proxy, "type"), "" | "direct" | "reject" | "dns")
                && !proxy.contains_key("dialer-proxy")
                && !dedicated.contains(name)
                && !name.is_empty()
                && !["专线", "客服", "公告", "倒卖", "到期", "剩余流量", "续费"]
                    .iter()
                    .any(|term| name.contains(term))
                && !matches!(name, "神仙云" | "吾爱云");
            eligible.then_some(name)
        })
        .collect();
    let mut seen = HashSet::new();
    let candidates: Vec<_> = members
        .iter()
        .filter_map(Value::as_str)
        .filter(|name| leaves.contains(name) && seen.insert(*name))
        .map(Value::from)
        .collect();
    let mut pinned = Vec::new();
    for (name, kind, strategy) in [
        ("负载均衡", "load-balance", Some("consistent-hashing")),
        ("轮询负载均衡", "load-balance", Some("round-robin")),
        ("故障转移", "fallback", None),
    ] {
        let existing = groups
            .iter()
            .filter_map(Value::as_mapping)
            .find(|g| text(g, "name") == name);
        if let Some(group) = existing {
            if text(group, "type") == kind && members.iter().any(|m| m.as_str() == Some(name)) {
                pinned.push(Value::from(name));
            }
            continue;
        }
        let node_collision = config
            .get("proxies")
            .and_then(Value::as_sequence)
            .into_iter()
            .flatten()
            .filter_map(Value::as_mapping)
            .any(|node| text(node, "name") == name);
        if candidates.len() < 2 || node_collision {
            continue;
        }
        let mut group = Mapping::new();
        group.insert("name".into(), name.into());
        group.insert("type".into(), kind.into());
        group.insert("proxies".into(), Value::Sequence(candidates.clone()));
        tune_health(&mut group);
        group.insert("lazy".into(), true.into());
        if let Some(strategy) = strategy {
            group.insert("strategy".into(), strategy.into());
        }
        groups.push(Value::Mapping(group));
        pinned.push(Value::from(name));
    }
    members.retain(|item| !pinned.contains(item));
    if let Some(position) = members.iter().position(|m| m.as_str() == Some(automatic)) {
        members.splice(position + 1..position + 1, pinned);
        groups[primary]["proxies"] = Value::Sequence(members);
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
    if let Some(primary) = groups.iter().position(|entry| {
        entry.as_mapping().is_some_and(|selector| {
            primary_selector(selector)
                && selector
                    .get("proxies")
                    .and_then(Value::as_sequence)
                    .is_some_and(|members| members.iter().any(|member| member.as_str() == Some(&name)))
        })
    }) {
        pin_routing_choices(config, &mut groups, &name, primary);
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
        assert_eq!(
            groups[0]["proxies"].as_sequence().expect("members"),
            &["自动选择", "负载均衡", "轮询负载均衡", "故障转移", "A", "B"].map(Value::from)
        );
        assert_eq!(groups[2]["strategy"].as_str(), Some("consistent-hashing"));
        assert_eq!(groups[3]["strategy"].as_str(), Some("round-robin"));
        assert_eq!(groups[4]["type"].as_str(), Some("fallback"));
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
    fn optional_groups_exclude_dedicated_and_placeholder_nodes_and_respect_collisions() {
        let mut config = parse(
            "proxies: [{name: A, type: ss, server: a.test}, {name: B, type: ss, server: b.test}, {name: 独立, type: ss, server: dedicated.test}, {name: 落地中转, type: ss, server: dedicated.test, dialer-proxy: A}, {name: 客服公告, type: ss, server: notice.test}, {name: 香港专线, type: ss, server: line.test}, {name: 轮询负载均衡, type: ss, server: local.test}]\nproxy-groups: [{name: 节点选择, type: select, proxies: [A, B, 独立, 落地中转, 客服公告, 香港专线, DIRECT]}, {name: my01最终选择, type: select, proxies: [独立, 落地中转]}]",
        );
        ensure_automatic_selection(&mut config);
        let groups = config["proxy-groups"].as_sequence().expect("groups");
        for name in ["负载均衡", "故障转移"] {
            let group = groups
                .iter()
                .find(|row| row["name"].as_str() == Some(name))
                .expect("strategy");
            assert_eq!(
                group["proxies"].as_sequence().expect("members"),
                &["A", "B"].map(Value::from)
            );
        }
        assert!(!groups.iter().any(|row| row["name"].as_str() == Some("轮询负载均衡")));
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
