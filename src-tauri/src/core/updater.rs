mod download_control;
mod download_progress;
mod download_watchdog;
use crate::{
    config::Config,
    core::notification::NotificationSystem,
    singleton,
    utils::{brand, dirs},
};
use anyhow::{Result, anyhow};
use chrono::Utc;
use clash_verge_logging::{Type, logging};
use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::Arc,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
use tauri::AppHandle;
use tauri_plugin_updater::{Update, UpdaterExt as _};

pub const UPDATE_FALLBACK_PROGRESS_EVENT: &str = "shenxianyun://update-fallback-progress";
static INTERACTIVE_UPDATE_ACTIVE: AtomicBool = AtomicBool::new(false);
static DOWNLOAD_CONTROL: Mutex<download_control::DownloadControl> =
    Mutex::new(download_control::DownloadControl::new());

pub fn cancel_interactive_download() -> &'static str {
    let mut state = DOWNLOAD_CONTROL.lock();
    if state.cancel() {
        "cancelled"
    } else if state.active() {
        "installing"
    } else {
        "idle"
    }
}
fn check_download_cancelled() -> Result<()> {
    if DOWNLOAD_CONTROL.lock().cancelled() {
        return Err(anyhow!("已取消更新下载"));
    }
    Ok(())
}

const DUFS_UPDATE_ENDPOINTS: &[&str] = &[
    "https://gh-proxy.org/https://github.com/abxian/shenxianyun-52nm/releases/download/updater/update-proxy.json",
    "https://github.com/abxian/shenxianyun-52nm/releases/download/updater/update.json",
];
const GITHUB_UPDATE_ENDPOINTS: &[&str] = &[
    "https://gh-proxy.org/https://github.com/abxian/shenxianyun-52nm/releases/download/updater/update-proxy.json",
    "https://github.com/abxian/shenxianyun-52nm/releases/download/updater/update.json",
];

#[derive(Clone, Copy, Debug)]
enum UpdateSource {
    Dufs,
    Github,
}

impl UpdateSource {
    const fn label(self) -> &'static str {
        match self {
            Self::Dufs => "dufs",
            Self::Github => "github",
        }
    }

    const fn endpoints(self) -> &'static [&'static str] {
        match self {
            Self::Dufs => DUFS_UPDATE_ENDPOINTS,
            Self::Github => GITHUB_UPDATE_ENDPOINTS,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateFallbackProgress {
    source: &'static str,
    phase: &'static str,
    chunk_length: Option<usize>,
    content_length: Option<u64>,
}

struct InteractiveUpdateGuard;

impl InteractiveUpdateGuard {
    fn acquire() -> Result<Self> {
        INTERACTIVE_UPDATE_ACTIVE
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| anyhow!("an app update is already in progress"))?;
        DOWNLOAD_CONTROL.lock().begin();
        Ok(Self)
    }
}

impl Drop for InteractiveUpdateGuard {
    fn drop(&mut self) {
        DOWNLOAD_CONTROL.lock().finish();
        INTERACTIVE_UPDATE_ACTIVE.store(false, Ordering::Release);
    }
}

fn emit_update_progress(
    app_handle: &AppHandle,
    source: UpdateSource,
    phase: &'static str,
    chunk_length: Option<usize>,
    content_length: Option<u64>,
) {
    NotificationSystem::broadcast(
        app_handle,
        UPDATE_FALLBACK_PROGRESS_EVENT,
        UpdateFallbackProgress {
            source: source.label(),
            phase,
            chunk_length,
            content_length,
        },
    );
}

fn normalize_update_version(version: &str) -> Option<&str> {
    let trimmed = version.trim();
    let normalized = trimmed.strip_prefix('v').unwrap_or(trimmed);
    let valid = !normalized.is_empty()
        && normalized.as_bytes().first().is_some_and(u8::is_ascii_digit)
        && normalized
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'.' | b'-' | b'+'));
    valid.then_some(normalized)
}

