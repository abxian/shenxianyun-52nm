/** Local UI command only. Never a server access code or authentication token. */
export const isLocalSettingsCommand = (value: string) =>
  value.trim().toLowerCase() === 'setting'

export const homeWorkspaceVisible = (
  localWorkspace: boolean,
  running: boolean,
  connectionReady: boolean,
) => localWorkspace || (running && connectionReady)

/** Keep dates readable without pretending an absent expiry is unlimited. */
export const accountExpiryLabel = (value: string) => {
  const date = value.trim()
  return date ? `到期时间：${date.replace('T', ' ')}` : '到期时间：待同步'
}
