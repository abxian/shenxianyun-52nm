import { Button, Tooltip } from '@mui/material'
import { useRef } from 'react'

import { DialogRef } from '@/components/base'
import { useUpdate } from '@/hooks/use-update'
import { resolveUpdateButtonState } from '@/services/update-button-state'

import { UpdateViewer } from '../setting/mods/update-viewer'

interface Props {
  className?: string
}

export const UpdateButton = (props: Props) => {
  const { className } = props
  const viewerRef = useRef<DialogRef>(null)

  const { updateInfo, checkUpdate, loading, error } = useUpdate()
  const state = resolveUpdateButtonState({ updateInfo, error })

  // 检查失败过去是静默的（直接 return null），用户和排障者都看不到任何线索。
  // 这里给出一个克制但可见的入口：只在 react-query 重试耗尽后出现，点击即重试。
  if (state.kind === 'error') {
    return (
      <Tooltip title={`检查更新失败：${state.message}（点击重试）`}>
        <span>
          <Button
            color="warning"
            variant="outlined"
            size="small"
            className={className}
            disabled={loading}
            onClick={() => {
              checkUpdate().catch(() => undefined)
            }}
          >
            更新检查失败
          </Button>
        </span>
      </Tooltip>
    )
  }

  if (state.kind === 'hidden') return null

  return (
    <>
      <UpdateViewer ref={viewerRef} />

      <Button
        color="error"
        variant="contained"
        size="small"
        className={className}
        onClick={() => viewerRef.current?.open()}
      >
        New
      </Button>
    </>
  )
}
