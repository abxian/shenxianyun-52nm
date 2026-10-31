import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createPresenceThrottleState,
  markPresenceAccepted,
  markPresenceRateLimited,
  markPresenceSent,
  PRESENCE_MAX_BACKOFF_MS,
  PRESENCE_MIN_INTERVAL_MS,
  PRESENCE_RETRY_AFTER_FALLBACK_MS,
  shouldSendPresence,
} from '../src/services/presence-throttle.ts'

describe('presence throttle', () => {
  it('lets the first report through', () => {
    const state = createPresenceThrottleState()
    assert.deepEqual(shouldSendPresence(state, true, 1_000), { send: true })
  })

  it('collapses a running-state flap into a single report', () => {
    // 复现线上风暴：running 抖动导致 offline/heartbeat 被反复触发。
    const state = createPresenceThrottleState()
    let now = 1_000
    markPresenceSent(state, true, now)

    // 抖动：立刻来一个 offline，再来一个 online。
    now += 200
    assert.deepEqual(shouldSendPresence(state, false, now), { send: true })
    markPresenceSent(state, false, now)

    now += 200
    // 状态又变回 online —— 状态变化允许发出，这是真实语义。
    assert.deepEqual(shouldSendPresence(state, true, now), { send: true })
    markPresenceSent(state, true, now)

    // 但同状态的重复触发会被挡住，风暴无法成型。
    now += 200
    assert.deepEqual(shouldSendPresence(state, true, now), {
      send: false,
      reason: 'duplicate',
    })
  })

  it('blocks same-state repeats until the minimum interval elapses', () => {
    const state = createPresenceThrottleState()
    markPresenceSent(state, true, 0)
    assert.deepEqual(
      shouldSendPresence(state, true, PRESENCE_MIN_INTERVAL_MS - 1),
      { send: false, reason: 'duplicate' },
    )
    assert.deepEqual(
      shouldSendPresence(state, true, PRESENCE_MIN_INTERVAL_MS),
      {
        send: true,
      },
    )
  })

  it('honours Retry-After from the reverse proxy', () => {
    const state = createPresenceThrottleState()
    const until = markPresenceRateLimited(state, '15', 1_000)
    assert.equal(until, 1_000 + 15_000)
    assert.deepEqual(shouldSendPresence(state, true, 1_000 + 14_999), {
      send: false,
      reason: 'backoff',
    })
    assert.deepEqual(shouldSendPresence(state, true, 1_000 + 15_000), {
      send: true,
    })
  })

  it('falls back to a default backoff when Retry-After is missing or bogus', () => {
    for (const header of [null, undefined, '', 'soon', '0', '-5']) {
      const state = createPresenceThrottleState()
      const until = markPresenceRateLimited(state, header, 0)
      assert.equal(
        until,
        PRESENCE_RETRY_AFTER_FALLBACK_MS,
        `header=${String(header)}`,
      )
    }
  })

  it('backs off exponentially and caps the delay', () => {
    const state = createPresenceThrottleState()
    assert.equal(markPresenceRateLimited(state, '15', 0), 15_000)
    assert.equal(markPresenceRateLimited(state, '15', 0), 30_000)
    assert.equal(markPresenceRateLimited(state, '15', 0), 60_000)
    for (let i = 0; i < 20; i += 1) markPresenceRateLimited(state, '15', 0)
    assert.equal(state.retryUntil, PRESENCE_MAX_BACKOFF_MS)
  })

  it('backoff outranks a genuine state change', () => {
    // 被限流期间连状态翻转也不放行，否则失控客户端仍能持续打接口。
    const state = createPresenceThrottleState()
    markPresenceSent(state, true, 0)
    markPresenceRateLimited(state, '15', 0)
    assert.deepEqual(shouldSendPresence(state, false, 1_000), {
      send: false,
      reason: 'backoff',
    })
  })

  it('clears the backoff once the server accepts a report', () => {
    const state = createPresenceThrottleState()
    markPresenceRateLimited(state, '15', 0)
    markPresenceRateLimited(state, '15', 0)
    markPresenceAccepted(state)
    assert.equal(state.failureCount, 0)
    assert.equal(state.retryUntil, 0)
    // 退避清空后，下一次 429 重新从一档开始。
    assert.equal(markPresenceRateLimited(state, '15', 0), 15_000)
  })

  it('keeps the designed heartbeat cadence unaffected', () => {
    // 心跳 120s + 抖动，远大于最小间隔，不应被误挡。
    const state = createPresenceThrottleState()
    let now = 0
    for (let i = 0; i < 10; i += 1) {
      assert.deepEqual(
        shouldSendPresence(state, true, now),
        { send: true },
        `heartbeat #${i}`,
      )
      markPresenceSent(state, true, now)
      markPresenceAccepted(state)
      now += 120_000
    }
  })
})
