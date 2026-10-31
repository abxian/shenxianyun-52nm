#[derive(Debug, Default)]
pub(super) struct DownloadControl {
    active: bool,
    cancelled: bool,
    installing: bool,
}

impl DownloadControl {
    pub(super) const fn new() -> Self {
        Self {
            active: false,
            cancelled: false,
            installing: false,
        }
    }
    pub(super) const fn begin(&mut self) {
        *self = Self {
            active: true,
            ..Self::new()
        };
    }
    pub(super) const fn cancel(&mut self) -> bool {
        if !self.active || self.installing {
            return false;
        }
        self.cancelled = true;
        true
    }
    pub(super) const fn active(&self) -> bool {
        self.active
    }
    pub(super) const fn cancelled(&self) -> bool {
        self.cancelled
    }
    pub(super) const fn install(&mut self) -> bool {
        if !self.active || self.cancelled {
            return false;
        }
        self.installing = true;
        true
    }
    pub(super) const fn finish(&mut self) {
        *self = Self::new();
    }
}

#[cfg(test)]
mod tests {
    use super::DownloadControl;
    #[test]
    fn cancellation_prevents_install_and_retry_resets_it() {
        let mut state = DownloadControl::new();
        assert!(!state.cancel());
        state.begin();
        assert!(state.cancel());
        assert!(state.cancelled());
        assert!(!state.install());
        state.finish();
        state.begin();
        assert!(!state.cancelled());
        assert!(state.install());
    }
    #[test]
    fn installation_cannot_be_acknowledged_as_cancelled() {
        let mut state = DownloadControl::new();
        state.begin();
        assert!(state.install());
        assert!(!state.cancel());
        assert!(!state.cancelled());
        state.finish();
        assert!(!state.install());
    }
}
