import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

import { DOMAIN_PROFILE, DOMESTIC_API_HOST } from '@/config/domain-profile'

/**
 * 端点发现（去掉写死 sub.jc116.com）：
 * 启动时从「发现源」拉取 endpoints.json，得到 api_bases / sub_base / download_base，
 * 之后换域名 / 换内穿 / 切线路只改后台 + endpoints.json，客户端下次启动自动跟随。
 *
 * 发现失败 → 用本地缓存；再没有 → 用内置默认。任何一步都不阻塞启动。
 */

// 首装和每次启动都先使用国内主域名。其它地址只在国内线路检测失败时兜底，
// 不能因为响应更快就抢占国内主线路。
export const PINNED_API_BASES = [...DOMAIN_PROFILE.apiBases]

// 52nm 绑定版本不回退旧业务域名，避免新客户端被动态配置带回旧网站。
const RETIRED_API_HOSTS = new Set(['api.sxnn.de', 'sxnn.de', 'sub.jc116.com'])
// 内置兜底默认值（发现源全挂时用第一条写死线路）
export const DEFAULT_API_BASE = PINNED_API_BASES[0]

// 完整线路按固定优先级排列；并发检测只缩短等待时间，不改变选择优先级。
const allApiBases = (): string[] => {
  const merged: string[] = [...PINNED_API_BASES]
  for (const b of readCache()?.api_bases ?? []) {
    let host = ''
    try {
      host = new URL(b).hostname
    } catch {
      // sanitize 已过滤坏地址，这里仍保持防御性处理。
    }
    if (b && !RETIRED_API_HOSTS.has(host) && !merged.includes(b)) merged.push(b)
  }
  return merged
}

// 发现锚点：独立站动态接口优先，GitHub 与国外站点作为备用。
const DISCOVERY_URLS = [...DOMAIN_PROFILE.discoveryUrls]

// 每个复制项目按 profile.id 使用独立缓存，绝不读取其它站点线路。
const STORAGE_KEY = `shenxianyun.${DOMAIN_PROFILE.id}.endpoints`
const ACTIVE_BASE_KEY = `shenxianyun.${DOMAIN_PROFILE.id}.apiBaseActive`

export type RuntimeBrand = {
  site_name: string
  client_name: string
  node_brand: string
  subscription_name_template: string
  managed_import_scheme: string
}

export type Endpoints = {
  version?: number
  profile?: string
  brand?: RuntimeBrand
  api_bases?: string[]
  sub_base?: string
  download_base?: string
  bootstrap_proxy?: string
  updated_at?: string
}

const COMPILED_BRAND: RuntimeBrand = {
  site_name: DOMAIN_PROFILE.siteName,
  client_name: DOMAIN_PROFILE.clientName,
  node_brand: DOMAIN_PROFILE.nodeBrand,
  subscription_name_template: DOMAIN_PROFILE.subscriptionNameTemplate,
  managed_import_scheme: DOMAIN_PROFILE.deepLinkScheme,
}

const normalizeText = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 160)
    : fallback

const sanitizeBrand = (value: unknown): RuntimeBrand => {
  const brand =
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    site_name: normalizeText(brand.site_name, COMPILED_BRAND.site_name),
    client_name: normalizeText(brand.client_name, COMPILED_BRAND.client_name),
    node_brand: normalizeText(brand.node_brand, COMPILED_BRAND.node_brand),
    subscription_name_template: normalizeText(
      brand.subscription_name_template,
      COMPILED_BRAND.subscription_name_template,
    ),
    managed_import_scheme: normalizeText(
      brand.managed_import_scheme,
      COMPILED_BRAND.managed_import_scheme,
    ),
  }
}

const normalizeBase = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  const v = value.trim().replace(/\/+$/, '')
  return /^https?:\/\//.test(v) ? v : ''
}

// 兜底代理：允许 http/socks5 URL；不像 base 那样去尾斜杠。
const normalizeProxy = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  const v = value.trim()
  return /^(https?|socks5h?):\/\//.test(v) ? v : ''
}

