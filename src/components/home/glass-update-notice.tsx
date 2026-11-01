import {
  DownloadRounded,
  RefreshRounded,
  CloseRounded,
} from '@mui/icons-material'
import { Box, Button, IconButton, Stack, Typography } from '@mui/material'

type Props = {
  currentVersion: string
  version?: string
  checking: boolean
  checkFailed: boolean
  updating: boolean
  installing: boolean
  percent: number
  downloadLabel: string
  onCheck: () => void
  onUpdate: () => void
  onCancel: () => void
  expanded: boolean
  onExpand: (value: boolean) => void
}

/** Always reachable on the home screen, including before importing a code. */
export const GlassUpdateNotice = ({
  currentVersion,
  version,
  checking,
  checkFailed,
  updating,
  installing,
  percent,
  downloadLabel,
  onCheck,
  onUpdate,
  onCancel,
  expanded,
  onExpand,
}: Props) => (
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
      <Typography sx={{ fontSize: 12, flex: 1 }}>
        {version ? `新版本 v${version} 已发布` : `当前版本 v${currentVersion}`}
      </Typography>
      <Button
        size="small"
        startIcon={version ? <DownloadRounded /> : <RefreshRounded />}
        disabled={updating || (!version && checking)}
        onClick={() => (version ? onExpand(true) : onCheck())}
        sx={{ color: '#4356a2', borderRadius: '10px' }}
      >
        {version
          ? '有新版 · 查看更新'
          : checking
            ? '检查中…'
            : checkFailed
              ? '重试检查'
              : '检查新版'}
      </Button>
    </Stack>
    {version && (expanded || updating) && (
      <Stack
        direction="row"
        spacing={1}
        sx={{ mt: 0.75, alignItems: 'center' }}
      >
        <Typography role="status" sx={{ fontSize: 12, flex: 1 }}>
          {updating
            ? installing
              ? '校验完成，正在准备安装…'
              : `正在下载更新${percent ? ` ${percent}%` : '…'}`
            : '更新后可使用最新修复，也可以稍后再更新。'}
        </Typography>
        {updating && !installing ? (
          <Button size="small" onClick={onCancel}>
            取消下载
          </Button>
        ) : (
          <Button
            size="small"
            disabled={updating}
            onClick={onUpdate}
            sx={{
              borderRadius: '10px',
              border: '1px solid rgba(255,255,255,.7)',
              bgcolor: 'rgba(98,122,217,.14)',
              color: '#374a9c',
            }}
          >
            {downloadLabel}
          </Button>
        )}
        {!updating && (
          <IconButton
            size="small"
            aria-label="稍后更新，保留新版入口"
            onClick={() => onExpand(false)}
          >
            <CloseRounded fontSize="small" />
          </IconButton>
        )}
      </Stack>
    )}
  </Box>
)
