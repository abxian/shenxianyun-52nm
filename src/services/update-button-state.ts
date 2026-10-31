// 更新按钮该显示什么，与 React 和 Tauri 都无关的纯判定逻辑。
//
// 单独成文件而不是放进 services/update.ts，是因为后者依赖 @tauri-apps/*
// 与 @root/package.json，在纯 Node 测试环境里无法解析。
//
// 背景：更新检查失败过去是完全静默的 —— useUpdate 不向外暴露 error，
// UpdateButton 又只在 updateInfo.available 时渲染，于是 check() 抛错时
// 界面上什么都没有。2026-08-31 排查「约 130 台设备、3 个版本、零采用」时，
// 这一点让人无法判断究竟是用户没点更新，还是检查根本没成功过。

export type UpdateButtonState =
  | { kind: 'hidden' }
  | { kind: 'available'; version: string | null }
  | { kind: 'error'; message: string }

export const describeUpdateError = (error: unknown): string => {
  if (!error) return '未知错误'
  if (error instanceof Error) return error.message || error.name || '未知错误'
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    // 循环引用等无法序列化的情况不能让 UI 崩掉
    return String(error)
  }
}

export const resolveUpdateButtonState = (input: {
  updateInfo?: { available?: boolean; version?: string | null } | null
  error?: unknown
}): UpdateButtonState => {
  // 已经拿到可用更新时优先展示它：即便随后的一次刷新失败，
  // 这个结果仍然是用户可操作的，不该被错误态盖掉。
  if (input.updateInfo?.available) {
    return { kind: 'available', version: input.updateInfo.version ?? null }
  }
  // 只有 react-query 重试耗尽后才会有 error，不会因一次瞬时抖动就报警。
  if (input.error) {
    return { kind: 'error', message: describeUpdateError(input.error) }
  }
  return { kind: 'hidden' }
}
