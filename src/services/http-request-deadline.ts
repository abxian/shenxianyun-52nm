import type { ClientOptions } from '@tauri-apps/plugin-http'

type HttpInit = (RequestInit & ClientOptions) | undefined
type Fetcher = (url: string, init: HttpInit) => Promise<Response>

export const assertRequestActive = (signal?: AbortSignal | null) => {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException('Request cancelled', 'AbortError')
}

// Only use this for reads. A timed-out write transaction must retain ownership
// until its commit/rollback finishes rather than continuing after the UI unlocks.
export const withRequestDeadline = async <T>(
  request: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parent?: AbortSignal | null,
): Promise<T> => {
  assertRequestActive(parent)
  const controller = new AbortController()
  let reason: unknown
  const abort = (value: unknown) => {
    reason = value
    controller.abort(value)
  }
  const parentAbort = () =>
    abort(parent?.reason ?? new DOMException('Request cancelled', 'AbortError'))
  let rejectAbort: () => void = () => {}
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(reason)
    controller.signal.addEventListener('abort', rejectAbort, { once: true })
  })
  parent?.addEventListener('abort', parentAbort, { once: true })
  const timer = setTimeout(
    () => abort(new DOMException('Request deadline exceeded', 'TimeoutError')),
    timeoutMs,
  )
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        assertRequestActive(controller.signal)
        return request(controller.signal)
      }),
      aborted,
    ])
  } finally {
    clearTimeout(timer)
    parent?.removeEventListener('abort', parentAbort)
    controller.signal.removeEventListener('abort', rejectAbort)
  }
}

const preserveMetadata = (source: Response, result: Response): Response => {
  for (const key of ['url', 'redirected', 'type'] as const)
    Object.defineProperty(result, key, { value: source[key] })
  Object.defineProperty(result, 'clone', {
    value: () =>
      preserveMetadata(source, Response.prototype.clone.call(result)),
  })
  return result
}

// API/subscription payloads are buffered inside the deadline: receiving headers
// alone does not mean the request has finished. Never used for updater binaries.
export const fetchBufferedWithDeadline = (
  fetcher: Fetcher,
  url: string,
  init: HttpInit,
  timeoutMs = 12_000,
): Promise<Response> =>
  withRequestDeadline(
    async (signal) => {
      const response = await fetcher(url, { ...init, signal })
      if (signal.aborted) {
        void response.body?.cancel().catch(() => undefined)
        assertRequestActive(signal)
      }
      const body = response.body ? await response.arrayBuffer() : null
      assertRequestActive(signal)
      return preserveMetadata(
        response,
        new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        }),
      )
    },
    timeoutMs,
    init?.signal,
  )
