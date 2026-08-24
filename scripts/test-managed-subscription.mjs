import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { managedProfileName } from '../src/services/managed-subscription.ts'

describe('managed subscription presentation', () => {
  it('never uses an extraction code as the managed profile name', () => {
    const extractionCode = 'never-show-this-code'
    const name = managedProfileName('吾爱云')

    assert.equal(name, '吾爱云 官方订阅')
    assert.equal(name.includes(extractionCode), false)
  })

  it('normalizes an empty or oversized runtime brand', () => {
    assert.equal(managedProfileName('  '), '官方客户端 官方订阅')
    assert.equal(managedProfileName(` ${'a'.repeat(100)} `).length, 85)
  })
})