async fn download_verified_update(
    app_handle: &AppHandle,
    source: UpdateSource,
    expected_version: &str,
) -> Result<(Update, Vec<u8>)> {
    emit_update_progress(app_handle, source, "checking", None, None);

    let endpoints = source
        .endpoints()
        .iter()
        .map(|endpoint| endpoint.parse())
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let updater = app_handle.updater_builder().endpoints(endpoints)?.build()?;
    check_download_cancelled()?;
    let update = download_watchdog::watch(
        updater.check(),
        Arc::new(Mutex::new(Instant::now())),
        Duration::from_secs(20),
        Duration::from_secs(20),
        Duration::from_millis(250),
        || DOWNLOAD_CONTROL.lock().cancelled(),
    )
    .await
    .map_err(anyhow::Error::msg)?
    .ok_or_else(|| anyhow!("{} update metadata has no applicable update", source.label()))?;

    let remote_version = normalize_update_version(&update.version)
        .ok_or_else(|| anyhow!("{} update metadata has an invalid version", source.label()))?;
    if remote_version != expected_version {
        return Err(anyhow!(
            "{} update version mismatch: expected {}, got {}",
            source.label(),
            expected_version,
            remote_version
        ));
    }

    let last_progress = Arc::new(Mutex::new(Instant::now()));
    let progress_clock = Arc::clone(&last_progress);
    let progress = Arc::new(Mutex::new(download_progress::Progress::new(Instant::now())));
    let finish_progress = Arc::clone(&progress);
    let progress_handle = app_handle.clone();
    let finish_handle = app_handle.clone();
    let bytes = {
        let download = update.download(
            move |chunk_length, content_length| {
                *progress_clock.lock() = Instant::now();
                let frame = progress.lock().add(chunk_length, content_length, Instant::now());
                if let Some((bytes, length)) = frame {
                    emit_update_progress(&progress_handle, source, "progress", Some(bytes), length);
                }
            },
            move || {
                let frame = finish_progress.lock().flush();
                if let Some((bytes, length)) = frame {
                    emit_update_progress(&finish_handle, source, "progress", Some(bytes), length);
                }
                emit_update_progress(&finish_handle, source, "downloaded", None, None);
            },
        );
        download_watchdog::watch(
            download,
            last_progress,
            Duration::from_secs(20 * 60),
            Duration::from_secs(45),
            Duration::from_millis(250),
            || DOWNLOAD_CONTROL.lock().cancelled(),
        )
        .await
        .map_err(anyhow::Error::msg)?
    };

    // Update::download only returns after the Tauri updater has verified the
    // package signature with the configured public key.
    emit_update_progress(app_handle, source, "verified", None, None);
    Ok((update, bytes))
}

/// Download and install an exact version without opening a browser. Dufs is
/// always attempted first; only metadata/download/signature failures switch to
/// the GitHub updater endpoints. Installation itself is attempted exactly once.
pub async fn install_update_with_fallback(app_handle: &AppHandle, expected_version: &str) -> Result<()> {
    let _interactive_guard = InteractiveUpdateGuard::acquire()?;
    let expected_version =
        normalize_update_version(expected_version).ok_or_else(|| anyhow!("invalid expected update version"))?;

    let (update, bytes, source) = match download_verified_update(app_handle, UpdateSource::Dufs, expected_version).await
    {
        Ok((update, bytes)) => (update, bytes, UpdateSource::Dufs),
        Err(dufs_error) => {
            check_download_cancelled()?;
            logging!(
                warn,
                Type::System,
                "Dufs updater failed before install, switching to GitHub: {dufs_error}"
            );
            emit_update_progress(app_handle, UpdateSource::Github, "fallback", None, None);
            match download_verified_update(app_handle, UpdateSource::Github, expected_version).await {
                Ok((update, bytes)) => (update, bytes, UpdateSource::Github),
                Err(github_error) => {
                    return Err(anyhow!(
                        "Dufs and GitHub update sources are unavailable: Dufs: {dufs_error}; GitHub: {github_error}"
                    ));
                }
            }
        }
    };

    if !DOWNLOAD_CONTROL.lock().install() {
        return Err(anyhow!("已取消更新下载"));
    }
    emit_update_progress(app_handle, source, "stopping", None, None);
    if !crate::feat::clean_for_update().await {
        return Err(anyhow!(
            "更新包已验证，但停止连接未完成；未运行安装器，请停止连接后重试"
        ));
    }
    emit_update_progress(app_handle, source, "installing", None, None);

    // install() 是同步阻塞调用。直接在 async 命令里调用会占住 tokio 运行时，
    // Tauri 的 IPC 随之停摆，界面表现为「点了立即更新就假死」——这正是本函数
    // 要解决的问题。放进阻塞线程池后运行时不再被占住，界面始终可响应。
    //
    // 这里刻意不加超时。tauri-plugin-updater 的 Windows install_inner 在
    // ShellExecuteW 拉起安装器后立即 std::process::exit(0)：安装器真的接管时
    // 本进程当场退出，await 根本不会返回。反过来说，「等了 N 秒还活着」恰恰
    // 说明安装器没有接管，此时按成功返回是错的——调用方会立即 relaunch，
    // 用户看到「更新完成」，实际什么都没装，且 InteractiveUpdateGuard 会在
    // 阻塞任务仍在运行时被释放，允许第二次安装并发进来。
    // 因此只如实等待真实结果：成功即成功，失败即失败。万一 install() 真的
    // 卡住，代价是这条命令的 promise 一直 pending（界面停在「正在安装」，
    // 且 guard 持续持有、不会并发重入），而不是谎报成功。
    // 启动期静默安装路径同样把超时按失败处理（"will retry next launch"）。
    let install_task = tokio::task::spawn_blocking({
        let bytes = bytes.clone();
        let update = update.clone();
        move || update.install(&bytes)
    });

    match install_task.await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(err)) => Err(anyhow!("update install failed: {err}")),
        Err(join_err) => Err(anyhow!("update install task panicked: {join_err}")),
    }
}

