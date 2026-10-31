import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import ts from 'typescript'

import { loadManagedContent } from '../src/services/managed-download-recovery.ts'
import { summarizeNotice } from '../src/services/notice-summary.ts'

const auth = () => ({
  accessCode: 'same-code',
  profileUid: 'profile',
  deviceToken: 'old',
  subscriptionUrl: 'old-url',
  apiBase: 'api',
  expiresAt: '',
  limitMode: '',
  contentHash: 'old-hash',
  detached: false,
  updateVersion: 1,
})
const denied = Object.assign(new Error('credential expired'), { status: 403 })

test('explicit update renews a stale URL once and persists before downloading the new target', async () => {
  let current = auth()
  const original = current
  const events = []
  const result = await loadManagedContent(original, true, {
    current: () => current,
    status: (error) => error.status,
    download: async (value) => {
      events.push(value.subscriptionUrl)
      if (value === original) throw denied
      return 'new-file-content'
    },
    renew: async (value) => ({
      ...value,
      deviceToken: 'fresh',
      subscriptionUrl: 'new-target',
    }),
    persist: async (value) => {
      events.push('persist')
      current = value
    },
  })
  assert.deepEqual(events, ['old-url', 'persist', 'new-target'])
  assert.equal(result.content, 'new-file-content')
  assert.equal(result.auth.profileUid, original.profileUid)
  assert.equal(current.deviceToken, 'fresh')
})

test('background failures and ordinary network failures never re-register devices', async () => {
  for (const [userRequested, error] of [
    [false, denied],
    [true, new Error('network')],
  ]) {
    const current = auth()
    await assert.rejects(
      loadManagedContent(current, userRequested, {
        current: () => current,
        status: (value) => value.status,
        download: async () => {
          throw error
        },
        renew: async () => {
          assert.fail('must not renew')
        },
        persist: async () => {
          assert.fail('must not write')
        },
      }),
      error,
    )
  }
})

test('an account switch during renewal cannot overwrite the new account', async () => {
  let current = auth()
  const original = current
  await assert.rejects(
    loadManagedContent(original, true, {
      current: () => current,
      status: (value) => value.status,
      download: async () => {
        throw denied
      },
      renew: async (value) => {
        current = { ...auth(), accessCode: 'other' }
        return { ...value, deviceToken: 'fresh' }
      },
      persist: async () => {
        assert.fail('must not overwrite another account')
      },
    }),
    /提取码已变化/,
  )
  assert.equal(current.accessCode, 'other')
})

test('a fresh credential survives a new-target failure without consuming its revision', async () => {
  let current = auth()
  const original = current
  await assert.rejects(
    loadManagedContent(original, true, {
      current: () => current,
      status: (value) => value.status,
      download: async (value) => {
        if (value === original) throw denied
        throw new Error('invalid new config')
      },
      renew: async (value) => ({ ...value, deviceToken: 'fresh' }),
      persist: async (value) => {
        current = value
      },
    }),
    /invalid new config/,
  )
  assert.equal(current.deviceToken, 'fresh')
  assert.equal(current.updateVersion, 1)
  assert.equal(current.contentHash, 'old-hash')
})

test('long validation logs have a short usable summary and keep the actual parameter problem', () => {
  const message =
    '订阅配置校验失败 ' +
    'time=... '.repeat(100) +
    'proxy 5: invalid REALITY short ID'
  const summary = summarizeNotice(message)
  assert.ok(summary.length < 180)
  assert.match(summary, /REALITY short ID 无效/)
  assert.match(summary, /原配置已保留/)
  assert.equal(summarizeNotice('短错误'), '短错误')
})

