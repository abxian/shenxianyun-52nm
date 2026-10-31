import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import ts from 'typescript'

const source = await readFile(
  new URL('../src/pages/home.tsx', import.meta.url),
  'utf8',
)
const tree = ts.createSourceFile(
  'home.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)
function actual(name, ports) {
  let arrow
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name)
      arrow = node.initializer.arguments[0].getText(tree)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.ok(arrow)
  const js = ts.transpileModule(`const callback = ${arrow}`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText
  return new Function('ports', `with(ports){${js};return callback}`)(ports)
}
function setup(overrides = {}) {
  const events = [],
    state = { dialog: false, busy: false, status: '' }
  const p = {
    busy: false,
    manualBusy: false,
    running: true,
    systemProxyConfigOn: false,
    backgroundBusyRef: { current: false },
    refreshApplyInFlightRef: { current: false },
    codeEntryActiveRef: { current: false },
    proxyUrlRef: { current: 'http://127.0.0.1:7897' },
    previousRunningRef: { current: true },
    autoRefreshControllerRef: {
      current: { abort: () => events.push('abort-old-read') },
    },
    setBusy: (value) => {
      state.busy = value
    },
    setStatus: (value) => {
      state.status = value
    },
    patchVergeConfig: async (patch) => {
      events.push(['disable', patch])
    },
    mutateVerge: (update) => {
      assert.deepEqual(
        update({ enable_system_proxy: true, enable_tun_mode: true }),
        { enable_system_proxy: false, enable_tun_mode: false },
      )
    },
    stopCore: async () => {
      events.push('stop')
    },
    setConnectionReady: (value) => assert.equal(value, false),
    invalidateProxyState: async () => {},
    refreshAll: async () => {},
    sendClientPresence: async (value) => assert.equal(value, false),
    setExpiredDialogOpen: (value) => assert.equal(value, false),
    setCode: (value) => assert.equal(value, ''),
    setCodeImportPhase: (value) => assert.equal(value, 'input'),
    setCodeImportMessage: (value) => assert.equal(value, ''),
    setCodeDialogOpen: (value) => {
      state.dialog = value
      events.push('open')
    },
    ...overrides,
  }
  return { p, events, state, run: actual('openCodeImport', p) }
}
test('live connection releases system proxy and TUN before stopping and opening code input', async () => {
  const t = setup()
  await t.run()
  assert.deepEqual(t.events, [
    'abort-old-read',
    ['disable', { enable_system_proxy: false, enable_tun_mode: false }],
    'stop',
    'open',
  ])
  assert.equal(t.p.proxyUrlRef.current, '')
  assert.equal(t.p.previousRunningRef.current, false)
  assert.equal(t.p.codeEntryActiveRef.current, true)
  assert.equal(t.p.backgroundBusyRef.current, false)
  assert.equal(t.state.busy, false)
})
test('dialog cannot open while native stop is pending', async () => {
  let finish
  const t = setup({
    stopCore: () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  })
  const operation = t.run()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(t.state.busy, true)
  assert.equal(t.state.dialog, false)
  assert.equal(t.p.codeEntryActiveRef.current, true)
  finish()
  await operation
  assert.equal(t.state.dialog, true)
})
test('proxy or core stop failure gives a retryable error without starting validation or reconnecting', async () => {
  for (const name of ['patchVergeConfig', 'stopCore']) {
    const t = setup({
      [name]: async () => {
        throw Error('native failure')
      },
    })
    await t.run()
    assert.equal(t.state.dialog, false)
    assert.match(t.state.status, /未能停止/)
    assert.equal(t.state.busy, false)
    assert.equal(t.p.backgroundBusyRef.current, false)
    assert.equal(t.p.codeEntryActiveRef.current, false)
  }
})
test('already stopped code entry does not touch native connectivity', async () => {
  const t = setup({ running: false })
  await t.run()
  assert.deepEqual(t.events, ['abort-old-read', 'open'])
})
test('an in-flight config save retains ownership and cannot be interrupted by code entry', async () => {
  for (const key of [
    'busy',
    'manualBusy',
    'backgroundBusyRef',
    'refreshApplyInFlightRef',
  ]) {
    const t = setup({ [key]: key.endsWith('Ref') ? { current: true } : true })
    await t.run()
    assert.deepEqual(t.events, [])
    assert.equal(t.state.dialog, false)
    assert.match(t.state.status, /配置操作/)
  }
})
test('import boundary refuses a connection restarted externally while dialog was open', async () => {
  for (const [running, systemProxyConfigOn] of [
    [true, false],
    [false, true],
  ]) {
    const messages = []
    await actual('importByCode', {
      isLocalSettingsCommand: () => false,
      code: 'example',
      running,
      systemProxyConfigOn,
      setCodeImportPhase: (p) => assert.equal(p, 'input'),
      setCodeImportMessage: (m) => messages.push(m),
    })()
    assert.deepEqual(messages, ['请先停止代理，再切换提取码'])
  }
})
test('all three user switch controls invoke the same guarded entry', () => {
  const matches = []
  function visit(node) {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(tree) === 'onClick' &&
      node.initializer?.getText(tree).includes('openCodeImport()')
    )
      matches.push(node)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.equal(matches.length, 3)
})