// 所有官方接口都执行完整 TLS 校验，不在客户端绕过无效证书。
export const fetchWithVerifiedTls = async (
  url: string,
  init: Parameters<typeof tauriFetch>[1],
): ReturnType<typeof tauriFetch> => tauriFetch(url, init)

const sanitize = (data: unknown): Endpoints | null => {
  if (!data || typeof data !== 'object') return null
  const raw = data as Record<string, unknown>
  if (
    typeof raw.profile === 'string' &&
    raw.profile.trim() &&
    raw.profile.trim() !== DOMAIN_PROFILE.id
  ) {
    return null
  }
  const bases = Array.isArray(raw.api_bases)
    ? raw.api_bases.map(normalizeBase).filter(Boolean)
    : []
  if (!bases.length) return null
  return {
    version: Number(raw.version) || 0,
    profile: typeof raw.profile === 'string' ? raw.profile : DOMAIN_PROFILE.id,
    brand: sanitizeBrand(raw.brand),
    api_bases: bases,
    sub_base: normalizeBase(raw.sub_base),
    download_base: normalizeBase(raw.download_base),
    bootstrap_proxy: normalizeProxy(raw.bootstrap_proxy),
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : '',
  }
}

const readCache = (): Endpoints | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? sanitize(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

/** 当前应使用的 API 基址：探测出的可用地址 > 缓存列表第一个 > 内置默认。同步、永不抛错。 */
export const getApiBase = (): string => {
  const active = normalizeBase(localStorage.getItem(ACTIVE_BASE_KEY))
  if (active) return active
  return allApiBases()[0] || DEFAULT_API_BASE
}

export const getEndpoints = (): Endpoints | null => readCache()

export const getRuntimeBrand = (): RuntimeBrand =>
  readCache()?.brand ?? COMPILED_BRAND

/** 兜底代理（HTTP/SOCKS5）：直连+系统代理都连不上 web 时的最后一条路。无则空串。 */
export const getBootstrapProxy = (): string =>
  normalizeProxy(readCache()?.bootstrap_proxy)

const fetchDiscovery = async (url: string): Promise<Endpoints> => {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 4000)
  try {
    const res = await fetchWithVerifiedTls(url, {
      method: 'GET',
      signal: ctrl.signal,
      headers: { 'Cache-Control': 'no-cache' },
    })
    if (!res.ok) throw new Error(`discovery HTTP ${res.status}`)
    const parsed = sanitize(await res.json())
    if (!parsed) throw new Error('invalid discovery payload')
    return parsed
  } finally {
    clearTimeout(t)
  }
}

/** 并发拉取发现源，取第一个有效响应。发现失败不阻塞内置主线路。 */
export const refreshEndpoints = async (): Promise<Endpoints | null> => {
  try {
    const parsed = await Promise.any(DISCOVERY_URLS.map(fetchDiscovery))
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed))
    return parsed
  } catch {
    return readCache()
  }
}

