import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ImportNodeHealthError,
  listImportNodeCandidates,
  rankHealthyImportNodes,
} from '../src/utils/import-node-health.ts'

test('filters reserved entries and removes duplicate candidates', () => {
  assert.deepEqual(
    listImportNodeCandidates([
      { name: 'DIRECT', type: 'Direct' },
      { name: 'REJECT', type: 'Reject' },
      { name: 'PASS', type: 'Pass' },
      { name: '节点 A', type: 'VLESS' },
      { name: '节点 A', type: 'VLESS' },
      { name: '自动选择', type: 'URLTest' },
      { name: '自定义直连', type: 'Direct' },
      { name: '  ' },
    ]),
    ['节点 A', '自动选择'],
  )
})

test('selects a later healthy node when the first node is unavailable', () => {
  assert.deepEqual(
    rankHealthyImportNodes(
      ['失效首节点', '可用节点 B', '可用节点 C'],
      {
        失效首节点: 0,
        '可用节点 B': 186,
        '可用节点 C': 92,
      },
      5000,
    ),
    [
      { name: '可用节点 C', delay: 92 },
      { name: '可用节点 B', delay: 186 },
    ],
  )
})

test('ignores timeout, error, negative and unknown delay values', () => {
  assert.deepEqual(
    rankHealthyImportNodes(
      ['超时', '错误', '测试中', '未知', '边界', '正常'],
      {
        超时: 0,
        错误: 1_000_000,
        测试中: -2,
        边界: 5000,
        正常: 320,
      },
      5000,
    ),
    [{ name: '正常', delay: 320 }],
  )
})

test('returns no selection when every subscription node is unavailable', () => {
  assert.deepEqual(
    rankHealthyImportNodes(
      ['节点 A', '节点 B', '节点 C'],
      { '节点 A': 0, '节点 B': 5000, '节点 C': 1_000_000 },
      5000,
    ),
    [],
  )
})

test('keeps subscription order when healthy nodes have the same delay', () => {
  assert.deepEqual(
    rankHealthyImportNodes(
      ['节点 B', '节点 A'],
      { '节点 A': 100, '节点 B': 100 },
      5000,
    ),
    [
      { name: '节点 B', delay: 100 },
      { name: '节点 A', delay: 100 },
    ],
  )
})

test('health error exposes safe diagnostic counts', () => {
  const error = new ImportNodeHealthError('没有可用节点', 47, 0)
  assert.equal(error.name, 'ImportNodeHealthError')
  assert.equal(error.candidateCount, 47)
  assert.equal(error.healthyCount, 0)
  assert.equal(error.message, '没有可用节点')
})
