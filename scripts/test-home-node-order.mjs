import assert from 'node:assert/strict'
import test from 'node:test'

import { isAutomaticNode, sortHomeNodes } from '../src/utils/home-node-order.ts'
import { homeStatusMessage } from '../src/utils/home-status.ts'

test('automatic selection stays first before, during and after latency tests', () => {
  const nodes = [
    { name: '香港', type: 'Shadowsocks', delay: 10 },
    { name: '♻️ 自动选择', type: 'URLTest', delay: 9999 },
    { name: '日本', type: 'Shadowsocks', delay: 5 },
  ]
  for (const delay of [-2, -1, 0, 30, 9999]) {
    nodes[1].delay = delay
    const sorted = sortHomeNodes(nodes, (node) => node.delay)
    assert.equal(sorted[0].name, '♻️ 自动选择')
    assert.deepEqual(
      sorted.slice(1).map((node) => node.name),
      ['日本', '香港'],
    )
  }
  assert.equal(nodes[0].name, '香港', 'does not mutate source group order')
})

test('a leaf with an automatic-looking name is not mistaken for an automatic policy', () => {
  assert.equal(
    isAutomaticNode({ name: '自动选择 专线', type: 'Shadowsocks' }),
    false,
  )
  for (const type of ['URLTest', 'url-test', 'Fallback', 'LoadBalance'])
    assert.equal(isAutomaticNode({ name: '自动选择', type }), true)
})

test('multiple automatic policies keep their original order and manual latency still sorts', () => {
  const nodes = [
    { name: '日本', type: 'Shadowsocks', delay: 50 },
    { name: '自动选择 A', type: 'URLTest', delay: 40 },
    { name: '自动选择 B', type: 'Fallback', delay: 10 },
    { name: '香港', type: 'Shadowsocks', delay: 20 },
  ]
  assert.deepEqual(
    sortHomeNodes(nodes, (n) => n.delay).map((n) => n.name),
    ['自动选择 A', '自动选择 B', '香港', '日本'],
  )
})

test('home suppresses routine progress but keeps actionable and unfamiliar errors', () => {
  for (const status of [
    '正在刷新订阅...',
    '当前节点已是最新',
    '节点已切换',
    '已启动 TUN 模式',
  ])
    assert.equal(homeStatusMessage(status), '')
  for (const status of [
    '订阅更新失败，已继续使用原订阅',
    'permission denied',
    '提取码已到期，请续费',
    '检测到本地编辑，已停止远程覆盖',
  ])
    assert.equal(homeStatusMessage(status), status)
})
