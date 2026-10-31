import { PowerSettingsNewRounded } from '@mui/icons-material'
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material'

interface GlassPowerButtonProps {
  running: boolean
  busy: boolean
  disabled?: boolean
  prominent?: boolean
  onClick: () => void
}

export const GlassPowerButton = ({
  running,
  busy,
  disabled,
  prominent = false,
  onClick,
}: GlassPowerButtonProps) => (
  <Box
    sx={{
      '--power-size': prominent ? 'clamp(170px, 30vh, 234px)' : '148px',
      '--power-inset': (theme) => theme.spacing(1.3),
      width: 'var(--power-size)',
      height: 'var(--power-size)',
      flex: '0 0 auto',
      aspectRatio: '1',
      p: 'var(--power-inset)',
      boxSizing: 'border-box',
      borderRadius: '50%',
      border: '1px solid rgba(255,255,255,.7)',
      background:
        'linear-gradient(145deg, rgba(255,255,255,.4), rgba(255,255,255,.08))',
      boxShadow:
        'inset 0 1px 1px rgba(255,255,255,.7), 0 18px 48px rgba(70,90,180,.18)',
    }}
  >
    <Button
      onClick={onClick}
      disabled={disabled || busy}
      aria-label={busy ? '正在处理连接' : running ? '停止连接' : '启动连接'}
      sx={{
        width:
          'calc(var(--power-size) - var(--power-inset) - var(--power-inset) - 2px)',
        height:
          'calc(var(--power-size) - var(--power-inset) - var(--power-inset) - 2px)',
        p: 0,
        minWidth: 0,
        borderRadius: '50%',
        color: '#fff',
        border: '1px solid rgba(255,255,255,.64)',
        background: running
          ? 'linear-gradient(145deg, rgba(66,202,168,.7), rgba(62,150,214,.48))'
          : 'linear-gradient(145deg, rgba(135,159,247,.7), rgba(78,105,221,.5))',
        backdropFilter: 'blur(18px)',
        boxShadow:
          'inset 0 2px 12px rgba(255,255,255,.45), 0 10px 28px rgba(75,100,190,.2)',
        '&:hover': {
          background: running
            ? 'linear-gradient(145deg, rgba(51,191,153,.85), rgba(51,139,205,.65))'
            : 'linear-gradient(145deg, rgba(119,147,242,.85), rgba(66,92,210,.65))',
        },
        '&.Mui-disabled': { color: 'rgba(255,255,255,.8)' },
        '&.Mui-focusVisible': {
          outline: '3px solid #4356c4',
          outlineOffset: 4,
        },
      }}
    >
      <Stack spacing={0.7} sx={{ alignItems: 'center' }}>
        {busy ? (
          <CircularProgress size={prominent ? 44 : 30} color="inherit" />
        ) : (
          <PowerSettingsNewRounded sx={{ fontSize: prominent ? 48 : 34 }} />
        )}
        <Typography
          component="span"
          sx={{ fontSize: prominent ? 26 : 20, fontWeight: 800 }}
        >
          {busy ? '处理中' : running ? '停止' : '启动'}
        </Typography>
      </Stack>
    </Button>
  </Box>
)
