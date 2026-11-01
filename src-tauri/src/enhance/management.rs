//! A loopback-only forced-DIRECT inbound for official control requests. Unlike
//! ordinary domain rules, inbound SpecialProxy precedes global-mode selection.
use once_cell::sync::Lazy;
use serde_yaml_ng::{Mapping, Value};
use std::net::{Ipv4Addr, TcpListener};

const NAME: &str = "official-management-direct";
static PORT: Lazy<Result<u16, String>> = Lazy::new(|| {
    TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .and_then(|socket| socket.local_addr().map(|address| address.port()))
        .map_err(|_| "management loopback port unavailable".to_owned())
});

pub fn proxy_url() -> Result<std::string::String, String> {
    PORT.as_ref()
        .map(|port| format!("http://127.0.0.1:{port}"))
        .map_err(Clone::clone)
}

pub fn apply(config: &mut Mapping) -> Result<(), String> {
    let port = PORT.as_ref().map_err(Clone::clone)?;
    let listeners = config
        .entry(Value::from("listeners"))
        .or_insert_with(|| Value::Sequence(Vec::new()));
    if listeners.is_null() {
        *listeners = Value::Sequence(Vec::new());
    }
    let listeners = listeners.as_sequence_mut().ok_or("listeners must be a sequence")?;
    listeners.retain(|row| row.get("name").and_then(Value::as_str) != Some(NAME));
    let mut listener = Mapping::new();
    listener.insert("name".into(), NAME.into());
    listener.insert("type".into(), "mixed".into());
    listener.insert("listen".into(), "127.0.0.1".into());
    listener.insert("port".into(), Value::from(*port));
    listener.insert("proxy".into(), "DIRECT".into());
    listener.insert("udp".into(), false.into());
    listeners.push(Value::Mapping(listener));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn direct_inbound_preserves_global_and_user_rules() -> Result<(), String> {
        let mut config: Mapping = serde_yaml_ng::from_str(
            "mode: global\nrules: [MATCH,Proxy]\nlisteners: [{name: own, type: mixed, port: 12345}]",
        )
        .map_err(|_| "fixture".to_owned())?;
        let rules = config["rules"].clone();
        apply(&mut config)?;
        apply(&mut config)?;
        assert_eq!(config["mode"], Value::from("global"));
        assert_eq!(config["rules"], rules);
        let rows = config["listeners"].as_sequence().ok_or("listeners")?;
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1]["proxy"], Value::from("DIRECT"));
        assert_eq!(rows[1]["listen"], Value::from("127.0.0.1"));
        assert!(proxy_url()?.starts_with("http://127.0.0.1:"));
        Ok(())
    }
}
