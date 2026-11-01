import type { fetch as tauriFetch } from '@tauri-apps/plugin-http'

import {
  assertRequestActive,
  fetchBufferedWithDeadline,
} from './http-request-deadline'

type Init = Parameters<typeof tauriFetch>[1]
type Fetcher = (url: string, init: Init) => Promise<Response>

// An explicit proxy with a wildcard exclusion disables reqwest's automatic
// system proxy discovery without ever connecting to the placeholder port.
// A bare `proxy: undefined` still inherits the user's (possibly dead) proxy.
export const SYSTEM_PROXY_BYPASS = {
  all: { url: 'http://127.0.0.1:9', noProxy: '*' },
}

/** Each official request tries the core's forced-DIRECT inbound and an explicit
 * system-proxy-free route. Neither route uses GLOBAL or changes the core mode.
 * Body reads share the attempt deadline, and caller cancellation stops retries.
 */
export const fetchOfficialManagement = async (
  url: string,
  init: Init,
  ports: { fetch: Fetcher; directProxy: () => Promise<string> },
): Promise<Response> => {
  assertRequestActive(init?.signal)
  try {
    const proxy = await ports.directProxy()
    assertRequestActive(init?.signal)
    const response = await fetchBufferedWithDeadline(
      ports.fetch,
      url,
      {
        ...init,
        connectTimeout: 2000,
        maxRedirections: 0,
        proxy: { all: proxy },
      },
      3500,
    )
    // A genuine account/rate-limit rejection is authoritative. Do not replay it.
    if (response.status < 500) return response
  } catch {
    assertRequestActive(init?.signal)
  }
  try {
    return await fetchBufferedWithDeadline(
      ports.fetch,
      url,
      {
        ...init,
        connectTimeout: 2500,
        maxRedirections: 0,
        proxy: SYSTEM_PROXY_BYPASS,
      },
      4500,
    )
  } catch (error) {
    assertRequestActive(init?.signal)
    throw new Error('Management connection unavailable', {
      cause: error,
    })
  }
}
