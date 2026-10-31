import assert from 'node:assert/strict'
import { it } from 'node:test'

import yaml from 'js-yaml'

import {
  DOMESTIC_API_DIRECT_RULE as api,
  pinApiDirect,
  upsertTrafficRule,
  removeTrafficRule,
  saveRuleEdit,
} from '../src/services/traffic-rule-editor.ts'

it('persists edits below API, replaces a target and removes both legacy locations', () => {
  const original = {
    dns: { enable: true },
    'prepend-rules': ['DOMAIN,example.com,DIRECT', api],
    'append-rules': ['DOMAIN,example.com,Old', 'DOMAIN,other.example,DIRECT'],
  }
  const edited = yaml.load(
    yaml.dump(upsertTrafficRule(original, 'DOMAIN,example.com,Test')),
  )
  assert.deepEqual(edited['prepend-rules'], [api, 'DOMAIN,example.com,Test'])
  assert.deepEqual(edited['append-rules'], ['DOMAIN,other.example,DIRECT'])
  assert.deepEqual(edited.dns, original.dns)
  const deleted = removeTrafficRule(edited, 'DOMAIN,example.com,Test')
  assert.deepEqual(deleted['prepend-rules'], [api])
  assert.deepEqual(original['prepend-rules'], [
    'DOMAIN,example.com,DIRECT',
    api,
  ])
  assert.deepEqual(pinApiDirect(deleted), deleted)
})

it('rejects API override and reports failed validation rather than success', async () => {
  assert.throws(
    () => upsertTrafficRule({}, 'DOMAIN,api.52nm.de,Test'),
    /始终使用直连/,
  )
  let calls = 0
  await assert.rejects(
    saveRuleEdit(async () => {
      calls++
      return false
    }),
    /保存或应用失败/,
  )
  assert.equal(calls, 1)
  await saveRuleEdit(async () => true)
  await assert.rejects(
    saveRuleEdit(async () => {
      throw new Error('offline')
    }),
    /offline/,
  )
})
