import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  parseManagedTrafficDiagnostic,
  reduceManagedTrafficDiagnostic,
} from '../src/services/managed-traffic-diagnostics.ts'

describe('managed traffic diagnostics', () => {
  it('keeps the last acknowledged sequence across later scheduler states', () => {
    const acknowledged = reduceManagedTrafficDiagnostic(null, {
      state: 'scheduled',
      at: 10_000,
      attemptId: 1,
      durationMs: 200,
      failureCount: 0,
      nextAttemptAt: 310_000,
      reason: 'success',
      outcome: { status: 'acknowledged', sequence: 7 },
    })
    const attempting = reduceManagedTrafficDiagnostic(acknowledged, {
      state: 'attempting',
      at: 40_000,
      attemptId: 2,
      failureCount: 0,
    })
    const scheduled = reduceManagedTrafficDiagnostic(attempting, {
      state: 'scheduled',
      at: 40_100,
      failureCount: 0,
      nextAttemptAt: 45_100,
      reason: 'activity',
    })

    assert.equal(acknowledged.state, 'acknowledged')
    assert.equal(acknowledged.acknowledgedSequence, 7)
    assert.equal(acknowledged.lastAcknowledgedAt, 10_000)
    assert.equal(attempting.state, 'attempting')
    assert.equal(attempting.acknowledgedSequence, 7)
    assert.equal(attempting.attemptStartedAt, 40_000)
    assert.equal(scheduled.state, 'scheduled')
    assert.equal(scheduled.acknowledgedSequence, 7)
    assert.equal(scheduled.lastAcknowledgedAt, 10_000)
  })

  it('records a timeout without erasing the prior acknowledgement', () => {
    const previous = reduceManagedTrafficDiagnostic(null, {
      state: 'scheduled',
      at: 1_000,
      attemptId: 3,
      failureCount: 0,
      outcome: { status: 'acknowledged', sequence: 11 },
    })
    const retrying = reduceManagedTrafficDiagnostic(previous, {
      state: 'retrying',
      at: 20_000,
      attemptId: 4,
      durationMs: 15_000,
      failureCount: 1,
      nextAttemptAt: 31_250,
      errorCode: 'timeout',
    })

    assert.equal(retrying.state, 'retrying')
    assert.equal(retrying.errorCode, 'timeout')
    assert.equal(retrying.lastErrorCode, 'timeout')
    assert.equal(retrying.lastAttemptDurationMs, 15_000)
    assert.equal(retrying.acknowledgedSequence, 11)
    assert.equal(retrying.lastAcknowledgedAt, 1_000)
  })

  it('accepts only the versioned redacted diagnostic shape', () => {
    const valid = JSON.stringify({
      version: 2,
      state: 'scheduled',
      updatedAt: 5,
      failureCount: 0,
      acknowledgedSequence: 2,
    })
    assert.equal(parseManagedTrafficDiagnostic(valid)?.acknowledgedSequence, 2)
    assert.equal(
      parseManagedTrafficDiagnostic(
        JSON.stringify({
          version: 1,
          state: 'scheduled',
          updatedAt: 5,
          failureCount: 0,
        }),
      ),
      null,
    )
    assert.equal(parseManagedTrafficDiagnostic('{broken'), null)
  })
})
