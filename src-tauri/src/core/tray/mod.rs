use crate::config::IVerge;
use crate::core::tray::menu_def::TrayAction;
use crate::module::lightweight;
use crate::process::AsyncHandler;
use crate::singleton;
use crate::utils::window_manager::WindowManager;
use crate::{
    Type, cmd,
    config::Config,
    feat, logging,
    module::lightweight::is_in_lightweight_mode,
    utils::{brand, dirs::find_target_icons, help},
};
use clash_verge_limiter::{Limiter, SystemClock, SystemLimiter};
use clash_verge_logging::logging_error;
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tokio::fs;

use super::handle;
use anyhow::Result;
use smartstring::alias::String;
use std::collections::HashMap;
use std::time::Duration;
use tauri::{
    AppHandle, Wry,
    menu::{CheckMenuItem, IsMenuItem, MenuEvent, MenuItem, Submenu},
};

mod menu_def;
#[cfg(target_os = "macos")]
mod speed_task;
use menu_def::{MenuIds, MenuTexts};

// TODO: 是否需要将可变菜单抽离存储起来，后续直接更新对应菜单实例，无需重新创建菜单(待考虑)

const TRAY_CLICK_DEBOUNCE_MS: u64 = 300;
pub const TRAY_ID: &str = "clash-verge-rev-tray";

#[derive(Clone)]
struct TrayState {}

enum IconKind {
    Common,
    SysProxy,
    Tun,
}

pub struct Tray {
    limiter: SystemLimiter,
    #[cfg(target_os = "macos")]
    speed_controller: speed_task::TraySpeedController,
}

impl TrayState {
    async fn get_tray_icon(verge: &IVerge) -> (bool, Vec<u8>) {
        let tun_mode = verge.enable_tun_mode.unwrap_or(false);
        let system_mode = verge.enable_system_proxy.unwrap_or(false);
        let kind = if tun_mode {
            IconKind::Tun
        } else if system_mode {
            IconKind::SysProxy
        } else {
            IconKind::Common
        };
        Self::load_icon(verge, kind).await
    }

    async fn load_icon(verge: &IVerge, kind: IconKind) -> (bool, Vec<u8>) {
        let (custom_enabled, icon_name) = match kind {
            IconKind::Common => (verge.common_tray_icon.unwrap_or(false), "common"),
            IconKind::SysProxy => (verge.sysproxy_tray_icon.unwrap_or(false), "sysproxy"),
            IconKind::Tun => (verge.tun_tray_icon.unwrap_or(false), "tun"),
        };

        if custom_enabled
            && let Ok(Some(path)) = find_target_icons(icon_name)
            && let Ok(data) = fs::read(path).await
        {
            return (true, data);
        }

        Self::default_icon(verge, kind)
    }

    fn default_icon(verge: &IVerge, kind: IconKind) -> (bool, Vec<u8>) {
        #[cfg(target_os = "macos")]
        {
            let is_mono = verge.tray_icon.as_deref().unwrap_or("monochrome") == "monochrome";
            if is_mono {
                return (
                    false,
                    match kind {
                        IconKind::Common => include_bytes!("../../../icons/tray-icon-mono.ico").to_vec(),
                        IconKind::SysProxy => include_bytes!("../../../icons/tray-icon-sys-mono-new.ico").to_vec(),
                        IconKind::Tun => include_bytes!("../../../icons/tray-icon-tun-mono-new.ico").to_vec(),
                    },
                );
            }
        }

        #[cfg(not(target_os = "macos"))]
        let _ = verge;

        (
            false,
            match kind {
                IconKind::Common => include_bytes!("../../../icons/tray-icon.ico").to_vec(),
                IconKind::SysProxy => include_bytes!("../../../icons/tray-icon-sys.ico").to_vec(),
                IconKind::Tun => include_bytes!("../../../icons/tray-icon-tun.ico").to_vec(),
            },
        )
    }
}

impl Default for Tray {
    #[allow(clippy::unwrap_used)]
    fn default() -> Self {
        Self {
            limiter: Limiter::new(Duration::from_millis(TRAY_CLICK_DEBOUNCE_MS), SystemClock),
            #[cfg(target_os = "macos")]
            speed_controller: speed_task::TraySpeedController::new(),
        }
    }
}

