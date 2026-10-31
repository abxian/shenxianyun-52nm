use std::time::{Duration, Instant};

pub(super) struct Progress {
    pending: usize,
    received: u64,
    length: Option<u64>,
    last_emit: Instant,
}
impl Progress {
    pub(super) const fn new(now: Instant) -> Self {
        Self {
            pending: 0,
            received: 0,
            length: None,
            last_emit: now,
        }
    }
    pub(super) fn add(&mut self, bytes: usize, length: Option<u64>, now: Instant) -> Option<(usize, Option<u64>)> {
        self.pending = self.pending.saturating_add(bytes);
        self.received = self.received.saturating_add(bytes as u64);
        self.length = length.or(self.length);
        if now.duration_since(self.last_emit) >= Duration::from_millis(100)
            || self.length.is_some_and(|total| self.received >= total)
        {
            self.last_emit = now;
            self.flush()
        } else {
            None
        }
    }
    pub(super) fn flush(&mut self) -> Option<(usize, Option<u64>)> {
        if self.pending == 0 {
            return None;
        }
        Some((std::mem::take(&mut self.pending), self.length))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fast_chunks_emit_one_aggregated_frame_without_losing_bytes() {
        let now = Instant::now();
        let mut progress = Progress::new(now);
        assert_eq!(progress.add(10, Some(30), now), None);
        assert_eq!(progress.add(10, Some(30), now), None);
        assert_eq!(progress.add(10, Some(30), now), Some((30, Some(30))));
        assert_eq!(progress.flush(), None);
    }
    #[test]
    fn unknown_total_is_throttled_and_flushed_at_download_finish() {
        let now = Instant::now();
        let mut progress = Progress::new(now);
        assert_eq!(progress.add(10, None, now), None);
        assert_eq!(
            progress.add(15, None, now + Duration::from_millis(101)),
            Some((25, None))
        );
        assert_eq!(progress.add(20, None, now + Duration::from_millis(110)), None);
        assert_eq!(progress.flush(), Some((20, None)));
    }
}