pub struct SilentUpdater {
    update_ready: AtomicBool,
    pending_bytes: RwLock<Option<Vec<u8>>>,
    pending_update: RwLock<Option<Update>>,
    pending_version: RwLock<Option<String>>,
}

singleton!(SilentUpdater, SILENT_UPDATER);

impl SilentUpdater {
    const fn new() -> Self {
        Self {
            update_ready: AtomicBool::new(false),
            pending_bytes: RwLock::new(None),
            pending_update: RwLock::new(None),
            pending_version: RwLock::new(None),
        }
    }

    pub fn is_update_ready(&self) -> bool {
        self.update_ready.load(Ordering::Acquire)
    }
}

// ─── Disk Cache ───────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
struct UpdateCacheMeta {
    version: String,
    downloaded_at: String,
}

impl SilentUpdater {
    fn cache_dir() -> Result<PathBuf> {
        Ok(dirs::app_home_dir()?.join("update_cache"))
    }

    fn write_cache(bytes: &[u8], version: &str) -> Result<()> {
        let cache_dir = Self::cache_dir()?;
        std::fs::create_dir_all(&cache_dir)?;

        let bin_path = cache_dir.join("pending_update.bin");
        std::fs::write(&bin_path, bytes)?;

        let meta = UpdateCacheMeta {
            version: version.to_string(),
            downloaded_at: Utc::now().to_rfc3339(),
        };
        let meta_path = cache_dir.join("pending_update.json");
        std::fs::write(&meta_path, serde_json::to_string_pretty(&meta)?)?;

        logging!(
            info,
            Type::System,
            "Update cache written: version={}, size={} bytes",
            version,
            bytes.len()
        );
        Ok(())
    }

    fn read_cache_bytes() -> Result<Vec<u8>> {
        let bin_path = Self::cache_dir()?.join("pending_update.bin");
        Ok(std::fs::read(bin_path)?)
    }

    fn read_cache_meta() -> Result<UpdateCacheMeta> {
        let meta_path = Self::cache_dir()?.join("pending_update.json");
        let content = std::fs::read_to_string(meta_path)?;
        Ok(serde_json::from_str(&content)?)
    }

    fn delete_cache() {
        if let Ok(cache_dir) = Self::cache_dir()
            && cache_dir.exists()
        {
            if let Err(e) = std::fs::remove_dir_all(&cache_dir) {
                logging!(warn, Type::System, "Failed to delete update cache: {e}");
            } else {
                logging!(info, Type::System, "Update cache deleted");
            }
        }
    }
}

// ─── Version Comparison ───────────────────────────────────────────────────────

