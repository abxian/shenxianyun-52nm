use anyhow::Result;
use percent_encoding::percent_decode_str;
use smartstring::alias::String;
use tauri::Url;

use crate::{
    cmd::managed::{self, ManagedImportRequest},
    config::{Config, PrfItem, profiles},
    core::{CoreManager, handle},
    utils::help,
};
use clash_verge_logging::{Type, logging, logging_error};
use tauri::Emitter as _;

const MANAGED_IMPORT_SCHEME: &str = env!("MANAGED_IMPORT_SCHEME");

pub(super) async fn resolve_scheme(param: &str) -> Result<()> {
    let param_str = if param.starts_with("[") && param.len() > 4 {
        param
            .get(2..param.len() - 2)
            .ok_or_else(|| anyhow::anyhow!("Invalid string slice boundaries"))?
    } else {
        param
    };
    let masked_deep_link = help::mask_url(param_str);

    logging!(debug, Type::Config, "received deep link: {masked_deep_link}");

    let link_parsed = Url::parse(param_str)
        .map_err(|e| anyhow::anyhow!("failed to parse deep link: {e:?}, param: {masked_deep_link}"))?;

    if let Some(request) = extract_managed_import_request(&link_parsed) {
        managed::queue_managed_import(request);
        let _ = handle::Handle::app_handle().emit("shenxianyun://managed-import", ());
        logging!(info, Type::Config, "queued protected subscription import request");
        return Ok(());
    }

    let Some((url, name)) = extract_subscription_info(&link_parsed) else {
        logging!(
            warn,
            Type::Config,
            "missing url parameter in deep link: {masked_deep_link}"
        );
        return Ok(());
    };

    import_subscription(&url, name.as_ref()).await;
    Ok(())
}

fn extract_managed_import_request(link_parsed: &Url) -> Option<ManagedImportRequest> {
    if link_parsed.scheme() != MANAGED_IMPORT_SCHEME
        || link_parsed.host_str() != Some("install-config")
    {
        return None;
    }

    let mut ticket = None;
    let mut api_base = None;
    let mut name = None;
    for (key, value) in link_parsed.query_pairs() {
        match key.as_ref() {
            "ticket" => ticket = Some(value.into_owned()),
            "api" => api_base = sanitize_api_base(value.as_ref()),
            "name" => name = Some(value.into_owned()),
            _ => {}
        }
    }

    let ticket = ticket?.trim().to_string();
    if ticket.is_empty() {
        return None;
    }
    Some(ManagedImportRequest {
        ticket,
        api_base: api_base?,
        name,
    })
}

fn sanitize_api_base(value: &str) -> Option<std::string::String> {
    let mut parsed = Url::parse(value).ok()?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return None;
    }
    parsed.set_query(None);
    parsed.set_fragment(None);
    let path = parsed.path().trim_end_matches('/').to_string();
    parsed.set_path(&path);
    Some(parsed.to_string().trim_end_matches('/').to_string())
}

fn extract_subscription_info(link_parsed: &Url) -> Option<(std::string::String, Option<String>)> {
    if !matches!(link_parsed.scheme(), "clash" | "clash-verge")
        && link_parsed.scheme() != MANAGED_IMPORT_SCHEME
    {
        return None;
    }

    let name = link_parsed
        .query_pairs()
        .find(|(key, _)| key == "name")
        .map(|(_, value)| value.into_owned().into());
    let url = extract_subscription_url(link_parsed)?;
    Some((url, name))
}

fn extract_subscription_url(link_parsed: &Url) -> Option<std::string::String> {
    let query = link_parsed.query()?;
    let prefix = "url=";
    let pos = query.find(prefix)?;
    let raw_url = query[pos + prefix.len()..].trim();
    Some(decode_subscription_url(raw_url))
}

fn decode_subscription_url(raw_url: &str) -> std::string::String {
    // Avoid double-decoding nested subscription URLs; decode only when needed.
    if Url::parse(raw_url).is_ok() {
        return raw_url.to_string();
    }

    let mut candidate = raw_url.to_string();
    for _ in 0..2 {
        let next = percent_decode_str(&candidate).decode_utf8_lossy().to_string();
        if next == candidate {
            break;
        }
        candidate = next;
        if Url::parse(&candidate).is_ok() {
            break;
        }
    }
    candidate
}

