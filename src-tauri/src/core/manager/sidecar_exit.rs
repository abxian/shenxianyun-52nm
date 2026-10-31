use std::time::Duration;
use tokio::sync::watch;

pub(super) async fn wait_for_exit(
    mut exits: watch::Receiver<Option<u32>>,
    pid: u32,
    timeout: Duration,
) -> Result<(), &'static str> {
    tokio::time::timeout(timeout, async {
        while *exits.borrow_and_update() != Some(pid) {
            exits.changed().await.map_err(|_| "核心退出事件通道已关闭")?;
        }
        Ok(())
    })
    .await
    .map_err(|_| "核心进程仍在退出，请稍后重试；原配置未更改")?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn exit_already_received_is_not_lost() {
        let (sender, receiver) = watch::channel(Some(123));
        assert_eq!(wait_for_exit(receiver, 123, Duration::from_millis(20)).await, Ok(()));
        drop(sender);
    }
    #[tokio::test]
    async fn unrelated_process_exit_does_not_confirm_our_core() {
        let (sender, receiver) = watch::channel(Some(999));
        assert!(wait_for_exit(receiver, 123, Duration::from_millis(10)).await.is_err());
        drop(sender);
    }
    #[tokio::test]
    async fn stop_waits_for_the_tracked_process_exit() {
        let (sender, receiver) = watch::channel(None);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(5)).await;
            sender.send_replace(Some(123));
        });
        assert_eq!(wait_for_exit(receiver, 123, Duration::from_millis(100)).await, Ok(()));
    }
}
