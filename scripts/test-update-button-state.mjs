import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  describeUpdateError,
  resolveUpdateButtonState,
} from '../src/services/update-button-state.ts'

describe('update button state', () => {
  it('stays hidden when there is no update and no error', () => {
    assert.deepEqual(resolveUpdateButtonState({}), { kind: 'hidden' })
    assert.deepEqual(
      resolveUpdateButtonState({ updateInfo: null, error: null }),
      { kind: 'hidden' },
    )
    assert.deepEqual(
      resolveUpdateButtonState({ updateInfo: { available: false } }),
      { kind: 'hidden' },
    )
  })

  it('shows the available update', () => {
    assert.deepEqual(
      resolveUpdateButtonState({
        updateInfo: { available: true, version: '2.5.42' },
      }),
      { kind: 'available', version: '2.5.42' },
    )
  })

  it('surfaces a check failure instead of silently hiding', () => {
    // 这是本次改动的核心：过去这种情况界面上什么都不显示。
    const state = resolveUpdateButtonState({
      error: new Error('Network unreachable'),
    })
    assert.deepEqual(state, { kind: 'error', message: 'Network unreachable' })
  })

  it('prefers an actionable update over a later refresh failure', () => {
    // 已经拿到可用更新后又刷新失败时，仍应让用户能点击安装。
    assert.deepEqual(
      resolveUpdateButtonState({
        updateInfo: { available: true, version: '2.5.42' },
        error: new Error('later refresh failed'),
      }),
      { kind: 'available', version: '2.5.42' },
    )
  })

  it('tolerates an update without a version string', () => {
    assert.deepEqual(
      resolveUpdateButtonState({ updateInfo: { available: true } }),
      { kind: 'available', version: null },
    )
  })

  it('describes non-Error failures without throwing', () => {
    assert.equal(describeUpdateError(new Error('boom')), 'boom')
    assert.equal(describeUpdateError('plain string'), 'plain string')
    assert.equal(describeUpdateError({ code: 500 }), '{"code":500}')
    assert.equal(describeUpdateError(null), '未知错误')
    assert.equal(describeUpdateError(undefined), '未知错误')
    // 带循环引用的对象不能让 UI 崩掉
    const circular = {}
    circular.self = circular
    assert.equal(typeof describeUpdateError(circular), 'string')
    // Error 没有 message 时回退到 name
    const bare = new Error('')
    assert.equal(describeUpdateError(bare), 'Error')
  })
})
