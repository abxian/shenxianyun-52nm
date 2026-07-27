import { Box, Button, Typography } from '@mui/material'
import { useLockFn } from 'ahooks'
import type { Ref } from 'react'
import { useImperativeHandle, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog, BaseEmpty, DialogRef } from '@/components/base'
import { useVerge } from '@/hooks/use-verge'
import { getClashInfo, getProfiles, openWebUrl } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { resolveWebUiUrl } from '@/utils/web-ui-url'

import { WebUIItem } from './web-ui-item'

const DEFAULT_WEB_UI_LIST = [
  'https://yacd.metacubex.one/?hostname=%host&port=%port&secret=%secret#/connections',
  'https://metacubex.github.io/metacubexd/#/setup?http=true&hostname=%host&port=%port&secret=%secret',
  'https://board.zash.run.place/#/setup?http=true&hostname=%host&port=%port&secret=%secret',
]

export function WebUIViewer({ ref }: { ref?: Ref<DialogRef> }) {
  const { t } = useTranslation()

  const { verge, patchVerge, mutateVerge } = useVerge()

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }))

  const webUIList = verge?.web_ui_list || DEFAULT_WEB_UI_LIST

  const webUIEntries = useMemo(() => {
    const counts: Record<string, number> = {}
    return webUIList.map((item, index) => {
      const keyBase = item && item.trim().length > 0 ? item : 'entry'
      const count = counts[keyBase] ?? 0
      counts[keyBase] = count + 1
      return {
        item,
        index,
        key: `${keyBase}-${count}`,
      }
    })
  }, [webUIList])

  const handleAdd = useLockFn(async (value: string) => {
    const newList = [...webUIList, value]
    mutateVerge((old) => (old ? { ...old, web_ui_list: newList } : old), false)
    await patchVerge({ web_ui_list: newList })
  })

  const handleChange = useLockFn(async (index: number, value?: string) => {
    const newList = [...webUIList]
    newList[index] = value ?? ''
    mutateVerge((old) => (old ? { ...old, web_ui_list: newList } : old), false)
    await patchVerge({ web_ui_list: newList })
  })

  const handleDelete = useLockFn(async (index: number) => {
    const newList = [...webUIList]
    newList.splice(index, 1)
    mutateVerge((old) => (old ? { ...old, web_ui_list: newList } : old), false)
    await patchVerge({ web_ui_list: newList })
  })

  const handleOpenUrl = useLockFn(async (value?: string) => {
    if (!value) return
    try {
      // Always read the current runtime/profile pair before opening. The query
      // cache may still describe the controller used by the previous profile.
      const [clashInfo, profiles] = await Promise.all([
        getClashInfo(),
        getProfiles(),
      ])
      const url = resolveWebUiUrl(value, clashInfo, profiles.current)
      await openWebUrl(url)
    } catch (e: any) {
      showNotice.error(e)
    }
  })

  return (
    <BaseDialog
      open={open}
      title={
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          {t('settings.modals.webUI.title')}
          <Button
            variant="contained"
            size="small"
            disabled={editing}
            onClick={() => setEditing(true)}
          >
            {t('shared.actions.new')}
          </Button>
        </Box>
      }
      contentSx={{
        width: 450,
        height: 300,
        pb: 1,
        overflowY: 'auto',
        userSelect: 'text',
      }}
      cancelBtn={t('shared.actions.close')}
      disableOk
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
    >
      {!editing && webUIList.length === 0 && (
        <BaseEmpty
          extra={
            <Typography sx={{ mt: 2, fontSize: '12px' }}>
              {t('settings.modals.webUI.messages.placeholderInstruction')}
            </Typography>
          }
        />
      )}

      {webUIEntries.map(({ item, index, key }) => (
        <WebUIItem
          key={key}
          value={item}
          onChange={(v) => handleChange(index, v)}
          onDelete={() => handleDelete(index)}
          onOpenUrl={handleOpenUrl}
        />
      ))}
      {editing && (
        <WebUIItem
          value=""
          onlyEdit
          onChange={(v) => {
            setEditing(false)
            handleAdd(v || '')
          }}
          onCancel={() => setEditing(false)}
        />
      )}
    </BaseDialog>
  )
}
