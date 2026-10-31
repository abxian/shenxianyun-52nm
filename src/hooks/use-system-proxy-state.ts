import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'
import { closeAllConnections } from 'tauri-plugin-mihomo-api'

import { useVerge } from '@/hooks/use-verge'
import { useClashConfigData, useSystemData } from '@/providers/app-data-context'
import { getAutotemProxy } from '@/services/cmds'
import { queryClient } from '@/services/query-client'

// 系统代理状态检测统一逻辑
export const useSystemProxyState = () => {
  const { verge, mutateVerge, patchVerge } = useVerge()
  const { sysproxy } = useSystemData()
  const { clashConfig } = useClashConfigData()
  const { data: autoproxy } = useQuery({
    queryKey: ['getAutotemProxy'],
    queryFn: getAutotemProxy,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })

  const {
    enable_system_proxy,
    proxy_auto_config,
    proxy_host,
    verge_mixed_port,
  } = verge ?? {}

  // 上一次「输入齐备时」得出的判定结果。数据尚未就绪时沿用它。
  const lastIndicatorRef = useRef(false)

  // OS 实际状态：enable + 地址匹配本应用。
  //
  // 这个值会经 running 直接驱动首页 presence 上报的挂载/卸载，瞬时误判一次
  // 就会多向服务端发一对 offline+heartbeat。而它的三个输入（verge / sysproxy
  // 或 autoproxy / clashConfig）各自独立刷新与重试，任何一个短暂 undefined
  // 都会让旧写法立刻返回 false。2026-08-31 线上因此出现 14 台设备以 2.7-10.7
  // 次/秒刷心跳的上报风暴。
  //
  // 因此这里必须把「数据还没加载出来」和「系统代理确实关着」区分开：
  // 前者保持上一次结论，只有确证为关闭时才返回 false。
  const indicator = (() => {
    if (!verge) return lastIndicatorRef.current
    const host = proxy_host || '127.0.0.1'
    if (proxy_auto_config) {
      if (autoproxy === undefined) return lastIndicatorRef.current
      if (!autoproxy.enable) return false
      const pacPort = import.meta.env.DEV ? 11233 : 33331
      return autoproxy.url === `http://${host}:${pacPort}/commands/pac`
    }
    if (sysproxy === undefined) return lastIndicatorRef.current
    if (!sysproxy.enable) return false
    // 端口未知时无法比对。旧写法回落到硬编码 7897，会在 clashConfig 尚未加载、
    // 且用户改过混合端口时与真实端口对不上，从而误判为「已关闭」。
    const port = verge_mixed_port || clashConfig?.mixedPort
    if (!port) return lastIndicatorRef.current
    return sysproxy.server === `${host}:${port}`
  })()
  lastIndicatorRef.current = indicator

  // "最后一次生效"模式：快速连续点击时，只执行最终状态
  const pendingRef = useRef<boolean | null>(null)
  const busyRef = useRef(false)

  const toggleSystemProxy = useCallback(
    async (enabled: boolean) => {
      mutateVerge(
        (prev) => (prev ? { ...prev, enable_system_proxy: enabled } : prev),
        false,
      )
      pendingRef.current = enabled

      if (busyRef.current) return
      busyRef.current = true

      try {
        while (pendingRef.current !== null) {
          const target = pendingRef.current
          pendingRef.current = null
          await patchVerge({ enable_system_proxy: target })
          if (!target && verge?.auto_close_connection) {
            await closeAllConnections().catch(() => {})
          }
        }
      } finally {
        busyRef.current = false
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['getSystemProxy'] }),
          queryClient.invalidateQueries({ queryKey: ['getAutotemProxy'] }),
        ])
      }
    },
    [mutateVerge, patchVerge, verge?.auto_close_connection],
  )

  const invalidateProxyState = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['getSystemProxy'] }),
        queryClient.invalidateQueries({ queryKey: ['getAutotemProxy'] }),
      ]),
    [],
  )

  return {
    indicator,
    configState: enable_system_proxy ?? false,
    toggleSystemProxy,
    invalidateProxyState,
  }
}
