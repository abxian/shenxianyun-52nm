use parking_lot::Mutex;
use std::{
    fmt::Display,
    future::Future,
    sync::Arc,
    time::{Duration, Instant},
};

pub(super) async fn watch<T, E: Display>(
    operation: impl Future<Output = Result<T, E>>,
    progress: Arc<Mutex<Instant>>,
    total: Duration,
    idle: Duration,
    poll: Duration,
    cancelled: impl Fn() -> bool,
) -> Result<T, String> {
    if cancelled() {
        return Err("已取消更新下载".into());
    }
    let started = Instant::now();
    let mut tick = tokio::time::interval(poll);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    tokio::pin!(operation);
    loop {
        tokio::select! {
            result = &mut operation => return result.map_err(|error| error.to_string()),
            _ = tick.tick() => {
                if cancelled() { return Err("已取消更新下载".into()); }
                if started.elapsed() >= total { return Err("更新请求超时，请重试".into()); }
                if progress.lock().elapsed() >= idle { return Err("更新下载长时间无数据，请重试".into()); }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    #[tokio::test]
    async fn stalled_download_times_out_and_drops_network_future() {
        let result = watch(
            std::future::pending::<Result<(), String>>(),
            Arc::new(Mutex::new(Instant::now())),
            Duration::from_secs(1),
            Duration::from_millis(15),
            Duration::from_millis(2),
            || false,
        )
        .await;
        assert!(result.is_err_and(|error| error.contains("无数据")));
    }
    #[tokio::test]
    async fn cancellation_interrupts_an_inflight_download() {
        let cancelled = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&cancelled);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(5)).await;
            flag.store(true, Ordering::Release);
        });
        let result = watch(
            std::future::pending::<Result<(), String>>(),
            Arc::new(Mutex::new(Instant::now())),
            Duration::from_secs(1),
            Duration::from_secs(1),
            Duration::from_millis(2),
            || cancelled.load(Ordering::Acquire),
        )
        .await;
        assert!(result.is_err_and(|error| error.contains("取消")));
    }
    #[tokio::test]
    async fn continuous_progress_can_finish_beyond_idle_window() {
        let clock = Arc::new(Mutex::new(Instant::now()));
        let writer = Arc::clone(&clock);
        let operation = async move {
            for _ in 0..8 {
                tokio::time::sleep(Duration::from_millis(3)).await;
                *writer.lock() = Instant::now();
            }
            Ok::<_, String>(42)
        };
        assert_eq!(
            watch(
                operation,
                clock,
                Duration::from_secs(1),
                Duration::from_millis(15),
                Duration::from_millis(2),
                || false
            )
            .await,
            Ok(42)
        );
    }
}
