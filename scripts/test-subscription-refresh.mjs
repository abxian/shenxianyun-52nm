import assert from 'node:assert/strict'
import test from 'node:test'

import { planSubscriptionRefresh } from '../src/utils/subscription-refresh.ts'

test('refreshes once at startup even when the server version is unchanged', () => {
  assert.equal(
    planSubscriptionRefresh({
      hasCurrentProfile: true,
      startupRefreshPending: true,
      remoteVersion: 5,
      localVersion: 5,
    }),
    'startup',
  )
})

test('refreshes after startup only when the server version advances', () => {
  assert.equal(
    planSubscriptionRefresh({
      hasCurrentProfile: true,
      startupRefreshPending: false,
      remoteVersion: 6,
      localVersion: 5,
    }),
    'server-push',
  )
})

test('does not repeatedly download an unchanged subscription', () => {
  assert.equal(
    planSubscriptionRefresh({
      hasCurrentProfile: true,
      startupRefreshPending: false,
      remoteVersion: 5,
      localVersion: 5,
    }),
    null,
  )
})

test('does not refresh before a current profile is ready', () => {
  assert.equal(
    planSubscriptionRefresh({
      hasCurrentProfile: false,
      startupRefreshPending: true,
      remoteVersion: 9,
      localVersion: 0,
    }),
    null,
  )
})