/// Returns true if version `a` <= version `b` using semver-like comparison.
/// Strips leading 'v', splits on '.', handles pre-release suffixes.
fn version_lte(a: &str, b: &str) -> bool {
    let parse = |v: &str| -> Vec<u64> {
        v.trim_start_matches('v')
            .split('.')
            .filter_map(|part| {
                let numeric = part.split('-').next().unwrap_or("0");
                numeric.parse::<u64>().ok()
            })
            .collect()
    };

    let a_parts = parse(a);
    let b_parts = parse(b);
    let len = a_parts.len().max(b_parts.len());

    for i in 0..len {
        let av = a_parts.get(i).copied().unwrap_or(0);
        let bv = b_parts.get(i).copied().unwrap_or(0);
        if av < bv {
            return true;
        }
        if av > bv {
            return false;
        }
    }
    true // equal
}

// ─── Startup Install & Cache Management ─────────────────────────────────────

impl SilentUpdater {
    /// Called at app startup. If a cached update exists and is newer than the current version,
    /// attempt to install it immediately (before the main app initializes).
    /// Returns true if install was triggered (app should relaunch), false otherwise.
    pub async fn try_install_on_startup(&self, app_handle: &tauri::AppHandle) -> bool {
        let current_version = env!("CARGO_PKG_VERSION");

        let meta = match Self::read_cache_meta() {
            Ok(meta) => meta,
            Err(_) => return false, // No cache, nothing to do
        };

        let cached_version = &meta.version;

        if version_lte(cached_version, current_version) {
            logging!(
                info,
                Type::System,
                "Update cache version ({}) <= current ({}), cleaning up",
                cached_version,
                current_version
            );
            Self::delete_cache();
            return false;
        }

        logging!(
            info,
            Type::System,
            "Update cache version ({}) > current ({}), asking user to install",
            cached_version,
            current_version
        );

        // Ask user for confirmation — they can skip and use the app normally.
        // The cache is preserved so next launch will ask again.
        if !Self::ask_user_to_install(app_handle, cached_version).await {
            logging!(info, Type::System, "User skipped update install, starting normally");
            return false;
        }

        // Read cached bytes
        let bytes = match Self::read_cache_bytes() {
            Ok(b) => b,
            Err(e) => {
                logging!(
                    warn,
                    Type::System,
                    "Failed to read cached update bytes: {e}, cleaning up"
                );
                Self::delete_cache();
                return false;
            }
        };

        // Need a fresh Update object from the server to call install().
        // This is a lightweight HTTP request (< 1s), not a re-download.
        let update = match app_handle.updater() {
            Ok(updater) => match updater.check().await {
                Ok(Some(u)) => u,
                Ok(None) => {
                    logging!(
                        info,
                        Type::System,
                        "No update available from server, cache may be stale, cleaning up"
                    );
                    Self::delete_cache();
                    return false;
                }
                Err(e) => {
                    logging!(
                        warn,
                        Type::System,
                        "Failed to check for update at startup: {e}, will retry next launch"
                    );
                    return false; // Keep cache for next attempt
                }
            },
            Err(e) => {
                logging!(
                    warn,
                    Type::System,
                    "Failed to create updater: {e}, will retry next launch"
                );
                return false;
            }
        };

        // Verify the server's version matches the cached version.
        // If server now has a newer version, our cached bytes are stale.
        if update.version != *cached_version {
            logging!(
                info,
                Type::System,
                "Server version ({}) != cached version ({}), cache is stale, cleaning up",
                update.version,
                cached_version
            );
            Self::delete_cache();
            return false;
        }

        let version = update.version.clone();
        logging!(info, Type::System, "Installing cached update v{version} at startup...");

        // Show splash window so user knows the app is updating, not frozen
        Self::show_update_splash(app_handle, &version);

        // install() is sync and may hang (known bug #2558), so run with a timeout.
        // On Windows, NSIS takes over the process so install() may never return — that's OK.
        let install_result = tokio::task::spawn_blocking({
            let bytes = bytes.clone();
            let update = update.clone();
            move || update.install(&bytes)
        });

        let success = match tokio::time::timeout(std::time::Duration::from_secs(30), install_result).await {
            Ok(Ok(Ok(()))) => {
                logging!(info, Type::System, "Update v{version} install triggered at startup");
                Self::delete_cache();
                true
            }
            Ok(Ok(Err(e))) => {
                logging!(
                    warn,
                    Type::System,
                    "Startup install failed: {e}, will retry next launch"
                );
                false
            }
            Ok(Err(e)) => {
                logging!(
                    warn,
                    Type::System,
                    "Startup install task panicked: {e}, will retry next launch"
                );
                false
            }
            Err(_) => {
                logging!(
                    warn,
                    Type::System,
                    "Startup install timed out (30s), will retry next launch"
                );
                false
            }
        };

        // Close splash window if install failed and app continues normally
        if !success {
            Self::close_update_splash(app_handle);
        }

        success
    }
}

