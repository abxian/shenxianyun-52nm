import { CheckCircleRounded, SpeedRounded } from '@mui/icons-material'
import {
  Box,
  Button,
  CircularProgress,
  Stack,
  ToggleButton,
  Typography,
} from '@mui/material'

interface NodeSelectionPanelProps {
  label: string
  nodes: { name: string; delay: number; automatic?: boolean }[]
  selected: string
  timeoutMs: number
  disabled: boolean
  testing: boolean
  onSelect: (name: string) => void
  onTest: () => void
}

export const NodeSelectionPanel = ({
  label,
  nodes,
  selected,
  timeoutMs,
  disabled,
  testing,
  onSelect,
  onTest,
}: NodeSelectionPanelProps) => (
  <Stack spacing={1} sx={{ minWidth: 0, minHeight: 0, flex: 1 }}>
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: 'center', justifyContent: 'space-between' }}
    >
      <Typography
        component="h2"
        sx={{ fontSize: 14, fontWeight: 800, color: '#33406e' }}
      >
        {label}
        <Box component="span" sx={{ ml: 0.75, fontSize: 12, fontWeight: 500 }}>
          {nodes.length} 个
        </Box>
      </Typography>
      <Button
        variant="outlined"
        size="small"
        startIcon={testing ? <CircularProgress size={16} /> : <SpeedRounded />}
        disabled={disabled || testing || nodes.length === 0}
        onClick={onTest}
        sx={{ flexShrink: 0, whiteSpace: 'nowrap', minHeight: 34 }}
      >
        {testing ? '测试中…' : '测试连通性'}
      </Button>
    </Stack>
    {nodes.length === 0 ? (
      <Typography sx={{ p: 2, fontSize: 13, color: '#526084' }}>
        暂无可选节点，请更新订阅后重试。
      </Typography>
    ) : (
      <Box
        role="group"
        aria-label={label}
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 1,
          flex: 1,
          minHeight: 156,
          maxHeight: 'max(180px, calc(100vh - 280px))',
          alignContent: 'start',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          p: 0.4,
          scrollbarWidth: 'thin',
        }}
      >
        {nodes.map((node) => {
          const active = selected === node.name
          const checking = testing || node.delay === -2
          const timeout = node.delay === 0 || node.delay >= timeoutMs
          const available = node.delay > 0 && !timeout
          const latency = checking
            ? '测试中…'
            : timeout
              ? '超时'
              : available
                ? `${node.delay} ms`
                : '未测试'
          return (
            <ToggleButton
              key={node.name}
              value={node.name}
              selected={active}
              disabled={disabled}
              onClick={() => {
                if (!active) onSelect(node.name)
              }}
              aria-label={`${node.name}，${latency}`}
              title={node.name}
              sx={{
                minWidth: 0,
                minHeight: 68,
                p: 1.1,
                borderRadius: '12px',
                textTransform: 'none',
                textAlign: 'left',
                justifyContent: 'stretch',
                alignItems: 'flex-start',
                borderColor: 'rgba(80,100,160,.16)',
                bgcolor: 'rgba(255,255,255,.55)',
                '&:hover': { bgcolor: 'rgba(255,255,255,.86)' },
                '&.Mui-selected': {
                  bgcolor: 'rgba(95,123,240,.13)',
                  borderColor: '#5f7bf0',
                  boxShadow: 'inset 0 0 0 1px #5f7bf0',
                },
                '&.Mui-selected:hover': { bgcolor: 'rgba(95,123,240,.2)' },
                '&.Mui-focusVisible': {
                  outline: '2px solid #4356c4',
                  outlineOffset: 1,
                },
              }}
            >
              <Stack spacing={0.5} sx={{ width: '100%', minWidth: 0 }}>
                <Stack
                  direction="row"
                  spacing={0.5}
                  sx={{ alignItems: 'start' }}
                >
                  <Typography
                    component="span"
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      color: '#33406e',
                      fontSize: 13,
                      fontWeight: active ? 800 : 600,
                      lineHeight: 1.4,
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {node.automatic ? '自动选择' : node.name}
                  </Typography>
                  {active && (
                    <CheckCircleRounded
                      sx={{ fontSize: 17, color: '#526de3', flexShrink: 0 }}
                    />
                  )}
                </Stack>
                <Typography
                  component="span"
                  sx={{
                    fontSize: 11.5,
                    lineHeight: 1.4,
                    color: checking
                      ? '#526084'
                      : timeout
                        ? '#b4464a'
                        : available
                          ? '#19734e'
                          : '#627092',
                    fontWeight: 600,
                  }}
                >
                  {active ? '已选择 · ' : ''}
                  {node.automatic && !checking ? '自动切换 · ' : ''}
                  {latency}
                </Typography>
              </Stack>
            </ToggleButton>
          )
        })}
      </Box>
    )}
  </Stack>
)
