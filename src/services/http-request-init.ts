import type { ClientOptions } from '@tauri-apps/plugin-http'

type HttpRequestInit = (RequestInit & ClientOptions) | undefined

export const cloneHttpRequestInit = (
  init: HttpRequestInit,
): HttpRequestInit => ({
  ...init,
  headers:
    init?.headers instanceof Headers
      ? new Headers(init.headers)
      : Array.isArray(init?.headers)
        ? init.headers.map(([name, value]) => [name, value] as [string, string])
        : init?.headers
          ? { ...init.headers }
          : undefined,
  proxy: init?.proxy
    ? {
        ...init.proxy,
        ...(init.proxy.all && typeof init.proxy.all === 'object'
          ? { all: { ...init.proxy.all } }
          : {}),
        ...(init.proxy.http && typeof init.proxy.http === 'object'
          ? { http: { ...init.proxy.http } }
          : {}),
        ...(init.proxy.https && typeof init.proxy.https === 'object'
          ? { https: { ...init.proxy.https } }
          : {}),
      }
    : undefined,
})