// ─── User Confirmation Dialog ────────────────────────────────────────────────

impl SilentUpdater {
    /// Show a native dialog asking the user to install or skip the update.
    /// Returns true if user chose to install, false if they chose to skip.
    async fn ask_user_to_install(app_handle: &tauri::AppHandle, version: &str) -> bool {
        use tauri_plugin_dialog::{DialogExt as _, MessageDialogButtons, MessageDialogKind};

        let title = brand::native_text(&clash_verge_i18n::t!("notifications.updateReady.title"));
        let body =
            brand::native_text(&clash_verge_i18n::t!("notifications.updateReady.body").replace("{version}", version));
        let install_now = clash_verge_i18n::t!("notifications.updateReady.installNow").into_owned();
        let later = clash_verge_i18n::t!("notifications.updateReady.later").into_owned();

        let (tx, rx) = tokio::sync::oneshot::channel();

        app_handle
            .dialog()
            .message(body)
            .title(title)
            .buttons(MessageDialogButtons::OkCancelCustom(install_now, later))
            .kind(MessageDialogKind::Info)
            .show(move |confirmed| {
                let _ = tx.send(confirmed);
            });

        rx.await.unwrap_or(false)
    }
}

// ─── Update Splash Window ────────────────────────────────────────────────────

impl SilentUpdater {
    /// Show a small centered splash window indicating update is being installed.
    /// Injects HTML via eval() after window creation so it doesn't depend on any
    /// external file in the bundle.
    fn show_update_splash(app_handle: &tauri::AppHandle, version: &str) {
        use tauri::{WebviewUrl, WebviewWindowBuilder};

        let window = match WebviewWindowBuilder::new(app_handle, "update-splash", WebviewUrl::App("index.html".into()))
            .title(brand::native_text("Clash Verge - Updating"))
            .inner_size(300.0, 180.0)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .closable(false)
            .decorations(false)
            .center()
            .always_on_top(true)
            .visible(true)
            .build()
        {
            Ok(w) => w,
            Err(e) => {
                logging!(warn, Type::System, "Failed to create update splash: {e}");
                return;
            }
        };

        let js = format!(
            r#"
            document.documentElement.innerHTML = `
            <head><meta charset="utf-8"/><style>
              *{{margin:0;padding:0;box-sizing:border-box}}
              html,body{{height:100%;overflow:hidden;user-select:none;-webkit-user-select:none;
                font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}}
              body{{display:flex;flex-direction:column;align-items:center;justify-content:center;
                background:#1e1e2e;color:#cdd6f4}}
              @media(prefers-color-scheme:light){{
                body{{background:#eff1f5;color:#4c4f69}}
                .bar{{background:#dce0e8}}.fill{{background:#1e66f5}}.sub{{color:#6c6f85}}
              }}
              .icon{{width:48px;height:48px;margin-bottom:16px;animation:pulse 2s ease-in-out infinite}}
              .title{{font-size:16px;font-weight:600;margin-bottom:6px}}
              .sub{{font-size:13px;color:#a6adc8;margin-bottom:20px}}
              .bar{{width:200px;height:4px;background:#313244;border-radius:2px;overflow:hidden}}
              .fill{{height:100%;width:30%;background:#89b4fa;border-radius:2px;animation:ind 1.5s ease-in-out infinite}}
              @keyframes ind{{0%{{width:0;margin-left:0}}50%{{width:40%;margin-left:30%}}100%{{width:0;margin-left:100%}}}}
              @keyframes pulse{{0%,100%{{opacity:1}}50%{{opacity:.6}}}}
            </style></head>
            <body>
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              <div class="title">Installing Update...</div>
              <div class="sub">v{version}</div>
              <div class="bar"><div class="fill"></div></div>
            </body>`;
            "#
        );

        // Retry eval a few times — the webview may not be ready immediately
        std::thread::spawn(move || {
            for i in 0..10 {
                std::thread::sleep(std::time::Duration::from_millis(100 * (i + 1)));
                if window.eval(&js).is_ok() {
                    return;
                }
            }
        });

        logging!(info, Type::System, "Update splash window shown");
    }

