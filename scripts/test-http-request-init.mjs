import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { cloneHttpRequestInit } from '../src/services/http-request-init.ts'

describe('Tauri HTTP request options', () => {
  it('isolates every attempt from plugin option mutation', () => {
    const original = {
      method: 'POST',
      connectTimeout: 5_000,
      headers: { 'Content-Type': 'application/json' },
      proxy: {
        all: {
          url: 'http://127.0.0.1:7890',
          basicAuth: { username: 'local', password: 'placeholder' },
        },
      },
      body: '{}',
    }
    const firstAttempt = cloneHttpRequestInit(original)
    const secondAttempt = cloneHttpRequestInit(original)

    delete firstAttempt.connectTimeout
    firstAttempt.headers['Content-Type'] = 'text/plain'
    firstAttempt.proxy.all.url = 'http://127.0.0.1:7891'

    assert.equal(original.connectTimeout, 5_000)
    assert.equal(original.headers['Content-Type'], 'application/json')
    assert.equal(original.proxy.all.url, 'http://127.0.0.1:7890')
    assert.equal(secondAttempt.connectTimeout, 5_000)
    assert.equal(secondAttempt.headers['Content-Type'], 'application/json')
    assert.equal(secondAttempt.proxy.all.url, 'http://127.0.0.1:7890')
  })
})
