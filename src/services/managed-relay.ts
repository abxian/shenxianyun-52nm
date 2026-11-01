import type { fetch as tauriFetch } from '@tauri-apps/plugin-http'

import {
  loadManagedAuth,
  saveManagedAuth,
  type ManagedAuth,
} from './managed-subscription'

export const RELAY_BASE = 'https://ll.sxnn.de'
export const RELAY_TENANT = '52nm'
export type RelayGrant = {
  base: string
  tenant: string
  grant: string
  expires_at: number
}
export type RelayFetch = (
  url: string,
  init: Parameters<typeof tauriFetch>[1],
) => ReturnType<typeof tauriFetch>
const within = async (
  fetcher: RelayFetch,
  url: string,
  init: Parameters<typeof tauriFetch>[1],
): Promise<Response> => {
  const controller = new AbortController()
  const abort = () => controller.abort()
  init?.signal?.addEventListener('abort', abort, { once: true })
  if (init?.signal?.aborted) controller.abort()
  const timer = setTimeout(abort, 4500)
  try {
    return await fetcher(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
    init?.signal?.removeEventListener('abort', abort)
  }
}

const inflight = new Map<string, Promise<RelayGrant>>()
const grants = new Map<string, RelayGrant>()
const valid = (value?: RelayGrant): value is RelayGrant =>
  value?.base === RELAY_BASE &&
  value.tenant === RELAY_TENANT &&
  typeof value.grant === 'string' &&
  value.grant.length < 4096 &&
  value.expires_at > Date.now() / 1000 + 60

export const relayEndpoint = (operation: string) =>
  `${RELAY_BASE}/v1/client/${RELAY_TENANT}/${operation}`

export const prepareRelay = async (
  auth: ManagedAuth,
  fetcher: RelayFetch,
  signal?: AbortSignal,
): Promise<RelayGrant> => {
  const cached = grants.get(auth.deviceToken) || auth.relay
  if (valid(cached)) return cached
  const active = inflight.get(auth.deviceToken)
  if (active) return active
  const pending = (async () => {
    const saved = await loadManagedAuth().catch(() => null)
    if (saved?.deviceToken === auth.deviceToken && valid(saved.relay)) {
      grants.set(auth.deviceToken, saved.relay)
      return saved.relay
    }
    const init = {
      method: 'POST',
      connectTimeout: 2500,
      signal,
      headers: {
        Authorization: `Bearer ${auth.deviceToken}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    }
    let response: Response
    try {
      response = await within(
        fetcher,
        `${auth.apiBase}/api/v2/client/relay`,
        init,
      )
      if (response.status >= 500) throw new Error('primary unavailable')
    } catch (error) {
      if (signal?.aborted) throw error
      response = await within(fetcher, relayEndpoint('authorize'), init)
    }
    const data = (await response.json()) as { ok?: boolean; relay?: RelayGrant }
    if (!response.ok || !data.ok || !valid(data.relay))
      throw new Error('relay authorization unavailable')
    grants.set(auth.deviceToken, data.relay)
    const latest = await loadManagedAuth().catch(() => null)
    if (
      latest?.deviceToken === auth.deviceToken &&
      latest.accessCode === auth.accessCode
    ) {
      await saveManagedAuth({ ...latest, relay: data.relay })
    }
    return data.relay
  })()
  inflight.set(auth.deviceToken, pending)
  try {
    return await pending
  } finally {
    inflight.delete(auth.deviceToken)
  }
}

/** 202 is NEVER translated to old ok:true. Frozen usage survives until final ACK. */
export const sendTrafficWithRelay = async (
  auth: ManagedAuth,
  body: string,
  init: Parameters<typeof tauriFetch>[1],
  fetcher: RelayFetch,
): Promise<Response> => {
  try {
    const response = await within(
      fetcher,
      `${auth.apiBase}/api/v2/client/traffic`,
      { ...init, body },
    )
    if (response.status < 500) {
      if (response.ok) void prepareRelay(auth, fetcher).catch(() => undefined)
      return response
    }
  } catch (error) {
    if (init?.signal?.aborted) throw error
  }
  const grant = await prepareRelay(auth, fetcher, init?.signal ?? undefined)
  const source = JSON.parse(body) as Record<string, number | string>
  const packet = Object.fromEntries(
    [
      'counter_id',
      'sequence',
      'upload_total',
      'download_total',
      'observed_at',
    ].map((key) => [key, source[key]]),
  )
  const response = await within(
    fetcher,
    `${RELAY_BASE}/v1/traffic/${RELAY_TENANT}`,
    {
      method: 'POST',
      connectTimeout: 2500,
      signal: init?.signal,
      headers: {
        Authorization: `Bearer ${grant.grant}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(packet),
    },
  )
  const result = (await response.json()) as {
    state?: string
    committed?: boolean
  }
  if (response.ok && result.state === 'applied' && result.committed === true) {
    return new Response(JSON.stringify({ ok: true, via_relay: true }), {
      status: 200,
    })
  }
  return new Response(JSON.stringify({ ok: false, code: 'relay_pending' }), {
    status: response.status === 202 ? 503 : response.status,
    headers: { 'Retry-After': response.headers.get('Retry-After') || '30' },
  })
}

export const fetchSubscriptionWithRelay = async (
  auth: Pick<ManagedAuth, 'subscriptionUrl' | 'deviceToken'>,
  init: Parameters<typeof tauriFetch>[1],
  fetcher: RelayFetch,
): Promise<Response> => {
  try {
    const response = await within(fetcher, auth.subscriptionUrl, init)
    if (response.status < 500) return response
  } catch (error) {
    if (init?.signal?.aborted) throw error
  }
  const response = await within(fetcher, relayEndpoint('subscription'), {
    ...init,
    method: 'POST',
    connectTimeout: 2500,
    headers: {
      Authorization: `Bearer ${auth.deviceToken}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
  const data = (await response.json()) as { ok?: boolean; content?: string }
  if (!response.ok || !data.ok || typeof data.content !== 'string')
    return new Response('', {
      status: response.status >= 400 ? response.status : 502,
    })
  return new Response(data.content, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  })
}

/** First import has no device token yet. Only these fixed entry operations can
 * reach the shared relay; authority/one-use tickets stay in the original Web. */
export const fetchEntryWithRelay = async (
  url: string,
  init: Parameters<typeof tauriFetch>[1],
  fetcher: RelayFetch,
): Promise<Response> => {
  const parsed = new URL(url)
  let operation: 'ticket' | 'exchange' | 'verify' | 'state'
  let body: Record<string, unknown>
  if (
    parsed.pathname === '/api/import/ticket' ||
    parsed.pathname === '/api/import/exchange'
  ) {
    operation = parsed.pathname.endsWith('/ticket') ? 'ticket' : 'exchange'
    body = JSON.parse(
      typeof init?.body === 'string' ? init.body : '{}',
    ) as Record<string, unknown>
  } else {
    const match = parsed.pathname.match(
      /^\/api\/(verify|update-state)\/([^/]+)$/,
    )
    if (!match) throw new Error('unsupported official entry operation')
    operation = match[1] === 'verify' ? 'verify' : 'state'
    body = {
      code: decodeURIComponent(match[2]),
      client_id: parsed.searchParams.get('client_id') || '',
    }
    if (parsed.searchParams.has('import'))
      body.import = parsed.searchParams.get('import')
  }
  try {
    const response = await within(fetcher, url, init)
    if (response.status < 500) return response
  } catch (error) {
    if (init?.signal?.aborted) throw error
  }
  return within(fetcher, relayEndpoint(operation), {
    method: 'POST',
    connectTimeout: 2500,
    signal: init?.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
