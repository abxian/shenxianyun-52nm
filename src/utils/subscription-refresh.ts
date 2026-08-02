export type SubscriptionRefreshReason = 'startup' | 'server-push'

type SubscriptionRefreshPlanInput = {
  hasCurrentProfile: boolean
  startupRefreshPending: boolean
  remoteVersion: number
  localVersion: number
}

export const planSubscriptionRefresh = ({
  hasCurrentProfile,
  startupRefreshPending,
  remoteVersion,
  localVersion,
}: SubscriptionRefreshPlanInput): SubscriptionRefreshReason | null => {
  if (!hasCurrentProfile) return null
  if (startupRefreshPending) return 'startup'
  if (remoteVersion > localVersion) return 'server-push'
  return null
}
