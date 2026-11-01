import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import ts from 'typescript'
const path = new URL('../src/services/managed-relay.ts', import.meta.url)
const raw = readFileSync(path, 'utf8')
const js = ts.transpileModule(raw, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText
const tenant = raw.match(/RELAY_TENANT = '(\w+)'/)[1]
let saved
const grant = {
  base: 'https://ll.sxnn.de',
  tenant,
  grant: 'synthetic.signature',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
}
globalThis.relayTestStorage = {
  loadManagedAuth: async () => saved,
  saveManagedAuth: async (v) => {
    saved = v
  },
}
const source = js.replace(
  /import\s*\{[^}]+\}\s*from\s*['"]\.\/managed-subscription['"];?/,
  'const { loadManagedAuth, saveManagedAuth } = globalThis.relayTestStorage;',
)
const mod = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
)
const auth = {
  accessCode: 'synthetic',
  apiBase: 'https://api.example.test',
  deviceToken: 'synthetic-device',
  subscriptionUrl: 'https://api.example.test/managed-sub/opaque',
  relay: grant,
}
saved = auth
const payload = JSON.stringify({
  counter_id: 'counter',
  sequence: 1,
  upload_total: 10,
  download_total: 20,
  observed_at: 123,
  platform: 'windows',
})
const reply = (status, body) => new Response(JSON.stringify(body), { status })
test('202 queue acceptance never becomes final client acknowledgement', async () => {
  const calls = []
  const r = await mod.sendTrafficWithRelay(
    auth,
    payload,
    {},
    async (url, init) => {
      calls.push([url, init])
      if (url.includes('/api/v2/')) throw new Error('offline')
      return reply(202, { state: 'queued', committed: false })
    },
  )
  assert.equal(r.status, 503)
  assert.equal((await r.json()).ok, false)
  assert.equal(calls[1][0], `https://ll.sxnn.de/v1/traffic/${tenant}`)
  assert.equal(JSON.parse(calls[1][1].body).observed_at, 123)
  assert.equal(JSON.parse(calls[1][1].body).platform, undefined)
  assert.equal(calls[1][1].headers.Authorization, 'Bearer synthetic.signature')
})
test('only applied committed final receipt is acknowledged', async () => {
  const r = await mod.sendTrafficWithRelay(auth, payload, {}, async (url) => {
    if (url.includes('/api/v2/')) throw new Error('offline')
    return reply(200, { state: 'applied', committed: true })
  })
  assert.equal(r.status, 200)
  assert.equal((await r.json()).ok, true)
})
test('authentication denial and caller cancellation never trigger relay retry', async () => {
  let count = 0
  const r = await mod.sendTrafficWithRelay(auth, payload, {}, async () => {
    count++
    return reply(401, { ok: false })
  })
  assert.equal(r.status, 401)
  assert.equal(count, 1)
  const controller = new AbortController()
  controller.abort()
  count = 0
  await assert.rejects(() =>
    mod.sendTrafficWithRelay(
      auth,
      payload,
      { signal: controller.signal },
      async () => {
        count++
        throw new Error('cancelled')
      },
    ),
  )
  assert.equal(count, 1)
})
test('subscription fallback is fixed authenticated live endpoint with no URL input', async () => {
  const calls = []
  const r = await mod.fetchSubscriptionWithRelay(
    auth,
    {},
    async (url, init) => {
      calls.push([url, init])
      if (url === auth.subscriptionUrl) throw new Error('offline')
      return reply(200, { ok: true, content: 'proxies: [latest]' })
    },
  )
  assert.equal(await r.text(), 'proxies: [latest]')
  assert.equal(
    calls[1][0],
    `https://ll.sxnn.de/v1/client/${tenant}/subscription`,
  )
  assert.equal(calls[1][1].body, '{}')
  assert.equal(r.headers.get('cache-control'), 'no-store')
})
test('subscription revoked credentials do not use fallback', async () => {
  let count = 0
  const r = await mod.fetchSubscriptionWithRelay(auth, {}, async () => {
    count++
    return reply(403, { ok: false })
  })
  assert.equal(r.status, 403)
  assert.equal(count, 1)
})