singleton!(Tray, TRAY);

impl Tray {
    fn new() -> Self {
        Self::default()
    }

    pub async fn init(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘初始化");
            return Ok(());
        }

        let app_handle = handle::Handle::app_handle();

        match self.create_tray_from_handle(app_handle).await {
            Ok(_) => {
                logging!(info, Type::Tray, "System tray created successfully");
            }
            Err(e) => {
                // Don't return error, let application continue running without tray
                logging!(
                    warn,
                    Type::Tray,
                    "System tray creation failed: {e}, Application will continue running without tray icon",
                );
            }
        }
        Ok(())
    }

    /// 更新托盘点击行为
    pub async fn update_click_behavior(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘点击行为更新");
            return Ok(());
        }

        let app_handle = handle::Handle::app_handle();
        let tray_event = { Config::verge().await.latest_arc().tray_event.clone() };
        let tray_event = TrayAction::from(tray_event.as_deref().unwrap_or("main_window"));
        let tray = app_handle
            .tray_by_id(TRAY_ID)
            .ok_or_else(|| anyhow::anyhow!("Failed to get main tray"))?;
        match tray_event {
            TrayAction::TrayMenu => tray.set_show_menu_on_left_click(true)?,
            _ => tray.set_show_menu_on_left_click(false)?,
        }
        Ok(())
    }

    /// 更新托盘菜单
    pub async fn update_menu(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘菜单更新");
            return Ok(());
        }
        let app_handle = handle::Handle::app_handle();
        self.update_menu_internal(app_handle).await
    }

    async fn update_menu_internal(&self, app_handle: &AppHandle) -> Result<()> {
        let Some(tray) = app_handle.tray_by_id(TRAY_ID) else {
            logging!(warn, Type::Tray, "Failed to update tray menu: tray not found");
            return Ok(());
        };

        // This menu does not depend on core readiness, profiles or service IPC.
        logging_error!(Type::Tray, tray.set_menu(Some(create_tray_menu(app_handle).await?)));

        logging!(debug, Type::Tray, "托盘菜单更新成功");
        Ok(())
    }

    /// 更新托盘图标
    pub async fn update_icon(&self, verge: &IVerge) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘图标更新");
            return Ok(());
        }

        let app_handle = handle::Handle::app_handle();

        let Some(tray) = app_handle.tray_by_id(TRAY_ID) else {
            logging!(warn, Type::Tray, "Failed to update tray icon: tray not found");
            return Ok(());
        };

        let (_is_custom_icon, icon_bytes) = TrayState::get_tray_icon(verge).await;

        logging_error!(
            Type::Tray,
            tray.set_icon(Some(tauri::image::Image::from_bytes(&icon_bytes)?))
        );

        #[cfg(target_os = "macos")]
        {
            let is_colorful = verge.tray_icon.as_deref().unwrap_or("monochrome") == "colorful";
            logging_error!(Type::Tray, tray.set_icon_as_template(!is_colorful));
        }

        Ok(())
    }

    /// 更新托盘提示
    pub async fn update_tooltip(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘提示更新");
            return Ok(());
        }

        let app_handle = handle::Handle::app_handle();

        let verge = Config::verge().await.latest_arc();
        let system_proxy = verge.enable_system_proxy.unwrap_or(false);
        let tun_mode = verge.enable_tun_mode.unwrap_or(false);

        let switch_str = |flag: bool| {
            if flag { "on" } else { "off" }
        };

        // Get localized strings before using them
        let sys_proxy_text = clash_verge_i18n::t!("tray.tooltip.systemProxy");
        let tun_text = clash_verge_i18n::t!("tray.tooltip.tun");

        let v = env!("CARGO_PKG_VERSION");
        let reassembled_version = v.split_once('+').map_or_else(
            || v.into(),
            |(main, rest)| format!("{main}+{}", rest.split('.').next().unwrap_or("")),
        );

        let tooltip = build_tray_tooltip(
            reassembled_version,
            &sys_proxy_text,
            &tun_text,
            switch_str(system_proxy),
            switch_str(tun_mode),
        );

        let Some(tray) = app_handle.tray_by_id(TRAY_ID) else {
            logging!(warn, Type::Tray, "Failed to update tray tooltip: tray not found");
            return Ok(());
        };

        logging_error!(Type::Tray, tray.set_tooltip(Some(&tooltip)));

        Ok(())
    }

    pub async fn update_part(&self) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘局部更新");
            return Ok(());
        }
        let verge = Config::verge().await.data_arc();
        self.update_menu().await?;
        self.update_icon(&verge).await?;
        #[cfg(target_os = "macos")]
        self.update_speed_task(verge.enable_tray_speed.unwrap_or(false));
        self.update_tooltip().await?;
        Ok(())
    }

    pub async fn update_menu_and_icon(&self) {
        logging_error!(Type::Tray, self.update_menu().await);
        let verge = Config::verge().await.data_arc();
        logging_error!(Type::Tray, self.update_icon(&verge).await);
    }

    async fn create_tray_from_handle(&self, app_handle: &AppHandle) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            logging!(debug, Type::Tray, "应用正在退出，跳过托盘创建");
            return Ok(());
        }

        logging!(info, Type::Tray, "正在从AppHandle创建系统托盘");

        let verge = Config::verge().await.data_arc();

        let icon_bytes = TrayState::get_tray_icon(&verge).await.1;
        let icon = tauri::image::Image::from_bytes(&icon_bytes)?;

        #[cfg(target_os = "linux")]
        let builder = TrayIconBuilder::with_id(TRAY_ID).icon(icon).icon_as_template(false);

        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let show_menu_on_left_click = verge.tray_event.as_ref().is_some_and(|v| v == "tray_menu");

        #[cfg(not(target_os = "linux"))]
        let mut builder = TrayIconBuilder::with_id(TRAY_ID).icon(icon).icon_as_template(false);
        #[cfg(target_os = "macos")]
        {
            let is_monochrome = verge.tray_icon.as_ref().is_none_or(|v| v == "monochrome");
            builder = builder.icon_as_template(is_monochrome);
        }

        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            if !show_menu_on_left_click {
                builder = builder.show_menu_on_left_click(false);
            }
        }

        let tray = builder.build(app_handle)?;
        tray.on_tray_icon_event(on_tray_icon_event);
        tray.on_menu_event(on_menu_event);
        Ok(())
    }

    fn should_handle_tray_click(&self) -> bool {
        let allow = self.limiter.check();
        if !allow {
            logging!(debug, Type::Tray, "tray click rate limited");
        }
        allow
    }

    /// 根据配置统一更新托盘速率采集任务状态（macOS）
    #[cfg(target_os = "macos")]
    pub fn update_speed_task(&self, enable_tray_speed: bool) {
        self.speed_controller.update_task(enable_tray_speed);
    }
}

