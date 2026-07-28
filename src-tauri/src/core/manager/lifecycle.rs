use super::{CoreManager, RunningMode};
use crate::cmd::StringifyErr as _;
use crate::config::{Config, IVerge};
use crate::core::handle::Handle;
use crate::core::manager::CLASH_LOGGER;
use crate::core::service::{SERVICE_MANAGER, ServiceStatus};
use anyhow::Result;
use clash_verge_logging::{Type, logging};
use scopeguard::defer;
use smartstring::alias::String;
use tauri_plugin_clash_verge_sysinfo;

impl CoreManager {
    pub async fn start_core(&self) -> Result<()> {
        let _guard = self.lifecycle_lock.lock().await;
        self.start_core_locked().await
    }

    async fn start_core_locked(&self) -> Result<()> {
        if !matches!(*self.get_running_mode(), RunningMode::NotRunning) {
            logging!(
                info,
                Type::Core,
                "Core start requested while already running; stopping the tracked instance first"
            );
            self.stop_core_locked().await?;
        }

        self.prepare_startup().await;
        defer! {
            self.after_core_process();
        }

        match *self.get_running_mode() {
            RunningMode::Service => {
                if let Err(service_error) = self.start_core_by_service().await {
                    logging!(
                        warn,
                        Type::Core,
                        "Service mode failed to start the core: {service_error}. Falling back to sidecar mode."
                    );

                    self.set_running_mode(RunningMode::NotRunning);
                    #[cfg(target_os = "windows")]
                    self.prepare_windows_sidecar_fallback().await?;

                    if let Err(sidecar_error) = self.start_core_by_sidecar().await {
                        self.set_running_mode(RunningMode::NotRunning);
                        anyhow::bail!(
                            "Core startup failed in both service and sidecar modes. Service error: {service_error}; sidecar error: {sidecar_error}"
                        );
                    }

                    logging!(
                        info,
                        Type::Core,
                        "Core recovered in sidecar mode after service startup failure"
                    );
                }
                Ok(())
            }
            RunningMode::NotRunning | RunningMode::Sidecar => self.start_core_by_sidecar().await,
        }
    }

    pub async fn stop_core(&self) -> Result<()> {
        let _guard = self.lifecycle_lock.lock().await;
        self.stop_core_locked().await
    }

    async fn stop_core_locked(&self) -> Result<()> {
        CLASH_LOGGER.clear_logs().await;
        defer! {
            self.after_core_process();
        }

        match *self.get_running_mode() {
            RunningMode::Service => self.stop_core_by_service().await,
            RunningMode::Sidecar => self.stop_core_by_sidecar(),
            RunningMode::NotRunning => Ok(()),
        }
    }

    pub async fn restart_core(&self) -> Result<()> {
        let _guard = self.lifecycle_lock.lock().await;
        logging!(info, Type::Core, "Restarting core");
        self.stop_core_locked().await?;
        self.start_core_locked().await
    }

    pub async fn change_core(&self, clash_core: &String) -> Result<(), String> {
        if !IVerge::VALID_CLASH_CORES.contains(&clash_core.as_str()) {
            return Err(format!("Invalid clash core: {}", clash_core).into());
        }

        Config::verge().await.edit_draft(|d| {
            d.clash_core = Some(clash_core.to_owned());
        });
        Config::verge().await.apply();

        let verge_data = Config::verge().await.latest_arc();
        verge_data.save_file().await.map_err(|e| e.to_string())?;

        self.update_config_checked().await.stringify_err()?;
        Ok(())
    }

    async fn prepare_startup(&self) {
        #[cfg(target_os = "windows")]
        self.wait_for_service_if_needed().await;
        self.set_running_mode(match SERVICE_MANAGER.current().await {
            ServiceStatus::Ready => RunningMode::Service,
            _ => RunningMode::Sidecar,
        });
    }

    pub(super) fn after_core_process(&self) {
        let app_handle = Handle::app_handle();
        tauri_plugin_clash_verge_sysinfo::set_app_core_mode(app_handle, self.get_running_mode().to_string());
    }

    #[cfg(target_os = "windows")]
    async fn prepare_windows_sidecar_fallback(&self) -> Result<()> {
        let verge = Config::verge().await;
        if verge.latest_arc().enable_tun_mode.unwrap_or(false) {
            logging!(
                warn,
                Type::Core,
                "Disabling TUN because the Windows service failed; sidecar fallback will keep the core available"
            );
            verge.edit_draft(|draft| {
                draft.enable_tun_mode = Some(false);
            });
            verge.apply();
            verge.latest_arc().save_file().await?;
            Config::generate().await?;
            Handle::refresh_verge();
        }
        Ok(())
    }

    #[cfg(target_os = "windows")]
    async fn wait_for_service_if_needed(&self) {
        use crate::{config::Config, constants::timing, core::service};
        use backon::{ConstantBuilder, Retryable as _};

        let needs_service = Config::verge().await.latest_arc().enable_tun_mode.unwrap_or(false);

        if !needs_service {
            return;
        }

        if matches!(
            SERVICE_MANAGER.current().await,
            ServiceStatus::NeedsReinstall
        ) {
            logging!(
                warn,
                Type::Service,
                "服务协议不匹配，跳过启动等待并回退到 Sidecar"
            );
            return;
        }

        let max_times = timing::SERVICE_WAIT_MAX.as_millis() / timing::SERVICE_WAIT_INTERVAL.as_millis();
        let backoff = ConstantBuilder::default()
            .with_delay(timing::SERVICE_WAIT_INTERVAL)
            .with_max_times(max_times as usize);

        let _ = (|| async {
            if matches!(SERVICE_MANAGER.current().await, ServiceStatus::Ready) {
                return Ok(());
            }

            // If the service IPC path is not ready yet, treat it as transient and retry.
            // Running init/refresh too early can mark service state unavailable and break later config reloads.
            if !service::is_service_ipc_path_exists() {
                return Err(anyhow::anyhow!("Service IPC not ready"));
            }

            SERVICE_MANAGER.init().await?;
            let _ = SERVICE_MANAGER.refresh().await;

            if matches!(SERVICE_MANAGER.current().await, ServiceStatus::Ready) {
                Ok(())
            } else {
                Err(anyhow::anyhow!("Service not ready"))
            }
        })
        .retry(backoff)
        .await;
    }
}
