import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createManagedTrafficScheduler,
  ManagedTrafficReportError,
} from '../src/services/managed-traffic-scheduler.ts'

class FakeClock {
  nowMs = 0
  nextId = 1
  tasks = new Map()

  setTimer = (callback, delayMs) => {
    const id = this.nextId
    this.nextId += 1
    this.tasks.set(id, { at: this.nowMs + delayMs, callback })
    return id
  }

  clearTimer = (id) => {
    this.tasks.delete(id)
  }

  async advanceBy(delayMs) {
    const target = this.nowMs + delayMs
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0]
      if (!next) break
      const [id, task] = next
      this.tasks.delete(id)
      this.nowMs = task.at
      task.callback()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    }
    this.nowMs = target
  }
}

const createScheduler = (clock, options) =>
  createManagedTrafficScheduler({
    random: () => 0,
    now: () => clock.nowMs,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...options,
  })

describe('managed traffic scheduler', () => {
  it('keeps the initial timer while a high-frequency render updates its callback', async () => {
    const clock = new FakeClock()
    const calls = []
    const transitions = []
    const reportRef = {
      current: async () => {
        calls.push(0)
        return { status: 'acknowledged', sequence: 1 }
      },
    }
    const scheduler = createScheduler(clock, {
      report: () => reportRef.current(),
      onTransition: (transition) => transitions.push(transition),
    })

    scheduler.start()
    for (let render = 1; render <= 9; render += 1) {
      await clock.advanceBy(500)
      reportRef.current = async () => {
        calls.push(render)
        return { status: 'acknowledged', sequence: 1 }
      }
    }
    assert.deepEqual(calls, [])

    reportRef.current = async () => {
      calls.push(10)
      return { status: 'acknowledged', sequence: 1 }
    }
    await clock.advanceBy(500)

    assert.deepEqual(calls, [10])
    assert.equal(transitions[0].state, 'scheduled')
    assert.equal(transitions[0].nextAttemptAt, 5_000)
    assert.equal(transitions.at(-1).state, 'scheduled')
    assert.equal(transitions.at(-1).outcome.sequence, 1)
    assert.equal(transitions.at(-1).nextAttemptAt, 305_000)
  })

  it('consumes Retry-After once and then returns to the success interval', async () => {
    const clock = new FakeClock()
    const transitions = []
    let attempts = 0
    let retryAfterMs = 700_000
    const scheduler = createScheduler(clock, {
      report: async () => {
        attempts += 1
        if (attempts === 1) {
          throw new ManagedTrafficReportError('rate_limited', 429)
        }
        return { status: 'acknowledged', sequence: 2 }
      },
      takeRetryAfterMs: () => {
        const value = retryAfterMs
        retryAfterMs = 0
        return value
      },
      onTransition: (transition) => transitions.push(transition),
    })

    scheduler.start()
    await clock.advanceBy(5_000)
    const retry = transitions.at(-1)
    assert.equal(retry.state, 'retrying')
    assert.equal(retry.errorCode, 'rate_limited')
    assert.equal(retry.httpStatus, 429)
    assert.equal(retry.nextAttemptAt, 705_000)

    await clock.advanceBy(700_000)
    assert.equal(attempts, 2)
    assert.equal(transitions.at(-1).state, 'scheduled')
    assert.equal(transitions.at(-1).nextAttemptAt, 1_005_000)
    assert.equal(retryAfterMs, 0)
  })

  it('rechecks locally without a five-minute wait when no delta exists', async () => {
    const clock = new FakeClock()
    const transitions = []
    const scheduler = createScheduler(clock, {
      report: async () => ({ status: 'no_delta' }),
      onTransition: (transition) => transitions.push(transition),
    })

    scheduler.start()
    await clock.advanceBy(5_000)

    assert.equal(transitions.at(-1).state, 'scheduled')
    assert.equal(transitions.at(-1).outcome.status, 'no_delta')
    assert.equal(transitions.at(-1).nextAttemptAt, 20_000)
  })

  it('cancels a pending timer and never schedules after an in-flight stop', async () => {
    const clock = new FakeClock()
    let calls = 0
    let finishReport
    const scheduler = createScheduler(clock, {
      report: () => {
        calls += 1
        return new Promise((resolve) => {
          finishReport = resolve
        })
      },
    })

    scheduler.start()
    await clock.advanceBy(5_000)
    assert.equal(calls, 1)
    scheduler.stop()
    finishReport({ status: 'acknowledged', sequence: 1 })
    await Promise.resolve()
    await Promise.resolve()
    assert.equal(clock.tasks.size, 0)
    assert.equal(scheduler.isRunning(), false)
  })
})
