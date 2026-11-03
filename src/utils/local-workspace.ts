/** Local UI command only. Never a server access code or authentication token. */
export const isLocalSettingsCommand = (value: string) =>
  value.trim().toLowerCase() === 'setting'

export const homeWorkspaceVisible = (
  localWorkspace: boolean,
  running: boolean,
  connectionReady: boolean,
) => localWorkspace || (running && connectionReady)

/** Show an expiry only when the account provides a date. */
export const accountExpiryLabel = (value: string) => {
  const date = value.trim()
  return date && date.toLowerCase() !== 'null'
    ? `到期时间：${date.replace('T', ' ')}`
    : ''
}
