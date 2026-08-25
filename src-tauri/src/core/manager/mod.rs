mod config;
mod lifecycle;
mod state;

use anyhow::Result;
use arc_swap::{ArcSwap, ArcSwapOption};
use clash_verge_logger::AsyncLogger;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use std::{
    fmt,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Instant,
};
use tauri_plugin_shell::process::CommandChild;

use crate::singleton;

pub(crate) static CLASH_LOGGER: Lazy<Arc<AsyncLogger>> = Lazy::new(|| Arc::new(AsyncLogger::new()));

#[derive(Debug, serde::Serialize, PartialEq, Eq)]
pub enum RunningMode {
    Service,
    Sidecar,
    NotRunning,
}

impl fmt::Display for RunningMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Service => write!(f, "Service"),
            Self::Sidecar => write!(f, "Sidecar"),
            Self::NotRunning => write!(f, "NotRunning"),
        }
    }
}

#[derive(Debug)]
pub struct CoreManager {
    state: ArcSwap<State>,
    sidecar_state_lock: Mutex<()>,
    lifecycle_lock: tokio::sync::Mutex<()>,
    last_update: ArcSwapOption<Instant>,
    config_update_in_progress: AtomicBool,
}

#[derive(Debug)]
struct State {
    running_mode: ArcSwap<RunningMode>,
    child_sidecar: ArcSwapOption<CommandChild>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            running_mode: ArcSwap::new(Arc::new(RunningMode::NotRunning)),
            child_sidecar: ArcSwapOption::new(None),
        }
    }
}

impl Default for CoreManager {
    fn default() -> Self {
        Self {
            state: ArcSwap::new(Arc::new(State::default())),
            sidecar_state_lock: Mutex::new(()),
            lifecycle_lock: tokio::sync::Mutex::new(()),
            last_update: ArcSwapOption::new(None),
            config_update_in_progress: AtomicBool::new(false),
        }
    }
}

impl CoreManager {
    fn new() -> Self {
        Self::default()
    }

    pub fn get_running_mode(&self) -> Arc<RunningMode> {
        Arc::clone(&self.state.load().running_mode.load())
    }

    pub fn get_sidecar_pid(&self) -> Option<u32> {
        let _guard = self.sidecar_state_lock.lock();
        self.state.load().child_sidecar.load_full().map(|child| child.pid())
    }

    pub fn take_child_sidecar(&self) -> Option<CommandChild> {
        let _guard = self.sidecar_state_lock.lock();
        self.state
            .load()
            .child_sidecar
            .swap(None)
            .and_then(|arc| Arc::try_unwrap(arc).ok())
    }

    pub fn get_last_update(&self) -> Option<Arc<Instant>> {
        self.last_update.load_full()
    }

    pub fn set_running_mode(&self, mode: RunningMode) {
        let state = self.state.load();
        state.running_mode.store(Arc::new(mode));
    }

    pub fn set_running_child_sidecar(&self, child: CommandChild) {
        let _guard = self.sidecar_state_lock.lock();
        let state = self.state.load();
        state.child_sidecar.store(Some(Arc::new(child)));
    }

    pub fn clear_running_child_sidecar(&self, pid: u32) -> bool {
        let _guard = self.sidecar_state_lock.lock();
        let state = self.state.load();
        let is_current = state.child_sidecar.load_full().is_some_and(|child| child.pid() == pid);
        if is_current {
            state.child_sidecar.store(None);
            state.running_mode.store(Arc::new(RunningMode::NotRunning));
        }
        is_current
    }

    pub fn set_last_update(&self, time: Instant) {
        self.last_update.store(Some(Arc::new(time)));
    }

    fn try_start_config_update(&self) -> bool {
        !self.config_update_in_progress.swap(true, Ordering::AcqRel)
    }

    fn finish_config_update(&self) {
        self.config_update_in_progress.store(false, Ordering::Release);
    }

    pub async fn init(&self) -> Result<()> {
        self.start_core().await?;
        Ok(())
    }
}

singleton!(CoreManager, CORE_MANAGER);