async fn import_subscription(url: &str, name: Option<&String>) {
    let had_current_profile = {
        let profiles = Config::profiles().await;
        profiles.latest_arc().current.is_some()
    };

    let Some(mut item) = fetch_profile_item(url, name).await else {
        return;
    };

    let uid = item.uid.clone().unwrap_or_default();
    if let Err(e) = profiles::profiles_append_item_safe(&mut item).await {
        logging!(error, Type::Config, "failed to import subscription url: {:?}", e);
        Config::profiles().await.discard();
        handle::Handle::notice_message("import_sub_url::error", e.to_string());
        return;
    }

    Config::profiles().await.apply();
    logging_error!(Type::Config, Config::profiles().await.data_arc().save_file().await);
    handle::Handle::notice_message(
        "import_sub_url::ok",
        "", // 空 msg 传入，我们不希望导致 后端-前端-后端 死循环，这里只做提醒。
    );

    post_import_updates(&uid, had_current_profile).await;
}

async fn fetch_profile_item(url: &str, name: Option<&String>) -> Option<PrfItem> {
    match PrfItem::from_url(url, name, None, None).await {
        Ok(item) => Some(item),
        Err(e) => {
            logging!(error, Type::Config, "failed to parse profile from url: {:?}", e);
            handle::Handle::notice_message("import_sub_url::error", e.to_string());
            None
        }
    }
}

async fn post_import_updates(uid: &String, had_current_profile: bool) {
    handle::Handle::refresh_verge();
    handle::Handle::notify_profile_changed(uid);

    let should_update_core = if uid.is_empty() || had_current_profile {
        false
    } else {
        let profiles = Config::profiles().await;
        profiles.latest_arc().is_current_profile_index(uid)
    };

    if should_update_core {
        refresh_core_config().await;
    }
}

async fn refresh_core_config() {
    logging!(
        info,
        Type::Config,
        "Deep link import set current profile; refreshing core config"
    );
    match CoreManager::global().update_config_forced().await {
        Ok(outcome) if outcome.is_valid() => handle::Handle::refresh_clash(),
        Ok(outcome) => {
            let message = outcome.to_string();
            logging!(warn, Type::Config, "Apply config failed: {}", message);
            handle::Handle::notice_message("config_validate::error", message);
        }
        Err(err) => {
            logging!(error, Type::Config, "Apply config error: {}", err);
            handle::Handle::notice_message("update_failed", format!("{err}"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_protected_import_without_subscription_url() -> anyhow::Result<()> {
        let link = Url::parse(&format!(
            "{MANAGED_IMPORT_SCHEME}://install-config?ticket=one-time-secret&api=https%3A%2F%2Fapi.example.test%3A5443&name=demo"
        ))?;
        let request = extract_managed_import_request(&link)
            .ok_or_else(|| anyhow::anyhow!("protected request was not parsed"))?;
        assert_eq!(request.ticket, "one-time-secret");
        assert_eq!(request.api_base, "https://api.example.test:5443");
        assert_eq!(request.name.as_deref(), Some("demo"));
        Ok(())
    }

    #[test]
    fn rejects_protected_import_without_ticket_or_http_api() -> anyhow::Result<()> {
        let missing_ticket = Url::parse(&format!(
            "{MANAGED_IMPORT_SCHEME}://install-config?api=https%3A%2F%2Fapi.example.test"
        ))?;
        assert!(extract_managed_import_request(&missing_ticket).is_none());

        let unsafe_api = Url::parse(&format!(
            "{MANAGED_IMPORT_SCHEME}://install-config?ticket=secret&api=file%3A%2F%2F%2Ftmp%2Fconfig"
        ))?;
        assert!(extract_managed_import_request(&unsafe_api).is_none());
        Ok(())
    }

    #[test]
    fn keeps_legacy_url_import_compatible() -> anyhow::Result<()> {
        let link = Url::parse(&format!(
            "{MANAGED_IMPORT_SCHEME}://install-config?url=https%3A%2F%2Fexample.test%2Fsub%2Fcode&name=legacy"
        ))?;
        assert!(extract_managed_import_request(&link).is_none());
        let (url, name) = extract_subscription_info(&link)
            .ok_or_else(|| anyhow::anyhow!("legacy request was not parsed"))?;
        assert_eq!(url, "https://example.test/sub/code");
        assert_eq!(name.as_deref(), Some("legacy"));
        Ok(())
    }
}
