import type {
  ManagedTrafficReportFailureCode,
  ManagedTrafficSchedulerTransition,
} from './managed-traffic-scheduler'

export type ManagedTrafficDiagnostic = {
  version: 2
  state: 'acknowledged' | ManagedTrafficSchedulerTransition['state']
  updatedAt: number
  failureCount: number
  nextAttemptAt?: number
  reason?: ManagedTrafficSchedulerTransition['reason']
  outcome?: NonNullable<ManagedTrafficSchedulerTransition['outcome']>['status']
  acknowledgedSequence?: number
  lastAcknowledgedAt?: number
  attemptId?: number
  attemptStartedAt?: number
  lastAttemptDurationMs?: number
  errorCode?: ManagedTrafficReportFailureCode
  lastErrorCode?: ManagedTrafficReportFailureCode
  httpStatus?: number
}

export const parseManagedTrafficDiagnostic = (
  raw: string | null,
): ManagedTrafficDiagnostic | null => {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<ManagedTrafficDiagnostic>
    const states = new Set([
      'acknowledged',
      'attempting',
      'retrying',
      'scheduled',
      'stopped',
    ])
    if (
      value.version !== 2 ||
      !states.has(String(value.state)) ||
      !Number.isFinite(value.updatedAt) ||
      !Number.isInteger(value.failureCount) ||
      Number(value.failureCount) < 0 ||
      (value.acknowledgedSequence !== undefined &&
        (!Number.isInteger(value.acknowledgedSequence) ||
          Number(value.acknowledgedSequence) < 0))
    ) {
      return null
    }
    return value as ManagedTrafficDiagnostic
  } catch {
    return null
  }
}

export const reduceManagedTrafficDiagnostic = (
  previous: ManagedTrafficDiagnostic | null,
  transition: ManagedTrafficSchedulerTransition,
): ManagedTrafficDiagnostic => {
  const acknowledged = transition.outcome?.status === 'acknowledged'
  const acknowledgedSequence = Number.isInteger(transition.outcome?.sequence)
    ? transition.outcome?.sequence
    : undefined
  const attempting = transition.state === 'attempting'
  return {
    version: 2,
    state: acknowledged ? 'acknowledged' : transition.state,
    updatedAt: transition.at,
    failureCount: transition.failureCount,
    nextAttemptAt: transition.nextAttemptAt,
    reason: transition.reason,
    outcome: transition.outcome?.status ?? previous?.outcome,
    acknowledgedSequence:
      acknowledged && acknowledgedSequence !== undefined
        ? acknowledgedSequence
        : previous?.acknowledgedSequence,
    lastAcknowledgedAt:
      acknowledged && acknowledgedSequence !== undefined
        ? transition.at
        : previous?.lastAcknowledgedAt,
    attemptId: transition.attemptId ?? previous?.attemptId,
    attemptStartedAt: attempting ? transition.at : previous?.attemptStartedAt,
    lastAttemptDurationMs:
      transition.durationMs ?? previous?.lastAttemptDurationMs,
    errorCode: transition.errorCode,
    lastErrorCode: transition.errorCode ?? previous?.lastErrorCode,
    httpStatus: transition.httpStatus,
  }
}
