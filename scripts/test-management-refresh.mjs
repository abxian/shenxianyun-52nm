import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import ts from 'typescript'

import { refreshSubscriptionOnRequest } from '../src/services/manual-subscription-refresh.ts'

const compile = (file) =>
  ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText
const dataUrl = (js) =>
  'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
const deadline = dataUrl(compile('../src/services/http-request-deadline.ts'))
const code = compile('../src/services/official-management-http.ts').replace(
  "'./http-request-deadline'",
  JSON.stringify(deadline),
)
const { fetchOfficialManagement, SYSTEM_PROXY_BYPASS } = await import(
  dataUrl(code)
)

test('valid managed click downloads current nodes even when status gateway is offline', async () => {
  const calls = []
  await refreshSubscriptionOnRequest({
    managed: true,
    readState: async () => {
      assert.fail('status cannot block a valid managed download')
    },
    download: async (state) => {
      calls.push(state)
      return 'latest'
    },
  })
  assert.deepEqual(calls, [undefined])
})
test('unmanaged recovery still enforces public account state before import', async () => {
  let downloaded = false
  const denial = new Error('revoked')
  await assert.rejects(
    refreshSubscriptionOnRequest({
      managed: false,
      readState: async () => {
        throw denial
      },
      download: async () => {
        downloaded = true
      },
    }),
    denial,
  )
  assert.equal(downloaded, false)
})
test('a managed subscription rejection remains a rejection, not a fake success', async () => {
  await assert.rejects(
    refreshSubscriptionOnRequest({
      managed: true,
      readState: async () => assert.fail('unexpected status probe'),
      download: async () => {
        throw new Error('device revoked')
      },
    }),
    /device revoked/,
  )
})
test('global dead-node ordinary proxy is never selected for management', async () => {
  const routes = []
  const response = await fetchOfficialManagement(
    'https://api.example.test/subscription',
    {},
    {
      directProxy: async () => 'http://127.0.0.1:12345',
      fetch: async (_url, init) => {
        routes.push(init.proxy)
        assert.equal(init.proxy.all, 'http://127.0.0.1:12345')
        assert.equal(init.maxRedirections, 0)
        return new Response('latest nodes')
      },
    },
  )
  assert.equal(await response.text(), 'latest nodes')
  assert.equal(routes.length, 1)
})
test('cold/restarting core falls through to explicit system-proxy bypass', async () => {
  const attempts = []
  const response = await fetchOfficialManagement(
    'https://api.example.test/subscription',
    {},
    {
      directProxy: async () => 'http://127.0.0.1:12345',
      fetch: async (_url, init) => {
        attempts.push(init.proxy)
        if (typeof init.proxy.all === 'string')
          throw new Error('core not ready')
        assert.deepEqual(init.proxy, SYSTEM_PROXY_BYPASS)
        return new Response('fresh via physical network')
      },
    },
  )
  assert.equal(await response.text(), 'fresh via physical network')
  assert.equal(attempts.length, 2)
})
test('auth and rate-limit denials never get retried through another route', async () => {
  for (const status of [401, 403, 410, 429]) {
    let count = 0
    const response = await fetchOfficialManagement(
      'https://api.example.test/verify',
      {},
      {
        directProxy: async () => 'http://127.0.0.1:12345',
        fetch: async () => {
          count++
          return new Response('denied', { status })
        },
      },
    )
    assert.equal(response.status, status)
    assert.equal(count, 1)
  }
})
test('parent cancellation aborts body ownership without trying a second route', async () => {
  const controller = new AbortController()
  let routes = 0
  const pending = fetchOfficialManagement(
    'https://api.example.test/subscription',
    { signal: controller.signal },
    {
      directProxy: async () => 'http://127.0.0.1:12345',
      fetch: async (_url, init) => {
        routes++
        controller.abort(new DOMException('cancelled', 'AbortError'))
        assert.equal(init.signal.aborted, true)
        throw controller.signal.reason
      },
    },
  )
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(routes, 1)
})
