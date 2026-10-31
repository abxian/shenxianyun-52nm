#![cfg(test)]
#![allow(unused_imports)]
// Contract test for the real notification module, with a queued main-thread
// runtime and contended webview lock. Does not launch the app or read user data.
extern crate self as clash_verge_logging;
extern crate self as tauri;

use serde::Serialize;
use serde_json::Value;
use std::sync::{
    Arc, Mutex, OnceLock,
    atomic::{AtomicBool, Ordering},
    mpsc,
};
use std::thread::{self, ThreadId};
type Task = Box<dyn FnOnce() + Send>;
#[derive(Debug)]
pub enum Type {
    Frontend,
}
#[macro_export]
macro_rules! logging {
    ($level:ident, $kind:expr, $($args:tt)*) => {{ let _ = $kind; let _ = format_args!($($args)*); }};
}
struct State {
    main: ThreadId,
    tasks: mpsc::Sender<Task>,
    webviews: Mutex<()>,
    present: AtomicBool,
    stopped: AtomicBool,
    emitted: Mutex<Vec<(&'static str, Value)>>,
}
#[derive(Clone)]
pub struct AppHandle(Arc<State>);
impl AppHandle {
    pub fn run_on_main_thread(&self, task: impl FnOnce() + Send + 'static) -> Result<(), &'static str> {
        if self.0.stopped.load(Ordering::Relaxed) {
            return Err("event loop closed");
        }
        self.0.tasks.send(Box::new(task)).map_err(|_| "queue closed")
    }
}
pub trait Emitter {
    fn emit(&self, name: &'static str, payload: impl Serialize) -> Result<(), &'static str>;
}
impl Emitter for AppHandle {
    fn emit(&self, name: &'static str, payload: impl Serialize) -> Result<(), &'static str> {
        assert_eq!(thread::current().id(), self.0.main, "emit must not run on a worker");
        let _webviews = self.0.webviews.lock().unwrap();
        self.0
            .emitted
            .lock()
            .unwrap()
            .push((name, serde_json::to_value(payload).unwrap()));
        Ok(())
    }
}
static APP: OnceLock<AppHandle> = OnceLock::new();
mod core {
    pub mod handle {
        pub struct Handle;
        impl Handle {
            pub fn app_handle() -> &'static crate::AppHandle {
                crate::APP.get().unwrap()
            }
        }
    }
}
mod utils {
    pub mod window_manager {
        pub struct WindowManager;
        impl WindowManager {
            pub fn get_main_window() -> Option<crate::AppHandle> {
                let app = crate::APP.get().unwrap();
                assert_eq!(std::thread::current().id(), app.0.main, "lookup must also be queued");
                app.0
                    .present
                    .load(std::sync::atomic::Ordering::Relaxed)
                    .then(|| app.clone())
            }
        }
    }
}
#[path = "../../src-tauri/src/core/notification.rs"]
mod production;

#[test]
fn worker_events_preserve_owned_payloads_order_and_do_not_wait_for_ui_locks() {
    use production::{FrontendEvent as E, NotificationSystem as N};
    let (tx, rx) = mpsc::channel();
    let app = AppHandle(Arc::new(State {
        main: thread::current().id(),
        tasks: tx,
        webviews: Mutex::new(()),
        present: AtomicBool::new(true),
        stopped: AtomicBool::new(false),
        emitted: Mutex::new(Vec::new()),
    }));
    assert!(APP.set(app.clone()).is_ok());
    // Model IPC already using the webview registry on the main thread. The
    // producer must return before we release the lock or pump the UI queue.
    let lock = app.0.webviews.lock().unwrap();
    let (done_tx, done_rx) = mpsc::channel();
    let worker = thread::spawn(move || {
        let uid = smartstring::alias::String::from("fixture-profile");
        N::send_event(E::RefreshClash);
        N::send_event(E::RefreshVerge);
        N::send_event(E::ProfileChanged {
            current_profile_id: &uid,
        });
        N::send_event(E::TimerUpdated { profile_index: &uid });
        N::send_event(E::ProfileUpdateStarted { uid: &uid });
        N::send_event(E::ProfileUpdateCompleted { uid: &uid });
        N::send_event(E::NoticeMessage {
            status: "fixture",
            message: "owned-message".into(),
        });
        N::broadcast(APP.get().unwrap(), "fixture://broadcast", ("value", 42));
        done_tx.send(()).unwrap();
    });
    done_rx
        .recv_timeout(std::time::Duration::from_secs(2))
        .expect("worker blocked on UI/registry");
    worker.join().unwrap();
    assert!(app.0.emitted.lock().unwrap().is_empty());
    drop(lock);
    for task in rx.try_iter() {
        task();
    }
    let actual = app.0.emitted.lock().unwrap().clone();
    assert_eq!(
        actual.iter().map(|e| e.0).collect::<Vec<_>>(),
        vec![
            "verge://refresh-clash-config",
            "verge://refresh-verge-config",
            "profile-changed",
            "verge://timer-updated",
            "profile-update-started",
            "profile-update-completed",
            "verge://notice-message",
            "fixture://broadcast",
        ]
    );
    assert_eq!(actual[2].1, serde_json::json!("fixture-profile"));
    assert_eq!(actual[4].1, serde_json::json!({"uid":"fixture-profile"}));
    assert_eq!(actual[6].1, serde_json::json!(["fixture", "owned-message"]));
    assert_eq!(actual[7].1, serde_json::json!(["value", 42]));
    // Window can disappear after enqueueing; broadcast remains available to
    // other listeners. No stale WebviewWindow is held by the worker.
    N::send_event(E::RefreshClash);
    app.0.present.store(false, Ordering::Relaxed);
    N::broadcast(&app, "fixture://no-window", ());
    for task in rx.try_iter() {
        task();
    }
    assert_eq!(app.0.emitted.lock().unwrap().len(), 9);
    assert_eq!(app.0.emitted.lock().unwrap()[8].0, "fixture://no-window");
    // Event-loop shutdown fails closed without a synchronous emission fallback.
    app.0.stopped.store(true, Ordering::Relaxed);
    N::send_event(E::RefreshClash);
    N::broadcast(&app, "fixture://stopped", ());
    assert!(rx.try_recv().is_err());
    assert_eq!(app.0.emitted.lock().unwrap().len(), 9);
}