    /// Close the update splash window (e.g. after install failure).
    fn close_update_splash(app_handle: &tauri::AppHandle) {
        use tauri::Manager as _;
        if let Some(window) = app_handle.get_webview_window("update-splash") {
            let _ = window.close();
            logging!(info, Type::System, "Update splash window closed");
        }
    }
}

// ─── Background Check and Download ───────────────────────────────────────────

impl SilentUpdater {
    async fn check_and_download(&self, app_handle: &tauri::AppHandle) -> Result<()> {
        let is_portable = *dirs::PORTABLE_FLAG.get().unwrap_or(&false);
        if is_portable {
            logging!(debug, Type::System, "Silent update skipped: portable build");
            return Ok(());
        }

        let auto_check = Config::verge().await.latest_arc().auto_check_update.unwrap_or(true);
        if !auto_check {
            logging!(debug, Type::System, "Silent update skipped: auto_check_update is false");
            return Ok(());
        }

        if self.is_update_ready() {
            logging!(debug, Type::System, "Silent update skipped: update already pending");
            return Ok(());
        }

        logging!(info, Type::System, "Silent updater: checking for updates...");

        let updater = app_handle.updater()?;
        let update = match updater.check().await {
            Ok(Some(update)) => update,
            Ok(None) => {
                logging!(info, Type::System, "Silent updater: no update available");
                return Ok(());
            }
            Err(e) => {
                logging!(warn, Type::System, "Silent updater: check failed: {e}");
                return Err(e.into());
            }
        };

        let version = update.version.clone();
        logging!(info, Type::System, "Silent updater: update available: v{version}");

        if let Some(body) = &update.body
            && body.to_lowercase().contains("break change")
        {
            logging!(
                info,
                Type::System,
                "Silent updater: breaking change detected in v{version}, notifying frontend"
            );
            super::handle::Handle::notice_message(
                "info",
                format!("New version v{version} contains breaking changes. Please update manually."),
            );
            return Ok(());
        }

        logging!(info, Type::System, "Silent updater: downloading v{version}...");
        let bytes = update
            .download(
                |chunk_len, content_len| {
                    logging!(
                        debug,
                        Type::System,
                        "Silent updater download progress: chunk={chunk_len}, total={content_len:?}"
                    );
                },
                || {
                    logging!(info, Type::System, "Silent updater: download complete");
                },
            )
            .await?;

        if let Err(e) = Self::write_cache(&bytes, &version) {
            logging!(warn, Type::System, "Silent updater: failed to write cache: {e}");
        }

        *self.pending_bytes.write() = Some(bytes);
        *self.pending_update.write() = Some(update);
        *self.pending_version.write() = Some(version.clone());
        self.update_ready.store(true, Ordering::Release);

        logging!(
            info,
            Type::System,
            "Silent updater: v{version} ready for startup install on next launch"
        );
        Ok(())
    }

