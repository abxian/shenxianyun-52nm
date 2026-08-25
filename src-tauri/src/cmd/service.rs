use super::{CmdResult, StringifyErr as _};
use crate::{
    config::Config,
    core::{
        CoreManager, autostart,
        service::{self, SERVICE_MANAGER, ServiceStatus},
    },
    utils::dirs,
};
use serde::Serialize;
use std::{env::current_exe, path::Path};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceDiagnostics {
    app_path: String,
    app_home_path: String,
    configured_core: String,
    expected_core_path: String,
    expected_core_exists: bool,
    service_path: String,
    service_payload_exists: bool,
    running_mode: String,
    sidecar_pid: Option<u32>,
    service_status: String,
    service_ipc_path: String,
    service_ipc_exists: bool,
    service_protocol_mismatch: bool,
    auto_launch_enabled: bool,
    auto_launch_targets: Vec<String>,
    warnings: Vec<String>,
}

#[cfg(target_os = "windows")]
fn same_windows_executable(current: &Path, target: &str) -> bool {
    let target = target.trim().trim_matches('"');
    match (dunce::canonicalize(current), dunce::canonicalize(target)) {
        (Ok(current), Ok(target)) => current == target,
        _ => current
            .to_string_lossy()
            .replace('/', "\\")
            .eq_ignore_ascii_case(&target.replace('/', "\\")),
    }
}

async fn execute_service_operation_sync(status: ServiceStatus, op_type: &str) -> CmdResult {
    SERVICE_MANAGER
        .handle_service_status(status)
        .await
        .map_err(|e| format!("{op_type} Service failed: {e}").into())
}

#[tauri::command]
pub async fn install_service() -> CmdResult {
    execute_service_operation_sync(ServiceStatus::InstallRequired, "Install").await
}

#[tauri::command]
pub async fn uninstall_service() -> CmdResult {
    execute_service_operation_sync(ServiceStatus::UninstallRequired, "Uninstall").await
}

#[tauri::command]
pub async fn reinstall_service() -> CmdResult {
    execute_service_operation_sync(ServiceStatus::ReinstallRequired, "Reinstall").await
}

#[tauri::command]
pub async fn repair_service() -> CmdResult {
    execute_service_operation_sync(ServiceStatus::ForceReinstallRequired, "Repair").await
}

#[tauri::command]
pub async fn is_service_available() -> CmdResult<bool> {
    service::is_service_available().await.stringify_err()?;
    if clash_verge_service_ipc::is_reinstall_service_needed().await {
        return Err("系统服务协议不匹配，请在客户端中明确执行“修复系统服务”".into());
    }
    Ok(true)
}

#[tauri::command]
pub async fn get_service_diagnostics() -> CmdResult<ServiceDiagnostics> {
    let app_path = current_exe().stringify_err()?;
    let app_home_path = dirs::app_home_dir().stringify_err()?;
    let configured_core = Config::verge().await.latest_arc().get_valid_clash_core();
    let bin_ext = if cfg!(windows) { ".exe" } else { "" };
    let expected_core_path = app_path.with_file_name(format!("{configured_core}{bin_ext}"));

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    let service_path = dirs::service_path().stringify_err()?;
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let service_path = app_path.with_file_name("clash-verge-service");

    let running_mode = CoreManager::global().get_running_mode().to_string();
    let sidecar_pid = CoreManager::global().get_sidecar_pid();
    let service_status = format!("{:?}", SERVICE_MANAGER.current().await);
    let service_ipc_path = Path::new(clash_verge_service_ipc::IPC_PATH);
    let service_ipc_exists = service_ipc_path.exists();
    let service_protocol_mismatch = service_ipc_exists && clash_verge_service_ipc::is_reinstall_service_needed().await;

    let auto_launch_enabled = autostart::get_launch_status().unwrap_or(false);
    #[cfg(target_os = "windows")]
    let auto_launch_targets = crate::utils::schtasks::auto_launch_task_targets();
    #[cfg(not(target_os = "windows"))]
    let auto_launch_targets = Vec::new();

    let mut warnings = Vec::new();
    if !expected_core_path.exists() {
        warnings.push(format!("当前安装目录缺少核心文件 {}", expected_core_path.display()));
    }
    if !service_path.exists() {
        warnings.push(format!("当前安装目录缺少服务组件 {}", service_path.display()));
    }
    if service_protocol_mismatch {
        warnings.push("系统服务协议与当前客户端不匹配，需要用户明确修复".into());
    }

    #[cfg(target_os = "windows")]
    for target in &auto_launch_targets {
        if !same_windows_executable(&app_path, target) {
            warnings.push(format!("开机启动任务仍指向其他安装目录：{target}"));
        }
    }

    Ok(ServiceDiagnostics {
        app_path: app_path.to_string_lossy().into_owned(),
        app_home_path: app_home_path.to_string_lossy().into_owned(),
        configured_core: configured_core.to_string(),
        expected_core_path: expected_core_path.to_string_lossy().into_owned(),
        expected_core_exists: expected_core_path.exists(),
        service_path: service_path.to_string_lossy().into_owned(),
        service_payload_exists: service_path.exists(),
        running_mode,
        sidecar_pid,
        service_status,
        service_ipc_path: service_ipc_path.to_string_lossy().into_owned(),
        service_ipc_exists,
        service_protocol_mismatch,
        auto_launch_enabled,
        auto_launch_targets,
        warnings,
    })
}