fn create_hotkeys(hotkeys: &Option<Vec<String>>) -> HashMap<&str, &str> {
    hotkeys
        .as_ref()
        .map(|h| {
            h.iter()
                .filter_map(|item| {
                    let mut parts = item.split(',');
                    match (parts.next(), parts.next()) {
                        (Some(func), Some(key)) => {
                            // 托盘菜单中的 `accelerator` 属性，在 Linux/Windows 中都不支持小键盘按键的解析
                            if key.to_uppercase().contains("NUMPAD") {
                                None
                            } else {
                                Some((func, key))
                            }
                        }
                        _ => None,
                    }
                })
                .collect::<HashMap<&str, &str>>()
        })
        .unwrap_or_default()
}

fn build_tray_tooltip(
    version: impl std::fmt::Display,
    system_proxy_text: &str,
    tun_text: &str,
    system_proxy_state: &str,
    tun_state: &str,
) -> std::string::String {
    format!(
        "{} {version}\n{system_proxy_text}: {system_proxy_state}\n{tun_text}: {tun_state}",
        brand::VISIBLE_APP_NAME
    )
}

fn build_tray_version_label(localized_label: &str, version: impl std::fmt::Display) -> std::string::String {
    format!("{} {version}", brand::native_text(localized_label))
}

async fn create_tray_menu(app_handle: &AppHandle) -> Result<tauri::menu::Menu<Wry>> {
    let verge_settings = Config::verge().await.latest_arc();
    let hotkeys = create_hotkeys(&verge_settings.hotkeys);
    let texts = MenuTexts::new();
    let version = env!("CARGO_PKG_VERSION");

    let open_window = &MenuItem::with_id(
        app_handle,
        MenuIds::DASHBOARD,
        &texts.dashboard,
        true,
        hotkeys.get("open_or_close_dashboard").copied(),
    )?;

    let close_all_connections = &MenuItem::with_id(
        app_handle,
        MenuIds::CLOSE_ALL_CONNECTIONS,
        &texts.close_all_connections,
        true,
        None::<&str>,
    )?;

    let lightweight_mode = &CheckMenuItem::with_id(
        app_handle,
        MenuIds::LIGHTWEIGHT_MODE,
        &texts.lightweight_mode,
        true,
        is_in_lightweight_mode(),
        hotkeys.get("entry_lightweight_mode").copied(),
    )?;

    let copy_env = &MenuItem::with_id(app_handle, MenuIds::COPY_ENV, &texts.copy_env, true, None::<&str>)?;

    let open_app_dir = &MenuItem::with_id(app_handle, MenuIds::CONF_DIR, &texts.conf_dir, true, None::<&str>)?;

    let open_core_dir = &MenuItem::with_id(app_handle, MenuIds::CORE_DIR, &texts.core_dir, true, None::<&str>)?;

    let open_logs_dir = &MenuItem::with_id(app_handle, MenuIds::LOGS_DIR, &texts.logs_dir, true, None::<&str>)?;

    let open_app_log = &MenuItem::with_id(app_handle, MenuIds::APP_LOG, &texts.app_log, true, None::<&str>)?;

    let open_core_log = &MenuItem::with_id(app_handle, MenuIds::CORE_LOG, &texts.core_log, true, None::<&str>)?;

    let open_dir = &Submenu::with_id_and_items(
        app_handle,
        MenuIds::OPEN_DIR,
        &texts.open_dir,
        true,
        &[open_app_dir, open_core_dir, open_logs_dir, open_app_log, open_core_log],
    )?;

    let restart_clash = &MenuItem::with_id(
        app_handle,
        MenuIds::RESTART_CLASH,
        &texts.restart_clash,
        true,
        None::<&str>,
    )?;

    let restart_app = &MenuItem::with_id(app_handle, MenuIds::RESTART_APP, &texts.restart_app, true, None::<&str>)?;

    let app_version = &MenuItem::with_id(
        app_handle,
        MenuIds::VERGE_VERSION,
        build_tray_version_label(&texts.verge_version, version),
        true,
        None::<&str>,
    )?;

    let more = &Submenu::with_id_and_items(
        app_handle,
        MenuIds::MORE,
        &texts.more,
        true,
        &[
            open_window as &dyn IsMenuItem<Wry>,
            open_dir,
            lightweight_mode,
            copy_env as &dyn IsMenuItem<Wry>,
            close_all_connections,
            restart_clash,
            restart_app,
            app_version,
        ],
    )?;

    let quit_accelerator = hotkeys.get("quit").copied();

    #[cfg(target_os = "macos")]
    let quit_accelerator = quit_accelerator.or(Some("Cmd+Q"));

    let quit = &MenuItem::with_id(app_handle, MenuIds::EXIT, &texts.exit, true, quit_accelerator)?;

    // Only these two items appear at the first level on every desktop OS.
    let menu = tauri::menu::MenuBuilder::new(app_handle)
        .items(&[more as &dyn IsMenuItem<Wry>, quit as &dyn IsMenuItem<Wry>])
        .build()?;
    Ok(menu)
}

