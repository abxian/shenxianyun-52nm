import assert from 'node:assert/strict'
import test from 'node:test'

import yaml from 'js-yaml'

import { prepareSubscriptionContent } from '../src/utils/subscription-content.ts'

test('unchanged subscription formatting/order does not request a core write or reload', () => {
  assert.equal(
    prepareSubscriptionContent(
      'proxies: []\nrules: [MATCH,DIRECT]\nmode: rule\n',
      'mode: rule\nrules:\n  - MATCH\n  - DIRECT\nproxies: []\n',
    ),
    null,
  )
})

test('protected rules are present before the changed subscription is validated/applied', () => {
  const local = yaml.dump({
    proxies: [{ name: 'old', server: '192.0.2.1' }],
    rules: ['DOMAIN,local.invalid,DIRECT'],
    'rule-providers': { local: { type: 'file', path: './fake.yaml' } },
    'sub-rules': { local: ['MATCH,DIRECT'] },
  })
  const remote = yaml.dump({
    proxies: [{ name: 'new', server: '192.0.2.2' }],
    rules: ['MATCH,remote'],
  })
  const prepared = yaml.load(prepareSubscriptionContent(local, remote))
  assert.equal(prepared.proxies[0].name, 'new')
  const previous = yaml.load(local)
  for (const key of ['rules', 'rule-providers', 'sub-rules'])
    assert.deepEqual(prepared[key], previous[key])
})

test('an invalid download cannot replace the previous configuration', () => {
  const local = 'proxies: []\nrules: []\n'
  assert.throws(() => prepareSubscriptionContent(local, 'invalid: ['))
  assert.throws(() => prepareSubscriptionContent(local, 'not a mapping'))
  assert.equal(local, 'proxies: []\nrules: []\n')
})

test('without local protected rules a valid remote ruleset remains available', () => {
  assert.deepEqual(
    yaml.load(
      prepareSubscriptionContent(
        'proxies: []',
        'proxies: []\nrules: ["MATCH,DIRECT"]',
      ),
    ),
    { proxies: [], rules: ['MATCH,DIRECT'] },
  )
})

test('array order changes are real changes while equivalent mapping order is not', () => {
  const previous =
    'proxies: [{name: a, server: 192.0.2.1}, {name: b, server: 192.0.2.2}]'
  assert.notEqual(
    prepareSubscriptionContent(
      previous,
      'proxies: [{name: b, server: 192.0.2.2}, {name: a, server: 192.0.2.1}]',
    ),
    null,
  )
})
