import { CloseRounded, DownloadRounded } from '@mui/icons-material'
import { Box, Button, IconButton, Stack, Typography } from '@mui/material'

type Props = {
  version?: string
  updating: boolean
  installing: boolean
  percent: number
  dismissed: boolean
  onDismiss: () => void
  onUpdate: () => void
  onCancel: () => void
}

/** Background checks stay silent; only an available release or active download appears. */
export const GlassUpdateNotice = ({
  version,
  updating,
  installing,
  percent,
  dismissed,
  onDismiss,
  onUpdate,
  onCancel,
}: Props) => {
  if ((!version || dismissed) && !updating) return null

  return (
    <Box
      sx={{
        borderRadius: '16px',
        border: '1px solid rgba(255,255,255,.65)',
        bgcolor: 'rgba(255,255,255,.22)',
        backdropFilter: 'blur(18px) saturate(130%)',
        px: 1.5,
        py: 0.8,
        color: '#33406e',
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
      >
        <Typography role="status" sx={{ fontSize: 12, flex: 1 }}>
          {updating
            ? installing
              ? '校验完成，正在准备安装…'
              : `正在下载更新${percent ? ` ${percent}%` : '…'}`
            : `发现新版本 v${version}`}
        </Typography>
        {updating && !installing ? (
          <Button size="small" onClick={onCancel}>
            取消下载
          </Button>
        ) : (
          <Button
            size="small"
            startIcon={<DownloadRounded />}
            disabled={updating}
            onClick={onUpdate}
            sx={{ color: '#4356a2', borderRadius: '10px' }}
          >
            {installing ? '正在安装…' : '点击更新'}
          </Button>
        )}
        {!updating && (
          <IconButton
            size="small"
            aria-label="关闭新版提醒"
            onClick={onDismiss}
          >
            <CloseRounded fontSize="small" />
          </IconButton>
        )}
      </Stack>
    </Box>
  )
}
