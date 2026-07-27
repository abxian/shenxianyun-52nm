interface WebUiConnectionInfo {
  server?: string
  secret?: string | null
}

export const resolveWebUiUrl = (
  template: string,
  clashInfo: WebUiConnectionInfo | null,
  activeProfileUid?: string,
) => {
  let url = template.trim().replaceAll('%host', '127.0.0.1')

  if (url.includes('%port') || url.includes('%secret')) {
    if (!clashInfo) throw new Error('failed to get clash info')
    if (!clashInfo.server?.includes(':')) {
      throw new Error(`failed to parse the server "${clashInfo.server}"`)
    }

    const port = clashInfo.server
      .slice(clashInfo.server.indexOf(':') + 1)
      .trim()

    url = url.replaceAll('%port', port || '9097')
    url = url.replaceAll('%secret', encodeURIComponent(clashInfo.secret || ''))
  }

  if (!activeProfileUid) return url

  const parsed = new URL(url)
  parsed.searchParams.set('_sxy_profile', activeProfileUid)
  return parsed.toString()
}
