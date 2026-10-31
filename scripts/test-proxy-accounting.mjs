import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import ts from 'typescript'

import {
  desktopProxyTrafficTotals,
  DESKTOP_MANAGED_TRAFFIC_STORAGE_KEY,
} from '../src/services/desktop-proxy-traffic.ts'
import {
  createManagedTrafficCounter,
  observeManagedTraffic,
  managedTrafficPayload,
} from '../src/services/managed-traffic-counter.ts'
const root = new URL('../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const home = read('src/pages/home.tsx')
const source = ts.createSourceFile(
  'home.tsx',
  home,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)
test('every desktop uses classified counters and never falls back to global totals', () => {
  assert.equal(
    DESKTOP_MANAGED_TRAFFIC_STORAGE_KEY,
    'shenxianyun.managedTraffic.proxy.v2',
  )
  assert.match(home, /if \(!proxyTrafficReadyRef\.current\) return/)
  assert.match(home, /desktopProxyTrafficTotals\(connectionResponse\.data\)/)
  assert.doesNotMatch(
    home,
    /sample\??\.uploadTotal|sample\??\.downloadTotal|shenxianyun\.managedTraffic\.v1/,
  )
  assert.equal(source.parseDiagnostics.length, 0)
  for (const platform of ['windows', 'macos', 'linux']) {
    const initial = desktopProxyTrafficTotals({
      proxyUploadTotal: 0,
      proxyDownloadTotal: 0,
    })
    const counter = createManagedTrafficCounter(
      platform,
      initial,
      'isolated-counter',
    )
    const sample = desktopProxyTrafficTotals({
      uploadTotal: 999999,
      downloadTotal: 999999,
      proxyUploadTotal: 12,
      proxyDownloadTotal: 65536,
    })
    const result = observeManagedTraffic(counter, sample).counter
    assert.deepEqual(managedTrafficPayload(result), {
      counter_id: 'isolated-counter',
      sequence: 1,
      upload_total: 12,
      download_total: 65536,
    })
  }
})
test('missing, unsafe, or negative classified fields never charge global totals', () => {
  for (const sample of [
    undefined,
    null,
    {},
    { uploadTotal: 123456 },
    { proxyUploadTotal: 0 },
    { proxyUploadTotal: -1, proxyDownloadTotal: 0 },
    { proxyUploadTotal: 1.2, proxyDownloadTotal: 0 },
    { proxyUploadTotal: 0, proxyDownloadTotal: Number.MAX_SAFE_INTEGER + 1 },
  ])
    assert.equal(desktopProxyTrafficTotals(sample), null)
  assert.deepEqual(
    desktopProxyTrafficTotals({ proxyUploadTotal: 0, proxyDownloadTotal: 0 }),
    { upload: 0, download: 0 },
  )
})
test('summary retains classified zero values without replacing with global totals', () => {
  const code = read('src/hooks/use-connection-data.ts')
  const start = code.indexOf('const mergeConnectionSummary =')
  const end = code.indexOf('const flushPendingMessage', start)
  const fn = code
    .slice(start, end)
    .replace('const mergeConnectionSummary =', 'const fn =')
  const js = ts.transpile(fn, { target: ts.ScriptTarget.ES2022 })
  const run = new Function(`${js};return fn`)()
  const summary = run({
    uploadTotal: 900,
    downloadTotal: 1000,
    proxyUploadTotal: 0,
    proxyDownloadTotal: 12,
    connections: [],
  })
  assert.equal(summary.proxyUploadTotal, 0)
  assert.equal(summary.proxyDownloadTotal, 12)
  assert.equal(
    run({ uploadTotal: 999, connections: [] }).proxyUploadTotal,
    undefined,
  )
})

test('desktop device identity matches the real platform without changing update routes', () => {
  const names = [
    'DESKTOP_PLATFORM',
    'CLIENT_PLATFORM_LABEL',
    'CLIENT_TYPE',
    'CLIENT_UA',
  ]
  const declarations = []
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      names.includes(node.name.getText(source))
    )
      declarations.push('const ' + node.getText(source))
    ts.forEachChild(node, visit)
  }
  visit(source)
  const code = ts.transpileModule(
    declarations.join(';') +
      '; return [CLIENT_PLATFORM_LABEL, CLIENT_TYPE, CLIENT_UA]',
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText
  for (const [platform, label, agent] of [
    ['windows', 'Windows电脑', 'Windows'],
    ['macos', 'Mac电脑', 'macOS'],
    ['linux', 'Linux电脑', 'Linux'],
  ]) {
    const result = new Function('getSystem', 'DESKTOP_VERSION', code)(
      () => platform,
      '2.5.52',
    )
    assert.deepEqual(result, [
      label,
      'shenxianyun-' + platform,
      'JC116-Shenxianyun-' + agent + '/2.5.52',
    ])
  }
  const prebuild = read('scripts/prebuild.mjs')
    .split('async function resolveSidecar')[1]
    .split('const sidecarPath')[0]
  assert.match(prebuild, /scripts\/build-proxy-core\.py/)
  assert.doesNotMatch(prebuild, /SIDECAR_HOST\.includes\('windows'\)/)
})
