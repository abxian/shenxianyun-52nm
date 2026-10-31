// All desktop platforms use continuous proxy-only counters from the bundled core.
// Keep the Windows v2 namespace; never migrate the old all-traffic v1 cache.
export const DESKTOP_MANAGED_TRAFFIC_STORAGE_KEY =
  'shenxianyun.managedTraffic.proxy.v2'

export function desktopProxyTrafficTotals(
  sample?: {
    proxyUploadTotal?: number
    proxyDownloadTotal?: number
  } | null,
): { upload: number; download: number } | null {
  if (
    !Number.isSafeInteger(sample?.proxyUploadTotal) ||
    !Number.isSafeInteger(sample?.proxyDownloadTotal) ||
    Number(sample?.proxyUploadTotal) < 0 ||
    Number(sample?.proxyDownloadTotal) < 0
  )
    return null
  return {
    upload: sample!.proxyUploadTotal!,
    download: sample!.proxyDownloadTotal!,
  }
}
