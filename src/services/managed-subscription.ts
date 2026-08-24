import { invoke } from '@tauri-apps/api/core'

export type ManagedImportRequest = {
  ticket: string
  apiBase: string
  name?: string
}

export type ManagedAuth = {
  accessCode: string
  profileUid: string
  apiBase: string
  subscriptionUrl: string
  deviceToken: string
  expiresAt: string
  limitMode: string
  contentHash: string
  detached: boolean
  updateVersion: number
}

export const takeManagedImportRequest = () =>
  invoke<ManagedImportRequest | null>('take_managed_import_request')

export const loadManagedAuth = () =>
  invoke<ManagedAuth | null>('load_managed_auth')

export const saveManagedAuth = (auth: ManagedAuth) =>
  invoke<void>('save_managed_auth', { auth })

export const clearManagedAuth = () => invoke<void>('clear_managed_auth')

export const managedProfileName = (clientName: string) => {
  const normalized = clientName.trim().slice(0, 80)
  return `${normalized || '官方客户端'} 官方订阅`
}

export const hashManagedContent = async (content: string) => {
  const bytes = new TextEncoder().encode(content)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export const extractTicketFromLaunchUrl = (launchUrl: string) => {
  const match = launchUrl.match(/\/import\/launch\/([^/?#]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}
