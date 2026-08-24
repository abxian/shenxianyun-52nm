export const TRAFFIC_REPORT_INITIAL_MIN_MS = 5_000
export const TRAFFIC_REPORT_INITIAL_JITTER_MS = 25_000
export const TRAFFIC_REPORT_IDLE_INTERVAL_MS = 15_000
export const TRAFFIC_REPORT_IDLE_JITTER_MS = 15_000
export const TRAFFIC_REPORT_INTERVAL_MS = 300_000
export const TRAFFIC_REPORT_JITTER_MS = 60_000
export const TRAFFIC_REPORT_RETRY_BASE_MS = 15_000
export const TRAFFIC_REPORT_MAX_BACKOFF_MS = 1_800_000
export const TRAFFIC_REPORT_ACTIVITY_DELAY_MS = 5_000
export const TRAFFIC_REPORT_ACTIVE_MIN_INTERVAL_MS = 30_000
export const TRAFFIC_REPORT_REQUEST_TIMEOUT_MS = 15_000

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
  | 'timeout'
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
  attemptId?: number
  durationMs?: number
  failureCount: number
  nextAttemptAt?: number
  reason?: 'activity' | 'initial' | 'success'
  outcome?: ManagedTrafficReportOutcome
  errorCode?: ManagedTrafficReportFailureCode
  httpStatus?: number
}

type ManagedTrafficSchedulerOptions = {
  report: (signal: AbortSignal) => Promise<ManagedTrafficReportOutcome>
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle
  clearTimer?: (handle: TimerHandle) => void
  random?: () => number
  now?: () => number
  reportTimeoutMs?: number
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
  const reportTimeoutMs = normalizeDelay(
    options.reportTimeoutMs ?? TRAFFIC_REPORT_REQUEST_TIMEOUT_MS,
  )
  let timer: TimerHandle | undefined
  let reportTimeoutTimer: TimerHandle | undefined
  let nextAttemptAt: number | undefined
  let stopped = true
  let failures = 0
  let inFlight = false
  let lastAttemptAt: number | undefined
  let activityPending = false
  let lifecycle = 0
  let attemptSequence = 0
  let activeAttemptId: number | undefined
  let activeAbortController: AbortController | undefined
  let cancelActiveReport: (() => void) | undefined

  const schedule = (
    delayMs: number,
    transition: Omit<
      ManagedTrafficSchedulerTransition,
      'at' | 'failureCount' | 'nextAttemptAt' | 'state'
    > & { state: 'retrying' | 'scheduled' },
  ) => {
    if (stopped) return
    const delay = normalizeDelay(delayMs)
    const scheduledAt = now()
    const scheduledLifecycle = lifecycle
    if (timer !== undefined) clearTimer(timer)
    nextAttemptAt = scheduledAt + delay
    timer = setTimer(() => {
      if (stopped || scheduledLifecycle !== lifecycle) return
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
    if (stopped || inFlight) return
    const runLifecycle = lifecycle
    const attemptId = ++attemptSequence
    const attemptedAt = now()
    lastAttemptAt = attemptedAt
    inFlight = true
    activeAttemptId = attemptId
    const abortController = new AbortController()
    activeAbortController = abortController
    let timedOut = false
    let rejectDeadline: ((reason: Error) => void) | undefined
    const deadline = new Promise<never>((_resolve, reject) => {
      rejectDeadline = reject
      reportTimeoutTimer = setTimer(() => {
        timedOut = true
        abortController.abort()
        reject(new ManagedTrafficReportError('timeout'))
      }, reportTimeoutMs)
    })
    cancelActiveReport = () => {
      abortController.abort()
      rejectDeadline?.(new Error('Managed traffic report cancelled'))
    }
    emit({
      state: 'attempting',
      at: attemptedAt,
      attemptId,
      failureCount: failures,
    })
    try {
      const outcome = await Promise.race([
        Promise.resolve().then(() => report(abortController.signal)),
        deadline,
      ])
      if (stopped || runLifecycle !== lifecycle) return
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
          attemptId,
          durationMs: Math.max(0, now() - attemptedAt),
          reason: pendingActivity ? 'activity' : 'success',
          outcome,
        },
      )
    } catch (error) {
      if (stopped || runLifecycle !== lifecycle) return
      failures += 1
      const backoff = Math.min(
        TRAFFIC_REPORT_MAX_BACKOFF_MS,
        TRAFFIC_REPORT_RETRY_BASE_MS *
          2 ** Math.min(Math.max(0, failures - 1), 7),
      )
      const retryAfter = Math.max(0, options.takeRetryAfterMs?.() || 0)
      const delay = Math.max(retryAfter, backoff * (0.75 + random() * 0.5))
      const reportError = timedOut
        ? new ManagedTrafficReportError('timeout')
        : error instanceof ManagedTrafficReportError
          ? error
          : undefined
      schedule(delay, {
        state: 'retrying',
        attemptId,
        durationMs: Math.max(0, now() - attemptedAt),
        errorCode: reportError?.code || 'network',
        httpStatus: reportError?.httpStatus,
      })
    } finally {
      if (reportTimeoutTimer !== undefined) {
        clearTimer(reportTimeoutTimer)
        reportTimeoutTimer = undefined
      }
      if (activeAttemptId === attemptId) {
        activeAttemptId = undefined
        activeAbortController = undefined
        cancelActiveReport = undefined
        inFlight = false
      }
    }
  }

  return {
    start() {
      if (!stopped) return
      stopped = false
      lifecycle += 1
      failures = 0
      inFlight = false
      lastAttemptAt = undefined
      activityPending = false
      schedule(
        TRAFFIC_REPORT_INITIAL_MIN_MS +
          Math.floor(random() * TRAFFIC_REPORT_INITIAL_JITTER_MS),
        { state: 'scheduled', reason: 'initial' },
      )
    },
    stop() {
      if (stopped) return
      stopped = true
      lifecycle += 1
      activityPending = false
      if (timer !== undefined) {
        clearTimer(timer)
        timer = undefined
      }
      if (reportTimeoutTimer !== undefined) {
        clearTimer(reportTimeoutTimer)
        reportTimeoutTimer = undefined
      }
      cancelActiveReport?.()
      activeAbortController?.abort()
      cancelActiveReport = undefined
      activeAbortController = undefined
      activeAttemptId = undefined
      inFlight = false
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