    pub async fn start_background_check(&self, app_handle: tauri::AppHandle) {
        logging!(info, Type::System, "Silent updater: background task started");

        tokio::time::sleep(std::time::Duration::from_secs(10)).await;

        loop {
            if let Err(e) = self.check_and_download(&app_handle).await {
                logging!(warn, Type::System, "Silent updater: cycle error: {e}");
            }

            tokio::time::sleep(std::time::Duration::from_secs(24 * 60 * 60)).await;
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    // ─── version_lte tests ──────────────────────────────────────────────────

    #[test]
    fn test_version_equal() {
        assert!(version_lte("2.4.7", "2.4.7"));
    }

    #[test]
    fn test_version_less() {
        assert!(version_lte("2.4.7", "2.4.8"));
        assert!(version_lte("2.4.7", "2.5.0"));
        assert!(version_lte("2.4.7", "3.0.0"));
    }

    #[test]
    fn test_version_greater() {
        assert!(!version_lte("2.4.8", "2.4.7"));
        assert!(!version_lte("2.5.0", "2.4.7"));
        assert!(!version_lte("3.0.0", "2.4.7"));
    }

    #[test]
    fn test_version_with_v_prefix() {
        assert!(version_lte("v2.4.7", "2.4.8"));
        assert!(version_lte("2.4.7", "v2.4.8"));
        assert!(version_lte("v2.4.7", "v2.4.8"));
    }

    #[test]
    fn test_version_with_prerelease() {
        // "2.4.8-alpha" → numeric part is still "2.4.8"
        assert!(version_lte("2.4.7", "2.4.8-alpha"));
        assert!(version_lte("2.4.8-alpha", "2.4.8"));
        // Both have same numeric part, so equal → true
        assert!(version_lte("2.4.8-alpha", "2.4.8-beta"));
    }

    #[test]
    fn test_version_different_lengths() {
        assert!(version_lte("2.4", "2.4.1"));
        assert!(!version_lte("2.4.1", "2.4"));
        assert!(version_lte("2.4.0", "2.4"));
    }

    // ─── Cache metadata tests ───────────────────────────────────────────────

    #[test]
    fn test_cache_meta_serialize_roundtrip() {
        let meta = UpdateCacheMeta {
            version: "2.5.0".to_string(),
            downloaded_at: "2026-03-31T00:00:00Z".to_string(),
        };
        let json = serde_json::to_string(&meta).unwrap();
        let parsed: UpdateCacheMeta = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.version, "2.5.0");
        assert_eq!(parsed.downloaded_at, "2026-03-31T00:00:00Z");
    }

    #[test]
    fn test_cache_meta_invalid_json() {
        let result = serde_json::from_str::<UpdateCacheMeta>("not valid json");
        assert!(result.is_err());
    }

    #[test]
    fn test_cache_meta_missing_required_field() {
        let result = serde_json::from_str::<UpdateCacheMeta>(r#"{"version":"2.5.0"}"#);
        assert!(result.is_err()); // missing downloaded_at
    }

    #[test]
    fn test_update_version_normalization_rejects_invalid_input() {
        assert_eq!(normalize_update_version("v2.5.41"), Some("2.5.41"));
        assert_eq!(normalize_update_version(" 2.5.41-beta.1 "), Some("2.5.41-beta.1"));
        assert_eq!(normalize_update_version(""), None);
        assert_eq!(normalize_update_version("latest"), None);
        assert_eq!(normalize_update_version("2.5.41/../../bad"), None);
    }

    #[test]
    fn test_update_sources_are_separated_and_ordered() {
        assert_eq!(UpdateSource::Dufs.endpoints(), DUFS_UPDATE_ENDPOINTS);
        assert_eq!(UpdateSource::Github.endpoints(), GITHUB_UPDATE_ENDPOINTS);
        assert!(
            DUFS_UPDATE_ENDPOINTS
                .iter()
                .all(|url| url.contains("abxian/shenxianyun-52nm/"))
        );
        assert!(GITHUB_UPDATE_ENDPOINTS.iter().all(|url| url.contains("github.com")));
        assert!(
            DUFS_UPDATE_ENDPOINTS[0].starts_with("https://gh-proxy.org/https://github.com/abxian/shenxianyun-52nm/")
        );
        assert!(GITHUB_UPDATE_ENDPOINTS[1].starts_with("https://github.com/abxian/shenxianyun-52nm/"));
    }

    #[test]
    fn test_interactive_update_guard_prevents_parallel_installers() {
        DOWNLOAD_CONTROL.lock().finish();
        INTERACTIVE_UPDATE_ACTIVE.store(false, Ordering::Release);
        let guard = InteractiveUpdateGuard::acquire().unwrap();
        assert!(InteractiveUpdateGuard::acquire().is_err());
        drop(guard);
        assert!(InteractiveUpdateGuard::acquire().is_ok());
    }
}
