// presence（heartbeat / offline）上报的节流闸门。
//
// 背景：2026-08-31 线上排查发现 14 台设备以 2.7-10.7 次/秒刷 presence 接口，
// 设计值只有约 1 次/130 秒。根因是首页的 running 由多个独立刷新的查询派生，
// 刷新/重试期间会瞬时翻转，而 presence 上报的 useEffect 直接以它为依赖，
// 卸载发 offline、挂载发 heartbeat，抖一次就多发一对。
//
// 这里把「该不该发」抽成与 React 无关的纯逻辑，便于单测覆盖：
// 上游无论因为什么原因重复触发，都由这道闸门统一挡住。

// running 需要稳定多久才允许驱动 presence 上报。
export const PRESENCE_STATE_DEBOUNCE_MS = 5_000
// 同一状态在该窗口内不重复上报。心跳间隔 120s，正常节奏不受影响。
export const PRESENCE_MIN_INTERVAL_MS = 15_000
// 服务端返回 429 但没给 Retry-After 时的兜底退避。
export const PRESENCE_RETRY_AFTER_FALLBACK_MS = 15_000
export const PRESENCE_MAX_BACKOFF_MS = 300_000

export type PresenceThrottleState = {
  lastSent: { online: boolean; at: number } | null
  retryUntil: number
  failureCount: number
}

export type PresenceSkipReason = 'backoff' | 'duplicate'

export const createPresenceThrottleState = (): PresenceThrottleState => ({
  lastSent: null,
  retryUntil: 0,
  failureCount: 0,
})

/** 判断本次 presence 上报是否应当真正发出。 */
export const shouldSendPresence = (
  state: PresenceThrottleState,
  online: boolean,
  now: number,
): { send: true } | { send: false; reason: PresenceSkipReason } => {
  if (now < state.retryUntil) return { send: false, reason: 'backoff' }
  const last = state.lastSent
  if (
    last &&
    last.online === online &&
    now - last.at < PRESENCE_MIN_INTERVAL_MS
  ) {
    return { send: false, reason: 'duplicate' }
  }
  return { send: true }
}

/** 记录一次已经发出的上报。状态变化（online↔offline）总是允许立即发出。 */
export const markPresenceSent = (
  state: PresenceThrottleState,
  online: boolean,
  now: number,
) => {
  state.lastSent = { online, at: now }
}

/**
 * 记录一次 429。按 Retry-After 指数退避，封顶 PRESENCE_MAX_BACKOFF_MS。
 * 返回退避截止时间戳。
 */
export const markPresenceRateLimited = (
  state: PresenceThrottleState,
  retryAfterHeader: string | null | undefined,
  now: number,
) => {
  state.failureCount += 1
  const header = Number(retryAfterHeader)
  const base =
    Number.isFinite(header) && header > 0
      ? header * 1000
      : PRESENCE_RETRY_AFTER_FALLBACK_MS
  const backoff = Math.min(
    base * 2 ** (state.failureCount - 1),
    PRESENCE_MAX_BACKOFF_MS,
  )
  state.retryUntil = now + backoff
  return state.retryUntil
}

/** 上报被服务端接受，清空退避。 */
export const markPresenceAccepted = (state: PresenceThrottleState) => {
  state.failureCount = 0
  state.retryUntil = 0
}