// 一次 GET 探测：proxyUrl 传入时经该代理（软件内核混合端口）出网，否则本机直连。
const probeOnce = async (
  url: string,
  proxyUrl: string | undefined,
  timeout: number,
): Promise<boolean> => {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetchWithVerifiedTls(url, {
      method: 'GET',
      signal: ctrl.signal,
      ...(proxyUrl ? { proxy: { all: proxyUrl } } : {}),
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

const isDomesticPrimary = (base: string): boolean => {
  try {
    return new URL(base).hostname === DOMESTIC_API_HOST
  } catch {
    return false
  }
}

// 判断一条线路是否可用：先本机直连；直连不通且传了 proxyUrl（内核在跑）时，
// 再经内核端口重试一次——内核带 52nm.de 直连规则，能绕开系统级
// OpenClash/fake-ip 把自家服务器误路由到国外节点的问题。任一成功即可用。
const reachable = async (base: string, proxyUrl?: string): Promise<boolean> => {
  const url = `${base}/api/app-version?_=${Date.now()}`
  if (await probeOnce(url, undefined, 3500)) return true
  if (isDomesticPrimary(base)) return false

  // 直连失败后并发尝试内核代理和后台兜底，避免串行等待 14 秒。
  const boot = getBootstrapProxy()
  const fallbacks = [proxyUrl, boot]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => values.indexOf(value) === index)
  if (!fallbacks.length) return false
  const results = await Promise.all(
    fallbacks.map((proxy) => probeOnce(url, proxy, 4000)),
  )
  return results.some(Boolean)
}

const firstReachable = async (
  bases: string[],
  proxyUrl?: string,
): Promise<string | null> => {
  const results = await Promise.all(
    bases.map((base) => reachable(base, proxyUrl)),
  )
  return bases.find((_, index) => results[index]) ?? null
}

/** 并发探测 api_bases，按列表优先级选择可用线路。proxyUrl=内核混合端口（可选兜底）。 */
export const pickApiBase = async (proxyUrl?: string): Promise<string> => {
  const base = await firstReachable(allApiBases(), proxyUrl)
  if (base) {
    localStorage.setItem(ACTIVE_BASE_KEY, base)
    return base
  }
  return getApiBase()
}

/** 当前候选线路 = 国内主线路 + 国外/内穿兜底；旧域名已排除。 */
export const listApiBases = (): string[] => allApiBases()

/** 国内主线路条数，UI 仅在国内主线路失败时显示兜底线路。 */
export const pinnedCount = (): number => PINNED_API_BASES.length

/** 探测单条线路是否可用。proxyUrl=内核混合端口（可选兜底）。 */
export const probeApiBase = async (
  base: string,
  proxyUrl?: string,
): Promise<boolean> => reachable(base, proxyUrl)

/** 手动指定当前线路（页面上点选线路时用）。 */
export const setActiveApiBase = (base: string): void => {
  const v = normalizeBase(base)
  if (v) localStorage.setItem(ACTIVE_BASE_KEY, v)
}

/** 请求失败时调用：把当前 active 基址作废并顺延到下一个候选，返回新基址。 */
export const rotateApiBase = async (proxyUrl?: string): Promise<string> => {
  const bad = getApiBase()
  const base = await firstReachable(
    allApiBases().filter((candidate) => candidate !== bad),
    proxyUrl,
  )
  if (base) {
    localStorage.setItem(ACTIVE_BASE_KEY, base)
    return base
  }
  return bad
}

/** 启动时调用一次：刷新发现源 + 探测可用基址（后台执行，不阻塞 UI）。 */
export const initEndpointDiscovery = async (
  proxyUrl?: string,
): Promise<void> => {
  // 覆盖旧版本保存的国外/内穿选择，启动瞬间即使用国内主域名。
  localStorage.setItem(ACTIVE_BASE_KEY, DEFAULT_API_BASE)
  // 所有候选并发检测，但结果始终按国内主域名优先选取。
  await pickApiBase(proxyUrl)
  await refreshEndpoints()
  await pickApiBase(proxyUrl)
}

/** 官方域名直连列表：生成占位/规则时使用，避免客户端把自家 API/订阅域名也代理了。 */
export const officialDirectRules = (): string[] => {
  const hosts = new Set<string>(DOMAIN_PROFILE.officialDomainSuffixes)
  const cached = readCache()
  const collect = (value?: string) => {
    if (!value) return
    try {
      const host = new URL(value).hostname
      if (host && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
        // 取注册域（简单处理：保留完整主机名后缀即可满足 DOMAIN-SUFFIX）
        hosts.add(host.split('.').slice(-2).join('.'))
      }
    } catch {
      // 忽略坏值
    }
  }
  for (const b of cached?.api_bases ?? []) collect(b)
  collect(cached?.sub_base)
  collect(cached?.download_base)
  return [...hosts].map((h) => `DOMAIN-SUFFIX,${h},DIRECT`)
}
