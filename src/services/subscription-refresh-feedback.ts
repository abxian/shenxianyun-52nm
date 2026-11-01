export type SubscriptionRefreshFeedback = {
  severity: 'success' | 'warning' | 'info'
  message: string
}

export type SubscriptionRefreshOutcome = 'updated' | 'unchanged' | 'detached'

/** Feedback follows the actual transaction, and automatic refreshes stay quiet. */
export const refreshWithFeedback = async (ports: {
  automatic: boolean
  refresh: () => Promise<SubscriptionRefreshOutcome>
  notify: (feedback: SubscriptionRefreshFeedback) => void
}): Promise<void> => {
  try {
    const outcome = await ports.refresh()
    if (!ports.automatic) {
      ports.notify(
        outcome === 'detached'
          ? { severity: 'info', message: '未更新，当前订阅由本地管理' }
          : {
              severity: 'success',
              message:
                outcome === 'unchanged'
                  ? '更新成功，当前节点已是最新'
                  : '订阅更新成功，已获取最新节点',
            },
      )
    }
  } catch (error) {
    if (!ports.automatic)
      ports.notify({ severity: 'warning', message: '更新失败，已保留原订阅' })
    throw error
  }
}
