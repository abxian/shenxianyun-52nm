use super::CmdResult;
use crate::constants::files;
use crate::core::autostart;
use crate::core::handle;
use crate::{cmd::StringifyErr as _, feat, utils, utils::dirs};
use clash_verge_logging::{Type, logging};
use smartstring::alias::String;
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Manager as _};

const FACTORY_RESET_FILES: &[&str] = &[
    dirs::CLASH_CONFIG,
    dirs::VERGE_CONFIG,
    dirs::PROFILE_YAML,
    files::RUNTIME_CONFIG,
    files::CHECK_CONFIG,
    files::DNS_CONFIG,
    files::WINDOW_STATE,
    ".shenxianyun-managed-auth",
    ".encryption_key",
];

fn remove_factory_reset_config(app_dir: &Path) -> std::io::Result<usize> {
    let mut removed = 0;

    for &name in FACTORY_RESET_FILES {
        let path = app_dir.join(name);
        if path.exists() {
            fs::remove_file(path)?;
            removed += 1;
        }
    }

    let profiles_dir = app_dir.join("profiles");
    if profiles_dir.exists() {
        fs::remove_dir_all(profiles_dir)?;
        removed += 1;
    }

    Ok(removed)
}

/// 打开应用程序所在目录
#[tauri::command]
pub async fn open_app_dir() -> CmdResult<()> {
    let app_dir = dirs::app_home_dir().stringify_err()?;
    open::that(app_dir).stringify_err()
}

/// 打开核心所在目录
#[tauri::command]
pub async fn open_core_dir() -> CmdResult<()> {
    let core_dir = tauri::utils::platform::current_exe().stringify_err()?;
    let core_dir = core_dir.parent().ok_or("failed to get core dir")?;
    open::that(core_dir).stringify_err()
}

/// 打开日志目录
#[tauri::command]
pub async fn open_logs_dir() -> CmdResult<()> {
    let log_dir = dirs::app_logs_dir().stringify_err()?;
    open::that(log_dir).stringify_err()
}

/// 打开网页链接
#[tauri::command]
pub fn open_web_url(url: String) -> CmdResult<()> {
    open::that(url.as_str()).stringify_err()
}

/// 打开/关闭开发者工具
#[tauri::command]
pub fn open_devtools(app_handle: AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        if !window.is_devtools_open() {
            window.open_devtools();
        } else {
            window.close_devtools();
        }
    }
}

/// 退出应用
#[tauri::command]
pub async fn exit_app() {
    feat::quit().await;
}

/// 重启应用
#[tauri::command]
pub async fn restart_app() -> CmdResult<()> {
    feat::restart_app().await;
    Ok(())
}

/// 删除旧配置并直接重启。这里不能调用常规 restart_app，因为常规重启会先把
/// 内存中的旧配置重新写回磁盘，导致“彻底重置”看似成功但旧配置再次出现。
#[tauri::command]
pub async fn factory_reset_app() -> CmdResult<()> {
    logging!(info, Type::System, "开始彻底重置并重建客户端配置");
    handle::Handle::global().set_is_exiting();
    utils::server::shutdown_embedded_server();

    if !feat::clean_async().await {
        logging!(
            warn,
            Type::System,
            "重置前部分系统清理未完成，将继续删除客户端配置"
        );
    }

    let app_dir = dirs::app_home_dir().stringify_err()?;
    let removed = remove_factory_reset_config(&app_dir).stringify_err()?;
    logging!(
        info,
        Type::System,
        "彻底重置已删除 {} 个配置入口；日志、本地备份和稳定设备 ID 保留",
        removed
    );

    handle::Handle::app_handle().restart()
}

/// 获取便携版标识
#[tauri::command]
pub fn get_portable_flag() -> bool {
    *dirs::PORTABLE_FLAG.get().unwrap_or(&false)
}

/// 获取应用目录
#[tauri::command]
pub fn get_app_dir() -> CmdResult<String> {
    let app_home_dir = dirs::app_home_dir().stringify_err()?.to_string_lossy().into();
    Ok(app_home_dir)
}

/// 获取当前自启动状态
#[tauri::command]
pub fn get_auto_launch_status() -> CmdResult<bool> {
    autostart::get_launch_status().stringify_err()
}

/// 下载图标缓存
#[tauri::command]
pub async fn download_icon_cache(url: String, name: String) -> CmdResult<String> {
    feat::download_icon_cache(url, name).await
}

/// 复制图标文件
#[tauri::command]
pub async fn copy_icon_file(path: String, icon_info: feat::IconInfo) -> CmdResult<String> {
    feat::copy_icon_file(path, icon_info).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn factory_reset_removes_only_generated_config() -> std::io::Result<()> {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "shenxianyun-factory-reset-{}-{suffix}",
            std::process::id()
        ));
        fs::create_dir_all(root.join("profiles"))?;
        fs::create_dir_all(root.join("logs"))?;
        fs::create_dir_all(root.join(dirs::BACKUP_DIR))?;
        fs::write(root.join(dirs::VERGE_CONFIG), b"old")?;
        fs::write(root.join(files::RUNTIME_CONFIG), b"old")?;
        fs::write(root.join(".shenxianyun-managed-auth"), b"secret")?;
        fs::write(root.join("profiles").join("old.yaml"), b"old")?;
        fs::write(root.join("logs").join("latest.log"), b"keep")?;
        fs::write(root.join(dirs::BACKUP_DIR).join("backup.zip"), b"keep")?;
        fs::write(root.join("Country.mmdb"), b"keep")?;

        let removed = remove_factory_reset_config(&root)?;

        assert_eq!(removed, 4);
        assert!(!root.join(dirs::VERGE_CONFIG).exists());
        assert!(!root.join(files::RUNTIME_CONFIG).exists());
        assert!(!root.join(".shenxianyun-managed-auth").exists());
        assert!(!root.join("profiles").exists());
        assert!(root.join("logs").join("latest.log").exists());
        assert!(root.join(dirs::BACKUP_DIR).join("backup.zip").exists());
        assert!(root.join("Country.mmdb").exists());

        fs::remove_dir_all(root)?;
        Ok(())
    }
}