fn on_tray_icon_event(_tray_icon: &TrayIcon, tray_event: TrayIconEvent) {
    if matches!(
        tray_event,
        TrayIconEvent::Move { .. } | TrayIconEvent::Leave { .. } | TrayIconEvent::Enter { .. }
    ) {
        return;
    }

    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Down,
        ..
    } = tray_event
    {
        // 添加防抖检查，防止快速连击
        #[allow(clippy::use_self)]
        if !Tray::global().should_handle_tray_click() {
            return;
        }

        AsyncHandler::spawn(|| async move {
            let verge = Config::verge().await.data_arc();
            let verge_tray_event = verge.tray_event.clone().unwrap_or_else(|| "main_window".into());
            let verge_tray_action = TrayAction::from(verge_tray_event.as_str());
            logging!(debug, Type::Tray, "tray event: {verge_tray_action:?}");
            match verge_tray_action {
                TrayAction::SystemProxy => {
                    let _ = feat::toggle_system_proxy().await;
                }
                TrayAction::TunMode => {
                    let _ = feat::toggle_tun_mode(None).await;
                }
                TrayAction::MainWindow => {
                    if !lightweight::exit_lightweight_mode().await {
                        WindowManager::show_main_window().await;
                    };
                }
                _ => {
                    logging!(warn, Type::Tray, "invalid tray event: {}", verge_tray_event);
                }
            };
        });
    }
}

