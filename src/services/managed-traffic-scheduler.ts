export const TRAFFIC_REPORT_INITIAL_MIN_MS = 5_000
export const TRAFFIC_REPORT_INITIAL_JITTER_MS = 25_000
export const TRAFFIC_REPORT_IDLE_INTERVAL_MS = 15_000
export const TRAFFIC_REPORT_IDLE_JITTER_MS = 15_000
export const TRAFFIC_REPORT_INTERVAL_MS = 300_000
export const TRAFFIC_REPORT_JITTER_MS = 60_000
export const TRAFFIC_REPORT_MAX_BACKOFF_MS = 1_800_000
export const TRAFFIC_REPORT_ACTIVITY_DELAY_MS = 5_000
export const TRAFFIC_REPORT_ACTIVE_MIN_INTERVAL_MS = 30_000

export type ManagedTrafficReportOutcome = {
  status:
    | 'acknowledged'
    | 'counter_rebased'
    | 'inactive'
    | 'invalid_delta_discarded'
    | 'no_delta'
  sequence?: number
}

export type ManagedTrafficReportFailureCode =
  | 'authentication'
  | 'http'
  | 'network'
  | 'rate_limited'
  | 'server_rejected'
  | 'service_unavailable'
  | 'traffic_limit'

export class ManagedTrafficReportError extends Error {
  readonly code: ManagedTrafficReportFailureCode
  readonly httpStatus?: number

  constructor(code: ManagedTrafficReportFailureCode, httpStatus?: number) {
    super('Managed traffic report failed')
    this.name = 'ManagedTrafficReportError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

type TimerHandle = unknown

export type ManagedTrafficSchedulerTransition = {
  state: 'attempting' | 'retrying' | 'scheduled' | 'stopped'
  at: number
  failureCount: number
  nextAttemptAt?: number
  reason?: 'activity' | 'initial' | 'success'
  outcome?: ManagedTrafficReportOutcome
  errorCode?: ManagedTrafficReportFailureCode
  httpStatus?: number
}

type ManagedTrafficSchedulerOptions = {
  report: () => Promise<ManagedTrafficReportOutcome>
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle
  clearTimer?: (handle: TimerHandle) => void
  random?: () => number
  now?: () => number
  takeRetryAfterMs?: () => number
  onTransition?: (transition: ManagedTrafficSchedulerTransition) => void
}

const normalizeDelay = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0

export const createManagedTrafficScheduler = (
  options: ManagedTrafficSchedulerOptions,
) => {
  const setTimer =
    options.setTimer ||
    ((callback: () => void, delayMs: number) =>
      globalThis.setTimeout(callback, delayMs))
  const clearTimer =
    options.clearTimer ||
    ((handle: TimerHandle) =>
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>))
  const now = options.now || Date.now
  const random = () => {
    const value = options.random?.() ?? Math.random()
    return Math.min(0.999_999_999, Math.max(0, value))
  }
  const emit = (transition: ManagedTrafficSchedulerTransition) => {
    try {
      options.onTransition?.(transition)
    } catch {
      // Diagnostics must never interrupt accounting or retries.
    }
  }

  const report = options.report
  let timer: TimerHandle | undefined
  let nextAttemptAt: number | undefined
  let stopped = true
  let failures = 0
  let inFlight = false
  let lastAttemptAt: number | undefined
  let activityPending = false

  const schedule = (
    delayMs: number,
    transition: Omit<
      ManagedTrafficSchedulerTransition,
      'at' | 'failureCount' | 'nextAttemptAt' | 'state'
    > & { state: 'retrying' | 'scheduled' },
  ) => {
    const delay = normalizeDelay(delayMs)
    const scheduledAt = now()
    if (timer !== undefined) clearTimer(timer)
    nextAttemptAt = scheduledAt + delay
    timer = setTimer(() => {
      timer = undefined
      nextAttemptAt = undefined
      void run()
    }, delay)
    emit({
      ...transition,
      at: scheduledAt,
      failureCount: failures,
      nextAttemptAt,
    })
  }

  const run = async () => {
    if (stopped) return
    const attemptedAt = now()
    lastAttemptAt = attemptedAt
    inFlight = true
    emit({ state: 'attempting', at: attemptedAt, failureCount: failures })
    try {
      const outcome = await report()
      if (stopped) return
      failures = 0
      options.takeRetryAfterMs?.()
      const normalDelay =
        outcome.status === 'inactive' || outcome.status === 'no_delta'
          ? TRAFFIC_REPORT_IDLE_INTERVAL_MS +
            Math.floor(random() * TRAFFIC_REPORT_IDLE_JITTER_MS)
          : TRAFFIC_REPORT_INTERVAL_MS +
            Math.floor(random() * TRAFFIC_REPORT_JITTER_MS)
      const pendingActivity = activityPending
      activityPending = false
      const activeDelay = Math.max(
        TRAFFIC_REPORT_ACTIVITY_DELAY_MS,
        TRAFFIC_REPORT_ACTIVE_MIN_INTERVAL_MS - (now() - attemptedAt),
      )
      schedule(
        Math.min(normalDelay, pendingActivity ? activeDelay : normalDelay),
        {
          state: 'scheduled',
          reason: pendingActivity ? 'activity' : 'success',
          outcome,
        },
      )
    } catch (error) {
      if (stopped) return
      failures += 1
      const backoff = Math.min(
        TRAFFIC_REPORT_MAX_BACKOFF_MS,
        TRAFFIC_REPORT_INTERVAL_MS * 2 ** Math.min(failures, 3),
      )
      const retryAfter = Math.max(0, options.takeRetryAfterMs?.() || 0)
      const delay = Math.max(retryAfter, backoff * (0.75 + random() * 0.5))
      const reportError =
        error instanceof ManagedTrafficReportError ? error : undefined
      schedule(delay, {
        state: 'retrying',
        errorCode: reportError?.code || 'network',
        httpStatus: reportError?.httpStatus,
      })
    } finally {
      inFlight = false
    }
  }

  return {
    start() {
      if (!stopped) return
      stopped = false
      failures = 0
      schedule(
        TRAFFIC_REPORT_INITIAL_MIN_MS +
          Math.floor(random() * TRAFFIC_REPORT_INITIAL_JITTER_MS),
        { state: 'scheduled', reason: 'initial' },
      )
    },
    stop() {
      if (stopped) return
      stopped = true
      activityPending = false
      if (timer !== undefined) {
        clearTimer(timer)
        timer = undefined
      }
      nextAttemptAt = undefined
      emit({ state: 'stopped', at: now(), failureCount: failures })
    },
    notifyActivity() {
      if (stopped) return false
      if (inFlight || failures > 0) {
        // The current/frozen payload might not contain this newer sample. Keep
        // the activity pending without shortening an in-flight request/backoff.
        activityPending = true
        return false
      }

      const requestedAt = now()
      const earliestByRateLimit =
        lastAttemptAt === undefined
          ? requestedAt + TRAFFIC_REPORT_ACTIVITY_DELAY_MS
          : Math.max(
              requestedAt + TRAFFIC_REPORT_ACTIVITY_DELAY_MS,
              lastAttemptAt + TRAFFIC_REPORT_ACTIVE_MIN_INTERVAL_MS,
            )
      if (nextAttemptAt !== undefined && nextAttemptAt <= earliestByRateLimit) {
        return false
      }
      schedule(earliestByRateLimit - requestedAt, {
        state: 'scheduled',
        reason: 'activity',
      })
      return true
    },
    isRunning() {
      return !stopped
    },
  }
}
