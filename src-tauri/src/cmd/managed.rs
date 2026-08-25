use super::{CmdResult, StringifyErr as _};
use crate::{
    config::{decrypt_data, encrypt_data},
    utils::dirs,
};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use smartstring::alias::String as SmartString;
use std::fs;

const MANAGED_AUTH_FILE: &str = ".shenxianyun-managed-auth";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedImportRequest {
    pub ticket: String,
    pub api_base: String,
    pub name: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAuth {
    pub access_code: String,
    pub profile_uid: String,
    pub api_base: String,
    pub subscription_url: String,
    pub device_token: String,
    pub expires_at: String,
    pub limit_mode: String,
    pub content_hash: String,
    pub detached: bool,
    pub update_version: u64,
}

static PENDING_MANAGED_IMPORT: Lazy<Mutex<Option<ManagedImportRequest>>> = Lazy::new(|| Mutex::new(None));

pub fn queue_managed_import(request: ManagedImportRequest) {
    *PENDING_MANAGED_IMPORT.lock() = Some(request);
}

fn managed_auth_path() -> CmdResult<std::path::PathBuf> {
    Ok(dirs::app_home_dir().stringify_err()?.join(MANAGED_AUTH_FILE))
}

#[cfg(unix)]
fn restrict_file_permissions(path: &std::path::Path) -> CmdResult<()> {
    use std::os::unix::fs::PermissionsExt as _;

    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).stringify_err()
}

#[tauri::command]
pub fn take_managed_import_request() -> Option<ManagedImportRequest> {
    PENDING_MANAGED_IMPORT.lock().take()
}

#[tauri::command]
pub fn load_managed_auth() -> CmdResult<Option<ManagedAuth>> {
    let path = managed_auth_path()?;
    if !path.exists() {
        return Ok(None);
    }

    let encrypted = fs::read_to_string(&path).stringify_err()?;
    let json =
        decrypt_data(encrypted.trim()).map_err(|_| SmartString::from("受管订阅凭据无法解密，请重新导入提取码"))?;
    let auth = serde_json::from_str::<ManagedAuth>(&json).stringify_err()?;
    Ok(Some(auth))
}

#[tauri::command]
pub fn save_managed_auth(auth: ManagedAuth) -> CmdResult<()> {
    if auth.access_code.trim().is_empty()
        || auth.profile_uid.trim().is_empty()
        || auth.subscription_url.trim().is_empty()
        || auth.device_token.trim().is_empty()
    {
        return Err("受管订阅凭据不完整".into());
    }

    let path = managed_auth_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).stringify_err()?;
    }
    let json = serde_json::to_string(&auth).stringify_err()?;
    let encrypted = encrypt_data(&json).map_err(|_| SmartString::from("受管订阅凭据加密失败"))?;
    fs::write(&path, encrypted.as_bytes()).stringify_err()?;
    #[cfg(unix)]
    restrict_file_permissions(&path)?;
    Ok(())
}

#[tauri::command]
pub fn clear_managed_auth() -> CmdResult<()> {
    let path = managed_auth_path()?;
    if path.exists() {
        fs::remove_file(path).stringify_err()?;
    }
    Ok(())
}
