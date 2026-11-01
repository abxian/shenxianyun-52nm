import assert from 'node:assert/strict'
import test from 'node:test'

import { refreshWithFeedback } from '../src/services/subscription-refresh-feedback.ts'

test('manual success appears only after the refresh transaction completes', async () => {
  const feedback = []
  let complete
  const refresh = new Promise((resolve) => {
    complete = resolve
  })
  const pending = refreshWithFeedback({
    automatic: false,
    refresh: () => refresh,
    notify: (value) => feedback.push(value),
  })
  await Promise.resolve()
  assert.equal(feedback.length, 0)
  complete('updated')
  await pending
  assert.deepEqual(feedback, [
    { severity: 'success', message: '订阅更新成功，已获取最新节点' },
  ])
})

test('a successful fetch with identical nodes still confirms success', async () => {
  const feedback = []
  await refreshWithFeedback({
    automatic: false,
    refresh: async () => 'unchanged',
    notify: (value) => feedback.push(value),
  })
  assert.deepEqual(feedback, [
    { severity: 'success', message: '更新成功，当前节点已是最新' },
  ])
})

test('download/config failure stays a rejection, with a short nontechnical notice', async () => {
  const feedback = []
  const error = new Error('isolated technical fixture, not user data')
  await assert.rejects(
    refreshWithFeedback({
      automatic: false,
      refresh: async () => {
        throw error
      },
      notify: (value) => feedback.push(value),
    }),
    (actual) => actual === error,
  )
  assert.deepEqual(feedback, [
    { severity: 'warning', message: '更新失败，已保留原订阅' },
  ])
  assert.equal(JSON.stringify(feedback).includes(error.message), false)
})

test('automatic refresh success and failure do not produce popups', async () => {
  const feedback = []
  const notify = (value) => feedback.push(value)
  await refreshWithFeedback({
    automatic: true,
    refresh: async () => 'updated',
    notify,
  })
  await assert.rejects(
    refreshWithFeedback({
      automatic: true,
      refresh: async () => {
        throw new Error('offline')
      },
      notify,
    }),
    /offline/,
  )
  assert.deepEqual(feedback, [])
})

test('a detached local subscription is not reported as an updated subscription', async () => {
  const feedback = []
  await refreshWithFeedback({
    automatic: false,
    refresh: async () => 'detached',
    notify: (value) => feedback.push(value),
  })
  assert.deepEqual(feedback, [
    { severity: 'info', message: '未更新，当前订阅由本地管理' },
  ])
})
