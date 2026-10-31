import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import ts from 'typescript'

import { assertRequestActive } from '../src/services/http-request-deadline.ts'
import { createSubscriptionMonitor } from '../src/services/subscription-monitor.ts'
import {
  needsSubscriptionRefresh,
  parseAccessRestriction,
  restrictionReason,
} from '../src/utils/access-recovery.ts'

// Exercise the real Home business callback with isolated IO ports, rather than
// reimplementing its state machine in a test or accessing a user's native app.
const source = ts.createSourceFile(
  'home.tsx',
  readFileSync(new URL('../src/pages/home.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)
let callbackText
let errorText
const visit = (node) => {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(source) === 'checkSubscriptionRecovery'
  )
    callbackText = node.initializer.arguments[0].getText(source)
  if (ts.isClassDeclaration(node) && node.name?.text === 'AccessCodeStateError')
    errorText = node.getText(source)
  ts.forEachChild(node, visit)
}
visit(source)
assert.ok(callbackText && errorText)
const compile = (text) =>
  ts.transpileModule(text, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText
const AccessCodeStateError = new Function(
  `${compile(errorText)}; return AccessCodeStateError`,
)()
const createCheck = new Function(
  'ports',
  `with (ports) { ${compile(`const check = ${callbackText}`)}; return check }`,
)
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}

const ports = () => {
  const storage = new Map([
    ['code', 'fixture'],
    ['version', '10'],
    ['revision', JSON.stringify({ accessCode: 'fixture', revision: 'old' })],
  ])
  const events = []
  const p = {
    events,
    storage,
    currentCode: 'fixture',
    activeCodeRef: { current: 'fixture' },
    current: { uid: 'fixture-profile' },
    expiresAt: '2030-01-01 00:00:00',
    running: false,
    CODE_STORAGE_KEY: 'code',
    CODE_UPDATE_VERSION_STORAGE_KEY: 'version',
    CODE_REVISION_STORAGE_KEY: 'revision',
    STARTUP_REFRESH_SESSION_KEY: 'startup',
    localStorage: {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, v),
    },
    sessionStorage: { setItem: () => undefined },
    updateInFlightRef: { current: false },
    refreshApplyInFlightRef: { current: false },
    autoRefreshControllerRef: { current: null },
    startupRefreshCompletedRef: { current: true },
    restrictionRef: { current: null },
    managedAuthRef: { current: { accessCode: 'fixture' } },
    proxyUrlRef: { current: null },
    AccessCodeStateError,
    assertRequestActive,
    restrictionReason,
    needsSubscriptionRefresh,
    parseExpireTime: (value) => Date.parse(value.replace(' ', 'T')),
    updateState: async () => ({
      ok: true,
      expires_at: p.expiresAt,
      update_version: 10,
      subscription_revision: 'old',
    }),
    onExpiredProfile: () => false,
    syncExpiresAt: async (value) => {
      p.expiresAt = value
      events.push('expiry')
    },
    updateManagedProfile: async () => {
      events.push('apply')
      return 'managed-updated'
    },
    recoverFromExpired: async () => {
      events.push('recover-original')
      return 'managed-updated'
    },
    updateCurrentProfileKeepingRules: async () => {
      events.push('legacy-apply')
    },
    mutateProfiles: async () => undefined,
    refreshAll: async () => undefined,
    setBusy: () => undefined,
    setStatus: (value) => events.push(['status', value]),
    setExpiredDialogOpen: () => undefined,
    clearAccessRestriction: () => {
      p.restrictionRef.current = null
      events.push('clear')
    },
    recordAccessRestriction: (accessCode, reason) => {
      p.restrictionRef.current = { accessCode, reason }
      events.push(['restrict', reason])
    },
    activateExpiredProfile: async () => {
      events.push('placeholder')
    },
    stopForServerLimit: async () => {
      events.push('stop')
    },
    rotateApiBase: async () => undefined,
  }
  return p
}

test('stopped VPN receives a file move even when the timestamp version goes backwards', async () => {
  const p = ports()
  p.updateState = async () => ({
    ok: true,
    update_version: 2,
    subscription_revision: 'moved-file',
  })
  await createCheck(p)(new AbortController().signal)
  assert.ok(p.events.indexOf('apply') < p.events.indexOf('clear'))
  assert.equal(p.storage.get('version'), '2')
  assert.equal(JSON.parse(p.storage.get('revision')).revision, 'moved-file')
  assert.ok(!p.events.includes('stop'))
})

test('quota exhaustion remains recoverable while stopped and restoration forces an update at equal version', async () => {
  const p = ports()
  p.updateState = async () => {
    throw new AccessCodeStateError('fixture limit', true, 'traffic_limit')
  }
  await createCheck(p)(new AbortController().signal)
  assert.equal(p.restrictionRef.current.reason, 'traffic_limit')
  assert.ok(!p.events.includes('apply'))
  p.updateState = async () => ({
    ok: true,
    update_version: 10,
    subscription_revision: 'old',
  })
  await createCheck(p)(new AbortController().signal)
  assert.ok(p.events.includes('apply'))
  assert.equal(p.restrictionRef.current, null)
  assert.ok(!p.events.includes('stop'))
})

test('manual extension restores original profile from an expiry placeholder without user re-import', async () => {
  const p = ports()
  p.expiresAt = '2020-01-01 00:00:00'
  p.onExpiredProfile = () => true
  p.updateState = async () => ({
    ok: true,
    update_version: 10,
    expires_at: '2031-01-01 00:00:00',
    subscription_revision: 'renewed',
  })
  await createCheck(p)(new AbortController().signal)
  assert.deepEqual(
    p.events.filter((e) => typeof e === 'string'),
    ['expiry', 'recover-original', 'clear'],
  )
  assert.equal(p.expiresAt, '2031-01-01 00:00:00')
})

test('failed replacement never consumes the revision or clears a known restriction', async () => {
  const p = ports()
  p.restrictionRef.current = { accessCode: 'fixture', reason: 'traffic_limit' }
  p.updateManagedProfile = async () => {
    throw new Error('fixture invalid YAML/save failed')
  }
  p.updateState = async () => ({
    ok: true,
    update_version: 11,
    subscription_revision: 'new',
  })
  await assert.rejects(
    createCheck(p)(new AbortController().signal),
    /save failed/,
  )
  assert.equal(p.storage.get('version'), '10')
  assert.equal(JSON.parse(p.storage.get('revision')).revision, 'old')
  assert.equal(p.restrictionRef.current.reason, 'traffic_limit')
  assert.equal(p.updateInFlightRef.current, false)
})

test('transport/service failures are not converted to expiry or a new placeholder', async () => {
  const p = ports()
  p.running = true
  p.updateState = async () => {
    throw Object.assign(new Error('fixture 503'), { retryAfterMs: 20_000 })
  }
  await assert.rejects(createCheck(p)(new AbortController().signal), /503/)
  assert.equal(p.restrictionRef.current, null)
  assert.ok(!p.events.includes('stop') && !p.events.includes('placeholder'))
})

test('foreground cancellation after a late status response cannot write or switch the old subscription', async () => {
  const p = ports()
  const controller = new AbortController()
  p.updateState = async () => {
    controller.abort()
    return { ok: true, update_version: 11, subscription_revision: 'new' }
  }
  await assert.rejects(createCheck(p)(controller.signal))
  assert.deepEqual(p.events, [])
  assert.equal(p.storage.get('version'), '10')
})

test('manual detachment keeps configuration and its unapplied revision protected', async () => {
  const p = ports()
  p.updateState = async () => ({
    ok: true,
    update_version: 11,
    subscription_revision: 'new',
  })
  p.updateManagedProfile = async () => 'managed-detached'
  await createCheck(p)(new AbortController().signal)
  assert.equal(p.storage.get('version'), '10')
  assert.equal(JSON.parse(p.storage.get('revision')).revision, 'old')
})

test('restriction storage belongs to its code and rejects corrupt or unfamiliar states', () => {
  assert.equal(parseAccessRestriction('{bad', 'fixture'), null)
  assert.equal(
    parseAccessRestriction(
      JSON.stringify({ accessCode: 'other', reason: 'expired' }),
      'fixture',
    ),
    null,
  )
  assert.equal(
    parseAccessRestriction(
      JSON.stringify({ accessCode: 'fixture', reason: 'other' }),
      'fixture',
    ),
    null,
  )
  assert.equal(
    parseAccessRestriction(
      JSON.stringify({ accessCode: 'fixture', reason: 'traffic_limit' }),
      'fixture',
    ).reason,
    'traffic_limit',
  )
})

const fakeClock = () => {
  let now = 0
  let id = 0
  const timers = new Map()
  return {
    now: () => now,
    setTimer: (fn, delay) => {
      timers.set(++id, { fn, due: now + delay })
      return id
    },
    clearTimer: (key) => timers.delete(key),
    advance: async (delay) => {
      now += delay
      for (const [key, value] of [...timers]) {
        if (value.due <= now) {
          timers.delete(key)
          value.fn()
        }
      }
      await flush()
    },
    timers,
  }
}

test('monitor keeps checking while VPN is stopped and coalesces focus/online wakeups', async () => {
  const clock = fakeClock()
  let calls = 0
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const monitor = createSubscriptionMonitor({
    ...clock,
    random: () => 0.5,
    canRun: () => true,
    check: async () => {
      calls += 1
      await gate
    },
  })
  monitor.start()
  monitor.wake()
  monitor.wake()
  monitor.wake()
  assert.equal(calls, 1)
  release()
  await flush()
  await clock.advance(0)
  assert.equal(calls, 2)
  await clock.advance(30_000)
  assert.equal(calls, 3)
  monitor.stop()
  assert.equal(clock.timers.size, 0)
})

test('wakeup respects server Retry-After instead of bypassing a shared-IP limit', async () => {
  const clock = fakeClock()
  let calls = 0
  const monitor = createSubscriptionMonitor({
    ...clock,
    random: () => 0.5,
    canRun: () => true,
    check: async () => {
      calls += 1
      if (calls === 1)
        throw Object.assign(new Error('429'), { retryAfterMs: 90_000 })
    },
  })
  monitor.start()
  await flush()
  monitor.wake()
  await flush()
  assert.equal(calls, 1)
  await clock.advance(89_999)
  monitor.wake()
  await flush()
  assert.equal(calls, 1)
  await clock.advance(1)
  assert.equal(calls, 2)
  monitor.stop()
})

test('monitor waits for configuration transaction ownership and cancels its actual read controller on stop', async () => {
  const clock = fakeClock()
  let busy = true
  let signal
  const monitor = createSubscriptionMonitor({
    ...clock,
    canRun: () => !busy,
    check: async (value) => {
      signal = value
      await new Promise((resolve) =>
        value.addEventListener('abort', resolve, { once: true }),
      )
    },
  })
  monitor.start()
  assert.equal(signal, undefined)
  busy = false
  await clock.advance(1000)
  assert.equal(signal.aborted, false)
  monitor.stop()
  await flush()
  assert.equal(signal.aborted, true)
  assert.equal(clock.timers.size, 0)
})

test('an account switch during an apply cannot consume its predecessor revision', async () => {
  const p = ports()
  p.updateState = async () => ({
    ok: true,
    update_version: 11,
    subscription_revision: 'new',
  })
  p.updateManagedProfile = async () => {
    p.storage.set('code', 'replacement')
    return 'managed-updated'
  }
  await assert.rejects(
    createCheck(p)(new AbortController().signal),
    /身份已变化/,
  )
  assert.equal(p.storage.get('version'), '10')
  assert.equal(JSON.parse(p.storage.get('revision')).revision, 'old')
  assert.ok(!p.events.includes('clear'))
})
