import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import {
  fetchBufferedWithDeadline,
  withRequestDeadline,
} from '../src/services/http-request-deadline.ts'

test('a stuck native fetch cannot hold the caller indefinitely even if it ignores abort', async () => {
  let signal
  await assert.rejects(
    fetchBufferedWithDeadline(
      (_url, init) => {
        signal = init.signal
        return new Promise(() => {})
      },
      'https://fixture.invalid',
      undefined,
      20,
    ),
    { name: 'TimeoutError' },
  )
  assert.equal(signal.aborted, true)
})

test('deadline includes a real HTTP response body that sends headers but never finishes', async (t) => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.write('{"unfinished":')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.closeAllConnections()
    return new Promise((resolve) => server.close(resolve))
  })
  await assert.rejects(
    fetchBufferedWithDeadline(
      fetch,
      `http://127.0.0.1:${server.address().port}`,
      undefined,
      50,
    ),
    { name: 'TimeoutError' },
  )
})

test('foreground cancellation stops background request/body ownership', async () => {
  const parent = new AbortController()
  let child
  const pending = fetchBufferedWithDeadline(
    (_url, init) => {
      child = init.signal
      return new Promise(() => {})
    },
    'https://fixture.invalid',
    { signal: parent.signal },
    1000,
  )
  await delay(0)
  parent.abort(new DOMException('Start requested', 'AbortError'))
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(child.aborted, true)
})

test('a timed-out path does not poison the original signal or the fallback path', async () => {
  const parent = new AbortController()
  const init = {
    signal: parent.signal,
    headers: { Authorization: 'fake-only' },
  }
  let firstSignal
  await assert.rejects(
    fetchBufferedWithDeadline(
      (_url, options) => {
        firstSignal = options.signal
        return new Promise(() => {})
      },
      'https://fixture.invalid',
      init,
      15,
    ),
    { name: 'TimeoutError' },
  )
  assert.equal(parent.signal.aborted, false)
  const response = await fetchBufferedWithDeadline(
    async (_url, options) => {
      assert.notEqual(options.signal, firstSignal)
      assert.equal(options.signal.aborted, false)
      assert.equal(options.headers.Authorization, 'fake-only')
      return new Response('fallback')
    },
    'https://fixture.invalid',
    init,
    100,
  )
  assert.equal(await response.text(), 'fallback')
})

test('buffers response bytes and preserves headers, URL and cloned metadata', async () => {
  const parent = new AbortController()
  const init = {
    signal: parent.signal,
    connectTimeout: 8000,
    proxy: { all: 'http://127.0.0.1:9' },
    headers: { 'X-Test': 'fake-only' },
  }
  const source = new Response('{"ok":true}', {
    status: 200,
    headers: { 'Content-Type': 'application/json', ETag: 'test' },
  })
  Object.defineProperty(source, 'url', {
    value: 'https://fixture.invalid/final',
  })
  const response = await fetchBufferedWithDeadline(
    async (_url, options) => {
      assert.equal(options.proxy.all, init.proxy.all)
      assert.equal(options.connectTimeout, 8000)
      return source
    },
    'https://fixture.invalid',
    init,
    100,
  )
  assert.equal(response.headers.get('etag'), 'test')
  assert.equal(response.url, source.url)
  assert.equal(response.clone().url, source.url)
  assert.deepEqual(await response.json(), { ok: true })
  assert.equal(init.signal, parent.signal)
  await delay(110)
  assert.equal(parent.signal.aborted, false)
})

test('parent cancellation before dispatch does not start transport work', async () => {
  const parent = new AbortController()
  parent.abort()
  let called = false
  await assert.rejects(
    fetchBufferedWithDeadline(
      async () => {
        called = true
        return new Response('wrong')
      },
      'https://fixture.invalid',
      { signal: parent.signal },
    ),
    { name: 'AbortError' },
  )
  assert.equal(called, false)
})

test('logical budget bounds multiple transport paths and clears its timer after success', async () => {
  let child
  await assert.rejects(
    withRequestDeadline(async (signal) => {
      child = signal
      await delay(10)
      return fetchBufferedWithDeadline(
        () => new Promise(() => {}),
        'https://fixture.invalid',
        { signal },
        1000,
      )
    }, 30),
    { name: 'TimeoutError' },
  )
  assert.equal(child.aborted, true)
  let completedSignal
  assert.equal(
    await withRequestDeadline(async (signal) => {
      completedSignal = signal
      return 'done'
    }, 15),
    'done',
  )
  await delay(30)
  assert.equal(completedSignal.aborted, false)
})

test('body-less responses remain body-less', async () => {
  const response = await fetchBufferedWithDeadline(
    async () => new Response(null, { status: 204 }),
    'https://fixture.invalid',
    undefined,
  )
  assert.equal(response.status, 204)
  assert.equal(response.body, null)
})
