import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  acknowledgeManagedTraffic,
  createManagedTrafficCounter,
  managedTrafficPayload,
  observeManagedTraffic,
  parseManagedTrafficCounter,
} from '../src/services/managed-traffic-counter.ts'

describe('managed traffic counter', () => {
  it('reports cumulative totals and advances only after acknowledgement', () => {
    let counter = createManagedTrafficCounter(
      'code',
      { upload: 100, download: 200 },
      'boot-1',
    )
    counter = observeManagedTraffic(counter, {
      upload: 140,
      download: 260,
    }).counter
    assert.deepEqual(managedTrafficPayload(counter), {
      counter_id: 'boot-1',
      sequence: 1,
      upload_total: 40,
      download_total: 60,
    })
    assert.equal(managedTrafficPayload(counter).sequence, 1)
    counter = acknowledgeManagedTraffic(counter, 1)
    assert.equal(managedTrafficPayload(counter).sequence, 2)
  })

  it('round-trips a persisted counter and rejects another access code', () => {
    const counter = createManagedTrafficCounter(
      'code',
      { upload: 1, download: 2 },
      'boot-2',
    )
    assert.deepEqual(
      parseManagedTrafficCounter(JSON.stringify(counter), 'code'),
      counter,
    )
    assert.equal(
      parseManagedTrafficCounter(JSON.stringify(counter), 'other'),
      null,
    )
  })

  it('detects a core counter reset', () => {
    const counter = createManagedTrafficCounter(
      'code',
      { upload: 100, download: 200 },
      'boot-3',
    )
    assert.equal(
      observeManagedTraffic(counter, { upload: 10, download: 20 }).reset,
      true,
    )
  })
})

it('persists a frozen relay packet through newer samples and restart', () => {
  let counter = createManagedTrafficCounter(
    'code',
    { upload: 0, download: 0 },
    'frozen',
  )
  counter = observeManagedTraffic(counter, { upload: 10, download: 20 }).counter
  const frozen = { ...managedTrafficPayload(counter), observed_at: 1234 }
  counter = { ...counter, pending: frozen }
  counter = observeManagedTraffic(counter, {
    upload: 100,
    download: 200,
  }).counter
  const restored = parseManagedTrafficCounter(JSON.stringify(counter), 'code')
  assert.deepEqual(managedTrafficPayload(restored), frozen)
  const next = acknowledgeManagedTraffic(restored, frozen.sequence)
  assert.equal(next.pending, undefined)
  assert.equal(managedTrafficPayload(next).sequence, 2)
  assert.equal(managedTrafficPayload(next).upload_total, 100)
})
