import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import yaml from 'js-yaml'
import ts from 'typescript'

import {
  accountExpiryLabel,
  homeWorkspaceVisible,
  isLocalSettingsCommand,
} from '../src/utils/local-workspace.ts'
const text = readFileSync(
  new URL('../src/pages/home.tsx', import.meta.url),
  'utf8',
)
const ast = ts.createSourceFile(
  'home.tsx',
  text,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)
const callbacks = new Map()
function visit(n) {
  if (
    ts.isVariableDeclaration(n) &&
    [
      'importByCode',
      'manualImportFile',
      'stopForServerLimit',
      'togglePower',
    ].includes(n.name.getText(ast))
  )
    callbacks.set(n.name.getText(ast), n.initializer.arguments[0].getText(ast))
  ts.forEachChild(n, visit)
}
visit(ast)
function actual(name, ports) {
  const js = ts.transpileModule('const callback = ' + callbacks.get(name), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText
  return new Function('ports', 'with(ports){' + js + ';return callback}')(ports)
}
function commandPorts() {
  const events = []
  const p = {
    events,
    code: ' setting ',
    busy: false,
    manualBusy: false,
    isLocalSettingsCommand,
    refreshApplyInFlightRef: { current: false },
    setLocalWorkspace: (v) => events.push(['workspace', v]),
    setAdvancedOpen: (v) => events.push(['advanced', v]),
    setCodeDialogOpen: (v) => events.push(['dialog', v]),
    setCode: (v) => events.push(['input', v]),
    setCodeImportPhase: (v) => events.push(['phase', v]),
    setCodeImportMessage: (v) => events.push(['message', v]),
    setStatus: (v) => events.push(['status', v]),
    // All actual network/credential/core functions are traps. No saved-code setters are provided.
    activateCode: () =>
      assert.fail('local command must not request an access ticket'),
    startImportedProfile: () =>
      assert.fail('local command must not start core'),
    autoRefreshControllerRef: {
      current: {
        abort: () => assert.fail('must not cancel unrelated background IO'),
      },
    },
  }
  return p
}
test('setting opens offline workspace before any import, network or VPN and clears only input', async () => {
  const p = commandPorts()
  await actual('importByCode', p)(true)
  assert.ok(p.events.some((e) => e[0] === 'workspace' && e[1]))
  assert.ok(p.events.some((e) => e[0] === 'advanced' && e[1]))
  assert.ok(p.events.some((e) => e[0] === 'input' && e[1] === ''))
})
test('setting waits during an owned configuration write', async () => {
  const p = commandPorts()
  p.refreshApplyInFlightRef.current = true
  await actual('importByCode', p)()
  assert.ok(!p.events.some((e) => e[0] === 'workspace'))
  assert.match(p.events[0][1], /请稍后/)
})
test('reserved command is exact, ordinary codes and URLs stay ordinary', () => {
  assert.ok(isLocalSettingsCommand('SETTING'))
  assert.ok(!isLocalSettingsCommand('setting123'))
  assert.ok(!isLocalSettingsCommand('https://setting'))
  assert.ok(homeWorkspaceVisible(true, false, false))
  assert.ok(!homeWorkspaceVisible(false, false, false))
  assert.ok(homeWorkspaceVisible(false, true, true))
  assert.equal(
    accountExpiryLabel('2030-02-03 12:00:00'),
    '到期时间：2030-02-03 12:00:00',
  )
  assert.equal(accountExpiryLabel(''), '到期时间：待同步')
})
function filePorts() {
  const events = [],
    p = {
      events,
      running: false,
      busy: false,
      manualBusy: false,
      refreshApplyInFlightRef: { current: false },
      backgroundBusyRef: { current: false },
      activeCodeRef: { current: 'old-account' },
      autoRefreshControllerRef: {
        current: { abort: () => events.push('abort-read') },
      },
      yaml,
      setStatus: (s) => events.push(s),
      setManualBusy: () => {},
      getProfiles: async () => ({
        items: events.includes('create')
          ? [{ uid: 'old' }, { uid: 'new' }]
          : [{ uid: 'old' }],
      }),
      createProfile: async () => {
        events.push('create')
      },
      patchProfilesConfig: async () => {
        assert.equal(p.activeCodeRef.current, '')
        events.push('select')
        return true
      },
      mutateProfiles: async () => {},
      refreshAll: async () => {},
      deleteProfile: async (uid) => events.push('delete:' + uid),
    }
  return p
}
test('local YAML imports and selects a profile without any authorization or automatic start', async () => {
  const p = filePorts()
  await actual('manualImportFile', p)(
    { name: 'fixture.yaml', size: 64 },
    'proxies: []\nrules: []',
  )
  assert.ok(p.events.includes('select'))
  assert.equal(p.activeCodeRef.current, '')
  assert.equal(p.backgroundBusyRef.current, false)
})
test('invalid file fails before creation, preserving active account', async () => {
  const p = filePorts()
  await actual('manualImportFile', p)(
    { name: 'fixture.yaml', size: 64 },
    '- not\n- configuration',
  )
  assert.ok(!p.events.includes('create'))
  assert.equal(p.activeCodeRef.current, 'old-account')
})
test('failed native config validation removes only the new file and preserves old account', async () => {
  const p = filePorts()
  p.patchProfilesConfig = async () => false
  await actual('manualImportFile', p)(
    { name: 'fixture.yaml', size: 64 },
    'proxies: []',
  )
  assert.ok(p.events.includes('delete:new'))
  assert.equal(p.activeCodeRef.current, 'old-account')
})
test('live VPN must stop before changing config, keeping telemetry attribution intact', async () => {
  const p = filePorts()
  p.running = true
  await actual('manualImportFile', p)(
    { name: 'fixture.yaml', size: 64 },
    'proxies: []',
  )
  assert.ok(!p.events.includes('create'))
  assert.equal(p.activeCodeRef.current, 'old-account')
})
test('late account restriction cannot stop a selected manual configuration', async () => {
  const p = { currentCode: 'old-account', activeCodeRef: { current: '' } }
  await actual('stopForServerLimit', p)('old-account quota exhausted') // any native call is deliberately missing and would fail
})

test('manual profile starts without checking an expired saved account', async () => {
  const events = []
  const p = {
    manualBusy: false,
    refreshApplyInFlightRef: { current: false },
    autoRefreshControllerRef: { current: null },
    running: false,
    current: { uid: 'manual-file' },
    currentCode: '',
    setBusy: () => {},
    setStatus: () => {},
    proxyStateMismatch: false,
    tunOn: false,
    systemProxyOn: false,
    systemProxyConfigOn: false,
    isTunModeAvailable: false,
    startCore: async () => {
      events.push('core')
    },
    restartCore: async () => {},
    waitForCoreReady: async () => true,
    mutateSystemState: async () => {},
    localStorage: { getItem: () => null },
    patchVerge: async () => {},
    toggleSystemProxy: async (value) => {
      events.push(['proxy', value])
    },
    invalidateProxyState: async () => {},
    refreshAll: async () => {},
    sendClientPresence: async () => {},
    updateState: () =>
      assert.fail('manual profile cannot check the unrelated saved account'),
  }
  await actual('togglePower', p)()
  assert.deepEqual(events, ['core', ['proxy', true]])
})

test('stopped local workspace keeps settings and editor open while normal mode closes them', () => {
  let effect
  const find = (n) => {
    if (
      ts.isCallExpression(n) &&
      n.expression.getText(ast) === 'useEffect' &&
      n.arguments[0]
        ?.getText(ast)
        .includes('previousRunningRef.current && !running')
    )
      effect = n.arguments[0].getText(ast)
    ts.forEachChild(n, find)
  }
  find(ast)
  assert.ok(effect)
  const js = ts.transpileModule('const effect = ' + effect, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText
  const create = new Function('ports', 'with(ports){' + js + ';return effect}')
  for (const localWorkspace of [true, false]) {
    const closed = []
    const p = {
      busy: false,
      running: false,
      localWorkspace,
      previousRunningRef: { current: false },
      savedCode: 'fixture',
      current: { uid: 'fixture-profile' },
      setAdvancedOpen: () => closed.push('advanced'),
      setTrafficRuleOpen: () => closed.push('rules'),
      setProfileManagerOpen: () => closed.push('profiles'),
      setSelfCheckOpen: () => closed.push('diagnostics'),
      setEditorState: () => closed.push('editor'),
    }
    create(p)()
    assert.equal(closed.length, localWorkspace ? 0 : 5)
  }
})
