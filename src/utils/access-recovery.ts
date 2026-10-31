export type AccessRestrictionReason =
  | 'expired'
  | 'traffic_limit'
  | 'unavailable'
export type AccessRestriction = {
  accessCode: string
  reason: AccessRestrictionReason
}
export const restrictionReason = (code?: string): AccessRestrictionReason =>
  code === 'expired'
    ? 'expired'
    : code === 'traffic_limit'
      ? 'traffic_limit'
      : 'unavailable'
export const parseAccessRestriction = (
  raw: string | null,
  accessCode: string,
): AccessRestriction | null => {
  try {
    const value = JSON.parse(raw || 'null') as AccessRestriction | null
    return value?.accessCode === accessCode &&
      ['expired', 'traffic_limit', 'unavailable'].includes(value.reason)
      ? value
      : null
  } catch {
    return null
  }
}
export const needsSubscriptionRefresh = (input: {
  startup: boolean
  recovering: boolean
  remoteVersion: number
  localVersion: number
  remoteRevision?: string
  localRevision?: string
  expiryChanged: boolean
}) =>
  input.startup ||
  input.recovering ||
  input.expiryChanged ||
  Boolean(
    input.remoteRevision && input.remoteRevision !== input.localRevision,
  ) ||
  input.remoteVersion > input.localVersion
