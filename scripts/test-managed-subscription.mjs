import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { managedProfileName } from '../src/services/managed-subscription.ts'
import {
  replaceVisibleBrand,
  VISIBLE_APP_NAME,
} from '../src/services/visible-brand.ts'

describe('managed subscription presentation', () => {
  it('never uses an extraction code as the managed profile name', () => {
    const extractionCode = 'never-show-this-code'
    const name = managedProfileName('神仙云')

    assert.equal(name, '神仙云 官方订阅')
    assert.equal(name.includes(extractionCode), false)
  })

  it('normalizes an empty or oversized runtime brand', () => {
    assert.equal(managedProfileName('  '), '官方客户端 官方订阅')
    assert.equal(managedProfileName(` ${'a'.repeat(100)} `).length, 85)
  })

  it('replaces inherited brands in every translated user-facing string', () => {
    for (const legacy of [
      'Clash Verge Rev',
      'Clash-Verge',
      'Clash Verge',
      'Verge',
    ]) {
      const rendered = replaceVisibleBrand(`${legacy} 版本`)
      assert.equal(rendered, `${VISIBLE_APP_NAME} 版本`)
      assert.equal(rendered.includes('Verge'), false)
    }
  })
})
