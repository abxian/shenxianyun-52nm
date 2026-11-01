import { Alert, Snackbar } from '@mui/material'

import type { SubscriptionRefreshFeedback } from '@/services/subscription-refresh-feedback'

export type SubscriptionRefreshNoticeValue = SubscriptionRefreshFeedback & {
  id: number
}

export const SubscriptionRefreshNotice = ({
  notice,
  onClose,
}: {
  notice: SubscriptionRefreshNoticeValue | null
  onClose: () => void
}) => (
  <Snackbar
    key={notice?.id}
    open={Boolean(notice)}
    autoHideDuration={notice?.severity === 'warning' ? 6000 : 4000}
    anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
    onClose={(_, reason) => {
      if (reason !== 'clickaway') onClose()
    }}
    sx={{ maxWidth: 'calc(100% - 32px)' }}
  >
    <Alert
      variant="standard"
      severity={notice?.severity ?? 'info'}
      onClose={onClose}
      sx={{ alignItems: 'center', width: '100%' }}
    >
      {notice?.message}
    </Alert>
  </Snackbar>
)