function arrow(source, name, ports) {
  const tree = ts.createSourceFile(
    'home.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  let code
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) {
      code = ts.isCallExpression(node.initializer)
        ? node.initializer.arguments[0].getText(tree)
        : node.initializer.getText(tree)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.ok(code, name)
  const js = ts.transpileModule('const callback=' + code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  return new Function('ports', `with(ports){${js};return callback}`)(ports)
}

test('actual Windows Home update remains in-app and settles cancellation without relaunch', async () => {
  const source = await readFile(
    new URL('../src/pages/home.tsx', import.meta.url),
    'utf8',
  )
  const states = []
  let rejectDownload
  let relaunched = false
  const ports = {
    updateInfo: { available: true, version: '2.5.51' },
    updating: false,
    isMacOS: false,
    busy: false,
    manualBusy: false,
    refreshApplyInFlightRef: { current: false },
    autoRefreshControllerRef: { current: null },
    backgroundBusyRef: { current: false },
    setBusy: (value) => states.push(['busy', value]),
    setUpdating: (value) => states.push(['updating', value]),
    setUpdateInstalling: () => {},
    setUpdPercent: () => {},
    setStatus: (value) => states.push(['status', value]),
    downloadAndInstallWithFallback: async (_update, onProgress) => {
      onProgress({ phase: 'progress', chunkLength: 1024, contentLength: 2048 })
      return new Promise((_resolve, reject) => {
        rejectDownload = reject
      })
    },
    cancelAppUpdateDownload: async () => {
      rejectDownload(new Error('已取消更新下载'))
      return 'cancelled'
    },
    relaunch: async () => {
      relaunched = true
    },
    refreshAll: async () => {},
    openWebUrl: () => assert.fail('Windows update must not launch a browser'),
  }
  const pending = arrow(source, 'doUpdate', ports)()
  await arrow(source, 'cancelUpdateDownload', ports)()
  await pending
  assert.ok(
    states.some(
      ([name, value]) => name === 'status' && value === '正在取消更新下载...',
    ),
  )
  assert.equal(relaunched, false)
  assert.ok(
    states.some(([name, value]) => name === 'updating' && value === false),
  )
  assert.ok(states.some(([name, value]) => name === 'busy' && value === false))
  assert.ok(
    states.some(([name, value]) => name === 'status' && value.includes('取消')),
  )
})

test('technical error notices never enqueue a popup or timer', async () => {
  const source = await readFile(
    new URL('../src/services/notice-service.ts', import.meta.url),
    'utf8',
  )
  const callback = arrow(source, 'baseShowNotice', {
    nextId: 0,
    parseNoticeExtras: () =>
      assert.fail('error notices must not create UI data'),
    setTimeout: () => assert.fail('hidden errors must not create timers'),
    notifySubscribers: () =>
      assert.fail('hidden errors must not notify the UI'),
  })
  assert.equal(callback('error', 'invalid REALITY short ID'), 0)
  assert.equal(callback('error', new Error('core could not stop')), 1)
})

test('actual startup refresh fetches same-revision nodes and only consumes success', async () => {
  const source = await readFile(
    new URL('../src/pages/home.tsx', import.meta.url),
    'utf8',
  )
  for (const fail of [false, true]) {
    const status = []
    const updates = []
    const ports = {
      currentCode: 'same-code',
      current: { uid: 'profile' },
      updateInFlightRef: { current: false },
      managedAuthRef: { current: { deviceToken: 'token' } },
      activeCodeRef: { current: 'same-code' },
      startupRefreshCompletedRef: { current: false },
      restrictionRef: { current: null },
      autoRefreshControllerRef: { current: null },
      refreshApplyInFlightRef: { current: false },
      localStorage: { getItem: () => 'same-code', setItem: () => {} },
      sessionStorage: { setItem: () => {} },
      CODE_STORAGE_KEY: 'code',
      CODE_UPDATE_VERSION_STORAGE_KEY: 'version',
      CODE_REVISION_STORAGE_KEY: 'revision',
      STARTUP_REFRESH_SESSION_KEY: 'session',
      expiresAt: '',
      onExpiredProfile: () => false,
      setStatus: (value) => status.push(value),
      setBusy: () => {},
      updateState: async () => ({
        update_version: 1,
        subscription_revision: 'unchanged',
      }),
      assertRequestActive: () => {},
      needsSubscriptionRefresh: ({ startup }) => startup,
      updateManagedProfile: async (_version, options) => {
        updates.push(options)
        if (fail) throw new Error('invalid YAML')
        return 'managed-updated'
      },
      mutateProfiles: async () => {},
      refreshAll: async () => {},
      clearAccessRestriction: () => {},
      setExpiredDialogOpen: () => {},
      AccessCodeStateError: class extends Error {},
      rotateApiBase: async () => {},
      proxyUrlRef: { current: '' },
    }
    await arrow(
      source,
      'checkSubscriptionRecovery',
      ports,
    )(new AbortController().signal).catch(() => {})
    assert.equal(updates.length, 1)
    assert.equal(updates[0].force, true)
    assert.equal(updates[0].suppressValidationNotice, true)
    assert.equal(ports.startupRefreshCompletedRef.current, !fail)
    assert.ok(status[0].includes('正在更新订阅'))
    assert.ok(status.at(-1).includes(fail ? '已保留原节点' : '最新'))
    assert.equal(ports.updateInFlightRef.current, false)
  }
})
