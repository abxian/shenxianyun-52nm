use crate::{core::handle::Handle, utils::window_manager::WindowManager};
use clash_verge_logging::{Type, logging};
use serde::Serialize;
use serde_json::json;
use smartstring::alias::String;

use tauri::{AppHandle, Emitter as _};

#[derive(Debug)]
pub enum FrontendEvent<'a> {
    RefreshClash,
    RefreshVerge,
    NoticeMessage { status: &'a str, message: String },
    ProfileChanged { current_profile_id: &'a String },
    TimerUpdated { profile_index: &'a String },
    ProfileUpdateStarted { uid: &'a String },
    ProfileUpdateCompleted { uid: &'a String },
}

#[derive(Debug)]
pub struct NotificationSystem {}

impl NotificationSystem {
    fn serialize_event(event: FrontendEvent) -> (&'static str, Result<serde_json::Value, serde_json::Error>) {
        match event {
            FrontendEvent::RefreshClash => ("verge://refresh-clash-config", Ok(json!("yes"))),
            FrontendEvent::RefreshVerge => ("verge://refresh-verge-config", Ok(json!("yes"))),
            FrontendEvent::NoticeMessage { status, message } => {
                ("verge://notice-message", serde_json::to_value((status, message)))
            }
            FrontendEvent::ProfileChanged { current_profile_id } => ("profile-changed", Ok(json!(current_profile_id))),
            FrontendEvent::TimerUpdated { profile_index } => ("verge://timer-updated", Ok(json!(profile_index))),
            FrontendEvent::ProfileUpdateStarted { uid } => ("profile-update-started", Ok(json!({ "uid": uid }))),
            FrontendEvent::ProfileUpdateCompleted { uid } => ("profile-update-completed", Ok(json!({ "uid": uid }))),
        }
    }

    pub(crate) fn send_event(event: FrontendEvent) {
        let (event_name, Ok(payload)) = Self::serialize_event(event) else {
            return;
        };
        Self::dispatch(Handle::app_handle(), event_name, payload, true);
    }

    pub(crate) fn broadcast(app_handle: &AppHandle, event_name: &'static str, payload: impl Serialize) {
        let Ok(payload) = serde_json::to_value(payload) else {
            logging!(
                warn,
                Type::Frontend,
                "Event payload serialization failed: {}",
                event_name
            );
            return;
        };
        Self::dispatch(app_handle, event_name, payload, false);
    }

    fn dispatch(app_handle: &AppHandle, event_name: &'static str, payload: serde_json::Value, main_window_only: bool) {
        // Tauri 2.11 holds the webview/listener locks during emit. With tracing,
        // eval_script waits for the UI thread, which may be handling IPC and
        // waiting for that same lock. Queue the whole lookup + emit on the UI
        // thread; serializing first also owns any borrowed profile IDs/messages.
        let app = app_handle.clone();
        if let Err(e) = app_handle.run_on_main_thread(move || {
            let result = if main_window_only {
                let Some(window) = WindowManager::get_main_window() else {
                    return;
                };
                window.emit(event_name, payload)
            } else {
                app.emit(event_name, payload)
            };
            if let Err(e) = result {
                logging!(warn, Type::Frontend, "Event emit failed: {}: {}", event_name, e);
            }
        }) {
            logging!(warn, Type::Frontend, "Event dispatch failed: {}: {}", event_name, e);
        }
    }
}