fn on_menu_event(_: &AppHandle, event: MenuEvent) {
    if !Tray::global().should_handle_tray_click() {
        return;
    }
    if event.id.as_ref().is_empty() {
        return;
    }
    AsyncHandler::spawn(|| async move {
        match event.id.as_ref() {
            MenuIds::DASHBOARD => {
                logging!(info, Type::Tray, "托盘菜单点击: 打开窗口");
                if !lightweight::exit_lightweight_mode().await {
                    WindowManager::show_main_window().await;
                };
            }
            MenuIds::CLOSE_ALL_CONNECTIONS => {
                if let Err(err) = handle::Handle::mihomo().await.close_all_connections().await {
                    logging!(error, Type::Tray, "Failed to close all connections from tray: {err}");
                }
            }
            MenuIds::COPY_ENV => feat::copy_clash_env().await,
            MenuIds::CONF_DIR => {
                let _ = cmd::open_app_dir().await;
            }
            MenuIds::CORE_DIR => {
                let _ = cmd::open_core_dir().await;
            }
            MenuIds::LOGS_DIR => {
                let _ = cmd::open_logs_dir().await;
            }
            MenuIds::APP_LOG => {
                let _ = help::open_app_latest_log();
            }
            MenuIds::CORE_LOG => {
                let _ = help::open_core_latest_log();
            }
            MenuIds::RESTART_CLASH => feat::restart_clash_core().await,
            MenuIds::RESTART_APP => feat::restart_app().await,
            MenuIds::LIGHTWEIGHT_MODE => {
                if !is_in_lightweight_mode() {
                    lightweight::entry_lightweight_mode().await;
                } else {
                    lightweight::exit_lightweight_mode().await;
                }
            }
            MenuIds::EXIT => {
                feat::quit().await;
            }
            _ => {
                logging!(debug, Type::Tray, "Unhandled tray menu event: {:?}", event.id);
            }
        }

        // We dont expected to refresh tray state here
        // as the inner handle function (SHOULD) already takes care of it
    });
}

#[cfg(test)]
mod tests {
    use super::{build_tray_tooltip, build_tray_version_label};

    #[test]
    fn version_menu_uses_visible_product_name() {
        let label = build_tray_version_label("Verge 版本", "2.5.39");

        assert_eq!(label, "神仙云 版本 2.5.39");
        assert!(!label.contains("Verge"));
    }

    #[test]
    fn tooltip_never_includes_a_profile_name() {
        let extraction_code = "never-show-this-code";
        let tooltip = build_tray_tooltip("2.5.39", "系统代理", "虚拟网卡", "on", "off");

        assert!(tooltip.starts_with("神仙云 2.5.39"));
        assert!(!tooltip.contains("Clash Verge"));
        assert!(!tooltip.contains(extraction_code));
        assert_eq!(tooltip.lines().count(), 3);
    }
}
