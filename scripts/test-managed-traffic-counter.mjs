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
