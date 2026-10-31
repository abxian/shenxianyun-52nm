// One lightweight request at a time, independent of VPN state. A focus/online
// wake is coalesced with an in-flight check; only reads receive cancellation.
export type SubscriptionMonitor = {
  start: () => void
  wake: () => void
  stop: () => void
}
export const createSubscriptionMonitor = (options: {
  check: (signal: AbortSignal, controller: AbortController) => Promise<void>
  canRun: () => boolean
  intervalMs?: () => number
  now?: () => number
  random?: () => number
  setTimer?: typeof setTimeout
  clearTimer?: typeof clearTimeout
}): SubscriptionMonitor => {
  const setTimer = options.setTimer ?? setTimeout
  const clearTimer = options.clearTimer ?? clearTimeout
  let active = false
  let checking = false
  let wakePending = false
  let failures = 0
  let notBefore = 0
  const now = options.now ?? Date.now
  let controller: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = (delay: number) => {
    if (timer !== undefined) clearTimer(timer)
    if (active)
      timer = setTimer(() => {
        timer = undefined
        void run()
      }, delay)
  }
  const run = async () => {
    if (!active) return
    if (checking) {
      wakePending = true
      return
    }
    if (now() < notBefore) {
      schedule(notBefore - now())
      return
    }
    if (!options.canRun()) {
      schedule(1000)
      return
    }
    checking = true
    wakePending = false
    controller = new AbortController()
    let retryAfter = 0
    try {
      await options.check(controller.signal, controller)
      failures = 0
      notBefore = 0
    } catch (error) {
      if (!controller.signal.aborted) {
        failures = Math.min(failures + 1, 4)
        retryAfter = Math.max(
          0,
          Number((error as { retryAfterMs?: number })?.retryAfterMs) || 0,
        )
        if (retryAfter > 0) notBefore = now() + retryAfter
      }
    } finally {
      checking = false
      controller = undefined
    }
    if (!active) return
    const base = Math.min(
      (options.intervalMs?.() ?? 30_000) * 2 ** failures,
      300_000,
    )
    const delay = base * (0.8 + (options.random?.() ?? Math.random()) * 0.4)
    schedule(
      retryAfter > 0 ? Math.max(retryAfter, delay) : wakePending ? 0 : delay,
    )
  }
  return {
    start: () => {
      if (!active) {
        active = true
        void run()
      }
    },
    wake: () => {
      if (!active) return
      if (timer !== undefined) {
        clearTimer(timer)
        timer = undefined
      }
      void run()
    },
    stop: () => {
      active = false
      if (timer !== undefined) clearTimer(timer)
      controller?.abort()
    },
  }
}
