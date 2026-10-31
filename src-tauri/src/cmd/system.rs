use std::sync::Arc;

use crate::core::{CoreManager, manager::RunningMode};

/// 获取当前内核运行模式
#[tauri::command]
pub async fn get_running_mode() -> Result<Arc<RunningMode>, String> {
    Ok(CoreManager::global().get_running_mode())
}

/// 获取当前这个客户端自身的 CPU 架构（"aarch64" / "x86_64" 等）。
///
/// 前端拿它决定 macOS 下该给用户哪个安装包：Apple 芯片给 aarch64 的 dmg，
/// Intel 给 x64 的 dmg。用编译期常量而不是 UA 判断，是因为 macOS 的
/// WKWebView 在 Apple 芯片上同样自称 "Intel Mac OS X"，UA 判不出来。
#[tauri::command]
pub async fn get_app_arch() -> Result<&'static str, String> {
    Ok(std::env::consts::ARCH)
}
