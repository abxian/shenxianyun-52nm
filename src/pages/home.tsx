import {
  AddRounded,
  BoltRounded,
  BuildRounded,
  CheckCircleRounded,
  CloudSyncRounded,
  DeleteRounded,
  DnsRounded,
  ErrorRounded,
  KeyRounded,
  LanRounded,
  LanguageRounded,
  NetworkCheckRounded,
  OpenInBrowserRounded,
  RefreshRounded,
  RestartAltRounded,
  RouterRounded,
  RuleRounded,
  SecurityRounded,
  SettingsRounded,
  ShoppingCartRounded,
  SpeedRounded,
  SwapVertRounded,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { relaunch } from '@tauri-apps/plugin-process'
import { useLockFn } from 'ahooks'
import yaml from 'js-yaml'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getBaseConfig, getVersion } from 'tauri-plugin-mihomo-api'

import { BasePage, type DialogRef } from '@/components/base'
import { GlassPowerButton } from '@/components/home/glass-power-button'
import { NodeSelectionPanel } from '@/components/home/node-selection-panel'
import { WebsiteTestViewer } from '@/components/home/website-test-viewer'
import { EditorViewer } from '@/components/profile/editor-viewer'
import { FileInput } from '@/components/profile/file-input'
import { ClashPortViewer } from '@/components/setting/mods/clash-port-viewer'
import { ControllerViewer } from '@/components/setting/mods/controller-viewer'
import { TunnelsViewer } from '@/components/setting/mods/tunnels-viewer'
import { WebUIViewer } from '@/components/setting/mods/web-ui-viewer'
import {
  DOMAIN_PROFILE,
  DOMESTIC_API_HOST,
  isOfficialHostname,
} from '@/config/domain-profile'
import { useClash } from '@/hooks/use-clash'
import { useConnectionData } from '@/hooks/use-connection-data'
import { useProfiles } from '@/hooks/use-profiles'
import { useProxySelection } from '@/hooks/use-proxy-selection'
import { useSystemProxyState } from '@/hooks/use-system-proxy-state'
import { useSystemState } from '@/hooks/use-system-state'
import { useUpdate } from '@/hooks/use-update'
import { useVerge } from '@/hooks/use-verge'
import { useAppData } from '@/providers/app-data-context'
import {
  createLocalBackup,
  createProfile,
  enhanceProfiles,
  factoryResetApp,
  getRunningMode,
  getProfiles,
  getServiceDiagnostics,
  getStableDeviceKey,
  getSystemProxy,
  importProfile,
  installService,
  openWebUrl,
  patchClashMode,
  patchProfile,
  patchProfilesConfig,
  patchVergeConfig,
  readProfileFile,
  repairService,
  restartCore,
  restartApp,
  saveProfileFile,
  startCore,
  stopCore,
  deleteProfile,
  updateProfile,
} from '@/services/cmds'
import delayManager from '@/services/delay'
import {
  desktopProxyTrafficTotals,
  DESKTOP_MANAGED_TRAFFIC_STORAGE_KEY,
} from '@/services/desktop-proxy-traffic'
import {
  fetchWithVerifiedTls,
  getApiBase,
  getBootstrapProxy,
  getRuntimeBrand,
  initEndpointDiscovery,
  listApiBases,
  officialDirectRules,
  pickApiBase,
  probeApiBase,
  rotateApiBase,
} from '@/services/endpoint-resolver'
import {
  assertRequestActive,
  fetchBufferedWithDeadline,
  withRequestDeadline,
} from '@/services/http-request-deadline'
import { loadManagedContent } from '@/services/managed-download-recovery'
import {
  clearManagedAuth,
  extractTicketFromLaunchUrl,
  hashManagedContent,
  loadManagedAuth,
  managedProfileName,
  saveManagedAuth,
  takeManagedImportRequest,
  type ManagedAuth,
  type ManagedImportRequest,
} from '@/services/managed-subscription'
import {
  acknowledgeManagedTraffic,
  createManagedTrafficCounter,
  managedTrafficPayload,
  observeManagedTraffic,
  parseManagedTrafficCounter,
  type ManagedTrafficCounter,
} from '@/services/managed-traffic-counter'
import {
  parseManagedTrafficDiagnostic,
  reduceManagedTrafficDiagnostic,
} from '@/services/managed-traffic-diagnostics'
import {
  createManagedTrafficScheduler,
  ManagedTrafficReportError,
  type ManagedTrafficReportOutcome,
  type ManagedTrafficSchedulerTransition,
} from '@/services/managed-traffic-scheduler'
import {
  createPresenceThrottleState,
  markPresenceAccepted,
  markPresenceRateLimited,
  markPresenceSent,
  PRESENCE_STATE_DEBOUNCE_MS,
  shouldSendPresence,
} from '@/services/presence-throttle'
import {
  createSubscriptionMonitor,
  type SubscriptionMonitor,
} from '@/services/subscription-monitor'
import {
  DOMESTIC_API_DIRECT_RULE,
  pinApiDirect,
  upsertTrafficRule,
  removeTrafficRule,
  saveRuleEdit,
} from '@/services/traffic-rule-editor'
import {
  downloadAndInstallWithFallback,
  cancelAppUpdateDownload,
} from '@/services/update'
import {
  needsSubscriptionRefresh,
  parseAccessRestriction,
  restrictionReason,
  type AccessRestriction,
  type AccessRestrictionReason,
} from '@/utils/access-recovery'
import getSystem from '@/utils/get-system'
import { isAutomaticNode, sortHomeNodes } from '@/utils/home-node-order'
import { homeStatusMessage } from '@/utils/home-status'
import {
  accountExpiryLabel,
  homeWorkspaceVisible,
  isLocalSettingsCommand,
} from '@/utils/local-workspace'
import { prepareSubscriptionContent } from '@/utils/subscription-content'
import { version as desktopBuildVersion } from '@root/package.json'

const CODE_STORAGE_KEY = 'shenxianyun.accessCode'
const CODE_EXPIRES_STORAGE_KEY = 'shenxianyun.accessExpiresAt'
const CODE_UPDATE_VERSION_STORAGE_KEY = 'shenxianyun.updateVersion'
const CODE_REVISION_STORAGE_KEY = 'shenxianyun.subscriptionRevision.v1'
const ACCESS_RESTRICTION_STORAGE_KEY = 'shenxianyun.accessRestriction.v1'
const STARTUP_REFRESH_SESSION_KEY = 'shenxianyun.startupSubscriptionRefresh.v1'
const CLIENT_ID_STORAGE_KEY = 'shenxianyun.clientId'
const PENDING_PRESENCE_STORAGE_KEY = 'shenxianyun.pendingPresence.v1'
const MANAGED_TRAFFIC_STORAGE_KEY = DESKTOP_MANAGED_TRAFFIC_STORAGE_KEY
const MANAGED_TRAFFIC_DIAGNOSTIC_STORAGE_KEY =
  'shenxianyun.managedTrafficStatus.v1'
// 到期占位配置的本地 UID，续费恢复后用它定位并删除占位配置。
const EXPIRED_PROFILE_UID_KEY = 'shenxianyun.expiredProfileUid'
// 「提取码订阅」对应的配置 UID。切码/恢复时只替换这一张，保留用户手动导入/新建的其它配置。
const CODE_PROFILE_UID_KEY = 'shenxianyun.codeProfileUid'
const DELAY_TIMEOUT = 5000
// 服务端以 5 分钟内 last_seen 判断在线。即使漏掉一轮，下一轮仍在在线窗口内。
const HEARTBEAT_INTERVAL_MS = 120_000
const HEARTBEAT_JITTER_MS = 20_000
const MAX_TRAFFIC_REPORT_DELTA = 5 * 1024 * 1024 * 1024
const EXPIRED_NODE_NAME = '提取码到期，请续费使用'
const EXPIRED_PROFILE_NAME = '提取码已到期'

type PendingPresence = {
  id: string
  accessCode: string
  online: boolean
  createdAt: number
}

const queuePendingPresence = (
  accessCode: string,
  online: boolean,
): PendingPresence => {
  const pending = {
    id: crypto.randomUUID?.() || `presence-${Date.now().toString(36)}`,
    accessCode,
    online,
    createdAt: Date.now(),
  }
  try {
    localStorage.setItem(PENDING_PRESENCE_STORAGE_KEY, JSON.stringify(pending))
  } catch {
    // 存储不可用时仍允许本次上报；下一轮心跳会继续尝试。
  }
  return pending
}

const clearPendingPresence = (id: string) => {
  try {
    const raw = localStorage.getItem(PENDING_PRESENCE_STORAGE_KEY)
    if (!raw) return
    const current = JSON.parse(raw) as Partial<PendingPresence>
    // 只清除本次已确认的状态，避免较早的在线请求误删随后写入的离线状态。
    if (current.id === id) localStorage.removeItem(PENDING_PRESENCE_STORAGE_KEY)
  } catch {
    localStorage.removeItem(PENDING_PRESENCE_STORAGE_KEY)
  }
}

const heartbeatDelay = () =>
  HEARTBEAT_INTERVAL_MS + Math.floor(Math.random() * HEARTBEAT_JITTER_MS)

const persistManagedTrafficDiagnostic = (
  transition: ManagedTrafficSchedulerTransition,
) => {
  try {
    const previous = parseManagedTrafficDiagnostic(
      localStorage.getItem(MANAGED_TRAFFIC_DIAGNOSTIC_STORAGE_KEY),
    )
    localStorage.setItem(
      MANAGED_TRAFFIC_DIAGNOSTIC_STORAGE_KEY,
      JSON.stringify(reduceManagedTrafficDiagnostic(previous, transition)),
    )
  } catch {
    // 诊断状态是可选证据；存储不可用时不得影响真实流量上报。
  }
}

const managedTrafficResponseError = (status: number, code?: string) => {
  if (code === 'traffic_limit') {
    return new ManagedTrafficReportError('traffic_limit', status)
  }
  if (status === 401 || status === 403) {
    return new ManagedTrafficReportError('authentication', status)
  }
  if (status === 429) {
    return new ManagedTrafficReportError('rate_limited', status)
  }
  if (status === 503) {
    return new ManagedTrafficReportError('service_unavailable', status)
  }
  if (status >= 400) {
    return new ManagedTrafficReportError('http', status)
  }
  return new ManagedTrafficReportError('server_rejected', status)
}

const formatUsageBytes = (value: number) => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = Math.max(0, Number(value) || 0)
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${unit === 0 ? Math.round(size) : size.toFixed(2)} ${units[unit]}`
}
// 生成一个只含单个本地不可上网节点的占位配置：所有流量指向一个不可达的本地 socks5，
// 客户端因此无法上网，而节点名直接提示用户续费。
const buildExpiredProfileYaml = () =>
  yaml.dump({
    proxies: [
      {
        name: EXPIRED_NODE_NAME,
        type: 'socks5',
        server: '127.0.0.1',
        port: 1,
      },
    ],
    'proxy-groups': [
      {
        name: '节点选择',
        type: 'select',
        proxies: [EXPIRED_NODE_NAME],
      },
    ],
    // 订阅/续费域名走直连（含发现到的所有官方域名），保证续费页可访问、
    // 占位期间仍能探测到续费并自动恢复；其余流量全部走不可达的占位节点（无法上网）。
    rules: [...officialDirectRules(), 'MATCH,节点选择'],
  })
const DESKTOP_VERSION = desktopBuildVersion
const DESKTOP_PLATFORM = getSystem()
const CLIENT_PLATFORM_LABEL = {
  windows: 'Windows电脑',
  macos: 'Mac电脑',
  linux: 'Linux电脑',
  unknown: '桌面电脑',
}[DESKTOP_PLATFORM]
const CLIENT_TYPE = `shenxianyun-${DESKTOP_PLATFORM}`
const CLIENT_UA = `JC116-Shenxianyun-${{ windows: 'Windows', macos: 'macOS', linux: 'Linux', unknown: 'Desktop' }[DESKTOP_PLATFORM]}/${DESKTOP_VERSION}`
const LIGHT_SURFACE_TEXT_COLOR = '#182033'
const fieldSx = {
  '& .MuiInputLabel-root': {
    color: 'rgba(33,43,64,.82)',
  },
  '& .MuiInputLabel-root.Mui-focused': {
    color: '#5f7bf0',
  },
  '& .MuiInputBase-root': {
    color: LIGHT_SURFACE_TEXT_COLOR,
    colorScheme: 'light',
    bgcolor: 'rgba(255,255,255,.6)',
    borderRadius: '12px',
  },
  '& .MuiInputBase-input': {
    color: LIGHT_SURFACE_TEXT_COLOR,
  },
  '& .MuiInputBase-input.Mui-disabled': {
    WebkitTextFillColor: 'rgba(24,32,51,.72)',
  },
  '& .MuiOutlinedInput-notchedOutline': {
    borderColor: 'rgba(45,65,105,.18)',
  },
  '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': {
    borderColor: 'rgba(127,151,244,.6)',
  },
  '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': {
    borderColor: '#5f7bf0',
  },
  '& .MuiSelect-icon': {
    color: 'rgba(24,32,51,.72)',
  },
  '& .MuiSvgIcon-root': {
    color: 'rgba(95,123,240,.9)',
  },
}

const outlineButtonSx = {
  color: '#4356c4',
  borderColor: 'rgba(255,255,255,.75)',
  bgcolor: 'rgba(255,255,255,.45)',
  backdropFilter: 'blur(8px)',
  borderRadius: '12px',
  '&:hover': {
    borderColor: '#7f97f4',
    bgcolor: 'rgba(255,255,255,.65)',
  },
  '&.Mui-disabled': {
    color: 'rgba(36,46,66,.38)',
    borderColor: 'rgba(36,46,66,.16)',
  },
}

// 所有弹窗/选项页共用的玻璃拟态渐变面板，风格与主界面一致
const glassDialogPaperSx = {
  color: LIGHT_SURFACE_TEXT_COLOR,
  colorScheme: 'light',
  borderRadius: '22px',
  border: '1px solid rgba(255,255,255,.6)',
  background:
    'linear-gradient(160deg, rgba(255,255,255,.9) 0%, rgba(233,236,252,.86) 52%, rgba(214,222,250,.84) 100%)',
  backdropFilter: 'blur(26px)',
  boxShadow:
    '0 26px 64px rgba(90,110,220,.3), inset 0 1px 0 rgba(255,255,255,.85)',
  '& .MuiTypography-root': {
    color: LIGHT_SURFACE_TEXT_COLOR,
  },
  '& .MuiToggleButton-root:not(.Mui-selected)': {
    color: '#4356c4',
  },
}

const getClientId = () => {
  const saved = localStorage.getItem(CLIENT_ID_STORAGE_KEY)
  if (saved) return saved
  const generated =
    crypto.randomUUID?.() ||
    `sx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  localStorage.setItem(CLIENT_ID_STORAGE_KEY, generated)
  return generated
}

type VerifyResponse = {
  ok?: boolean
  name?: string
  expires_at?: string
  subscription_url?: string
  update_version?: number
  message?: string
}

type ValidVerifyResponse = VerifyResponse & {
  subscription_url: string
}

type ManagedInstallTransaction = {
  data: ValidVerifyResponse
  activate: () => Promise<void>
  commit: () => Promise<void>
  rollback: () => Promise<void>
}

type UpdateStateResponse = {
  code?: string
  subscription_revision?: string
  ok?: boolean
  update_version?: number
  expires_at?: string | null
  message?: string
}

type ClientAccountState = {
  dayUsed: number
  monthUsed: number
  dayLimit: number
  monthLimit: number
  onlineDevices: number
  onlineLimit: number
  boundDevices: number
  boundLimit: number
  showUsage: boolean
  updatedAt: number
}

type ManagedProfileUpdateResult =
  | 'managed-updated'
  | 'managed-unchanged'
  | 'managed-detached'
  | 'unmanaged'

type ImportTicketResponse = {
  ok?: boolean
  launch_url?: string
  message?: string
}

type ImportExchangeResponse = {
  ok?: boolean
  name?: string
  expires_at?: string
  device_token?: string
  subscription_url?: string
  limit_mode?: string
  message?: string
}

type DesktopVersionResponse = {
  ok?: boolean
  latest_version?: string
  download_url?: string
  windows_url?: string
  macos_url?: string
  linux_deb_url?: string
  linux_rpm_url?: string
  notes?: string
  platform?: string
}

type RuleSnapshot = {
  rules?: unknown
  ruleProviders?: unknown
  subRules?: unknown
}

type TrafficRuleItem = {
  raw: string
  type: string
  value: string
  policy: string
}

const TRAFFIC_RULE_TYPES = [
  { name: 'DOMAIN-SUFFIX', label: '域名后缀', domain: true },
  { name: 'DOMAIN', label: '完整域名', domain: true },
  { name: 'DOMAIN-KEYWORD', label: '域名关键词', domain: true },
  { name: 'IP-CIDR', label: 'IP 段', domain: false },
  { name: 'GEOSITE', label: '网站类别', domain: false },
  { name: 'GEOIP', label: '地区 IP', domain: false },
  { name: 'PROCESS-NAME', label: '进程名', domain: false },
] as const

type SelfCheckStatus = 'pending' | 'ok' | 'warn' | 'fail'
type CodeImportPhase =
  | 'input'
  | 'checking'
  | 'downloading'
  | 'starting'
  | 'success'
  | 'error'
type ServerCheckStatus = 'idle' | 'checking' | 'connected' | 'disconnected'
type SelfCheckItem = {
  key: string
  label: string
  status: SelfCheckStatus
  detail: string
  fixLabel?: string
  fix?: () => Promise<void>
  fixing?: boolean
}

// 抗污染默认 DNS（与官方 clash verge 默认一致）：fake-ip + 可信 DoH，
// 解决「直连域名被 DNS 污染导致证书/打不开」的问题。单页版开启 DNS 覆写时写入。
const DEFAULT_DNS_CONFIG = {
  enable: true,
  listen: ':53',
  'enhanced-mode': 'fake-ip',
  'fake-ip-range': '198.18.0.1/16',
  'fake-ip-filter-mode': 'blacklist',
  'prefer-h3': false,
  'respect-rules': false,
  'use-hosts': false,
  'use-system-hosts': false,
  ipv6: true,
  // blacklist 模式：命中者「不」走 fake-ip，拿真实 IP。
  // 关键：geosite:cn 让所有国内域名拿真实 IP，否则系统代理下国内直连域名
  // 会被解析成无效 fake-ip(198.18.x.x) 而打不开。
  'fake-ip-filter': [
    'geosite:cn',
    'geosite:private',
    '*.lan',
    '*.local',
    '*.arpa',
    'time.*.com',
    'ntp.*.com',
    '+.market.xiaomi.com',
    'localhost.ptlogin2.qq.com',
    '*.msftncsi.com',
    'www.msftconnecttest.com',
    DOMESTIC_API_HOST,
  ],
  'default-nameserver': ['system', '223.6.6.6', '8.8.8.8'],
  nameserver: ['https://doh.pub/dns-query', 'https://dns.alidns.com/dns-query'],
  fallback: [],
  'proxy-server-nameserver': [
    'https://doh.pub/dns-query',
    'https://dns.alidns.com/dns-query',
    'tls://223.5.5.5',
  ],
  'fallback-filter': {
    geoip: true,
    'geoip-code': 'CN',
    ipcidr: ['240.0.0.0/4', '0.0.0.0/32'],
    domain: ['+.google.com', '+.facebook.com', '+.youtube.com'],
  },
}

class AccessCodeStateError extends Error {
  constructor(
    message: string,
    readonly serverRejected = false,
    readonly stateCode?: string,
    readonly httpStatus?: number,
  ) {
    super(message)
  }
}

class ManagedInstallError extends Error {
  constructor(message: string) {
    super(message)
  }
}

const parseExpireTime = (value: string) => {
  if (!value) return Number.POSITIVE_INFINITY
  const time = Date.parse(value.replace(' ', 'T'))
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time
}

// 从订阅 URL 提取神仙云提取码：仅当域名是 52nm 官网域名或明确的 IP 入口
// 且路径是 /sub/<code> 时才认。用于把"一键导入的官网订阅"识别为提取码订阅、
// 受有效期管理;其它网站的 Clash 配置不匹配 → 不受限制,自由使用。
const extractCodeFromProfileUrl = (url: string): string => {
  if (!url) return ''
  try {
    const u = new URL(url)
    const host = u.hostname
    const isOfficial =
      isOfficialHostname(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host)
    if (!isOfficial) return ''
    const m = u.pathname.match(/\/sub\/([^/]+)/)
    return m ? decodeURIComponent(m[1]) : ''
  } catch {
    return ''
  }
}

const compareVersion = (remote: string, current: string) => {
  const parse = (value: string) =>
    value
      .replace(/^v/i, '')
      .split(/[.+-]/)[0]
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0)

  const left = parse(remote)
  const right = parse(current)
  const max = Math.max(left.length, right.length, 3)

  for (let index = 0; index < max; index += 1) {
    const a = left[index] || 0
    const b = right[index] || 0
    if (a > b) return 1
    if (a < b) return -1
  }
  return 0
}

const readRuleSnapshot = async (
  profileUid?: string,
): Promise<RuleSnapshot | null> => {
  if (!profileUid) return null

  try {
    const content = await readProfileFile(profileUid)
    const data = yaml.load(content) as Record<string, unknown> | null
    if (!data || typeof data !== 'object') return null

    const snapshot: RuleSnapshot = {}
    if (Array.isArray(data.rules)) snapshot.rules = data.rules
    if (data['rule-providers'] && typeof data['rule-providers'] === 'object') {
      snapshot.ruleProviders = data['rule-providers']
    }
    if (data['sub-rules'] && typeof data['sub-rules'] === 'object') {
      snapshot.subRules = data['sub-rules']
    }

    return Object.keys(snapshot).length > 0 ? snapshot : null
  } catch {
    return null
  }
}

const restoreRuleSnapshot = async (
  profileUid: string | undefined,
  snapshot: RuleSnapshot | null,
  options?: { suppressValidationNotice?: boolean },
) => {
  if (!profileUid || !snapshot) return

  const content = await readProfileFile(profileUid)
  const data = yaml.load(content) as Record<string, unknown> | null
  if (!data || typeof data !== 'object') return

  if (snapshot.rules !== undefined) data.rules = snapshot.rules
  if (snapshot.ruleProviders !== undefined) {
    data['rule-providers'] = snapshot.ruleProviders
  }
  if (snapshot.subRules !== undefined) data['sub-rules'] = snapshot.subRules

  const saved = await saveProfileFile(
    profileUid,
    yaml.dump(data, { lineWidth: -1 }),
    options,
  )
  if (!saved) throw new Error('规则恢复后的配置验证失败')
}

const isDomesticApiUrl = (url: string): boolean => {
  try {
    return new URL(url).hostname === DOMESTIC_API_HOST
  } catch {
    return false
  }
}

// 国内 API 始终放在全局规则最前面，避免系统代理开启后又绕进代理节点。
const ensureDomesticApiDirect = async () => {
  const content = await withRequestDeadline(
    () => readProfileFile('Merge'),
    5000,
  )
  const data = (yaml.load(content) as Record<string, unknown> | null) || {}
  const prepend = Array.isArray(data['prepend-rules'])
    ? (data['prepend-rules'] as unknown[])
    : []
  if (
    prepend[0] === DOMESTIC_API_DIRECT_RULE &&
    prepend.filter((rule) => rule === DOMESTIC_API_DIRECT_RULE).length === 1
  )
    return
  if (
    !(await saveProfileFile(
      'Merge',
      yaml.dump(pinApiDirect(data), { lineWidth: -1 }),
    ))
  ) {
    throw new Error('国内 API 直连规则验证失败')
  }
  // saveProfileFile already validates and applies runtime-affecting files.
}

const normalizeRuleDomain = (input: string) => {
  const value = input.trim()
  if (!value) return ''

  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    return url.hostname.replace(/^\*\./, '').toLowerCase()
  } catch {
    return value
      .replace(/^\w+:\/\//, '')
      .split('/')[0]
      .split(':')[0]
      .replace(/^\*\./, '')
      .toLowerCase()
  }
}

const parseTrafficRule = (rule: unknown): TrafficRuleItem | null => {
  if (typeof rule !== 'string') return null
  const parts = rule.split(',').map((part) => part.trim())
  if (parts.length < 3) return null
  if (!TRAFFIC_RULE_TYPES.some((t) => t.name === parts[0])) {
    return null
  }
  return {
    raw: rule,
    type: parts[0],
    value: parts[1],
    policy: parts[2],
  }
}

const pickPrimaryGroup = (groups: IProxyGroupItem[] = []) => {
  const manualGroups = groups.filter((group) => {
    const type = String(group.type || '').toLowerCase()
    return type === 'selector' || type === 'select'
  })
  const fallbackGroups = groups.filter((group) => {
    const type = String(group.type || '').toLowerCase()
    return type === 'urltest' || type === 'url-test' || type === 'fallback'
  })
  const selectable = manualGroups.length ? manualGroups : fallbackGroups

  return (
    selectable.find((group) =>
      ['节点', '选择', 'select', 'proxy'].some((keyword) =>
        group.name.toLowerCase().includes(keyword.toLowerCase()),
      ),
    ) ||
    selectable.find((group) =>
      group.all?.some((proxy) => !['DIRECT', 'REJECT'].includes(proxy.name)),
    ) ||
    manualGroups[0] ||
    fallbackGroups[0] ||
    groups[0]
  )
}

const getNodeDelay = (proxy: IProxyItem, groupName = '') => {
  const testedDelay = groupName
    ? delayManager.getDelayFix(proxy, groupName)
    : -1
  if (testedDelay >= 0) return testedDelay
  return proxy.history?.slice(-1)[0]?.delay ?? -1
}

const delayRank = (proxy: IProxyItem, groupName = '') => {
  const delay = getNodeDelay(proxy, groupName)
  if (delay > 0 && delay < DELAY_TIMEOUT) return delay
  if (delay === 0 || delay >= DELAY_TIMEOUT) return DELAY_TIMEOUT + 1
  return Number.MAX_SAFE_INTEGER
}

const HomePage = () => {
  const { verge, patchVerge, mutateVerge } = useVerge()
  const { response: connectionResponse } = useConnectionData()
  const { clash, patchClash } = useClash()
  const { profiles, current, mutateProfiles } = useProfiles()
  const { proxies, clashConfig, refreshAll, refreshClashConfig, refreshProxy } =
    useAppData()
  const {
    indicator: systemProxyOn,
    configState: systemProxyConfigOn,
    toggleSystemProxy,
    invalidateProxyState,
  } = useSystemProxyState()
  const {
    isTunModeAvailable,
    isServiceOk,
    isAdminMode,
    runningMode,
    mutateSystemState,
  } = useSystemState()
  const { changeProxy } = useProxySelection({
    onSuccess: () => {
      setStatus('节点已切换')
      refreshProxy().catch(() => {})
    },
    onError: () => setStatus('节点切换失败'),
  })

  const [code, setCode] = useState('')
  const [runtimeBrand, setRuntimeBrand] = useState(() => getRuntimeBrand())

  useEffect(() => {
    document.title = runtimeBrand.client_name
    getCurrentWindow()
      .setTitle(runtimeBrand.client_name)
      .catch(() => undefined)
  }, [runtimeBrand])
  const [savedCode, setSavedCode] = useState(
    () => localStorage.getItem(CODE_STORAGE_KEY) || '',
  )
  const [codeProfileUid, setCodeProfileUid] = useState(
    () => localStorage.getItem(CODE_PROFILE_UID_KEY) || '',
  )
  const [expiredProfileUid, setExpiredProfileUid] = useState(
    () => localStorage.getItem(EXPIRED_PROFILE_UID_KEY) || '',
  )
  const [expiresAt, setExpiresAt] = useState(
    () => localStorage.getItem(CODE_EXPIRES_STORAGE_KEY) || '',
  )
  const [accessRestriction, setAccessRestriction] = useState(() =>
    parseAccessRestriction(
      localStorage.getItem(ACCESS_RESTRICTION_STORAGE_KEY),
      savedCode,
    ),
  )
  const restrictionRef = useRef<AccessRestriction | null>(accessRestriction)
  const subscriptionMonitorRef = useRef<SubscriptionMonitor | null>(null)
  const subscriptionCheckRef = useRef<
    ((signal: AbortSignal) => Promise<void>) | null
  >(null)
  const backgroundBusyRef = useRef(false)
  const [status, setStatus] = useState(
    savedCode ? '提取码已保存，会自动检查订阅更新。' : '',
  )
  const [clientAccountState, setClientAccountState] =
    useState<ClientAccountState | null>(null)
  const [codeDialogOpen, setCodeDialogOpen] = useState(false)
  const codeEntryActiveRef = useRef(false)
  useEffect(() => {
    codeEntryActiveRef.current = codeDialogOpen
  }, [codeDialogOpen])
  const [codeImportPhase, setCodeImportPhase] =
    useState<CodeImportPhase>('input')
  const [codeImportMessage, setCodeImportMessage] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [localWorkspace, setLocalWorkspace] = useState(false)
  const portViewerRef = useRef<DialogRef>(null)
  const controllerViewerRef = useRef<DialogRef>(null)
  const webUIViewerRef = useRef<DialogRef>(null)
  const websiteTestViewerRef = useRef<DialogRef>(null)
  const tunnelsViewerRef = useRef<DialogRef>(null)
  const [serverCheckStatus, setServerCheckStatus] =
    useState<ServerCheckStatus>('idle')
  const [trafficRuleOpen, setTrafficRuleOpen] = useState(false)
  const [trafficRuleInput, setTrafficRuleInput] = useState('')
  const [trafficRuleType, setTrafficRuleType] = useState('DOMAIN-SUFFIX')
  const [trafficRulePolicy, setTrafficRulePolicy] = useState('')
  const [trafficRules, setTrafficRules] = useState<TrafficRuleItem[]>([])
  const [selfCheckOpen, setSelfCheckOpen] = useState(false)
  const [selfChecking, setSelfChecking] = useState(false)
  const [selfCheckItems, setSelfCheckItems] = useState<SelfCheckItem[]>([])
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetRebuildConfig, setResetRebuildConfig] = useState(true)
  const [resetRepairService, setResetRepairService] = useState(false)
  const [resetCreateBackup, setResetCreateBackup] = useState(true)
  // 到期提示弹窗
  const [expiredDialogOpen, setExpiredDialogOpen] = useState(false)
  // 手动配置管理（应对 web 断网无法导入订阅时，自行切换/导入/编辑本地配置）
  const [profileManagerOpen, setProfileManagerOpen] = useState(false)
  const [manualImportUrl, setManualImportUrl] = useState('')
  const [manualBusy, setManualBusy] = useState(false)
  const [editorState, setEditorState] = useState<{
    uid: string
    name: string
    value: string
  } | null>(null)
  // 订阅更新在途互斥：防止慢请求/掉线恢复时积累并发请求打满服务器。
  const updateInFlightRef = useRef(false)
  const autoRefreshControllerRef = useRef<AbortController | null>(null)
  const refreshApplyInFlightRef = useRef(false)
  useEffect(() => () => autoRefreshControllerRef.current?.abort(), [])
  const [desktopUpdate, setDesktopUpdate] =
    useState<DesktopVersionResponse | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    backgroundBusyRef.current = busy || manualBusy
  }, [busy, manualBusy])
  const [modeOverride, setModeOverride] = useState('')
  const [updating, setUpdating] = useState(false)
  const [updateInstalling, setUpdateInstalling] = useState(false)
  const [updPercent, setUpdPercent] = useState(0)
  const { updateInfo } = useUpdate(true)
  const isMacOS = getSystem() === 'macos'
  const doUpdate = useLockFn(async () => {
    if (!updateInfo?.available || updating) return
    // Match Settings: download the NAS DMG for this CPU, then install manually.
    if (isMacOS) {
      await openWebUrl(
        `https://github.com/${DOMAIN_PROFILE.githubRepository}/releases/latest`,
      ).catch(() => undefined)
      return
    }
    if (busy || manualBusy || refreshApplyInFlightRef.current) {
      setStatus('正在完成配置操作，请稍后更新软件')
      return
    }
    autoRefreshControllerRef.current?.abort()
    backgroundBusyRef.current = true
    setBusy(true)
    setUpdating(true)
    setUpdateInstalling(false)
    setUpdPercent(0)
    setStatus('正在下载更新...')
    let total = 0
    let downloaded = 0
    try {
      await downloadAndInstallWithFallback(updateInfo, (event) => {
        if (event.phase === 'checking') {
          setStatus(
            event.source === 'dufs'
              ? '正在检查更新源...'
              : '正在检查备用更新源...',
          )
        } else if (event.phase === 'fallback') {
          total = 0
          downloaded = 0
          setUpdPercent(0)
          setStatus('Dufs 暂不可用，正在切换 GitHub 备用源...')
        } else if (event.phase === 'progress') {
          total = event.contentLength ?? total
          downloaded += event.chunkLength ?? 0
          setStatus(
            `正在下载更新，已接收 ${Math.round(downloaded / 1024)} KB...`,
          )
          if (total > 0) {
            setUpdPercent(Math.min(99, Math.round((downloaded / total) * 100)))
          }
        } else if (event.phase === 'verified') {
          setUpdPercent(100)
        } else if (event.phase === 'stopping') {
          setUpdateInstalling(true)
          setStatus('更新包校验通过，正在停止连接以安装...')
        } else if (event.phase === 'installing') {
          setUpdateInstalling(true)
          setStatus('更新包校验通过，正在安装...')
        }
      })
      setStatus('更新完成，正在重启...')
      await relaunch()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setUpdating(false)
      setBusy(false)
      void refreshAll().catch(() => undefined)
    }
  })
  const cancelUpdateDownload = useLockFn(async () => {
    const state = await cancelAppUpdateDownload()
    if (state === 'cancelled') setStatus('正在取消更新下载...')
    else if (state === 'installing')
      setStatus('正在准备安装，暂不能取消，请等待安装器启动')
    else setStatus('更新任务已结束，可重新尝试')
  })
  const [delayTesting, setDelayTesting] = useState(false)
  const [delaySortTick, setDelaySortTick] = useState(0)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const trafficTotalsRef = useRef({ upload: 0, download: 0 })
  const proxyTrafficReadyRef = useRef(false)
  const lastReportedTrafficRef = useRef({ upload: 0, download: 0 })
  const trafficReportRetryAfterRef = useRef(0)
  const trafficCounterRef = useRef<ManagedTrafficCounter | null>(null)
  const trafficSchedulerRef = useRef<ReturnType<
    typeof createManagedTrafficScheduler
  > | null>(null)
  const pendingManagedTrafficRef = useRef<
    ReturnType<typeof managedTrafficPayload> | undefined
  >(undefined)
  const sendClientPresenceRef = useRef<
    ((online: boolean) => Promise<void>) | null
  >(null)
  const reportClientTrafficRef = useRef<
    ((signal: AbortSignal) => Promise<ManagedTrafficReportOutcome>) | null
  >(null)
  const managedAuthRef = useRef<ManagedAuth | null>(null)
  // presence 上报的节流状态，逻辑见 services/presence-throttle。
  const presenceThrottleRef = useRef(createPresenceThrottleState())
  // 服务端升级建议本次启动是否已提示过。
  const upgradeHintShownRef = useRef(false)

  const [managedAuthReady, setManagedAuthReady] = useState(false)
  const startupRefreshCompletedRef = useRef(false)
  const previousRunningRef = useRef(false)
  const [connectionReady, setConnectionReady] = useState(false)
  const proxyUrlRef = useRef('')
  const legacyMigrationRef = useRef('')

  const mode = (modeOverride || clashConfig?.mode || 'rule').toLowerCase()
  const ruleGroup = useMemo(
    () => pickPrimaryGroup((proxies?.groups || []) as IProxyGroupItem[]),
    [proxies?.groups],
  )
  const nodeGroup =
    mode === 'global' && proxies?.global?.all?.length
      ? (proxies.global as IProxyGroupItem)
      : ruleGroup
  const nodes = useMemo(() => {
    void delaySortTick
    return sortHomeNodes(
      (nodeGroup?.all || []).filter(
        (proxy) => !['DIRECT', 'REJECT'].includes(proxy.name),
      ),
      (node) => delayRank(node, nodeGroup?.name),
    )
  }, [nodeGroup, delaySortTick])

  const selectedNode = useMemo(() => {
    if (!nodeGroup) return ''
    const current = nodeGroup.now || ''
    if (current && nodes.some((node) => node.name === current)) return current
    return nodes[0]?.name || ''
  }, [nodes, nodeGroup])
  const tunOn = verge?.enable_tun_mode || false
  const proxyStateMismatch = systemProxyConfigOn && !systemProxyOn
  const running = tunOn || systemProxyOn
  useEffect(() => {
    if (!running) {
      // eslint-disable-next-line @eslint-react/set-state-in-effect -- clear a completed async controller check when OS connectivity changes.
      setConnectionReady(false)
      return
    }
    let disposed = false
    let confirmed = 0
    let checking = false
    const check = async () => {
      if (disposed || checking) return
      checking = true
      const ready = await withRequestDeadline(
        () => Promise.all([getVersion(), getBaseConfig()]),
        2500,
      )
        .then(
          ([version, active]) =>
            Boolean(version?.version) &&
            (systemProxyOn || (tunOn && active?.tun?.enable)),
        )
        .catch(() => false)
      checking = false
      confirmed = ready ? confirmed + 1 : 0
      if (!disposed) setConnectionReady(confirmed >= 2)
    }
    void check()
    const timer = window.setInterval(check, 3000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [running, systemProxyOn, tunOn])
  const showConnectionOptions = homeWorkspaceVisible(
    localWorkspace,
    running,
    connectionReady,
  )
  // presence 上报只跟随「稳定后」的 running。UI 仍用 running 即时反馈，
  // 但网络副作用必须等状态真正定下来，避免刷新/重试期间的瞬时翻转
  // 被当成一次真实的启停，向服务端多发一对 offline+heartbeat。
  // eslint-disable-next-line @eslint-react/no-unused-state -- 仅供 presence/流量上报的生命周期 effect 使用，UI 一律用即时的 running。
  const [stableRunning, setStableRunning] = useState(running)
  useEffect(() => {
    if (running === stableRunning) return
    const timer = window.setTimeout(
      () => setStableRunning(running),
      PRESENCE_STATE_DEBOUNCE_MS,
    )
    return () => window.clearTimeout(timer)
  }, [running, stableRunning])
  const systemProxyChip: {
    label: string
    color: 'success' | 'warning' | 'default'
    variant: 'filled' | 'outlined'
  } = tunOn
    ? { label: 'TUN 已开', color: 'success', variant: 'filled' }
    : systemProxyOn
      ? { label: '系统代理已开', color: 'success', variant: 'filled' }
      : proxyStateMismatch
        ? { label: '系统代理异常', color: 'warning', variant: 'filled' }
        : { label: '系统代理关闭', color: 'default', variant: 'outlined' }
  const currentCode =
    savedCode &&
    current?.uid &&
    (current.uid === codeProfileUid || current.uid === expiredProfileUid)
      ? savedCode
      : ''
  const activeCodeRef = useRef(currentCode)
  useEffect(() => {
    activeCodeRef.current = currentCode
  }, [currentCode])
  const isSwitchingCode = Boolean(
    savedCode && code.trim() && code.trim() !== savedCode,
  )
  const codeExpired = Boolean(expiresAt && nowMs > parseExpireTime(expiresAt))
  const activeRestriction =
    accessRestriction?.accessCode === currentCode ? accessRestriction : null
  const showRenewal = Boolean(
    currentCode &&
      (codeExpired ||
        activeRestriction?.reason === 'expired' ||
        activeRestriction?.reason === 'traffic_limit'),
  )
  const recordAccessRestriction = useCallback(
    (value: string, reason: AccessRestrictionReason) => {
      const next = { accessCode: value, reason }
      localStorage.setItem(ACCESS_RESTRICTION_STORAGE_KEY, JSON.stringify(next))
      restrictionRef.current = next
      setAccessRestriction(next)
    },
    [],
  )
  const clearAccessRestriction = useCallback((value: string) => {
    if (restrictionRef.current?.accessCode !== value) return
    localStorage.removeItem(ACCESS_RESTRICTION_STORAGE_KEY)
    restrictionRef.current = null
    setAccessRestriction(null)
  }, [])
  const openRenewal = useCallback(
    () =>
      openWebUrl(
        `${managedAuthRef.current?.apiBase || getApiBase()}/pay?action=renew&code=${encodeURIComponent(currentCode || savedCode)}`,
      ),
    [currentCode, savedCode],
  )
  const allowLanOn = clash?.['allow-lan'] ?? false
  const externalControllerOn = verge?.enable_external_controller ?? false
  const dnsOverwriteOn = verge?.enable_dns_settings ?? false
  const proxyGuardOn = verge?.enable_proxy_guard ?? true
  const importantStatus = homeStatusMessage(status)
  const nodeSelectLabel = mode === 'global' ? '选择全局节点' : '选择节点'
  const codeDialogTitle =
    codeImportPhase === 'checking'
      ? '正在检查提取码'
      : codeImportPhase === 'downloading'
        ? '正在获取订阅'
        : codeImportPhase === 'starting'
          ? '正在检查网络'
          : codeImportPhase === 'success'
            ? '连接成功'
            : codeImportPhase === 'error'
              ? '连接未完成'
              : savedCode
                ? '切换提取码'
                : '导入订阅'
  const codeImportStep =
    codeImportPhase === 'checking'
      ? 0
      : codeImportPhase === 'downloading'
        ? 1
        : codeImportPhase === 'starting'
          ? 2
          : codeImportPhase === 'success'
            ? 3
            : -1
  // 统一写入全局 Merge 配置（UID 固定为 "Merge"，系统保证存在），对所有订阅生效，
  // 不再依赖订阅自带的 option.rules（神仙云订阅通常没有，会导致无法编辑）。
  const rulesProfileUid = 'Merge'
  const rulePolicies = useMemo(() => {
    const values = [
      nodeGroup?.name,
      selectedNode,
      ...nodes.map((node) => node.name),
      'DIRECT',
      'REJECT',
    ].filter((value): value is string => Boolean(value))
    return Array.from(new Set(values))
  }, [nodeGroup?.name, nodes, selectedNode])
  // 统一的 API 请求兜底链：直连 → 内核端口/系统代理 → 后台配置的兜底代理。
  // 逐层重试，解决 OpenClash/fake-ip 误路由、首装用户连不上 web 验证提取码的问题。
  const apiFetch = useCallback(
    async (
      url: string,
      init: Parameters<typeof tauriFetch>[1],
    ): ReturnType<typeof tauriFetch> =>
      withRequestDeadline(
        async (signal) => {
          const guarded = { ...init, signal }
          const fetchPath = (options: Parameters<typeof tauriFetch>[1]) =>
            fetchBufferedWithDeadline(fetchWithVerifiedTls, url, options)
          try {
            return await fetchPath(guarded)
          } catch (err) {
            if (signal.aborted) throw err
            // 国内主域名必须直连；失败后由上层自动换线路，不允许绕代理重试。
            if (isDomesticApiUrl(url)) throw err
            // 第 2 层：内核混合端口（在跑时）或系统代理
            const p = proxyUrlRef.current
            if (p) {
              try {
                return await fetchPath({
                  ...guarded,
                  proxy: { all: p },
                })
              } catch (proxyError) {
                if (signal.aborted) throw proxyError
                // 落到第 3 层
              }
            }
            // 第 3 层：后台下发的兜底代理（bootstrap_proxy），最后一条路
            const boot = getBootstrapProxy()
            if (boot && boot !== p) {
              return await fetchPath({
                ...guarded,
                proxy: { all: boot },
              })
            }
            throw err
          }
        },
        20_000,
        init?.signal,
      ),
    [],
  )

  const persistManagedAuth = useCallback(async (auth: ManagedAuth | null) => {
    if (auth) {
      await saveManagedAuth(auth)
    } else {
      await clearManagedAuth()
    }
    managedAuthRef.current = auth
  }, [])

  const syncExpiresAt = useCallback(
    async (value: string | null | undefined) => {
      // undefined 表示旧服务端没有返回这个兼容字段；null/空串表示永久有效。
      if (value === undefined) return false
      const nextExpiresAt = typeof value === 'string' ? value.trim() : ''
      if (nextExpiresAt === expiresAt) return false

      localStorage.setItem(CODE_EXPIRES_STORAGE_KEY, nextExpiresAt)
      setExpiresAt(nextExpiresAt)
      const auth = managedAuthRef.current
      if (auth && auth.expiresAt !== nextExpiresAt) {
        await persistManagedAuth({ ...auth, expiresAt: nextExpiresAt })
      }
      return true
    },
    [expiresAt, persistManagedAuth],
  )

  const requestImportTicket = useCallback(
    async (input: string, apiBase = getApiBase()) => {
      const response = await apiFetch(`${apiBase}/api/import/ticket`, {
        method: 'POST',
        connectTimeout: 8000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': CLIENT_UA,
          'X-Client-Id': getClientId(),
          'X-Client-Type': CLIENT_TYPE,
        },
        body: JSON.stringify({ code: input, target: 'shenxianyun' }),
      })
      const data = (await response.json()) as ImportTicketResponse
      const ticket = extractTicketFromLaunchUrl(data.launch_url || '')
      if (!response.ok || !data.ok || !ticket) {
        throw new AccessCodeStateError(
          data.message || '无法创建安全导入票据',
          response.status === 403,
        )
      }
      return ticket
    },
    [apiFetch],
  )

  const exchangeImportTicket = useCallback(
    async (request: ManagedImportRequest) => {
      const deviceKey = await getStableDeviceKey().catch(() => null)
      const response = await apiFetch(
        `${request.apiBase}/api/import/exchange`,
        {
          method: 'POST',
          connectTimeout: 8000,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': CLIENT_UA,
            'X-Client-Id': getClientId(),
            'X-Client-Type': CLIENT_TYPE,
          },
          body: JSON.stringify({
            ticket: request.ticket,
            client_id: getClientId(),
            device_key: deviceKey || getClientId(),
            platform: DESKTOP_PLATFORM,
          }),
        },
      )
      const data = (await response.json()) as ImportExchangeResponse
      if (
        !response.ok ||
        !data.ok ||
        !data.device_token ||
        !data.subscription_url
      ) {
        throw new AccessCodeStateError(
          data.message || '安全导入票据无效或已过期',
          response.status === 403 || response.status === 410,
        )
      }
      return data as Required<
        Pick<
          ImportExchangeResponse,
          'device_token' | 'subscription_url' | 'expires_at' | 'limit_mode'
        >
      > &
        ImportExchangeResponse
    },
    [apiFetch],
  )

  const fetchManagedSubscription = useCallback(
    async (
      auth: Pick<ManagedAuth, 'subscriptionUrl' | 'deviceToken'>,
      signal?: AbortSignal,
    ) => {
      const response = await apiFetch(auth.subscriptionUrl, {
        method: 'GET',
        connectTimeout: 12000,
        signal,
        headers: {
          Authorization: `Bearer ${auth.deviceToken}`,
          'User-Agent': CLIENT_UA,
          'X-Client-Id': getClientId(),
          'X-Client-Type': CLIENT_TYPE,
        },
      })
      if (!response.ok) {
        const message = await response.text().catch(() => '')
        throw new AccessCodeStateError(
          message || '受管订阅获取失败，请重新导入提取码',
          response.status === 401 || response.status === 403,
          undefined,
          response.status,
        )
      }
      const content = await response.text()
      if (!content.trim()) throw new Error('受管订阅内容为空')
      return content
    },
    [apiFetch],
  )

  const installManagedSubscription = useCallback(
    async (
      input: string,
      exchange: Awaited<ReturnType<typeof exchangeImportTicket>>,
      apiBase: string,
    ): Promise<ManagedInstallTransaction> => {
      const content = await fetchManagedSubscription({
        subscriptionUrl: exchange.subscription_url,
        deviceToken: exchange.device_token,
      })
      const previousProfiles = await getProfiles()
      const previousProfileIds = new Set(
        (previousProfiles.items || [])
          .map((item) => item.uid)
          .filter((uid): uid is string => Boolean(uid)),
      )
      const previousCurrentUid = previousProfiles.current || ''
      const prevCodeProfileUid =
        localStorage.getItem(CODE_PROFILE_UID_KEY) || ''
      const previousAuth =
        managedAuthRef.current ?? (await loadManagedAuth().catch(() => null))
      const previousSavedCode = savedCode
      const previousExpiresAt = expiresAt
      const storageKeys = [
        CODE_PROFILE_UID_KEY,
        CODE_STORAGE_KEY,
        CODE_EXPIRES_STORAGE_KEY,
        CODE_UPDATE_VERSION_STORAGE_KEY,
      ]
      const previousStorage = new Map(
        storageKeys.map((key) => [key, localStorage.getItem(key)]),
      )
      let newestUid = ''
      let activated = false
      let settled = false

      const restoreStorage = () => {
        for (const [key, value] of previousStorage) {
          if (value === null) localStorage.removeItem(key)
          else localStorage.setItem(key, value)
        }
      }

      const restorePrevious = async () => {
        let restoreError: unknown
        if (previousCurrentUid) {
          try {
            const restored = await patchProfilesConfig({
              current: previousCurrentUid,
            })
            if (!restored) throw new Error('旧订阅运行时配置恢复失败')
          } catch (error) {
            restoreError = error
          }
        }
        if (newestUid && (!previousCurrentUid || !restoreError)) {
          try {
            await deleteProfile(newestUid)
          } catch (error) {
            restoreError ??= error
          }
        }
        try {
          await persistManagedAuth(previousAuth)
        } catch (error) {
          restoreError ??= error
        }
        restoreStorage()
        setSavedCode(previousSavedCode)
        setExpiresAt(previousExpiresAt)
        setCodeProfileUid(previousStorage.get(CODE_PROFILE_UID_KEY) || '')
        await mutateProfiles()
        await refreshAll().catch(() => undefined)
        if (restoreError) {
          throw new Error(
            `旧订阅自动恢复未完成：${
              restoreError instanceof Error
                ? restoreError.message
                : String(restoreError)
            }`,
          )
        }
      }

      try {
        await createProfile(
          {
            type: 'local',
            name: managedProfileName(getRuntimeBrand().client_name),
            desc: '受保护的提取码订阅；地址仅由客户端安全保存',
            url: '',
            option: {
              with_proxy: false,
              self_proxy: false,
              allow_auto_update: false,
            },
          } as IProfileItem,
          content,
        )
        const list = await getProfiles()
        const newest = (list.items || [])
          .filter((item) => item.uid && !previousProfileIds.has(item.uid))
          .slice(-1)[0]
        if (!newest?.uid) throw new Error('无法定位新导入的订阅')
        newestUid = newest.uid

        const auth: ManagedAuth = {
          accessCode: input,
          profileUid: newestUid,
          apiBase,
          subscriptionUrl: exchange.subscription_url,
          deviceToken: exchange.device_token,
          expiresAt: exchange.expires_at || '',
          limitMode: exchange.limit_mode || 'hybrid',
          contentHash: await hashManagedContent(content),
          detached: false,
          updateVersion: 0,
        }
        await mutateProfiles()

        const activate = async () => {
          if (activated) return
          const switched = await patchProfilesConfig({ current: newestUid })
          if (!switched) {
            throw new Error('新订阅配置验证失败，已保留原订阅')
          }
          activated = true
          await mutateProfiles()
        }

        return {
          data: {
            expires_at: exchange.expires_at || '',
            update_version: auth.updateVersion,
            subscription_url: '',
          },
          activate,
          commit: async () => {
            if (settled) return
            await activate()
            await persistManagedAuth(auth)
            localStorage.setItem(CODE_PROFILE_UID_KEY, newestUid)
            localStorage.setItem(CODE_STORAGE_KEY, input)
            localStorage.setItem(
              CODE_EXPIRES_STORAGE_KEY,
              exchange.expires_at || '',
            )
            localStorage.setItem(
              CODE_UPDATE_VERSION_STORAGE_KEY,
              String(auth.updateVersion),
            )
            await ensureDomesticApiDirect().catch(() => undefined)
            setSavedCode(input)
            setExpiresAt(exchange.expires_at || '')
            setCodeProfileUid(newestUid)
            await mutateProfiles()
            await refreshAll()
            settled = true
            if (prevCodeProfileUid && prevCodeProfileUid !== newestUid) {
              await deleteProfile(prevCodeProfileUid).catch(() => undefined)
              await mutateProfiles().catch(() => undefined)
              await refreshAll().catch(() => undefined)
            }
          },
          rollback: async () => {
            if (settled) return
            await restorePrevious()
            settled = true
          },
        }
      } catch (error) {
        let rollbackError: unknown
        try {
          await restorePrevious()
        } catch (restoreError) {
          rollbackError = restoreError
        }
        const message = error instanceof Error ? error.message : String(error)
        throw new ManagedInstallError(
          rollbackError
            ? `${message}；${
                rollbackError instanceof Error
                  ? rollbackError.message
                  : String(rollbackError)
              }`
            : message,
        )
      }
    },
    [
      expiresAt,
      fetchManagedSubscription,
      mutateProfiles,
      persistManagedAuth,
      refreshAll,
      savedCode,
    ],
  )

  useEffect(() => {
    loadManagedAuth()
      .then((auth) => {
        if (managedAuthRef.current === null) {
          managedAuthRef.current = auth
        }
        if (!auth) return
        void (async () => {
          const profileName = managedProfileName(getRuntimeBrand().client_name)
          const list = await getProfiles()
          const profile = list.items?.find(
            (item) => item.uid === auth.profileUid,
          )
          if (!profile || profile.name === profileName) return
          await patchProfile(auth.profileUid, { name: profileName })
          await mutateProfiles()
        })().catch(() => {
          setStatus('官方订阅名称安全迁移未完成，请重启后重试')
        })
      })
      .catch(() => {
        if (managedAuthRef.current === null) {
          setStatus('受管订阅凭据不可用，请重新导入提取码')
        }
      })
      .finally(() => setManagedAuthReady(true))
  }, [mutateProfiles])

  const verifyCode = useCallback(
    async (input: string, countImport = true): Promise<ValidVerifyResponse> => {
      const params = new URLSearchParams({
        client_id: getClientId(),
      })
      if (countImport) params.set('import', '1')
      const response = await apiFetch(
        `${getApiBase()}/api/verify/${encodeURIComponent(input)}?${params.toString()}`,
        {
          method: 'GET',
          connectTimeout: 8000,
          headers: {
            'User-Agent': CLIENT_UA,
            'X-Client-Id': getClientId(),
            'X-Client-Type': CLIENT_TYPE,
          },
        },
      )
      const data = (await response.json()) as VerifyResponse
      if (!response.ok || !data.ok || !data.subscription_url) {
        throw new Error(data.message || '提取码验证失败')
      }
      return { ...data, subscription_url: data.subscription_url }
    },
    [apiFetch],
  )

  const updateState = useCallback(
    async (
      input: string,
      signal?: AbortSignal,
    ): Promise<UpdateStateResponse> => {
      const params = new URLSearchParams({
        client_id: getClientId(),
      })
      const response = await apiFetch(
        `${getApiBase()}/api/update-state/${encodeURIComponent(input)}?${params.toString()}`,
        {
          method: 'GET',
          connectTimeout: 8000,
          signal,
          headers: {
            'User-Agent': CLIENT_UA,
            'X-Client-Id': getClientId(),
            'X-Client-Type': CLIENT_TYPE,
          },
        },
      )
      const data = (await response.json()) as UpdateStateResponse
      if (!response.ok || !data.ok) {
        if (response.status === 404 || response.status === 403) {
          throw new AccessCodeStateError(
            data.message || '提取码暂不可用',
            true,
            data.code,
          )
        }
        const error = new Error('订阅状态检查暂不可用') as Error & {
          retryAfterMs?: number
        }
        error.retryAfterMs =
          Math.max(0, Number(response.headers.get('Retry-After')) || 0) * 1000
        throw error
      }
      return data
    },
    [apiFetch],
  )

  const checkDesktopUpdate = useCallback(async () => {
    const response = await tauriFetch(
      `${getApiBase()}/api/desktop-version?platform=${encodeURIComponent(DESKTOP_PLATFORM)}`,
      {
        method: 'GET',
        connectTimeout: 8000,
        headers: {
          'User-Agent': CLIENT_UA,
          'X-Client-Id': getClientId(),
          'X-Client-Type': CLIENT_TYPE,
        },
      },
    )
    const data = (await response.json()) as DesktopVersionResponse
    const latestVersion = data.latest_version?.trim() || ''
    const downloadUrl = data.download_url?.trim() || ''
    const hasDownload =
      Boolean(downloadUrl) ||
      (DESKTOP_PLATFORM === 'linux' &&
        Boolean(data.linux_deb_url?.trim() || data.linux_rpm_url?.trim()))
    if (
      response.ok &&
      data.ok &&
      latestVersion &&
      hasDownload &&
      compareVersion(latestVersion, DESKTOP_VERSION) > 0
    ) {
      setDesktopUpdate({
        ...data,
        latest_version: latestVersion,
        download_url: downloadUrl,
        linux_deb_url: data.linux_deb_url?.trim() || '',
        linux_rpm_url: data.linux_rpm_url?.trim() || '',
      })
    }
  }, [])

  const updateCurrentProfileKeepingRules = useCallback(
    async (suppressFailureNotice = false) => {
      const profileUid = current?.uid
      if (!profileUid) return

      const previousContent = await readProfileFile(profileUid)
      const ruleSnapshot = await readRuleSnapshot(profileUid)
      try {
        await updateProfile(
          profileUid,
          { with_proxy: true },
          { suppressFailureNotice },
        )
        await restoreRuleSnapshot(profileUid, ruleSnapshot, {
          suppressValidationNotice: suppressFailureNotice,
        })
      } catch (error) {
        const restored = await saveProfileFile(profileUid, previousContent, {
          suppressValidationNotice: suppressFailureNotice,
        }).catch(() => false)
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(
          restored
            ? `${message}；已恢复更新前订阅`
            : `${message}；更新前订阅也未能自动恢复`,
          { cause: error },
        )
      }
    },
    [current?.uid],
  )

  const updateManagedProfile = useCallback(
    async (
      remoteVersion: number,
      options?: {
        force?: boolean
        suppressValidationNotice?: boolean
        signal?: AbortSignal
        background?: boolean
        allowInactive?: boolean
        renewCredentials?: boolean
      },
    ): Promise<ManagedProfileUpdateResult> => {
      const force = options?.force ?? false
      const suppressValidationNotice =
        options?.suppressValidationNotice ?? false
      let auth = managedAuthRef.current
      if (
        !auth ||
        (auth.profileUid !== current?.uid &&
          !(
            options?.allowInactive &&
            auth.profileUid === codeProfileUid &&
            current?.uid === expiredProfileUid
          ))
      )
        return 'unmanaged'
      const commitAuth = async (next: ManagedAuth) => {
        assertRequestActive(options?.signal)
        if (managedAuthRef.current !== auth)
          throw new Error('提取码已变化，已取消旧订阅更新')
        if (options?.background) {
          refreshApplyInFlightRef.current = true
          setBusy(true)
        }
        try {
          await persistManagedAuth(next)
        } finally {
          if (options?.background) {
            refreshApplyInFlightRef.current = false
            setBusy(false)
          }
        }
      }
      if (auth.detached && !force) {
        if (remoteVersion > auth.updateVersion) {
          await commitAuth({ ...auth, updateVersion: remoteVersion })
        }
        setStatus('当前订阅已在本地编辑，已停止远程覆盖')
        return 'managed-detached'
      }

      const profileUid = auth.profileUid
      const localContent = await withRequestDeadline(
        () => readProfileFile(profileUid),
        5000,
        options?.signal,
      )
      const localHash = await hashManagedContent(localContent)
      assertRequestActive(options?.signal)
      if (!force && auth.contentHash && localHash !== auth.contentHash) {
        await commitAuth({
          ...auth,
          detached: true,
          updateVersion: Math.max(auth.updateVersion, remoteVersion),
        })
        setStatus('检测到本地编辑，已转为本地配置并停止远程覆盖')
        return 'managed-detached'
      }

      const loaded = await loadManagedContent(
        auth,
        options?.renewCredentials ?? false,
        {
          download: (value) => fetchManagedSubscription(value, options?.signal),
          status: (error) =>
            error instanceof AccessCodeStateError
              ? error.httpStatus
              : undefined,
          current: () => managedAuthRef.current,
          persist: persistManagedAuth,
          renew: async (previous) => {
            // Validate the same code's current target before a user-requested rebind.
            await updateState(previous.accessCode, options?.signal)
            assertRequestActive(options?.signal)
            const apiBase = getApiBase()
            const ticket = await requestImportTicket(
              previous.accessCode,
              apiBase,
            )
            const exchange = await exchangeImportTicket({
              ticket,
              apiBase,
              name: previous.accessCode,
            })
            assertRequestActive(options?.signal)
            return {
              ...previous,
              apiBase,
              deviceToken: exchange.device_token,
              subscriptionUrl: exchange.subscription_url,
              expiresAt: exchange.expires_at ?? previous.expiresAt,
              limitMode: exchange.limit_mode || previous.limitMode,
            }
          },
        },
      )
      auth = loaded.auth
      const downloaded = loaded.content
      assertRequestActive(options?.signal)
      if (managedAuthRef.current !== auth)
        throw new Error('提取码已变化，已取消旧订阅更新')
      const content = prepareSubscriptionContent(localContent, downloaded)
      if (content === null) {
        if (
          auth.detached ||
          auth.contentHash !== localHash ||
          remoteVersion > auth.updateVersion
        ) {
          if (options?.background) {
            refreshApplyInFlightRef.current = true
            setBusy(true)
          }
          try {
            await persistManagedAuth({
              ...auth,
              contentHash: localHash,
              detached: false,
              updateVersion: Math.max(auth.updateVersion, remoteVersion),
            })
          } finally {
            if (options?.background) {
              refreshApplyInFlightRef.current = false
              setBusy(false)
            }
          }
        }
        return 'managed-unchanged'
      }
      assertRequestActive(options?.signal)
      if (options?.background) {
        refreshApplyInFlightRef.current = true
        setBusy(true)
      }
      let saved = false
      try {
        saved = await saveProfileFile(auth.profileUid, content, {
          suppressValidationNotice,
        })
        if (!saved) throw new Error('远程订阅内容验证失败，已保留原配置')
        const savedContent = await readProfileFile(auth.profileUid)
        await persistManagedAuth({
          ...auth,
          contentHash: await hashManagedContent(savedContent),
          detached: false,
          updateVersion: Math.max(auth.updateVersion, remoteVersion),
        })
      } catch (error) {
        if (!saved) throw error // native validation has already restored the file
        const restored = await saveProfileFile(auth.profileUid, localContent, {
          suppressValidationNotice,
        }).catch(() => false)
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(
          restored
            ? `${message}；已恢复更新前订阅`
            : `${message}；更新前订阅也未能自动恢复`,
          { cause: error },
        )
      } finally {
        if (options?.background) {
          refreshApplyInFlightRef.current = false
          setBusy(false)
        }
      }
      return 'managed-updated'
    },
    [
      current?.uid,
      codeProfileUid,
      expiredProfileUid,
      fetchManagedSubscription,
      updateState,
      requestImportTicket,
      exchangeImportTicket,
      persistManagedAuth,
      setStatus,
    ],
  )

  const stopForServerLimit = useCallback(
    async (
      message: string,
      reason: AccessRestrictionReason = 'unavailable',
    ) => {
      if (!currentCode || activeCodeRef.current !== currentCode) return
      recordAccessRestriction(currentCode, reason)
      await patchVerge({ enable_tun_mode: false }).catch(() => undefined)
      await toggleSystemProxy(false).catch(() => undefined)
      await stopCore().catch(() => undefined)
      await invalidateProxyState().catch(() => undefined)
      setStatus(message)
    },
    [
      currentCode,
      recordAccessRestriction,
      invalidateProxyState,
      patchVerge,
      toggleSystemProxy,
    ],
  )

  const sendClientPresence = useCallback(
    async (online: boolean) => {
      const value = currentCode
      if (!value) return

      // 节流闸门。上游任何来源（状态抖动、事件重复、窗口聚焦）都可能重复触发，
      // 这里统一挡住，保证服务端看到的上报节奏与设计一致。
      const now = Date.now()
      const throttle = presenceThrottleRef.current
      if (!shouldSendPresence(throttle, online, now).send) return
      markPresenceSent(throttle, online, now)

      const pending = queuePendingPresence(value, online)
      const auth = managedAuthRef.current
      if (auth?.accessCode === value) {
        const endpoint = online ? 'heartbeat' : 'offline'
        const response = await apiFetch(
          `${auth.apiBase}/api/v2/client/${endpoint}`,
          {
            method: 'POST',
            connectTimeout: 5000,
            headers: {
              Authorization: `Bearer ${auth.deviceToken}`,
              'Content-Type': 'application/json',
              'User-Agent': CLIENT_UA,
              'X-Client-Id': getClientId(),
              'X-Client-Type': CLIENT_TYPE,
            },
            body: JSON.stringify({
              platform: CLIENT_PLATFORM_LABEL,
              app_name: `${getRuntimeBrand().client_name}桌面端`,
              app_version: DESKTOP_VERSION,
              device_name: navigator.userAgent,
            }),
          },
        )
        const data = (await response.json().catch(() => null)) as {
          ok?: boolean
          code?: string
          message?: string
          expires_at?: string | null
          day_used?: number
          month_used?: number
          day_limit?: number
          month_limit?: number
          online_devices?: number
          online_limit?: number
          bound_devices?: number
          bound_limit?: number
          show_usage_status?: boolean
          // 服务端下发的升级建议。内置 updater 检查失败时是静默的，
          // 这条旁路让服务端仍能把「你的版本太旧」告诉用户。
          upgrade_hint?: {
            message?: string
            current_version?: string
            min_version?: string
            download_url?: string
          } | null
        } | null
        if (
          activeCodeRef.current !== value ||
          managedAuthRef.current?.accessCode !== value ||
          managedAuthRef.current?.deviceToken !== auth.deviceToken
        )
          return
        if (!response.ok || !data?.ok) {
          // 429 是反代的限流，不是业务错误：按 Retry-After 退避，别继续打。
          // 反代已配置 limit_req_status 429 + Retry-After。
          if (response.status === 429) {
            markPresenceRateLimited(
              throttle,
              response.headers.get('retry-after'),
              Date.now(),
            )
            throw new Error('设备状态上报被限流，稍后重试')
          }
          if (
            online &&
            (data?.code === 'device_limit' ||
              data?.code === 'bound_limit' ||
              data?.code === 'traffic_limit')
          ) {
            await stopForServerLimit(
              data.message ||
                (data.code === 'traffic_limit'
                  ? '流量额度已用尽，代理已停止'
                  : data.code === 'bound_limit'
                    ? '绑定设备数量已达到套餐上限，代理已停止'
                    : '在线设备数量已达到套餐上限，代理已停止'),
              data.code === 'traffic_limit' ? 'traffic_limit' : 'unavailable',
            )
          }
          throw new Error(data?.message || '设备状态上报失败')
        }
        markPresenceAccepted(throttle)
        if (online) {
          if (!updateInFlightRef.current && !backgroundBusyRef.current)
            await syncExpiresAt(data.expires_at)
          setClientAccountState({
            dayUsed: Number(data.day_used) || 0,
            monthUsed: Number(data.month_used) || 0,
            dayLimit: Number(data.day_limit) || 0,
            monthLimit: Number(data.month_limit) || 0,
            onlineDevices: Number(data.online_devices) || 0,
            onlineLimit: Number(data.online_limit) || 0,
            boundDevices: Number(data.bound_devices) || 0,
            boundLimit: Number(data.bound_limit) || 0,
            showUsage: data.show_usage_status === true,
            updatedAt: Date.now(),
          })
          // 每次启动只提示一次，心跳每 2 分钟一轮，不能每轮都刷状态栏。
          const hint = data.upgrade_hint?.message?.trim()
          if (hint && !upgradeHintShownRef.current) {
            upgradeHintShownRef.current = true
            setStatus(hint)
          }
        }
        clearPendingPresence(pending.id)
        return
      }
      const endpoint = online ? 'heartbeat' : 'offline'
      const params = new URLSearchParams({
        client_id: getClientId(),
        platform: CLIENT_PLATFORM_LABEL,
        app_name: `${getRuntimeBrand().client_name}桌面端`,
        app_version: DESKTOP_VERSION,
        device_name: navigator.userAgent,
      })
      const response = await apiFetch(
        `${getApiBase()}/api/client/${endpoint}/${encodeURIComponent(value)}?${params.toString()}`,
        {
          method: 'GET',
          connectTimeout: 5000,
          headers: {
            'User-Agent': CLIENT_UA,
            'X-Client-Id': getClientId(),
            'X-Client-Type': CLIENT_TYPE,
          },
        },
      )
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean
        message?: string
        expires_at?: string | null
      } | null
      if (activeCodeRef.current !== value) return
      if (!response.ok || !data?.ok) {
        if (response.status === 429) {
          markPresenceRateLimited(
            throttle,
            response.headers.get('retry-after'),
            Date.now(),
          )
          throw new Error('设备状态上报被限流，稍后重试')
        }
        throw new Error(
          data?.message || `客户端${online ? '心跳' : '离线'}上报失败`,
        )
      }
      markPresenceAccepted(throttle)
      if (online && !updateInFlightRef.current && !backgroundBusyRef.current)
        await syncExpiresAt(data.expires_at)
      clearPendingPresence(pending.id)
    },
    [apiFetch, currentCode, stopForServerLimit, syncExpiresAt],
  )

  useEffect(() => {
    sendClientPresenceRef.current = sendClientPresence
  }, [sendClientPresence])

  const reportClientTraffic = useCallback(
    async (signal: AbortSignal): Promise<ManagedTrafficReportOutcome> => {
      const value = currentCode
      if (!value || !running || !proxyTrafficReadyRef.current)
        return { status: 'inactive' }

      const current = trafficTotalsRef.current
      const auth = managedAuthRef.current
      if (auth?.accessCode === value) {
        let counter =
          trafficCounterRef.current ||
          createManagedTrafficCounter(value, current)
        const coreCounterReset =
          current.upload < counter.observed.upload ||
          current.download < counter.observed.download
        if (!coreCounterReset) {
          counter = observeManagedTraffic(counter, current).counter
        }
        trafficCounterRef.current = counter
        localStorage.setItem(
          MANAGED_TRAFFIC_STORAGE_KEY,
          JSON.stringify(counter),
        )
        const pending =
          pendingManagedTrafficRef.current || managedTrafficPayload(counter)
        if (pending.upload_total <= 0 && pending.download_total <= 0) {
          return { status: 'no_delta' }
        }
        pendingManagedTrafficRef.current = pending

        trafficReportRetryAfterRef.current = 0
        const response = await apiFetch(
          `${auth.apiBase}/api/v2/client/traffic`,
          {
            method: 'POST',
            connectTimeout: 5000,
            signal,
            headers: {
              Authorization: `Bearer ${auth.deviceToken}`,
              'Content-Type': 'application/json',
              'User-Agent': CLIENT_UA,
              'X-Client-Id': getClientId(),
              'X-Client-Type': CLIENT_TYPE,
            },
            body: JSON.stringify({
              ...pending,
              platform: CLIENT_PLATFORM_LABEL,
              app_name: `${getRuntimeBrand().client_name}桌面端`,
              app_version: DESKTOP_VERSION,
              device_name: navigator.userAgent,
            }),
          },
        )
        const data = (await response.json().catch((error) => {
          if (signal.aborted) throw error
          return null
        })) as {
          ok?: boolean
          duplicate?: boolean
          code?: string
          message?: string
          day_used?: number
          month_used?: number
          day_limit?: number
          month_limit?: number
        } | null
        if (signal.aborted) throw new ManagedTrafficReportError('timeout')
        if (
          activeCodeRef.current !== value ||
          managedAuthRef.current?.accessCode !== value ||
          managedAuthRef.current?.deviceToken !== auth.deviceToken
        )
          return { status: 'inactive' }
        if (response.status === 429 || response.status === 503) {
          const retryAfterSeconds = Number(response.headers.get('Retry-After'))
          trafficReportRetryAfterRef.current = Number.isFinite(
            retryAfterSeconds,
          )
            ? Math.max(0, retryAfterSeconds * 1000)
            : 0
        }
        if (response.status === 409 && data?.code === 'counter_reset') {
          const reset = createManagedTrafficCounter(value, current)
          trafficCounterRef.current = reset
          pendingManagedTrafficRef.current = undefined
          localStorage.setItem(
            MANAGED_TRAFFIC_STORAGE_KEY,
            JSON.stringify(reset),
          )
          return { status: 'counter_rebased', sequence: reset.sequence }
        }
        if (!response.ok || !data?.ok) {
          if (data?.code === 'traffic_limit') {
            pendingManagedTrafficRef.current = undefined
            await stopForServerLimit(
              data.message || '流量额度已用尽，代理已停止',
              'traffic_limit',
            )
          }
          throw managedTrafficResponseError(response.status, data?.code)
        }
        const latestCounter = trafficCounterRef.current || counter
        const acknowledged = coreCounterReset
          ? createManagedTrafficCounter(value, current)
          : acknowledgeManagedTraffic(latestCounter, pending.sequence)
        trafficCounterRef.current = acknowledged
        pendingManagedTrafficRef.current = undefined
        localStorage.setItem(
          MANAGED_TRAFFIC_STORAGE_KEY,
          JSON.stringify(acknowledged),
        )
        if (data) {
          setClientAccountState((previous) => ({
            dayUsed: Number(data.day_used) || 0,
            monthUsed: Number(data.month_used) || 0,
            dayLimit: Number(data.day_limit) || 0,
            monthLimit: Number(data.month_limit) || 0,
            onlineDevices: previous?.onlineDevices || 0,
            onlineLimit: previous?.onlineLimit || 0,
            boundDevices: previous?.boundDevices || 0,
            boundLimit: previous?.boundLimit || 0,
            showUsage: previous?.showUsage === true,
            updatedAt: Date.now(),
          }))
        }
        return { status: 'acknowledged', sequence: acknowledged.sequence }
      }
      if (activeCodeRef.current !== value) return { status: 'inactive' }
      const previous = lastReportedTrafficRef.current
      if (
        current.upload < previous.upload ||
        current.download < previous.download
      ) {
        lastReportedTrafficRef.current = current
        return { status: 'counter_rebased' }
      }

      const uploadDelta = current.upload - previous.upload
      const downloadDelta = current.download - previous.download
      if (uploadDelta <= 0 && downloadDelta <= 0) {
        return { status: 'no_delta' }
      }
      if (
        uploadDelta > MAX_TRAFFIC_REPORT_DELTA ||
        downloadDelta > MAX_TRAFFIC_REPORT_DELTA
      ) {
        lastReportedTrafficRef.current = current
        return { status: 'invalid_delta_discarded' }
      }

      trafficReportRetryAfterRef.current = 0
      const response = await apiFetch(
        `${getApiBase()}/api/client/traffic/${encodeURIComponent(value)}`,
        {
          method: 'POST',
          connectTimeout: 5000,
          signal,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': CLIENT_UA,
            'X-Client-Id': getClientId(),
            'X-Client-Type': CLIENT_TYPE,
          },
          body: JSON.stringify({
            client_id: getClientId(),
            platform: CLIENT_PLATFORM_LABEL,
            app_name: `${getRuntimeBrand().client_name}桌面端`,
            app_version: DESKTOP_VERSION,
            device_name: navigator.userAgent,
            upload_bytes: uploadDelta,
            download_bytes: downloadDelta,
          }),
        },
      )
      const data = (await response.json().catch((error) => {
        if (signal.aborted) throw error
        return null
      })) as {
        ok?: boolean
        code?: string
        message?: string
      } | null
      if (signal.aborted) throw new ManagedTrafficReportError('timeout')
      if (response.status === 429 || response.status === 503) {
        const retryAfterSeconds = Number(response.headers.get('Retry-After'))
        trafficReportRetryAfterRef.current = Number.isFinite(retryAfterSeconds)
          ? Math.max(0, retryAfterSeconds * 1000)
          : 0
      }
      if (!response.ok || !data?.ok) {
        throw managedTrafficResponseError(response.status, data?.code)
      }
      // 只有服务端明确确认成功才推进基线，失败增量留到下一轮重试。
      lastReportedTrafficRef.current = current
      return { status: 'acknowledged' }
    },
    [apiFetch, currentCode, running, stopForServerLimit],
  )

  useEffect(() => {
    reportClientTrafficRef.current = reportClientTraffic
  }, [reportClientTraffic])

  const activateCode = async (
    value: string,
    retryCount = 3,
    onPhase?: (phase: CodeImportPhase) => void,
  ) => {
    let lastError: unknown
    for (let attempt = 1; attempt <= retryCount; attempt += 1) {
      try {
        onPhase?.('checking')
        const apiBase = getApiBase()
        const ticket = await requestImportTicket(value, apiBase)
        const exchange = await exchangeImportTicket({
          ticket,
          apiBase,
          name: value,
        })

        onPhase?.('downloading')
        return await installManagedSubscription(value, exchange, apiBase)
      } catch (error) {
        lastError = error
        if (
          (error instanceof AccessCodeStateError && error.serverRejected) ||
          error instanceof ManagedInstallError
        ) {
          break
        }
        if (attempt < retryCount) {
          // 重试前尝试切换到下一条可用 API 线路（当前线路可能已失联）。
          await rotateApiBase(proxyUrlRef.current || undefined).catch(
            () => undefined,
          )
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  // 提取码到期：切换到只含一个不可上网节点的本地占位配置（节点名提示续费），
  // 而不是直接拒绝开启。续费后会自动检测并恢复正常订阅。
  const activateExpiredProfile = useCallback(async () => {
    const existingUid = localStorage.getItem(EXPIRED_PROFILE_UID_KEY) || ''
    const list = await getProfiles()
    let targetUid = existingUid
      ? list.items?.find((item) => item.uid === existingUid)?.uid
      : undefined
    if (!targetUid) {
      await createProfile(
        {
          type: 'local',
          name: EXPIRED_PROFILE_NAME,
          desc: '续费后自动检查并恢复订阅',
          url: '',
          option: { with_proxy: false, self_proxy: false },
        } as IProfileItem,
        buildExpiredProfileYaml(),
      )
      const refreshed = await getProfiles()
      targetUid = refreshed.items?.slice(-1)[0]?.uid
      if (targetUid) {
        localStorage.setItem(EXPIRED_PROFILE_UID_KEY, targetUid)
        setExpiredProfileUid(targetUid)
      }
    }
    if (targetUid) {
      const switched = await patchProfilesConfig({ current: targetUid })
      if (!switched) throw new Error('到期提示配置验证失败')
      await mutateProfiles()
      await refreshAll()
    }
  }, [mutateProfiles, refreshAll])

  // 当前是否正处于到期占位配置
  const onExpiredProfile = useCallback(() => {
    const uid = localStorage.getItem(EXPIRED_PROFILE_UID_KEY) || ''
    return Boolean(uid && current?.uid === uid)
  }, [current?.uid])

  // Keep the original managed URL/device credential across renewal. Only
  // legacy installations without credentials need an automatic ticket exchange.
  const recoverFromExpired = useCallback(
    async (
      remoteVersion: number,
      signal?: AbortSignal,
    ): Promise<ManagedProfileUpdateResult> => {
      const value = savedCode
      if (!value) throw new Error('尚未绑定提取码')
      const expiredUid = localStorage.getItem(EXPIRED_PROFILE_UID_KEY) || ''
      const auth = managedAuthRef.current
      let result: ManagedProfileUpdateResult = 'managed-updated'
      if (auth?.accessCode === value && auth.profileUid === codeProfileUid) {
        result = await updateManagedProfile(remoteVersion, {
          allowInactive: true,
          signal,
          background: true,
          suppressValidationNotice: true,
        })
        if (result === 'unmanaged')
          throw new Error('受管订阅身份已变化，稍后自动重试')
        assertRequestActive(signal)
        if (current?.uid === expiredUid && auth.profileUid !== expiredUid) {
          refreshApplyInFlightRef.current = true
          setBusy(true)
          try {
            if (!(await patchProfilesConfig({ current: auth.profileUid })))
              throw new Error('正常订阅未能恢复，已保留原配置')
          } finally {
            refreshApplyInFlightRef.current = false
            setBusy(false)
          }
        }
      } else {
        assertRequestActive(signal)
        refreshApplyInFlightRef.current = true
        setBusy(true)
        try {
          const apiBase = auth?.apiBase || getApiBase()
          const ticket = await requestImportTicket(value, apiBase)
          assertRequestActive(signal)
          const exchange = await exchangeImportTicket({
            ticket,
            apiBase,
            name: value,
          })
          assertRequestActive(signal)
          const transaction = await installManagedSubscription(
            value,
            exchange,
            apiBase,
          )
          try {
            await transaction.commit()
          } catch (error) {
            await transaction.rollback()
            throw error
          }
        } finally {
          refreshApplyInFlightRef.current = false
          setBusy(false)
        }
      }
      if (expiredUid) {
        await deleteProfile(expiredUid)
          .then(() => {
            localStorage.removeItem(EXPIRED_PROFILE_UID_KEY)
            setExpiredProfileUid('')
          })
          .catch(() => undefined)
      }
      void mutateProfiles().catch(() => undefined)
      void refreshAll().catch(() => undefined)
      return result
    },
    [
      codeProfileUid,
      current?.uid,
      exchangeImportTicket,
      installManagedSubscription,
      mutateProfiles,
      refreshAll,
      requestImportTicket,
      savedCode,
      updateManagedProfile,
    ],
  )

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  // 官网订阅绑定提取码：当前配置若是神仙云官网订阅（一键导入 shenxianyun:// 或提取码导入，
  // url 含 /sub/<code>），自动把提取码存下来，使其与"输入提取码"一样受有效期管理。
  // 只做绑定不解绑（避免影响到期占位配置的续费恢复）；外部/本地配置 url 不匹配 → 不绑定 → 不受限。
  useEffect(() => {
    const code = extractCodeFromProfileUrl(current?.url || '')
    const boundUid = localStorage.getItem(CODE_PROFILE_UID_KEY) || ''
    if (code && (code !== savedCode || current?.uid !== boundUid)) {
      localStorage.setItem(CODE_STORAGE_KEY, code)
      if (current?.uid) localStorage.setItem(CODE_PROFILE_UID_KEY, current.uid)
      // 官网一键导入需要把 URL 中的提取码同步到组件状态。
      // eslint-disable-next-line @eslint-react/set-state-in-effect
      setSavedCode(code)
      // eslint-disable-next-line @eslint-react/set-state-in-effect
      setCodeProfileUid(current?.uid || '')
    }
  }, [current?.uid, current?.url, savedCode])

  // 覆盖安装会保留原来的 profile UID 和用户设置。旧 jc116 订阅失效时，
  // 换取当前签名 URL 后原位更新，避免清空配置或产生重复订阅。
  useEffect(() => {
    if (!current?.uid || !current.url) return
    const hostname = (() => {
      try {
        return new URL(current.url).hostname
      } catch {
        return ''
      }
    })()
    if (!hostname) return
    if (!/(^|\.)jc116\.com$/.test(hostname)) return

    const value = extractCodeFromProfileUrl(current.url)
    const migrationKey = `${current.uid}:${current.url}`
    if (!value || legacyMigrationRef.current === migrationKey) return
    legacyMigrationRef.current = migrationKey

    void (async () => {
      try {
        setStatus('正在迁移旧版订阅地址...')
        const data = await verifyCode(value, false)
        if (data.subscription_url === current.url) return
        const ruleSnapshot = await readRuleSnapshot(current.uid)
        await patchProfile(current.uid, {
          url: data.subscription_url,
          option: {
            ...current.option,
            with_proxy: true,
            allow_auto_update: false,
          },
        })
        await updateProfile(
          current.uid,
          { with_proxy: true },
          { suppressFailureNotice: true },
        )
        await restoreRuleSnapshot(current.uid, ruleSnapshot, {
          suppressValidationNotice: true,
        })
        localStorage.setItem(CODE_STORAGE_KEY, value)
        localStorage.setItem(CODE_PROFILE_UID_KEY, current.uid)
        localStorage.setItem(
          CODE_UPDATE_VERSION_STORAGE_KEY,
          String(data.update_version || 0),
        )
        setSavedCode(value)
        await syncExpiresAt(data.expires_at || '')
        setCodeProfileUid(current.uid)
        await mutateProfiles()
        await refreshAll()
        setStatus('旧版订阅已迁移并更新')
      } catch {
        setStatus('旧版订阅迁移失败，请重新导入提取码')
      }
    })()
  }, [
    current?.option,
    current?.uid,
    current?.url,
    mutateProfiles,
    refreshAll,
    syncExpiresAt,
    verifyCode,
  ])

  // 服务器地址与切换过程完全交给客户端，只向高级用户展示汇总连通状态。
  const checkServerConnection = useCallback(async () => {
    setServerCheckStatus('checking')
    const bases = listApiBases()
    const results = await Promise.all(
      bases.map((base) => probeApiBase(base, proxyUrlRef.current || undefined)),
    )
    const connected = results.some(Boolean)
    if (connected) {
      await pickApiBase(proxyUrlRef.current || undefined).catch(() => undefined)
    }
    setServerCheckStatus(connected ? 'connected' : 'disconnected')
    return connected
  }, [])

  // 端点发现：启动时后台拉取 endpoints.json 并探测可用 API 基址。
  // 失败静默（用缓存/内置默认兜底），不阻塞任何功能。
  useEffect(() => {
    initEndpointDiscovery(proxyUrlRef.current || undefined)
      .catch(() => undefined)
      .finally(() => {
        setRuntimeBrand(getRuntimeBrand())
        ensureDomesticApiDirect().catch(() => undefined)
        checkServerConnection().catch(() => undefined)
      })
    // 启动瞬间核心/系统代理可能未就绪，10 秒后快速复测一次，尽快纠正误报
    const quick = window.setTimeout(() => {
      checkServerConnection().catch(() => undefined)
    }, 10_000)
    return () => window.clearTimeout(quick)
  }, [checkServerConnection])

  // 线路状态周期性重测：启动瞬间核心/系统代理可能未就绪导致误报「不通」，
  // 每 60 秒自动重探一轮，状态始终反映当前真实连通性。
  useEffect(() => {
    const timer = window.setInterval(() => {
      checkServerConnection().catch(() => undefined)
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [checkServerConnection])

  useEffect(() => {
    // jc116 桌面版本检查已停用，改用 Tauri updater（GitHub releases 签名自动更新）
    // checkDesktopUpdate().catch(() => undefined)
  }, [checkDesktopUpdate])

  useEffect(() => {
    if (!stableRunning || !currentCode) return
    const sendPresence = sendClientPresenceRef.current
    if (!sendPresence) return
    let timer: number | undefined
    let cancelled = false
    const schedule = () => {
      timer = window.setTimeout(async () => {
        await sendPresence(true).catch(() => undefined)
        if (!cancelled) schedule()
      }, heartbeatDelay())
    }
    const flushWhenOnline = () => {
      sendPresence(true).catch(() => undefined)
    }
    sendPresence(true).catch(() => undefined)
    schedule()
    window.addEventListener('online', flushWhenOnline)
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
      window.removeEventListener('online', flushWhenOnline)
      sendPresence(false).catch(() => undefined)
    }
  }, [currentCode, stableRunning])

  useEffect(() => {
    if (!managedAuthReady || !currentCode) {
      trafficCounterRef.current = null
      pendingManagedTrafficRef.current = undefined
      return
    }
    if (!proxyTrafficReadyRef.current) return
    if (trafficCounterRef.current?.accessCode === currentCode) return

    const restored = parseManagedTrafficCounter(
      localStorage.getItem(MANAGED_TRAFFIC_STORAGE_KEY),
      currentCode,
    )
    const counter =
      restored ||
      createManagedTrafficCounter(currentCode, trafficTotalsRef.current)
    trafficCounterRef.current = counter
    pendingManagedTrafficRef.current = undefined
    localStorage.setItem(MANAGED_TRAFFIC_STORAGE_KEY, JSON.stringify(counter))
  }, [
    currentCode,
    managedAuthReady,
    connectionResponse.data?.proxyUploadTotal,
    connectionResponse.data?.proxyDownloadTotal,
  ])

  useEffect(() => {
    const totals = desktopProxyTrafficTotals(connectionResponse.data)
    proxyTrafficReadyRef.current = totals !== null
    if (!totals) return
    trafficTotalsRef.current = totals
    const counter = trafficCounterRef.current
    if (!counter) return
    const hasNewTraffic =
      totals.upload > counter.observed.upload ||
      totals.download > counter.observed.download
    const observed = observeManagedTraffic(counter, totals)
    // 核心累计值回退通常表示核心重启。旧累计值必须先成功补报，不能被新基线覆盖。
    if (observed.reset) return
    trafficCounterRef.current = observed.counter
    localStorage.setItem(
      MANAGED_TRAFFIC_STORAGE_KEY,
      JSON.stringify(observed.counter),
    )
    if (hasNewTraffic) trafficSchedulerRef.current?.notifyActivity()
  }, [connectionResponse.data])

  useEffect(() => {
    if (!stableRunning || !currentCode || !managedAuthReady) {
      lastReportedTrafficRef.current = trafficTotalsRef.current
      return
    }

    const counter =
      trafficCounterRef.current ||
      createManagedTrafficCounter(currentCode, trafficTotalsRef.current)
    trafficCounterRef.current = counter
    pendingManagedTrafficRef.current = undefined
    localStorage.setItem(MANAGED_TRAFFIC_STORAGE_KEY, JSON.stringify(counter))

    const scheduler = createManagedTrafficScheduler({
      report: async (signal) => {
        const report = reportClientTrafficRef.current
        return report ? report(signal) : { status: 'inactive' }
      },
      takeRetryAfterMs: () => {
        const delay = trafficReportRetryAfterRef.current
        trafficReportRetryAfterRef.current = 0
        return delay
      },
      onTransition: persistManagedTrafficDiagnostic,
    })
    trafficSchedulerRef.current = scheduler
    scheduler.start()
    const initialPayload = managedTrafficPayload(counter)
    if (initialPayload.upload_total > 0 || initialPayload.download_total > 0) {
      scheduler.notifyActivity()
    }
    return () => {
      if (trafficSchedulerRef.current === scheduler) {
        trafficSchedulerRef.current = null
      }
      scheduler.stop()
    }
  }, [currentCode, managedAuthReady, stableRunning])

  const checkSubscriptionRecovery = useCallback(
    async (signal: AbortSignal) => {
      if (!currentCode || !current?.uid) return
      updateInFlightRef.current = true
      const originalDeviceToken = managedAuthRef.current?.deviceToken
      const assertAccountCurrent = () => {
        if (
          activeCodeRef.current !== currentCode ||
          localStorage.getItem(CODE_STORAGE_KEY) !== currentCode ||
          (originalDeviceToken &&
            managedAuthRef.current?.deviceToken !== originalDeviceToken)
        )
          throw new Error('提取码身份已变化，已取消旧订阅检查')
      }
      const startupRefresh = !startupRefreshCompletedRef.current
      if (startupRefresh) setStatus('正在更新订阅，获取最新节点...')
      try {
        const state = await updateState(currentCode, signal)
        assertAccountCurrent()
        assertRequestActive(signal)
        const wasRestricted =
          restrictionRef.current?.accessCode === currentCode ||
          onExpiredProfile()
        const expiryChanged =
          state.expires_at !== undefined &&
          (state.expires_at?.trim() || '') !== expiresAt
        const localVersion = Number(
          localStorage.getItem(CODE_UPDATE_VERSION_STORAGE_KEY) || 0,
        )
        const remoteVersion = Number(state.update_version || 0)
        let cachedRevision = ''
        try {
          const cached = JSON.parse(
            localStorage.getItem(CODE_REVISION_STORAGE_KEY) || 'null',
          )
          if (cached?.accessCode === currentCode)
            cachedRevision = cached.revision || ''
        } catch {
          /* migrate the old timestamp cache once */
        }
        const needsRefresh = needsSubscriptionRefresh({
          startup: !startupRefreshCompletedRef.current,
          recovering: wasRestricted,
          expiryChanged,
          remoteVersion,
          localVersion,
          remoteRevision: state.subscription_revision,
          localRevision: cachedRevision,
        })
        if (expiryChanged) {
          refreshApplyInFlightRef.current = true
          setBusy(true)
          try {
            await syncExpiresAt(state.expires_at)
          } finally {
            refreshApplyInFlightRef.current = false
            setBusy(false)
          }
        }
        assertRequestActive(signal)
        if (needsRefresh) {
          let result: ManagedProfileUpdateResult
          if (
            onExpiredProfile() ||
            ((wasRestricted || expiryChanged) && !managedAuthRef.current)
          )
            result = await recoverFromExpired(remoteVersion, signal)
          else
            result = await updateManagedProfile(remoteVersion, {
              signal,
              background: true,
              force: startupRefresh,
              suppressValidationNotice: true,
            })
          if (result === 'unmanaged') {
            assertRequestActive(signal)
            refreshApplyInFlightRef.current = true
            setBusy(true)
            try {
              await updateCurrentProfileKeepingRules(true)
            } finally {
              refreshApplyInFlightRef.current = false
              setBusy(false)
            }
          }
          assertAccountCurrent()
          // Never consume a revision for a failed or intentionally detached update.
          if (result !== 'managed-detached') {
            localStorage.setItem(
              CODE_UPDATE_VERSION_STORAGE_KEY,
              String(remoteVersion),
            )
            if (state.subscription_revision)
              localStorage.setItem(
                CODE_REVISION_STORAGE_KEY,
                JSON.stringify({
                  accessCode: currentCode,
                  revision: state.subscription_revision,
                }),
              )
            startupRefreshCompletedRef.current = true
            try {
              sessionStorage.setItem(STARTUP_REFRESH_SESSION_KEY, 'done')
            } catch {
              /* optional cache */
            }
            setStatus(
              wasRestricted ? '订阅已恢复，可以启动' : '当前节点已是最新',
            )
          }
          void mutateProfiles().catch(() => undefined)
          void refreshAll().catch(() => undefined)
        }
        assertAccountCurrent()
        clearAccessRestriction(currentCode)
        setExpiredDialogOpen(false)
      } catch (error) {
        if (signal.aborted) throw error
        if (error instanceof AccessCodeStateError && error.serverRejected) {
          const reason = error.stateCode
            ? restrictionReason(error.stateCode)
            : expiresAt && Date.now() > parseExpireTime(expiresAt)
              ? 'expired'
              : 'unavailable'
          recordAccessRestriction(currentCode, reason)
          // Existing connected clients fail closed. Never turn on a stopped VPN.
          if (running) {
            refreshApplyInFlightRef.current = true
            setBusy(true)
            try {
              if (reason === 'expired')
                await activateExpiredProfile().catch(() => undefined)
              await stopForServerLimit(error.message, reason)
            } finally {
              refreshApplyInFlightRef.current = false
              setBusy(false)
            }
          }
          setStatus(error.message)
          return
        }
        if (
          startupRefresh ||
          restrictionRef.current?.accessCode === currentCode
        )
          setStatus('暂未更新，已保留原节点，将自动重试')
        if (!(error instanceof AccessCodeStateError))
          void rotateApiBase(proxyUrlRef.current || undefined).catch(
            () => undefined,
          )
        throw error
      } finally {
        updateInFlightRef.current = false
        if (autoRefreshControllerRef.current?.signal === signal)
          autoRefreshControllerRef.current = null
      }
    },
    [
      activateExpiredProfile,
      clearAccessRestriction,
      current?.uid,
      currentCode,
      expiresAt,
      mutateProfiles,
      onExpiredProfile,
      recordAccessRestriction,
      recoverFromExpired,
      refreshAll,
      running,
      stopForServerLimit,
      syncExpiresAt,
      updateCurrentProfileKeepingRules,
      updateManagedProfile,
      updateState,
    ],
  )

  useEffect(() => {
    subscriptionCheckRef.current = checkSubscriptionRecovery
  }, [checkSubscriptionRecovery])
  useEffect(() => {
    if (!managedAuthReady || !currentCode || !current?.uid) return
    const monitor = createSubscriptionMonitor({
      check: (signal, controller) => {
        autoRefreshControllerRef.current = controller
        return subscriptionCheckRef.current?.(signal) ?? Promise.resolve()
      },
      canRun: () =>
        !backgroundBusyRef.current &&
        !updateInFlightRef.current &&
        !refreshApplyInFlightRef.current &&
        !codeEntryActiveRef.current,
      intervalMs: () =>
        document.visibilityState === 'hidden' ? 60_000 : 30_000,
    })
    subscriptionMonitorRef.current = monitor
    const wake = () => {
      // Opening or returning to the app fetches the current code's nodes again.
      startupRefreshCompletedRef.current = false
      monitor.wake()
    }
    const visible = () => {
      if (document.visibilityState === 'visible') wake()
    }
    monitor.start()
    window.addEventListener('focus', wake)
    window.addEventListener('online', wake)
    document.addEventListener('visibilitychange', visible)
    return () => {
      monitor.stop()
      if (subscriptionMonitorRef.current === monitor)
        subscriptionMonitorRef.current = null
      window.removeEventListener('focus', wake)
      window.removeEventListener('online', wake)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [current?.uid, currentCode, managedAuthReady])

  const updateCurrentSubscription = useLockFn(async (automatic = false) => {
    if (!managedAuthReady) {
      setStatus('正在读取本机订阅，请稍后再更新')
      return
    }
    if (automatic && codeEntryActiveRef.current) return
    if (!current?.uid) {
      setStatus('还没有可更新的订阅')
      return
    }
    setBusy(true)
    setStatus('正在更新订阅...')
    if (updateInFlightRef.current) {
      setStatus('订阅正在后台更新，请稍后再试')
      setBusy(false)
      return
    }
    updateInFlightRef.current = true
    setBusy(true)
    setStatus('正在更新订阅，获取最新节点...')
    try {
      let remoteVersion = Number(
        localStorage.getItem(CODE_UPDATE_VERSION_STORAGE_KEY) || 0,
      )
      const state = currentCode ? await updateState(currentCode) : null
      if (state) {
        remoteVersion = Number(state.update_version || 0)
        await syncExpiresAt(state.expires_at)
      }
      let result = await updateManagedProfile(remoteVersion, {
        force: !automatic,
        renewCredentials: !automatic,
        suppressValidationNotice: true,
      })
      if (result === 'unmanaged') {
        if (currentCode) result = await recoverFromExpired(remoteVersion)
        else await updateCurrentProfileKeepingRules(true)
      }
      void mutateProfiles().catch(() => undefined)
      void refreshAll().catch(() => undefined)
      setStatus(
        result === 'managed-unchanged'
          ? '当前节点已是最新'
          : result === 'managed-updated'
            ? '受管订阅已重新获取；本地编辑已恢复远程管理'
            : '订阅已更新，同提取码规则已保留',
      )
    } catch (error) {
      console.warn('手动订阅更新失败，已继续使用原订阅', error)
      setStatus('暂未更新，已保留原节点，请稍后重试')
    } finally {
      updateInFlightRef.current = false
      setBusy(false)
    }
  })

  // Only stable transitions outside an import/update operation count as a disconnect.
  useEffect(() => {
    if (busy) return
    const disconnected = previousRunningRef.current && !running
    previousRunningRef.current = running
    if (!running && !localWorkspace) {
      // eslint-disable-next-line @eslint-react/set-state-in-effect -- external disconnect must close the connected workspace.
      setAdvancedOpen(false)
      // eslint-disable-next-line @eslint-react/set-state-in-effect -- external disconnect must close the connected workspace.
      setTrafficRuleOpen(false)
      // eslint-disable-next-line @eslint-react/set-state-in-effect -- external disconnect must close the connected workspace.
      setProfileManagerOpen(false)
      // eslint-disable-next-line @eslint-react/set-state-in-effect -- external disconnect must close the connected workspace.
      setSelfCheckOpen(false)
      // eslint-disable-next-line @eslint-react/set-state-in-effect -- external disconnect must close the connected workspace.
      setEditorState(null)
    }
    if (disconnected && savedCode && current?.uid)
      void updateCurrentSubscription(true)
  }, [
    busy,
    running,
    localWorkspace,
    savedCode,
    current?.uid,
    updateCurrentSubscription,
  ])

  // ===== 手动配置管理：应对 web 断网无法导入订阅时，自行导入/切换/编辑本地配置 =====
  // 只展示用户真正的配置文件（远程订阅 / 本地配置），隐藏到期占位配置、全局 Merge
  // 覆盖、脚本等「乱七八糟」的内部条目，避免误编辑/误切换。
  const profileList = useMemo(() => {
    return (profiles?.items || []).filter(
      (item) =>
        (item.type === 'remote' || item.type === 'local') &&
        item.uid !== expiredProfileUid &&
        item.uid !== rulesProfileUid,
    )
  }, [expiredProfileUid, profiles?.items])

  const manualImportByUrl = useLockFn(async () => {
    if (running) {
      setStatus('请先停止代理，再导入或切换配置')
      return
    }
    if (busy || manualBusy || refreshApplyInFlightRef.current) {
      setStatus('正在完成配置操作，请稍后重试')
      return
    }
    autoRefreshControllerRef.current?.abort()
    const url = manualImportUrl.trim()
    if (!url) {
      setStatus('请输入订阅链接')
      return
    }
    backgroundBusyRef.current = true
    setManualBusy(true)
    setStatus('正在导入订阅...')
    const previousActiveCode = activeCodeRef.current
    let selected = false
    try {
      const before = await getProfiles()
      const previousIds = new Set(
        (before.items || [])
          .map((item) => item.uid)
          .filter((uid): uid is string => Boolean(uid)),
      )
      // 不开启周期性自动更新，避免无谓重下整个配置。
      await importProfile(url, { with_proxy: true, allow_auto_update: false })
      await ensureDomesticApiDirect().catch(() => undefined)
      const list = await getProfiles()
      const newest = (list.items || [])
        .filter((item) => item.uid && !previousIds.has(item.uid))
        .slice(-1)[0]
      if (newest?.uid) {
        activeCodeRef.current = ''
        const switched = await patchProfilesConfig({ current: newest.uid })
        if (!switched) {
          await deleteProfile(newest.uid).catch(() => undefined)
          throw new Error('订阅内容验证失败，已保留原配置')
        }
      } else {
        throw new Error('无法定位新导入的订阅')
      }
      selected = true
      setManualImportUrl('')
      await mutateProfiles()
      await refreshAll()
      setStatus('订阅已导入并切换')
    } catch {
      if (!selected) activeCodeRef.current = previousActiveCode
      setStatus('订阅导入失败，请检查链接后重试')
    } finally {
      backgroundBusyRef.current = false
      setManualBusy(false)
    }
  })

  const manualImportFile = useLockFn(async (file: File, content: string) => {
    if (running) {
      setStatus('请先停止代理，再导入或切换配置')
      return
    }
    if (busy || manualBusy || refreshApplyInFlightRef.current) {
      setStatus('正在完成配置操作，请稍后重试')
      return
    }
    backgroundBusyRef.current = true
    setManualBusy(true)
    autoRefreshControllerRef.current?.abort()
    let createdUid: string | undefined
    let selected = false
    const previousActiveCode = activeCodeRef.current
    try {
      if (file.size > 8 * 1024 * 1024)
        throw new Error('配置文件请控制在 8MB 以内')
      const document = yaml.load(content)
      if (!document || typeof document !== 'object' || Array.isArray(document))
        throw new Error('请选择有效的 Clash YAML 配置文件')
      const before = await getProfiles()
      const previousIds = new Set((before.items || []).map((item) => item.uid))
      await createProfile(
        {
          type: 'local',
          name: file.name,
          desc: '手动导入的本地 Clash 配置',
          option: { with_proxy: false, self_proxy: false },
        } as IProfileItem,
        content,
      )
      const after = await getProfiles()
      createdUid = (after.items || []).find(
        (item) => item.uid && !previousIds.has(item.uid),
      )?.uid
      activeCodeRef.current = ''
      if (!createdUid || !(await patchProfilesConfig({ current: createdUid })))
        throw new Error('配置验证失败，已保留原配置')
      selected = true
      await mutateProfiles()
      await refreshAll()
      setStatus('文件已导入并选中，点击启动后生效')
    } catch (error) {
      if (!selected) activeCodeRef.current = previousActiveCode
      if (createdUid && !selected)
        await deleteProfile(createdUid).catch(() => undefined)
      setStatus(
        error instanceof Error ? error.message : '文件导入失败，已保留原配置',
      )
    } finally {
      backgroundBusyRef.current = false
      setManualBusy(false)
    }
  })

  const manualCreateLocal = useLockFn(async () => {
    if (busy || manualBusy || refreshApplyInFlightRef.current) {
      setStatus('正在完成配置操作，请稍后重试')
      return
    }
    autoRefreshControllerRef.current?.abort()
    backgroundBusyRef.current = true
    setManualBusy(true)
    setStatus('正在新建本地配置...')
    try {
      await createProfile(
        {
          type: 'local',
          name: `本地配置 ${new Date().toLocaleString()}`,
          desc: '手动编辑的本地 Clash 配置',
          url: '',
          option: { with_proxy: false, self_proxy: false },
        } as IProfileItem,
        yaml.dump({ proxies: [], 'proxy-groups': [], rules: [] }),
      )
      await mutateProfiles()
      await refreshAll()
      setStatus('已新建本地配置，可点击编辑填入节点')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      backgroundBusyRef.current = false
      setManualBusy(false)
    }
  })

  const manualSwitch = useLockFn(async (uid: string) => {
    if (running) {
      setStatus('请先停止代理，再导入或切换配置')
      return
    }
    if (busy || manualBusy || refreshApplyInFlightRef.current) {
      setStatus('正在完成配置操作，请稍后重试')
      return
    }
    autoRefreshControllerRef.current?.abort()
    backgroundBusyRef.current = true
    setManualBusy(true)
    const previousActiveCode = activeCodeRef.current
    try {
      activeCodeRef.current = ''
      const switched = await patchProfilesConfig({ current: uid })
      if (!switched) throw new Error('配置验证失败，仍使用原配置')
      await mutateProfiles()
      await refreshAll()
      setStatus('已切换配置文件')
    } catch (error) {
      activeCodeRef.current = previousActiveCode
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      backgroundBusyRef.current = false
      setManualBusy(false)
    }
  })

  const manualDelete = useLockFn(async (uid: string) => {
    if (busy || manualBusy || refreshApplyInFlightRef.current) {
      setStatus('正在完成配置操作，请稍后重试')
      return
    }
    autoRefreshControllerRef.current?.abort()
    backgroundBusyRef.current = true
    setManualBusy(true)
    try {
      await deleteProfile(uid)
      if (localStorage.getItem(EXPIRED_PROFILE_UID_KEY) === uid) {
        localStorage.removeItem(EXPIRED_PROFILE_UID_KEY)
        setExpiredProfileUid('')
      }
      if (localStorage.getItem(CODE_PROFILE_UID_KEY) === uid) {
        localStorage.removeItem(CODE_PROFILE_UID_KEY)
        localStorage.removeItem(CODE_STORAGE_KEY)
        localStorage.removeItem(CODE_EXPIRES_STORAGE_KEY)
        localStorage.removeItem(CODE_UPDATE_VERSION_STORAGE_KEY)
        setSavedCode('')
        setExpiresAt('')
        setCodeProfileUid('')
      }
      if (managedAuthRef.current?.profileUid === uid) {
        await persistManagedAuth(null)
      }
      await mutateProfiles()
      await refreshAll()
      setStatus('已删除配置文件')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      backgroundBusyRef.current = false
      setManualBusy(false)
    }
  })

  const manualEdit = useLockFn(async (uid: string, name: string) => {
    try {
      const value = await readProfileFile(uid)
      setEditorState({ uid, name, value })
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  })

  const manualSaveEdit = useLockFn(async () => {
    if (!editorState) return
    if (busy || manualBusy || refreshApplyInFlightRef.current) {
      setStatus('正在完成配置操作，请稍后再保存')
      return
    }
    autoRefreshControllerRef.current?.abort()
    backgroundBusyRef.current = true
    setManualBusy(true)
    try {
      const saved = await saveProfileFile(editorState.uid, editorState.value)
      if (!saved) throw new Error('配置验证失败，已恢复保存前内容')
      const auth = managedAuthRef.current
      if (auth?.profileUid === editorState.uid) {
        await persistManagedAuth({
          ...auth,
          detached: true,
          contentHash: await hashManagedContent(editorState.value),
        })
      }
      await mutateProfiles()
      await refreshAll()
      setStatus(
        auth?.profileUid === editorState.uid
          ? '配置已保存，并已转为本地管理；远程更新不会覆盖'
          : '配置已保存',
      )
      setEditorState(null)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      backgroundBusyRef.current = false
      setManualBusy(false)
    }
  })

  const waitForCoreReady = useCallback(async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const version = await withRequestDeadline(() => getVersion(), 1500)
        if (version?.version) return true
      } catch {
        // 核心刚启动时控制器会短暂不可用，继续等待。
      }
      await new Promise((resolve) => setTimeout(resolve, 200 + attempt * 100))
    }
    return false
  }, [])

  const waitForCoreStopped = useCallback(async () => {
    // stopCore now waits for this App's owned sidecar termination or service ack.
    // A /version response is not an ownership/lifecycle confirmation.
    return withRequestDeadline(() => getRunningMode(), 3000)
      .then((mode) => mode === 'NotRunning')
      .catch(() => false)
  }, [])

  const openCodeImport = useLockFn(async () => {
    if (
      busy ||
      manualBusy ||
      backgroundBusyRef.current ||
      refreshApplyInFlightRef.current
    ) {
      setStatus('正在完成配置操作，请稍后再切换提取码')
      return
    }
    // Own the transition before canceling old reads; pause disconnect/focus refresh.
    codeEntryActiveRef.current = true
    backgroundBusyRef.current = true
    autoRefreshControllerRef.current?.abort()
    setBusy(true)
    setStatus('')
    try {
      if (running || systemProxyConfigOn) {
        // Await native writes, without an optimistic toggle or a write timeout.
        await patchVergeConfig({
          enable_system_proxy: false,
          enable_tun_mode: false,
        })
        mutateVerge(
          (previous) =>
            previous
              ? {
                  ...previous,
                  enable_system_proxy: false,
                  enable_tun_mode: false,
                }
              : previous,
          false,
        )
        await stopCore()
        setConnectionReady(false)
        proxyUrlRef.current = ''
        previousRunningRef.current = false
        void invalidateProxyState().catch(() => undefined)
        void refreshAll().catch(() => undefined)
        void sendClientPresence(false).catch(() => undefined)
      }
      setExpiredDialogOpen(false)
      setCode('')
      setCodeImportPhase('input')
      setCodeImportMessage('')
      setCodeDialogOpen(true)
    } catch {
      codeEntryActiveRef.current = false
      setStatus('未能停止当前连接，请先点击停止，再重试切换提取码')
    } finally {
      backgroundBusyRef.current = false
      setBusy(false)
    }
  })

  const togglePower = useLockFn(async () => {
    if (manualBusy) {
      setStatus('正在保存配置，请稍后再启动')
      return
    }
    if (refreshApplyInFlightRef.current) {
      setStatus('正在完成节点配置更新，请稍后再试')
      return
    }
    autoRefreshControllerRef.current?.abort()
    setBusy(true)
    try {
      if (running) {
        if (tunOn) await patchVerge({ enable_tun_mode: false })
        if (systemProxyOn || systemProxyConfigOn) {
          await toggleSystemProxy(false)
        } else {
          await patchVerge({ enable_system_proxy: false })
        }
        await stopCore().catch(() => {})
        await invalidateProxyState()
        await refreshAll()
        sendClientPresence(false).catch(() => undefined)
        setStatus('已停止代理')
        return
      }

      if (!current?.uid) {
        setStatus('请先导入订阅')
        setCodeImportPhase('input')
        setCodeImportMessage('')
        setCodeDialogOpen(true)
        return
      }

      // 只有「提取码」导入的配置才做有效期校验;一键导入官网订阅 / 手动导入的
      // Clash 配置(无提取码)直接允许启动——服务端已用签名订阅 URL 控制有效性,
      // 不再强制客户端必须输入提取码,否则一键导入的用户会被卡住无法启动。
      if (currentCode) {
        setStatus('正在检查提取码有效期...')
        try {
          const state = await withRequestDeadline(
            (signal) => updateState(currentCode, signal),
            5000,
          )
          await syncExpiresAt(state.expires_at)
          let revision = ''
          try {
            const cached = JSON.parse(
              localStorage.getItem(CODE_REVISION_STORAGE_KEY) || 'null',
            )
            if (cached?.accessCode === currentCode)
              revision = cached.revision || ''
          } catch {
            /* old cache */
          }
          const wasRestricted =
            restrictionRef.current?.accessCode === currentCode
          const refreshBeforeStart =
            !startupRefreshCompletedRef.current ||
            wasRestricted ||
            codeExpired ||
            Boolean(
              state.subscription_revision &&
                state.subscription_revision !== revision,
            ) ||
            Number(state.update_version || 0) >
              Number(localStorage.getItem(CODE_UPDATE_VERSION_STORAGE_KEY) || 0)
          if (
            onExpiredProfile() ||
            ((wasRestricted || codeExpired) && !managedAuthRef.current)
          ) {
            await recoverFromExpired(Number(state.update_version || 0))
          } else if (refreshBeforeStart) {
            const result = await updateManagedProfile(
              Number(state.update_version || 0),
              { suppressValidationNotice: true },
            )
            if (result === 'unmanaged')
              await updateCurrentProfileKeepingRules(true)
            if (result !== 'managed-detached') {
              localStorage.setItem(
                CODE_UPDATE_VERSION_STORAGE_KEY,
                String(state.update_version || 0),
              )
              if (state.subscription_revision)
                localStorage.setItem(
                  CODE_REVISION_STORAGE_KEY,
                  JSON.stringify({
                    accessCode: currentCode,
                    revision: state.subscription_revision,
                  }),
                )
            }
          }
          if (refreshBeforeStart) {
            startupRefreshCompletedRef.current = true
            try {
              sessionStorage.setItem(STARTUP_REFRESH_SESSION_KEY, 'done')
            } catch {
              /* optional */
            }
          }
          clearAccessRestriction(currentCode)
        } catch (error) {
          if (error instanceof AccessCodeStateError && error.serverRejected) {
            const reason = error.stateCode
              ? restrictionReason(error.stateCode)
              : codeExpired
                ? 'expired'
                : 'unavailable'
            recordAccessRestriction(currentCode, reason)
            setExpiredDialogOpen(reason !== 'unavailable')
            setStatus(error.message)
            return
          }
          // A remembered restriction cannot be cleared by an offline startup.
          if (
            codeExpired ||
            restrictionRef.current?.accessCode === currentCode ||
            onExpiredProfile()
          ) {
            setStatus('尚未确认提取码恢复，请联网后重试')
            subscriptionMonitorRef.current?.wake()
            return
          }
        }
      }

      setStatus('正在启动...')
      if (proxyStateMismatch) {
        await toggleSystemProxy(false).catch(() => {})
      }
      await startCore().catch(() => restartCore())
      if (!(await waitForCoreReady())) {
        await restartCore()
        if (!(await waitForCoreReady())) {
          throw new Error('核心控制器没有启动，请运行一键自检查看服务路径')
        }
      }
      await mutateSystemState()

      if (tunOn) await patchVerge({ enable_tun_mode: false })
      const useTunForPowerStart =
        localStorage.getItem('SHENXIANYUN_POWER_START_TUN') === '1'
      if (useTunForPowerStart && isTunModeAvailable) {
        await patchVerge({ enable_tun_mode: true })
        if (systemProxyOn || systemProxyConfigOn) await toggleSystemProxy(false)
        setStatus('已启动 TUN 模式')
      } else {
        await toggleSystemProxy(true)
        await invalidateProxyState()
        setStatus('已启动系统代理')
      }
      await invalidateProxyState()
      await refreshAll()
      sendClientPresence(true).catch(() => undefined)
    } catch (error) {
      if (!running) {
        await patchVerge({ enable_tun_mode: false }).catch(() => undefined)
        await toggleSystemProxy(false).catch(() => undefined)
        await stopCore().catch(() => undefined)
        await invalidateProxyState().catch(() => undefined)
      }
      setStatus(
        error instanceof Error
          ? error.message
          : '操作失败，请重启软件或在高级设置中运行自检',
      )
    } finally {
      setBusy(false)
    }
  })

  const changeMode = useLockFn(async (_: unknown, value: string | null) => {
    if (!value || value === mode) return
    setBusy(true)
    setModeOverride(value)
    try {
      await patchClashMode(value)
      // 控制器在模式切换后会短暂刷新，立即读取可能得到
      // no.url.provided.local。延迟重试，但不把读取抖动当成切换失败。
      let confirmed = false
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)))
        const result = await refreshClashConfig().catch(() => undefined)
        const actual = result?.data?.mode?.toLowerCase()
        if (actual === value) {
          confirmed = true
          setModeOverride('')
          break
        }
      }
      if (!confirmed) {
        // Rust 命令已确认 PATCH 与持久化成功，保留即时高亮；后续数据刷新会接管。
        window.setTimeout(() => {
          refreshClashConfig().catch(() => undefined)
        }, 1500)
      }
      setStatus(value === 'global' ? '已切换全局模式' : '已切换规则模式')
    } catch (error) {
      setModeOverride('')
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  })

  const changeNode = (value: string) => {
    if (!nodeGroup || !value) return
    changeProxy(nodeGroup.name, value, nodeGroup.now)
  }

  const testNodeDelay = useLockFn(async () => {
    if (!nodeGroup || nodes.length === 0) {
      setStatus('没有可测试的节点')
      return
    }

    setDelayTesting(true)
    setStatus('正在测试节点连通性...')
    try {
      await delayManager.checkListDelay(
        nodes.map((node) => node.name),
        nodeGroup.name,
        DELAY_TIMEOUT,
        8,
      )
      setDelaySortTick((tick) => tick + 1)
      await refreshProxy()
      setStatus(
        '连通性测试完成：节点名后显示数字(毫秒)即代表连接正常，已按速度排序',
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setDelayTesting(false)
    }
  })

  // 核心混合端口（系统代理 / 经代理探测都走它）
  const mixedPort =
    Number(
      (clashConfig as { 'mixed-port'?: number; port?: number } | undefined)?.[
        'mixed-port'
      ] ?? (clashConfig as { port?: number } | undefined)?.port,
    ) || 7897
  const proxyUrl = `http://127.0.0.1:${mixedPort}`

  // 探测/验证的「直连兜底代理」：
  // - 内核在跑：用内核混合端口（内核带 52nm.de 直连规则，最可靠）。
  // - 内核没跑：回落到操作系统当前的系统代理（如用户在用 OpenClash 做系统代理），
  //   让 App 像浏览器一样能出网，解决冷启动「一打开全不通」。
  useEffect(() => {
    let cancelled = false
    const sync = async () => {
      if (running) {
        proxyUrlRef.current = proxyUrl
        return
      }
      try {
        const sp = await getSystemProxy()
        // server 形如 "127.0.0.1:7890"；排除指向本核心自身的残留代理
        if (sp?.enable && sp.server && !sp.server.startsWith('0.0.0.0')) {
          const url = `http://${sp.server}`
          if (!cancelled) proxyUrlRef.current = url === proxyUrl ? '' : url
          return
        }
      } catch {
        // 读不到就不用兜底代理
      }
      if (!cancelled) proxyUrlRef.current = ''
    }
    sync()
    return () => {
      cancelled = true
    }
  }, [running, proxyUrl])

  // 局域网端口提示：混合端口同时支持 HTTP/SOCKS；若单独开了 HTTP/SOCKS 端口也一并展示。
  const httpPort = verge?.verge_port
  const httpEnabled = verge?.verge_http_enabled ?? false
  const socksPort = verge?.verge_socks_port
  const socksEnabled = verge?.verge_socks_enabled ?? false
  const lanPortHint =
    `混合端口 ${mixedPort}（HTTP/SOCKS 通用）` +
    (httpEnabled && httpPort ? ` · HTTP ${httpPort}` : '') +
    (socksEnabled && socksPort ? ` · SOCKS ${socksPort}` : '')

  // 真实发起一次 HTTP 探测；viaProxy=true 时强制走核心混合端口，
  // 等价于「浏览器开了代理后」的真实出网路径。
  const probe = useCallback(
    async (
      url: string,
      viaProxy: boolean,
      timeout = 6000,
      proxyOverride = '',
    ) => {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), timeout)
      try {
        const res = await tauriFetch(url, {
          method: 'GET',
          signal: ctrl.signal,
          ...(viaProxy ? { proxy: { all: proxyOverride || proxyUrl } } : {}),
        })
        return res.status >= 200 && res.status < 400
      } catch {
        return false
      } finally {
        clearTimeout(t)
      }
    },
    [proxyUrl],
  )

  const startImportedProfile = async (activateProfile: () => Promise<void>) => {
    let activated = false

    try {
      // 切换期间先解除系统流量接管，防止旧核心与新配置短暂交叉。
      if (tunOn) await patchVerge({ enable_tun_mode: false })
      if (systemProxyOn || systemProxyConfigOn || proxyStateMismatch) {
        await toggleSystemProxy(false)
      }
      await invalidateProxyState()
      await stopCore()
      if (!(await waitForCoreStopped())) {
        throw new Error('旧核心未能停止，已取消切换以避免加载错误配置')
      }

      await activateProfile()
      activated = true
      // 配置切换命令会在核心已停止时尝试用新配置重启；若控制器仍未就绪，
      // 再显式启动，避免对刚成功启动的新核心做一次无意义的二次重启。
      if (!(await waitForCoreReady())) {
        await startCore().catch(() => restartCore())
        if (!(await waitForCoreReady())) {
          await restartCore()
          if (!(await waitForCoreReady())) {
            throw new Error('新订阅核心控制器启动失败')
          }
        }
      }
      await mutateSystemState()

      // 导入是配置交易，不再以节点延迟或实时联网结果作为提交门槛。
      // 只要配置可被核心加载就先保留，并恢复导入前的接管方式。
      await patchVerge({ enable_tun_mode: tunOn && isTunModeAvailable })
      await toggleSystemProxy(systemProxyOn || systemProxyConfigOn)
      await invalidateProxyState()
      await refreshAll()
    } catch (error) {
      // 回滚事务会重新加载旧配置；这里先保证失败的新配置不再接管网络。
      await patchVerge({ enable_tun_mode: false }).catch(() => undefined)
      await toggleSystemProxy(false).catch(() => undefined)
      await stopCore().catch(() => undefined)
      await invalidateProxyState().catch(() => undefined)
      if (activated) await refreshAll().catch(() => undefined)
      throw error
    }
  }

  const restoreConnectivityAfterImportFailure = async (snapshot: {
    wasRunning: boolean
    tunEnabled: boolean
    systemProxyEnabled: boolean
  }) => {
    if (!snapshot.wasRunning) return

    if (!(await waitForCoreReady())) {
      await startCore().catch(() => restartCore())
      if (!(await waitForCoreReady())) {
        await restartCore()
        if (!(await waitForCoreReady())) {
          throw new Error('旧配置已恢复，但核心控制器未能重新启动')
        }
      }
    }
    await mutateSystemState()
    await patchVerge({ enable_tun_mode: snapshot.tunEnabled })
    await toggleSystemProxy(snapshot.systemProxyEnabled)
    await invalidateProxyState()
    await refreshAll()
  }

  const rollbackManagedImport = async (
    transaction: ManagedInstallTransaction,
    connectivity: {
      wasRunning: boolean
      tunEnabled: boolean
      systemProxyEnabled: boolean
    },
  ) => {
    const failures: string[] = []
    try {
      await transaction.rollback()
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
    try {
      await restoreConnectivityAfterImportFailure(connectivity)
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
    return failures.join('；')
  }

  const importManagedRequest = useLockFn(
    async (request: ManagedImportRequest) => {
      if (refreshApplyInFlightRef.current) {
        setStatus('正在完成节点配置更新，请稍后重新导入')
        return
      }
      autoRefreshControllerRef.current?.abort()
      const connectivity = {
        wasRunning: running,
        tunEnabled: tunOn,
        systemProxyEnabled: systemProxyOn || systemProxyConfigOn,
      }
      let transaction: ManagedInstallTransaction | null = null
      setCodeDialogOpen(true)
      setCodeImportMessage('')
      setCodeImportPhase('checking')
      setBusy(true)
      try {
        const exchange = await exchangeImportTicket(request)
        const value = (exchange.name || request.name || '').trim()
        if (!value) throw new Error('安全导入未返回提取码')
        setCodeImportPhase('downloading')
        transaction = await installManagedSubscription(
          value,
          exchange,
          request.apiBase,
        )
        setCodeImportPhase('starting')
        await startImportedProfile(transaction.activate)
        await transaction.commit()
        setCodeImportPhase('success')
        setCodeImportMessage(
          `订阅已安全导入；节点当前是否在线不再阻止导入，可在节点恢复后连接${
            transaction.data.expires_at
              ? `，到期 ${transaction.data.expires_at}`
              : ''
          }`,
        )
        setStatus('订阅已安全导入，订阅地址不会显示')
      } catch (error) {
        let recoveryFailure = ''
        if (transaction) {
          recoveryFailure = await rollbackManagedImport(
            transaction,
            connectivity,
          )
        }
        setCodeImportPhase('error')
        setCodeDialogOpen(false)
        setStatus('暂未导入，请检查提取码或网络后重试')
        setCodeImportMessage(
          recoveryFailure
            ? `安全导入失败，且自动恢复未完成：${recoveryFailure}`
            : error instanceof Error
              ? `${error.message}；已恢复原订阅和原网络状态。`
              : '安全导入失败，请返回网页重新点击一键导入',
        )
      } finally {
        setBusy(false)
      }
    },
  )

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    const consume = async () => {
      const request = await takeManagedImportRequest().catch(() => null)
      if (!disposed && request) await importManagedRequest(request)
    }
    listen('shenxianyun://managed-import', consume)
      .then((stop) => {
        if (disposed) stop()
        else unlisten = stop
      })
      .catch(() => undefined)
    consume().catch(() => undefined)
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [importManagedRequest])

  const importByCode = useLockFn(async (startAfterImport = false) => {
    if (isLocalSettingsCommand(code)) {
      if (busy || manualBusy || refreshApplyInFlightRef.current) {
        setCodeImportMessage('正在完成配置操作，请稍后再试')
        return
      }
      setLocalWorkspace(true)
      setAdvancedOpen(true)
      setCodeDialogOpen(false)
      setCode('')
      setCodeImportPhase('input')
      setCodeImportMessage('')
      setStatus('已进入本机高级模式，可先管理配置，再点击启动')
      return
    }
    if (running || systemProxyConfigOn) {
      setCodeImportPhase('input')
      setCodeImportMessage('请先停止代理，再切换提取码')
      return
    }
    if (refreshApplyInFlightRef.current) {
      setCodeImportMessage('正在完成节点配置更新，请稍后再试')
      return
    }
    autoRefreshControllerRef.current?.abort()
    const value = code.trim()
    if (!value) {
      setCodeImportMessage('请输入提取码')
      return
    }

    setBusy(true)
    setStatus('')
    setCodeImportMessage('')
    let phase: CodeImportPhase = 'checking'
    let transaction: ManagedInstallTransaction | null = null
    const connectivity = {
      wasRunning: running,
      tunEnabled: tunOn,
      systemProxyEnabled: systemProxyOn || systemProxyConfigOn,
    }
    const updatePhase = (next: CodeImportPhase) => {
      phase = next
      setCodeImportPhase(next)
    }
    updatePhase('checking')
    try {
      transaction = await activateCode(value, 3, updatePhase)
      updatePhase('starting')
      await startImportedProfile(transaction.activate)
      if (startAfterImport) {
        // Establish connectivity before committing: a start failure can still roll back.
        await toggleSystemProxy(true)
        await invalidateProxyState()
        await refreshAll()
      }
      await transaction.commit()
      startupRefreshCompletedRef.current = true
      try {
        sessionStorage.setItem(STARTUP_REFRESH_SESSION_KEY, 'done')
      } catch {
        /* memory completion remains */
      }
      if (startAfterImport) setCodeDialogOpen(false)
      setCode('')
      updatePhase('success')
      setCodeImportMessage(
        `${isSwitchingCode ? '提取码已切换' : '订阅已导入'}；节点当前是否在线不再阻止导入，可在节点恢复后连接${
          transaction.data.expires_at
            ? `，到期 ${transaction.data.expires_at}`
            : ''
        }`,
      )
      setStatus(startAfterImport ? '已启动' : '订阅已导入，可在节点恢复后连接')
    } catch (error) {
      let recoveryFailure = ''
      if (transaction) {
        recoveryFailure = await rollbackManagedImport(transaction, connectivity)
      }
      const failedPhase = phase
      if (startAfterImport)
        setStatus('启动失败，已保留原订阅，请检查提取码或网络后重试')
      updatePhase('error')
      setCodeDialogOpen(false)
      setStatus('暂未导入，请检查提取码或网络后重试')
      setCodeImportMessage(
        recoveryFailure
          ? `新订阅未启用，且自动恢复未完成：${recoveryFailure}`
          : error instanceof ManagedInstallError
            ? error.message
            : failedPhase === 'checking'
              ? '提取码验证失败，请检查提取码或网络后重试。'
              : failedPhase === 'downloading'
                ? '订阅获取失败，请稍后重新检测。'
                : transaction && error instanceof Error
                  ? `${error.message}；已恢复原订阅和原网络状态。`
                  : transaction
                    ? '新订阅联网检查失败，已恢复原订阅和原网络状态。'
                    : error instanceof Error
                      ? error.message
                      : '订阅启动失败，请稍后重试。',
      )
    } finally {
      setBusy(false)
    }
  })

  // 覆盖安装自愈：升级/覆盖安装后常见「系统代理已开但内核未真正就绪」→ 全系统断网。
  // 启动后延迟探测：系统代理已配置但经核心端口出不了网 → 自动重启内核并重设系统代理；
  // 仍不通则先关闭系统代理保住本机上网，提示用户自检。只在启动后自动执行一次。
  const selfHealRanRef = useRef(false)
  useEffect(() => {
    if (selfHealRanRef.current) return
    // TUN 模式流量不走系统代理，另有自检覆盖；未配置系统代理则无残留可修。
    if (!systemProxyConfigOn || tunOn) return
    selfHealRanRef.current = true

    const timer = window.setTimeout(async () => {
      // 国内 + 国外各探一次，任一通过则认为核心端口健康（避免单节点抖动误判）。
      const portAlive = async () =>
        (await probe('https://www.baidu.com', true, 8000)) ||
        (await probe('https://www.gstatic.com/generate_204', true, 8000))

      if (await portAlive()) return

      setStatus('检测到系统代理异常（常见于覆盖安装后），正在自动修复...')
      await restartCore().catch(() => {})
      await toggleSystemProxy(false).catch(() => {})
      await toggleSystemProxy(true).catch(() => {})
      await invalidateProxyState().catch(() => {})

      if (await portAlive()) {
        setStatus('系统代理已自动修复')
        await refreshAll().catch(() => {})
        return
      }

      // 修不好：先把系统代理关掉，把上网能力还给用户，再引导自检。
      await toggleSystemProxy(false).catch(() => {})
      await invalidateProxyState().catch(() => {})
      setStatus(
        '代理端口不通，已暂时关闭系统代理恢复上网；请点「一键自检」排查或彻底重置',
      )
    }, 3000)

    return () => window.clearTimeout(timer)
  }, [
    systemProxyConfigOn,
    tunOn,
    probe,
    toggleSystemProxy,
    invalidateProxyState,
    refreshAll,
  ])

  // 取出口 IP / 国家；viaProxy=true 反映节点出口（与系统代理同源，因为系统代理也指向
  // 内核混合端口），false 反映本地直连出口。优先用 Cloudflare trace（纯文本、极稳、几乎
  // 不被限流），再退回各 JSON 查询源，最大化"一定取到 IP"。
  const fetchEgress = useCallback(
    async (viaProxy: boolean, ipv6 = false) => {
      const req = async (url: string, timeout = 8000) => {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), timeout)
        try {
          const res = await tauriFetch(url, {
            method: 'GET',
            signal: ctrl.signal,
            ...(viaProxy ? { proxy: { all: proxyUrl } } : {}),
          })
          return res.ok ? res : null
        } catch {
          return null
        } finally {
          clearTimeout(t)
        }
      }

      // 1) Cloudflare trace（文本 ip=.. loc=..），IPv4/IPv6 都可能返回，最稳
      if (!ipv6) {
        for (const url of [
          'https://www.cloudflare.com/cdn-cgi/trace',
          'https://cloudflare.com/cdn-cgi/trace',
          'https://1.1.1.1/cdn-cgi/trace',
        ]) {
          const res = await req(url)
          if (!res) continue
          try {
            const text = await res.text()
            const map: Record<string, string> = {}
            text.split('\n').forEach((line) => {
              const i = line.indexOf('=')
              if (i > 0) map[line.slice(0, i)] = line.slice(i + 1)
            })
            const ip = map.ip || ''
            // 只取 IPv4（trace 有时给 v6，v6 场景另有分支）
            if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
              return {
                ip,
                cc: (map.loc || '').toUpperCase(),
                country: map.loc || '',
              }
            }
          } catch {
            // 下一个
          }
        }
      }

      // 2) JSON 查询源
      const endpoints = ipv6
        ? [
            'https://api6.ipify.org?format=json',
            'https://6.ipw.cn/api/ip/myip?json',
            'https://v6.ident.me/.json',
          ]
        : [
            'https://api.ip.sb/geoip',
            'https://ipwho.is/',
            'https://get.geojs.io/v1/ip/geo.json',
            'https://ipapi.co/json',
            'https://api.ipify.org?format=json',
          ]
      for (const url of endpoints) {
        const res = await req(url)
        if (!res) continue
        try {
          const d = (await res.json()) as Record<string, unknown>
          const loc = (d.location ?? {}) as Record<string, unknown>
          const ip = String(d.ip ?? d.IP ?? '')
          if (!ip) continue
          const cc = String(
            d.country_code ??
              d.country ??
              loc.country_code ??
              loc.country ??
              '',
          ).toUpperCase()
          const country = String(
            d.country_name ?? d.country ?? loc.country ?? '',
          )
          return { ip, cc, country }
        } catch {
          // 试下一个
        }
      }
      return null
    },
    [proxyUrl],
  )

  const runSelfCheck = useLockFn(async () => {
    setSelfChecking(true)
    const steps: SelfCheckItem[] = [
      { key: 'core', label: '内核', status: 'pending', detail: '检测中…' },
      { key: 'mode', label: '运行模式', status: 'pending', detail: '检测中…' },
      {
        key: 'service',
        label: '系统服务',
        status: 'pending',
        detail: '检测中…',
      },
      {
        key: 'install',
        label: '安装与残留',
        status: 'pending',
        detail: '检测中…',
      },
      {
        key: 'sysproxy',
        label: '系统代理',
        status: 'pending',
        detail: '检测中…',
      },
      { key: 'tun', label: 'TUN 网卡', status: 'pending', detail: '检测中…' },
      {
        key: 'sub',
        label: '订阅 / 提取码',
        status: 'pending',
        detail: '检测中…',
      },
      {
        key: 'proxymode',
        label: '代理模式',
        status: 'pending',
        detail: '检测中…',
      },
      { key: 'node', label: '节点连通', status: 'pending', detail: '检测中…' },
      { key: 'lan', label: '本地网络', status: 'pending', detail: '检测中…' },
      {
        key: 'lanaccess',
        label: '局域网访问',
        status: 'pending',
        detail: '检测中…',
      },
      {
        key: 'domestic',
        label: '国内站点',
        status: 'pending',
        detail: '检测中…',
      },
      {
        key: 'external',
        label: '国外站点',
        status: 'pending',
        detail: '检测中…',
      },
      { key: 'ipv6', label: 'IPv6 连通', status: 'pending', detail: '检测中…' },
    ]
    setSelfCheckItems(steps.map((s) => ({ ...s })))
    const set = (
      key: string,
      status: SelfCheckStatus,
      detail: string,
      fix?: () => Promise<void>,
      fixLabel?: string,
    ) =>
      setSelfCheckItems((prev) =>
        prev.map((item) =>
          item.key === key
            ? { ...item, status, detail, fix, fixLabel, fixing: false }
            : item,
        ),
      )

    const diagnostics = await getServiceDiagnostics().catch(() => null)

    try {
      const v = await getVersion()
      const pid = diagnostics?.sidecarPid
        ? ` · PID ${diagnostics.sidecarPid}`
        : ''
      set('core', 'ok', `运行中${v?.version ? ` v${v.version}` : ''}${pid}`)
    } catch {
      set(
        'core',
        'fail',
        '未运行',
        async () => {
          await restartCore()
        },
        '重启内核',
      )
    }

    set(
      'mode',
      runningMode === 'Service' || isAdminMode ? 'ok' : 'warn',
      runningMode === 'Service'
        ? 'Service 服务模式（TUN 可用）'
        : isAdminMode
          ? 'Sidecar · 管理员（TUN 可用）'
          : 'Sidecar 普通模式（TUN 不可用，需装服务或以管理员运行）',
      runningMode === 'Service' || isAdminMode
        ? undefined
        : async () => {
            await installService()
            await restartCore()
          },
      runningMode === 'Service' || isAdminMode ? undefined : '安装服务',
    )
    set(
      'service',
      diagnostics?.serviceProtocolMismatch
        ? 'fail'
        : isServiceOk
          ? 'ok'
          : 'warn',
      diagnostics?.serviceProtocolMismatch
        ? `协议与当前客户端不匹配：已装 ${
            diagnostics.serviceVersionInstalled ?? '版本未知'
          }，客户端要求 ${diagnostics.serviceVersionExpected}。点「修复服务」重装即可`
        : isServiceOk
          ? '已安装且协议匹配'
          : '未安装或不可连接（TUN 需要它）',
      diagnostics?.serviceProtocolMismatch
        ? async () => {
            await repairService()
            await restartCore()
          }
        : isServiceOk
          ? undefined
          : async () => {
              await installService()
              await restartCore()
            },
      diagnostics?.serviceProtocolMismatch
        ? '修复服务'
        : isServiceOk
          ? undefined
          : '安装服务',
    )
    if (diagnostics) {
      const appName =
        diagnostics.appPath.split(/[\\/]/).pop() || diagnostics.appPath
      const coreName =
        diagnostics.expectedCorePath.split(/[\\/]/).pop() ||
        diagnostics.expectedCorePath
      set(
        'install',
        diagnostics.warnings.length > 0 ? 'warn' : 'ok',
        diagnostics.warnings.length > 0
          ? diagnostics.warnings.join('；')
          : `当前 ${appName} · 核心 ${coreName} · ${diagnostics.runningMode}`,
      )
    } else {
      set('install', 'warn', '无法读取安装、核心和开机启动诊断信息')
    }

    if (systemProxyConfigOn && !systemProxyOn) {
      set(
        'sysproxy',
        'fail',
        '已配置但未生效（浏览器走不了代理）',
        async () => {
          await toggleSystemProxy(false).catch(() => {})
          await toggleSystemProxy(true)
        },
        '重设系统代理',
      )
    } else if (systemProxyOn) {
      set('sysproxy', 'ok', `已开启 · 端口 ${mixedPort}`)
    } else if (tunOn) {
      set('sysproxy', 'ok', '未开启（已由 TUN 接管流量）')
    } else {
      set(
        'sysproxy',
        'warn',
        '未开启',
        async () => {
          await toggleSystemProxy(true)
        },
        '开启',
      )
    }

    if (tunOn) {
      // flag(clashConfig.tun.enable) 运行时读不准，改用实测：
      // 不走代理直连国外 204，能通说明 TUN 确实在接管并出网。
      const tunWorks = await probe(
        'https://www.gstatic.com/generate_204',
        false,
      )
      if (tunWorks) {
        set('tun', 'ok', '已开启并生效（实测可出网）')
      } else if (!isTunModeAvailable) {
        set(
          'tun',
          'fail',
          '开关已开，但服务未就绪/非管理员，TUN 未生效',
          async () => {
            await installService()
            await restartCore()
          },
          '安装服务',
        )
      } else {
        set(
          'tun',
          'fail',
          '开关已开但实测不通，请重启内核',
          async () => {
            await restartCore()
          },
          '重启内核',
        )
      }
    } else {
      set(
        'tun',
        isTunModeAvailable ? 'ok' : 'warn',
        isTunModeAvailable ? '未开启' : '未开启（系统服务未安装）',
      )
    }

    if (!current?.uid) set('sub', 'fail', '未导入订阅')
    else if (!currentCode) set('sub', 'ok', '当前为手动或外部配置')
    else if (codeExpired) set('sub', 'fail', '提取码已过期')
    else set('sub', 'ok', expiresAt ? `已绑定，到期 ${expiresAt}` : '已绑定')

    const proxyMode = String(
      (clashConfig as { mode?: string } | undefined)?.mode || '',
    ).toLowerCase()
    if (proxyMode === 'global') {
      set(
        'proxymode',
        'warn',
        '全局模式：国内站点也走国外节点，会打不开',
        async () => {
          await patchClashMode('rule')
        },
        '改规则模式',
      )
    } else if (proxyMode === 'direct') {
      set(
        'proxymode',
        'warn',
        '直连模式：完全不走代理，国外打不开',
        async () => {
          await patchClashMode('rule')
        },
        '改规则模式',
      )
    } else if (proxyMode === 'rule') {
      set('proxymode', 'ok', '规则模式（国内直连、国外走代理）')
    } else {
      set('proxymode', proxyMode ? 'warn' : 'ok', proxyMode || '规则')
    }

    if (!selectedNode || !nodeGroup) {
      set('node', 'warn', '暂无可用节点')
    } else {
      try {
        await delayManager.checkDelay(selectedNode, nodeGroup.name, 5000)
        const delay = delayManager.getDelay(selectedNode, nodeGroup.name)
        if (delay > 0 && delay < 5000) {
          set('node', 'ok', `${selectedNode} · ${delay}ms`)
        } else {
          set(
            'node',
            'fail',
            `${selectedNode} · 超时不通`,
            async () => {
              await enhanceProfiles()
              await refreshProxy().catch(() => {})
            },
            '重载配置',
          )
        }
      } catch {
        set(
          'node',
          'fail',
          '测试失败',
          async () => {
            await enhanceProfiles()
            await refreshProxy().catch(() => {})
          },
          '重载配置',
        )
      }
    }

    // 「修复网络」：关 DNS 覆写（fake-ip 会把国内域名解析坏）+ 模式回 rule + 重启内核
    const fixNetwork = async () => {
      await invoke('apply_dns_config', { apply: false }).catch(() => {})
      await patchClashMode('rule').catch(() => {})
      await restartCore()
      await refreshClashConfig?.().catch(() => {})
    }

    // 局域网访问：是否允许同网段设备连接本机代理，并给出可用端口，方便手动填代理。
    if (allowLanOn) {
      set('lanaccess', 'ok', `已开启 · ${lanPortHint}`)
    } else {
      set(
        'lanaccess',
        'warn',
        `未开启（仅本机可用）· ${lanPortHint}`,
        async () => {
          await patchClash({ 'allow-lan': true })
        },
        '开启局域网',
      )
    }

    // 本地网络：直连国内站点（不走代理），验证机器本身有网
    const lanOk = await probe('https://www.baidu.com', false)
    if (lanOk) {
      set('lan', 'ok', '正常（机器本身可上网）')
    } else {
      set(
        'lan',
        'fail',
        '直连都打不开，本地网络/系统 DNS 异常',
        async () => {
          await restartCore()
        },
        '重启内核',
      )
    }

    // 国内站点：经核心混合端口访问国内站，等同浏览器开代理时的真实路径。
    // 开了 DNS 覆写(fake-ip)时，国内直连域名会被解析成无效 fake-ip 而打不开。
    const domesticOk = await probe('https://www.baidu.com', true)
    if (domesticOk) {
      set('domestic', 'ok', '经代理可访问国内站点')
    } else {
      set(
        'domestic',
        'fail',
        dnsOverwriteOn
          ? '国内站点打不开（DNS 覆写 fake-ip 把直连域名解析坏了）'
          : '国内站点打不开（多为全局模式或规则问题）',
        fixNetwork,
        '修复网络',
      )
    }

    // 国外站点：走核心混合端口取真实出口 IP/国家。系统代理也指向该端口，
    // 所以这里的出口 IP 与浏览器/系统代理看到的完全一致。
    const egress = await fetchEgress(true)
    if (!egress) {
      // 取不到 IP 时再多试一次（换更稳的源/更长超时），避免误报
      const retry = await fetchEgress(true)
      const eg2 = retry
      if (eg2) {
        set(
          'external',
          eg2.cc === 'CN' ? 'warn' : 'ok',
          `出口 ${eg2.ip}${eg2.country ? ` (${eg2.country})` : ''}（与系统代理同源）`,
        )
      } else {
        const g = await probe('https://www.gstatic.com/generate_204', true)
        set(
          'external',
          g ? 'warn' : 'fail',
          g
            ? '外网可访问，但出口 IP 查询站均超时/被限，稍后重试可显示'
            : '经代理无法访问外网（核心 / 节点 / DNS 异常）',
          g ? undefined : fixNetwork,
          g ? undefined : '修复网络',
        )
      }
    } else if (egress.cc === 'CN') {
      set(
        'external',
        'warn',
        `出口在国内 ${egress.ip}（节点未出国 / 选了国内中转）`,
      )
    } else {
      set(
        'external',
        'ok',
        `出口 ${egress.ip}${egress.country ? ` (${egress.country})` : ''}（与系统代理同源）`,
      )
    }

    // IPv6：经代理探测 v6 出口，多数情况下不通也不影响上网
    const egress6 = await fetchEgress(true, true)
    if (egress6) {
      set('ipv6', 'ok', `IPv6 出口 ${egress6.ip}`)
    } else {
      set('ipv6', 'warn', 'IPv6 不通（多数情况不影响上网）')
    }

    setSelfChecking(false)
  })

  const runSelfCheckFix = useLockFn(async (item: SelfCheckItem) => {
    if (!item.fix) return
    setSelfCheckItems((prev) =>
      prev.map((it) =>
        it.key === item.key ? { ...it, fixing: true, detail: '修复中…' } : it,
      ),
    )
    try {
      await item.fix()
    } catch {
      // 失败也继续，重新自检会反映真实状态
    }
    await Promise.allSettled([
      mutateSystemState?.(),
      refreshClashConfig?.(),
      invalidateProxyState?.(),
    ])
    await runSelfCheck()
  })

  // 一键尝试修复：依次执行所有检测项各自的自动修复动作，然后重新自检。
  // 比「彻底重置」温和得多——不删配置、不清数据，只修复能修的项。
  const runSelfCheckFixAll = useLockFn(async () => {
    const fixables = selfCheckItems.filter((it) => it.fix)
    if (fixables.length === 0) {
      setStatus('没有可自动修复的项')
      return
    }
    setSelfChecking(true)
    setStatus('正在尝试自动修复...')
    for (const it of fixables) {
      setSelfCheckItems((prev) =>
        prev.map((x) =>
          x.key === it.key ? { ...x, fixing: true, detail: '修复中…' } : x,
        ),
      )
      try {
        await it.fix?.()
      } catch {
        // 单项失败不影响其它项，最终重测会反映真实状态
      }
    }
    await Promise.allSettled([
      mutateSystemState?.(),
      refreshClashConfig?.(),
      invalidateProxyState?.(),
    ])
    await runSelfCheck()
    setStatus('已尝试自动修复，请查看最新结果')
  })

  // 彻底重置：重建配置和修复系统服务可以分别选择。稳定 client_id 必须保留，
  // 否则重置后会被服务端识别成新设备并额外占用绑定名额。
  const factoryReset = useLockFn(async () => {
    if (!resetRebuildConfig && !resetRepairService) {
      setStatus('请至少选择“删除旧配置”或“修复系统服务”')
      return
    }
    setResetting(true)
    const previousManagedAuth =
      managedAuthRef.current ?? (await loadManagedAuth().catch(() => null))
    const resetStorage = new Map(
      Object.keys(localStorage)
        .filter((key) => key.startsWith('shenxianyun.'))
        .map((key) => [key, localStorage.getItem(key)]),
    )
    const resetConnectivity = {
      wasRunning: running || runningMode !== 'NotRunning',
      tunEnabled: tunOn,
      systemProxyEnabled: systemProxyOn || systemProxyConfigOn,
    }
    const restoreResetStorage = () => {
      Object.keys(localStorage)
        .filter((key) => key.startsWith('shenxianyun.'))
        .forEach((key) => localStorage.removeItem(key))
      for (const [key, value] of resetStorage) {
        if (value !== null) localStorage.setItem(key, value)
      }
      setSavedCode(resetStorage.get(CODE_STORAGE_KEY) || '')
      setExpiresAt(resetStorage.get(CODE_EXPIRES_STORAGE_KEY) || '')
      setCodeProfileUid(resetStorage.get(CODE_PROFILE_UID_KEY) || '')
      setExpiredProfileUid(resetStorage.get(EXPIRED_PROFILE_UID_KEY) || '')
    }
    try {
      const stableClientId = getClientId()

      if (resetRepairService) {
        setStatus('正在修复系统服务，请确认管理员授权…')
        await repairService()
      }

      if (!resetRebuildConfig) {
        setStatus('系统服务已修复，正在重启…')
        await restartApp()
        return
      }

      if (resetCreateBackup) {
        await createLocalBackup()
      }

      // 管理员授权和备份都成功后再改变网络状态。这样用户取消授权或修复
      // 失败时，不会被错误标记离线，也不会留下代理 / TUN 被关闭的副作用。
      await sendClientPresence(false).catch(() => undefined)
      await patchVerge({ enable_tun_mode: false }).catch(() => {})
      await toggleSystemProxy(false).catch(() => {})
      await invoke('apply_dns_config', { apply: false }).catch(() => {})
      await patchClashMode('rule').catch(() => {})

      Object.keys(localStorage)
        .filter(
          (key) =>
            key.startsWith('shenxianyun.') && key !== CLIENT_ID_STORAGE_KEY,
        )
        .forEach((key) => {
          localStorage.removeItem(key)
        })
      localStorage.setItem(CLIENT_ID_STORAGE_KEY, stableClientId)
      await persistManagedAuth(null).catch(() => undefined)
      setStatus('旧配置已清理，正在生成全新配置…')
      await factoryResetApp()
    } catch (error) {
      restoreResetStorage()
      await persistManagedAuth(previousManagedAuth).catch(() => undefined)
      await restoreConnectivityAfterImportFailure(resetConnectivity).catch(
        () => undefined,
      )
      setResetting(false)
      setStatus(
        `重置失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  })

  const loadTrafficRules = useCallback(async () => {
    if (!rulesProfileUid) {
      setTrafficRules([])
      return
    }

    try {
      const content = await readProfileFile(rulesProfileUid)
      const data = yaml.load(content) as {
        'prepend-rules'?: unknown
        'append-rules'?: unknown
      } | null
      const prepend = Array.isArray(data?.['prepend-rules'])
        ? data['prepend-rules']
        : []
      const append = Array.isArray(data?.['append-rules'])
        ? data['append-rules']
        : []
      setTrafficRules(
        [...prepend, ...append]
          .filter((rule) => rule !== DOMESTIC_API_DIRECT_RULE)
          .map(parseTrafficRule)
          .filter((item): item is TrafficRuleItem => Boolean(item)),
      )
    } catch {
      setTrafficRules([])
    }
  }, [rulesProfileUid])

  const saveTrafficRuleAppend = async (nextRule: string) => {
    const content = await readProfileFile(rulesProfileUid)
    const data = (yaml.load(content) as Record<string, unknown> | null) || {}
    await saveRuleEdit(() =>
      saveProfileFile(
        rulesProfileUid,
        yaml.dump(upsertTrafficRule(data, nextRule), { lineWidth: -1 }),
      ),
    )
  }

  const addTrafficRule = useLockFn(async () => {
    const isDomainType =
      TRAFFIC_RULE_TYPES.find((t) => t.name === trafficRuleType)?.domain ?? true
    const value = isDomainType
      ? normalizeRuleDomain(trafficRuleInput)
      : trafficRuleInput.trim()
    const policy = trafficRulePolicy || selectedNode || nodeGroup?.name || ''

    if (!value) {
      setStatus('请输入规则内容')
      return
    }
    if (!policy) {
      setStatus('请选择要走的节点')
      return
    }

    setBusy(true)
    try {
      await saveTrafficRuleAppend(`${trafficRuleType},${value},${policy}`)
      setTrafficRuleInput('')
      setTrafficRulePolicy(policy)
      await loadTrafficRules()
      await refreshAll()
      setStatus(`已添加规则：${trafficRuleType} ${value} 走 ${policy}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  })

  const deleteTrafficRule = useLockFn(async (target: TrafficRuleItem) => {
    if (!rulesProfileUid) return

    setBusy(true)
    try {
      const content = await readProfileFile(rulesProfileUid)
      const data = (yaml.load(content) as Record<string, unknown> | null) || {}
      await saveRuleEdit(() =>
        saveProfileFile(
          rulesProfileUid,
          yaml.dump(removeTrafficRule(data, target.raw), { lineWidth: -1 }),
        ),
      )
      await loadTrafficRules()
      await refreshAll()
      setStatus(`已删除规则：${target.value}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  })

  useEffect(() => {
    if (!trafficRuleOpen) return
    loadTrafficRules()
  }, [loadTrafficRules, trafficRuleOpen])

  const toggleAllowLan = useLockFn(async (checked: boolean) => {
    setBusy(true)
    try {
      await patchClash({ 'allow-lan': checked })
      await refreshClashConfig()
      setStatus(checked ? '局域网连接已开启' : '局域网连接已关闭')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  })

  const toggleDnsOverwrite = useLockFn(async (checked: boolean) => {
    setBusy(true)
    try {
      if (checked) {
        // 单页版没有 DNS 设置页，首次开启时写入一份抗污染默认 DNS（fake-ip + 可信 DoH）
        const exists = await invoke<boolean>('check_dns_config_exists').catch(
          () => false,
        )
        if (!exists) {
          await invoke('save_dns_config', { dnsConfig: DEFAULT_DNS_CONFIG })
        }
      }
      await patchVerge({ enable_dns_settings: checked })
      await invoke('apply_dns_config', { apply: checked })
      await refreshClashConfig()
      setStatus(checked ? 'DNS 覆写已开启（抗污染）' : 'DNS 覆写已关闭')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  })

  const toggleProxyGuard = useLockFn(async (checked: boolean) => {
    setBusy(true)
    try {
      await patchVerge({ enable_proxy_guard: checked })
      setStatus(checked ? '系统代理守护已开启' : '系统代理守护已关闭')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  })

  return (
    <BasePage
      full
      contentStyle={{
        height: '100%',
        padding: 0,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          height: '100%',
          minHeight: 0,
          color: LIGHT_SURFACE_TEXT_COLOR,
          colorScheme: 'light',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          px: 1.5,
          py: 1.5,
          overflow: 'auto',
          position: 'relative',
          background:
            'radial-gradient(900px 420px at 18% 0%, rgba(255,255,255,.5), transparent 55%), radial-gradient(1100px 520px at 88% 100%, rgba(140,150,245,.45), transparent 60%), linear-gradient(135deg, #aebef2 0%, #c3c6f4 38%, #98aef0 72%, #8fa4ee 100%)',
        }}
      >
        <Box
          data-tauri-drag-region="true"
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 88,
            height: 34,
            zIndex: 12,
          }}
        />
        <Stack
          spacing={1}
          sx={{
            width: '100%',
            height: '100%',
            minHeight: 360,
            flexShrink: 0,
          }}
        >
          {localWorkspace && (
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', flexWrap: 'wrap' }}
            >
              <Chip label="本机高级模式" size="small" />
              <Typography variant="body2" sx={{ flex: 1, color: '#33406e' }}>
                {current?.name || '请导入或选择配置'}
              </Typography>
              <Button
                disabled={busy || manualBusy}
                onClick={() => setProfileManagerOpen(true)}
              >
                配置管理
              </Button>
              <Button
                disabled={busy || manualBusy}
                onClick={() => setAdvancedOpen(true)}
              >
                高级设置
              </Button>
              <Button
                disabled={busy || manualBusy}
                onClick={() => {
                  setLocalWorkspace(false)
                  setAdvancedOpen(false)
                  setProfileManagerOpen(false)
                  setEditorState(null)
                  setStatus('')
                }}
              >
                退出高级模式
              </Button>
            </Stack>
          )}
          {currentCode && (
            <Typography
              role="status"
              sx={{
                fontSize: 13,
                color: codeExpired ? '#973f38' : '#33406e',
                px: 1,
              }}
            >
              {accountExpiryLabel(expiresAt)}
            </Typography>
          )}
          {!showConnectionOptions ? (
            <Paper
              elevation={0}
              sx={{
                flex: 1,
                minHeight: 300,
                display: 'grid',
                gridTemplateColumns: {
                  xs: '1fr',
                  sm: 'minmax(180px, .9fr) minmax(220px, 1.1fr)',
                },
                alignContent: 'center',
                alignItems: 'center',
                gap: 3,
                p: { xs: 2.5, sm: 4 },
                borderRadius: '26px',
                border: '1px solid rgba(255,255,255,.6)',
                background:
                  'linear-gradient(140deg, rgba(255,255,255,.28), rgba(255,255,255,.1))',
                backdropFilter: 'blur(22px)',
                boxShadow:
                  'inset 0 1px 0 rgba(255,255,255,.7), 0 18px 48px rgba(80,100,190,.16)',
              }}
            >
              <Box sx={{ display: 'grid', placeItems: 'center' }}>
                <GlassPowerButton
                  prominent
                  running={running}
                  busy={busy}
                  disabled={!savedCode && !code.trim()}
                  onClick={() =>
                    savedCode || running ? togglePower() : importByCode(true)
                  }
                />
              </Box>
              <Stack
                spacing={2}
                sx={{
                  minWidth: 0,
                  width: '100%',
                  maxWidth: 420,
                  justifySelf: 'center',
                }}
              >
                <Typography
                  variant="h4"
                  sx={{ fontWeight: 800, color: '#33406e' }}
                >
                  {runtimeBrand.client_name}
                </Typography>
                {!savedCode ? (
                  <TextField
                    fullWidth
                    label="输入提取码"
                    value={code}
                    disabled={busy}
                    sx={fieldSx}
                    onChange={(event) => setCode(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !busy)
                        void importByCode(true)
                    }}
                  />
                ) : (
                  <Button
                    variant="outlined"
                    disabled={busy}
                    startIcon={<KeyRounded />}
                    sx={{ ...outlineButtonSx, py: 1.2 }}
                    onClick={() => void openCodeImport()}
                  >
                    切换提取码
                  </Button>
                )}
                {showRenewal && (
                  <Button
                    variant="outlined"
                    startIcon={<ShoppingCartRounded />}
                    sx={outlineButtonSx}
                    onClick={() =>
                      void openRenewal().catch(() =>
                        setStatus('续费页面暂未打开，请稍后重试'),
                      )
                    }
                  >
                    {activeRestriction?.reason === 'traffic_limit'
                      ? '续费 / 恢复流量'
                      : '续费'}
                  </Button>
                )}
                {importantStatus && (
                  <Alert severity="warning" onClose={() => setStatus('')}>
                    {importantStatus}
                  </Alert>
                )}
              </Stack>
            </Paper>
          ) : (
            <>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                sx={{
                  alignItems: { xs: 'center', sm: 'flex-end' },
                  justifyContent: 'space-between',
                }}
              >
                <Box>
                  <Typography
                    variant="h5"
                    sx={{
                      fontWeight: 900,
                      letterSpacing: 0,
                      color: '#ffffff',
                      textShadow: '0 2px 18px rgba(90,110,220,.45)',
                    }}
                  >
                    {runtimeBrand.client_name}
                  </Typography>
                </Box>
                <Stack
                  direction="row"
                  spacing={1}
                  useFlexGap
                  sx={{
                    flexWrap: 'wrap',
                    '& .MuiChip-root': {
                      bgcolor: 'rgba(255,255,255,.34)',
                      border: '1px solid rgba(255,255,255,.55)',
                      color: '#2e3a66',
                      fontWeight: 800,
                      backdropFilter: 'blur(10px)',
                      borderRadius: '999px',
                      px: 0.5,
                      '& .MuiChip-icon': { color: '#4a5fc9' },
                    },
                  }}
                >
                  <Chip
                    size="small"
                    icon={<BoltRounded />}
                    sx={
                      running
                        ? {
                            '&.MuiChip-root': {
                              bgcolor: 'rgba(70,205,150,.32)',
                              borderColor: 'rgba(70,205,150,.5)',
                            },
                          }
                        : undefined
                    }
                    label={running ? '在线' : '离线'}
                  />
                  <Chip
                    size="small"
                    icon={<LanguageRounded />}
                    label={mode === 'global' ? '全局模式' : '规则'}
                  />
                  <Chip
                    size="small"
                    icon={<LanRounded />}
                    label={systemProxyChip.label}
                  />
                </Stack>
              </Stack>

              <Paper
                elevation={0}
                sx={{
                  borderRadius: '26px',
                  p: 1.3,
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  border: '1px solid rgba(255,255,255,.6)',
                  bgcolor: 'rgba(255,255,255,.3)',
                  boxShadow:
                    '0 24px 60px rgba(90,110,220,.28), inset 0 1px 0 rgba(255,255,255,.75)',
                  backdropFilter: 'blur(22px)',
                  overflow: 'hidden',
                  position: 'relative',
                  '& .MuiButton-outlined': outlineButtonSx,
                  '&:before': {
                    content: '""',
                    position: 'absolute',
                    inset: 0,
                    pointerEvents: 'none',
                    background:
                      'linear-gradient(120deg, rgba(255,255,255,.22), transparent 46%, rgba(150,160,250,.14))',
                    opacity: 1,
                  },
                }}
              >
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1.15}
                  sx={{
                    position: 'relative',
                    alignItems: 'stretch',
                    flex: 1,
                    minHeight: 0,
                  }}
                >
                  <Box
                    sx={{
                      width: { xs: '100%', sm: 160 },
                      flexShrink: 0,
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    <GlassPowerButton
                      running={running}
                      busy={busy}
                      onClick={togglePower}
                    />
                  </Box>

                  <Box
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      minHeight: 0,
                      display: 'flex',
                      borderRadius: '20px',
                      p: 1.1,
                      border: '1px solid rgba(255,255,255,.6)',
                      background:
                        'linear-gradient(150deg, rgba(255,255,255,.45) 0%, rgba(226,231,252,.3) 60%, rgba(210,219,250,.26) 100%)',
                      backdropFilter: 'blur(20px)',
                      boxShadow:
                        'inset 0 1px 0 rgba(255,255,255,.8), 0 8px 22px rgba(90,110,220,.12)',
                    }}
                  >
                    <Stack
                      spacing={1}
                      sx={{
                        flex: 1,
                        minWidth: 0,
                        minHeight: 0,
                        '& .MuiButton-outlined': outlineButtonSx,
                        '& .MuiButton-contained.Mui-disabled': {
                          color: 'rgba(255,255,255,.56)',
                        },
                      }}
                    >
                      <ToggleButtonGroup
                        exclusive
                        value={mode}
                        onChange={changeMode}
                        disabled={busy}
                        fullWidth
                        size="small"
                        sx={{
                          '& .MuiToggleButton-root': {
                            py: 0.75,
                            minHeight: 34,
                            borderColor: 'rgba(45,65,105,.16)',
                            fontWeight: 700,
                            color: 'rgba(33,43,64,.9)',
                            '&.Mui-selected': {
                              color: '#fff',
                              bgcolor: '#5f7bf0',
                              boxShadow: '0 6px 16px rgba(95,123,240,.4)',
                            },
                            '&.Mui-selected:hover': {
                              bgcolor: '#4f66e8',
                            },
                          },
                        }}
                      >
                        <ToggleButton value="rule">规则模式</ToggleButton>
                        <ToggleButton value="global">全局模式</ToggleButton>
                      </ToggleButtonGroup>

                      <NodeSelectionPanel
                        label={nodeSelectLabel}
                        nodes={nodes.map((node) => ({
                          name: node.name,
                          delay: getNodeDelay(node, nodeGroup?.name),
                          automatic: isAutomaticNode(node),
                        }))}
                        selected={selectedNode}
                        timeoutMs={DELAY_TIMEOUT}
                        disabled={busy || !nodeGroup}
                        testing={delayTesting}
                        onSelect={changeNode}
                        onTest={testNodeDelay}
                      />
                    </Stack>
                  </Box>
                </Stack>
                <Stack spacing={1} sx={{ mt: 1.25, position: 'relative' }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    useFlexGap
                    sx={{
                      flexWrap: 'wrap',
                      '& .MuiButton-root': {
                        whiteSpace: 'nowrap',
                        minWidth: 'max-content',
                        minHeight: 36,
                      },
                    }}
                  >
                    <Button
                      variant="contained"
                      startIcon={<KeyRounded />}
                      disabled={busy}
                      onClick={() => void openCodeImport()}
                      sx={{
                        flex: '1 1 132px',
                        background: 'linear-gradient(135deg, #7f97f4, #5f7bf0)',
                        color: '#fff',
                        fontWeight: 800,
                        boxShadow: '0 8px 20px rgba(95,123,240,.4)',
                        '&:hover': {
                          background:
                            'linear-gradient(135deg, #6f8af2, #4f66e8)',
                        },
                      }}
                    >
                      {savedCode
                        ? running
                          ? '断开并切换提取码'
                          : '切换提取码'
                        : '导入订阅'}
                    </Button>
                    {!isTunModeAvailable && (
                      <Button
                        variant="outlined"
                        startIcon={<BuildRounded />}
                        disabled={busy}
                        sx={{ flex: '1 1 110px' }}
                        onClick={async () => {
                          setBusy(true)
                          setStatus('正在安装 TUN 服务...')
                          try {
                            await installService()
                            await restartCore()
                            await mutateSystemState()
                            setStatus('TUN 服务已安装')
                          } catch (error) {
                            setStatus(
                              error instanceof Error
                                ? error.message
                                : String(error),
                            )
                          } finally {
                            setBusy(false)
                          }
                        }}
                      >
                        安装 TUN
                      </Button>
                    )}
                    {isTunModeAvailable && !tunOn && (
                      <Button
                        variant="outlined"
                        color="success"
                        startIcon={<LanRounded />}
                        disabled={busy}
                        sx={{ flex: '1 1 110px' }}
                        onClick={async () => {
                          setBusy(true)
                          setStatus('正在开启 TUN...')
                          try {
                            await patchVerge({ enable_tun_mode: true })
                            await mutateSystemState()
                            await refreshAll()
                            setStatus('TUN 已开启')
                          } catch (error) {
                            setStatus(
                              error instanceof Error
                                ? error.message
                                : String(error),
                            )
                          } finally {
                            setBusy(false)
                          }
                        }}
                      >
                        开启 TUN
                      </Button>
                    )}
                    {tunOn && (
                      <Button
                        variant="outlined"
                        color="warning"
                        startIcon={<LanRounded />}
                        disabled={busy}
                        sx={{ flex: '1 1 110px' }}
                        onClick={async () => {
                          setBusy(true)
                          setStatus('正在关闭 TUN...')
                          try {
                            await patchVerge({ enable_tun_mode: false })
                            await mutateSystemState()
                            await refreshAll()
                            setStatus('TUN 已关闭')
                          } catch (error) {
                            setStatus(
                              error instanceof Error
                                ? error.message
                                : String(error),
                            )
                          } finally {
                            setBusy(false)
                          }
                        }}
                      >
                        关闭 TUN
                      </Button>
                    )}
                    <Button
                      variant="outlined"
                      startIcon={<CloudSyncRounded />}
                      disabled={busy}
                      onClick={() => updateCurrentSubscription()}
                      sx={{ flex: '1 1 116px' }}
                    >
                      更新订阅
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={<SettingsRounded />}
                      disabled={busy}
                      onClick={() => setAdvancedOpen(true)}
                      sx={{ flex: '1 1 132px' }}
                    >
                      高级用户设置
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={<ShoppingCartRounded />}
                      sx={{ flex: '1 1 96px' }}
                      onClick={() => {
                        const url = savedCode
                          ? `${getApiBase()}/pay?action=renew&code=${encodeURIComponent(savedCode)}`
                          : `${getApiBase()}/pay?action=new`
                        openWebUrl(url)
                      }}
                    >
                      {savedCode ? '续费' : '新购'}
                    </Button>
                  </Stack>

                  {importantStatus && (
                    <Alert
                      severity={
                        status.includes('失败') ||
                        status.includes('错误') ||
                        status.includes('过期')
                          ? 'error'
                          : 'info'
                      }
                      sx={{ py: 0.35 }}
                      onClose={() => setStatus('')}
                    >
                      {importantStatus}
                    </Alert>
                  )}
                </Stack>
              </Paper>
            </>
          )}
          <ClashPortViewer ref={portViewerRef} />
          <ControllerViewer ref={controllerViewerRef} />
          <WebUIViewer ref={webUIViewerRef} />
          <WebsiteTestViewer ref={websiteTestViewerRef} />
          <TunnelsViewer ref={tunnelsViewerRef} />
          <Dialog
            open={advancedOpen}
            onClose={() => setAdvancedOpen(false)}
            fullWidth
            maxWidth="xs"
            slotProps={{
              paper: {
                sx: glassDialogPaperSx,
              },
            }}
          >
            <DialogTitle sx={{ fontWeight: 900, pb: 0.5 }}>
              高级用户设置
            </DialogTitle>
            <DialogContent sx={{ pt: 1.5 }}>
              <Stack spacing={1.25}>
                {updateInfo?.available && (
                  <Box
                    sx={{
                      borderRadius: '14px',
                      px: 1.5,
                      py: 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                      flexWrap: 'wrap',
                      border: '1px solid rgba(41,201,156,.55)',
                      bgcolor: 'rgba(41,201,156,.16)',
                    }}
                  >
                    <BoltRounded sx={{ color: '#28c99c' }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 850, color: '#eafff8' }}>
                        发现新版本 v{updateInfo.version}
                      </Typography>
                      <Typography
                        sx={{ fontSize: 12, color: 'rgba(214,240,250,.82)' }}
                      >
                        {isMacOS
                          ? '点击前往下载页，手动下载安装新版本。'
                          : '点击「立即更新」自动下载并安装，完成后自动重启。'}
                      </Typography>
                    </Box>
                    <Button
                      variant="contained"
                      disabled={updating}
                      onClick={doUpdate}
                      sx={{
                        bgcolor: '#28c99c',
                        fontWeight: 800,
                        '&:hover': { bgcolor: '#22b489' },
                      }}
                    >
                      {isMacOS
                        ? '前往下载'
                        : updating
                          ? updateInstalling
                            ? '正在准备安装'
                            : updPercent > 0
                              ? `更新中 ${updPercent}%`
                              : '正在下载更新'
                          : '立即更新'}
                    </Button>
                    {updating && !updateInstalling && (
                      <Button
                        onClick={cancelUpdateDownload}
                        sx={{ color: '#eafff8' }}
                      >
                        取消下载
                      </Button>
                    )}
                  </Box>
                )}

                {currentCode && (
                  <Typography sx={{ fontSize: 13 }}>
                    {accountExpiryLabel(expiresAt)}
                  </Typography>
                )}
                {currentCode && clientAccountState?.showUsage && (
                  <Paper
                    elevation={0}
                    sx={{
                      p: 1.5,
                      borderRadius: '14px',
                      bgcolor: 'rgba(255,255,255,.6)',
                    }}
                  >
                    <Typography sx={{ fontWeight: 800, mb: 0.5 }}>
                      账号用量
                    </Typography>
                    <Typography sx={{ fontSize: 12 }}>
                      今日 {formatUsageBytes(clientAccountState.dayUsed)} /{' '}
                      {clientAccountState.dayLimit
                        ? formatUsageBytes(clientAccountState.dayLimit)
                        : '不限'}
                      {' · '}本月{' '}
                      {formatUsageBytes(clientAccountState.monthUsed)} /{' '}
                      {clientAccountState.monthLimit
                        ? formatUsageBytes(clientAccountState.monthLimit)
                        : '不限'}
                    </Typography>
                    <Typography sx={{ fontSize: 12 }}>
                      在线 {clientAccountState.onlineDevices}/
                      {clientAccountState.onlineLimit || '不限'}
                      {' · '}绑定 {clientAccountState.boundDevices}/
                      {clientAccountState.boundLimit || '不限'}
                    </Typography>
                  </Paper>
                )}
                <Paper
                  elevation={0}
                  sx={{
                    p: 1.25,
                    borderRadius: '14px',
                    border: '1px solid rgba(28,141,255,.28)',
                    bgcolor: 'rgba(28,141,255,.06)',
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={1.1}
                    sx={{ alignItems: 'center' }}
                  >
                    <BoltRounded sx={{ color: '#1c8dff' }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 850 }}>一键自检</Typography>
                      <Typography
                        sx={{ fontSize: 12, color: 'rgba(36,46,66,.62)' }}
                      >
                        检查内核、系统代理、TUN、节点连通和上网状态。
                      </Typography>
                    </Box>
                    <Button
                      size="small"
                      variant="contained"
                      disabled={busy}
                      onClick={() => {
                        setSelfCheckOpen(true)
                        runSelfCheck()
                      }}
                      sx={{
                        background: 'linear-gradient(135deg, #5f7bf0, #4159e0)',
                        fontWeight: 800,
                        '&:hover': { bgcolor: '#167ce3' },
                      }}
                    >
                      开始自检
                    </Button>
                  </Stack>
                </Paper>
                <Paper
                  elevation={0}
                  sx={{
                    p: 1.25,
                    borderRadius: '14px',
                    border: '1px solid rgba(45,65,105,.12)',
                    bgcolor: 'rgba(255,255,255,.72)',
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={1.1}
                    sx={{ alignItems: 'center' }}
                  >
                    <LanguageRounded sx={{ color: '#1c8dff' }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 850 }}>
                        服务器检测
                      </Typography>
                      <Typography
                        sx={{ fontSize: 12, color: 'rgba(36,46,66,.62)' }}
                      >
                        自动检测并选择可用服务器，不显示服务器地址。
                      </Typography>
                    </Box>
                    <Chip
                      size="small"
                      color={
                        serverCheckStatus === 'connected'
                          ? 'success'
                          : serverCheckStatus === 'disconnected'
                            ? 'error'
                            : 'default'
                      }
                      label={
                        serverCheckStatus === 'checking'
                          ? '检测中'
                          : serverCheckStatus === 'connected'
                            ? '已连通'
                            : serverCheckStatus === 'disconnected'
                              ? '未连通'
                              : '待检测'
                      }
                      sx={{ fontWeight: 800 }}
                    />
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<RefreshRounded />}
                      disabled={serverCheckStatus === 'checking'}
                      onClick={() =>
                        checkServerConnection().catch(() => undefined)
                      }
                    >
                      检测
                    </Button>
                  </Stack>
                </Paper>
                <Paper
                  elevation={0}
                  sx={{
                    p: 1.6,
                    borderRadius: '14px',
                    border: '1px solid rgba(28,141,255,.28)',
                    bgcolor: 'rgba(28,141,255,.06)',
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={1.1}
                    sx={{ alignItems: 'center' }}
                  >
                    <SettingsRounded sx={{ color: '#1c8dff' }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 850 }}>
                        手动配置管理
                      </Typography>
                      <Typography
                        sx={{ fontSize: 12, color: 'rgba(36,46,66,.62)' }}
                      >
                        web 断网时自行导入/切换/编辑配置文件，也可导入其它 Clash
                        订阅。
                      </Typography>
                    </Box>
                    <Button
                      size="small"
                      variant="contained"
                      disabled={busy}
                      onClick={() => setProfileManagerOpen(true)}
                      sx={{
                        background: 'linear-gradient(135deg, #5f7bf0, #4159e0)',
                        fontWeight: 800,
                        '&:hover': { bgcolor: '#167ce3' },
                      }}
                    >
                      打开管理
                    </Button>
                  </Stack>
                </Paper>
                <Paper
                  elevation={0}
                  sx={{
                    p: 1.25,
                    borderRadius: '14px',
                    border: '1px solid rgba(45,65,105,.12)',
                    bgcolor: 'rgba(255,255,255,.72)',
                  }}
                >
                  <Stack spacing={1}>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center' }}
                    >
                      <RuleRounded sx={{ color: '#1c8dff' }} />
                      <Box sx={{ flex: 1 }}>
                        <Typography sx={{ fontWeight: 850 }}>
                          规则设置
                        </Typography>
                        <Typography
                          sx={{ fontSize: 12, color: 'rgba(36,46,66,.62)' }}
                        >
                          规则模式适合日常使用，全局模式会全部走代理。
                        </Typography>
                      </Box>
                    </Stack>
                    <ToggleButtonGroup
                      exclusive
                      value={mode}
                      onChange={changeMode}
                      disabled={busy}
                      fullWidth
                      size="small"
                      sx={{
                        '& .MuiToggleButton-root': {
                          py: 0.7,
                          fontWeight: 800,
                          borderColor: 'rgba(45,65,105,.16)',
                          '&.Mui-selected': {
                            color: '#fff',
                            background:
                              'linear-gradient(135deg, #5f7bf0, #4159e0)',
                          },
                          '&.Mui-selected:hover': {
                            background:
                              'linear-gradient(135deg, #536fee, #3a50d8)',
                          },
                        },
                      }}
                    >
                      <ToggleButton value="rule">规则模式</ToggleButton>
                      <ToggleButton value="global">全局模式</ToggleButton>
                    </ToggleButtonGroup>
                  </Stack>
                </Paper>

                <Paper
                  elevation={0}
                  sx={{
                    p: 1.25,
                    borderRadius: '14px',
                    border: '1px solid rgba(45,65,105,.12)',
                    bgcolor: 'rgba(255,255,255,.72)',
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={1.1}
                    sx={{ alignItems: 'center' }}
                  >
                    <RuleRounded sx={{ color: '#18a679' }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 850 }}>
                        流量规则编辑
                      </Typography>
                      <Typography
                        sx={{ fontSize: 12, color: 'rgba(36,46,66,.62)' }}
                      >
                        设置某个网址或域名固定走指定节点。
                      </Typography>
                    </Box>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={!rulesProfileUid}
                      onClick={() => {
                        setTrafficRulePolicy(
                          trafficRulePolicy ||
                            selectedNode ||
                            nodeGroup?.name ||
                            '',
                        )
                        setTrafficRuleOpen(true)
                      }}
                    >
                      编辑
                    </Button>
                  </Stack>
                </Paper>

                {[
                  {
                    icon: <RouterRounded sx={{ color: '#1c8dff' }} />,
                    title: '代理端口',
                    desc: `设置监听端口并查看当前端口。${lanPortHint}`,
                    action: '设置端口',
                    onClick: () => portViewerRef.current?.open(),
                    status: '',
                  },
                  {
                    icon: <SecurityRounded sx={{ color: '#7c5cff' }} />,
                    title: '允许外部控制',
                    desc: '允许局域网设备或 Web 面板连接 Mihomo 控制接口，可设置地址和访问密钥。',
                    action: '配置',
                    onClick: () => controllerViewerRef.current?.open(),
                    status: externalControllerOn ? '已允许' : '未允许',
                  },
                  {
                    icon: <OpenInBrowserRounded sx={{ color: '#18a679' }} />,
                    title: 'Web 管理页面',
                    desc: '打开或管理 Mihomo Web 控制页面，自动填入本机控制地址和密钥。',
                    action: '打开',
                    onClick: () => webUIViewerRef.current?.open(),
                    status: '',
                  },
                  {
                    icon: <NetworkCheckRounded sx={{ color: '#e88524' }} />,
                    title: '网站测试',
                    desc: '设置常用测试网址，检查当前代理能否访问并查看连接耗时。',
                    action: '管理',
                    onClick: () => websiteTestViewerRef.current?.open(),
                    status: '',
                  },
                  {
                    icon: <SwapVertRounded sx={{ color: '#d74c87' }} />,
                    title: '流量隧道',
                    desc: '把本地 TCP/UDP 端口经指定代理组或节点转发到目标地址。',
                    action: '管理',
                    onClick: () => tunnelsViewerRef.current?.open(),
                    status: clash?.tunnels?.length
                      ? `${clash.tunnels.length} 条`
                      : '未配置',
                  },
                ].map((item) => (
                  <Paper
                    key={item.title}
                    elevation={0}
                    sx={{
                      p: 1.25,
                      borderRadius: '14px',
                      border: '1px solid rgba(45,65,105,.12)',
                      bgcolor: 'rgba(255,255,255,.72)',
                    }}
                  >
                    <Stack
                      direction="row"
                      spacing={1.1}
                      sx={{ alignItems: 'center' }}
                    >
                      {item.icon}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Stack
                          direction="row"
                          spacing={0.8}
                          sx={{ alignItems: 'center' }}
                        >
                          <Typography sx={{ fontWeight: 850 }}>
                            {item.title}
                          </Typography>
                          {item.status && (
                            <Chip
                              size="small"
                              label={item.status}
                              color={
                                item.status === '已允许' ? 'success' : 'default'
                              }
                              sx={{
                                height: 20,
                                fontSize: 11,
                                fontWeight: 800,
                              }}
                            />
                          )}
                        </Stack>
                        <Typography
                          sx={{ fontSize: 12, color: 'rgba(36,46,66,.62)' }}
                        >
                          {item.desc}
                        </Typography>
                      </Box>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={item.onClick}
                      >
                        {item.action}
                      </Button>
                    </Stack>
                  </Paper>
                ))}

                {[
                  {
                    icon: <DnsRounded sx={{ color: '#7c5cff' }} />,
                    title: 'DNS 覆写（抗污染）',
                    desc: '遇到直连网址打不开/证书报错时开启：用 fake-ip + 可信加密 DNS，避免 DNS 污染。',
                    checked: dnsOverwriteOn,
                    onChange: toggleDnsOverwrite,
                  },
                  {
                    icon: <LanRounded sx={{ color: '#12a87f' }} />,
                    title: '局域网连接',
                    desc: allowLanOn
                      ? `已允许同局域网设备连接本机代理 · ${lanPortHint}`
                      : `允许同一局域网设备连接本机代理。开启后可用：${lanPortHint}`,
                    checked: allowLanOn,
                    onChange: toggleAllowLan,
                  },
                  {
                    icon: <SettingsRounded sx={{ color: '#ff8a3d' }} />,
                    title: '系统代理守护',
                    desc: '系统代理被系统或浏览器改掉时自动恢复。',
                    checked: proxyGuardOn,
                    onChange: toggleProxyGuard,
                  },
                ].map((item) => (
                  <Paper
                    key={item.title}
                    elevation={0}
                    sx={{
                      p: 1.25,
                      borderRadius: '14px',
                      border: '1px solid rgba(45,65,105,.12)',
                      bgcolor: 'rgba(255,255,255,.72)',
                    }}
                  >
                    <Stack
                      direction="row"
                      spacing={1.1}
                      sx={{ alignItems: 'center' }}
                    >
                      {item.icon}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 850 }}>
                          {item.title}
                        </Typography>
                        <Typography
                          sx={{ fontSize: 12, color: 'rgba(36,46,66,.62)' }}
                        >
                          {item.desc}
                        </Typography>
                      </Box>
                      <Switch
                        edge="end"
                        disabled={busy}
                        checked={item.checked}
                        onChange={(_, checked) => item.onChange(checked)}
                      />
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5 }}>
              <Button onClick={() => setAdvancedOpen(false)}>完成</Button>
            </DialogActions>
          </Dialog>
          <Dialog
            open={trafficRuleOpen}
            onClose={() => setTrafficRuleOpen(false)}
            fullWidth
            maxWidth="sm"
            slotProps={{
              paper: {
                sx: glassDialogPaperSx,
              },
            }}
          >
            <DialogTitle sx={{ fontWeight: 900, pb: 0.5 }}>
              流量规则编辑
            </DialogTitle>
            <DialogContent sx={{ pt: 1.5 }}>
              <Stack spacing={1.25}>
                <Typography sx={{ fontSize: 13, color: 'rgba(36,46,66,.66)' }}>
                  选择匹配类型、填写内容、选择要走的节点。例如「域名后缀
                  google.com 走日本节点」「IP 段 1.1.1.1/24 走 DIRECT」。
                  自定义规则排在全部官网服务规则之后、订阅其他规则之前。
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <FormControl size="small" sx={{ minWidth: 124 }}>
                    <InputLabel>类型</InputLabel>
                    <Select
                      sx={fieldSx}
                      label="类型"
                      value={trafficRuleType}
                      disabled={busy}
                      onChange={(event) =>
                        setTrafficRuleType(event.target.value)
                      }
                    >
                      {TRAFFIC_RULE_TYPES.map((t) => (
                        <MenuItem key={t.name} value={t.name}>
                          {t.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <TextField
                    fullWidth
                    size="small"
                    sx={fieldSx}
                    label="规则内容"
                    placeholder="如 google.com / 1.1.1.1/24 / youtube"
                    value={trafficRuleInput}
                    disabled={busy}
                    onChange={(event) =>
                      setTrafficRuleInput(event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (
                        event.key === 'Enter' &&
                        trafficRuleInput.trim() &&
                        !busy
                      ) {
                        addTrafficRule()
                      }
                    }}
                  />
                  <FormControl size="small" sx={{ minWidth: 180 }}>
                    <InputLabel>走哪个节点</InputLabel>
                    <Select
                      sx={fieldSx}
                      label="走哪个节点"
                      value={trafficRulePolicy}
                      disabled={busy || rulePolicies.length === 0}
                      onChange={(event) =>
                        setTrafficRulePolicy(event.target.value)
                      }
                    >
                      {rulePolicies.map((policy) => (
                        <MenuItem key={policy} value={policy}>
                          {policy}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Button
                    variant="contained"
                    startIcon={<AddRounded />}
                    disabled={
                      busy || !trafficRuleInput.trim() || !trafficRulePolicy
                    }
                    onClick={addTrafficRule}
                    sx={{
                      minWidth: 96,
                      background: 'linear-gradient(135deg, #5f7bf0, #4159e0)',
                      fontWeight: 800,
                      '&:hover': { bgcolor: '#167ce3' },
                    }}
                  >
                    添加
                  </Button>
                </Stack>

                <Stack spacing={0.8}>
                  {trafficRules.length === 0 ? (
                    <Alert severity="info" sx={{ py: 0.35 }}>
                      还没有自定义流量规则。
                    </Alert>
                  ) : (
                    trafficRules.map((rule) => (
                      <Paper
                        key={rule.raw}
                        elevation={0}
                        sx={{
                          p: 1,
                          borderRadius: '12px',
                          border: '1px solid rgba(45,65,105,.12)',
                          bgcolor: 'rgba(255,255,255,.78)',
                        }}
                      >
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center' }}
                        >
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography sx={{ fontWeight: 850 }}>
                              {rule.value}
                            </Typography>
                            <Typography
                              sx={{
                                fontSize: 12,
                                color: 'rgba(36,46,66,.62)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {TRAFFIC_RULE_TYPES.find(
                                (t) => t.name === rule.type,
                              )?.label ?? rule.type}{' '}
                              · 走 {rule.policy}
                            </Typography>
                          </Box>
                          <IconButton
                            size="small"
                            disabled={busy}
                            onClick={() => deleteTrafficRule(rule)}
                          >
                            <DeleteRounded fontSize="small" />
                          </IconButton>
                        </Stack>
                      </Paper>
                    ))
                  )}
                </Stack>
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5 }}>
              <Button onClick={() => setTrafficRuleOpen(false)}>完成</Button>
            </DialogActions>
          </Dialog>
          <Dialog
            open={selfCheckOpen}
            onClose={() => setSelfCheckOpen(false)}
            fullWidth
            maxWidth="xs"
            slotProps={{
              paper: {
                sx: glassDialogPaperSx,
              },
            }}
          >
            <DialogTitle sx={{ fontWeight: 900, pb: 0.5 }}>
              系统自检
            </DialogTitle>
            <DialogContent sx={{ pt: 1.5 }}>
              <Stack spacing={1}>
                {selfCheckItems.length === 0 ? (
                  <Alert severity="info" sx={{ py: 0.35 }}>
                    点击「重新检测」开始。
                  </Alert>
                ) : (
                  selfCheckItems.map((item) => {
                    const color =
                      item.status === 'ok'
                        ? '#18a679'
                        : item.status === 'warn'
                          ? '#e0a200'
                          : item.status === 'fail'
                            ? '#e5484d'
                            : 'rgba(36,46,66,.45)'
                    const mark =
                      item.status === 'ok'
                        ? '✓'
                        : item.status === 'warn'
                          ? '!'
                          : item.status === 'fail'
                            ? '✕'
                            : '…'
                    return (
                      <Paper
                        key={item.key}
                        elevation={0}
                        sx={{
                          p: 1,
                          borderRadius: '12px',
                          border: '1px solid rgba(45,65,105,.12)',
                          bgcolor: 'rgba(255,255,255,.78)',
                        }}
                      >
                        <Stack
                          direction="row"
                          spacing={1.2}
                          sx={{ alignItems: 'center' }}
                        >
                          <Box
                            sx={{
                              width: 22,
                              height: 22,
                              borderRadius: '50%',
                              flexShrink: 0,
                              display: 'grid',
                              placeItems: 'center',
                              color: '#fff',
                              fontWeight: 900,
                              fontSize: 13,
                              bgcolor: color,
                            }}
                          >
                            {mark}
                          </Box>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography sx={{ fontWeight: 800 }}>
                              {item.label}
                            </Typography>
                            <Typography
                              sx={{
                                fontSize: 12,
                                color: 'rgba(36,46,66,.66)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {item.detail}
                            </Typography>
                          </Box>
                          {item.fix &&
                            (item.status === 'fail' ||
                              item.status === 'warn') && (
                              <Button
                                size="small"
                                variant="outlined"
                                disabled={item.fixing || selfChecking}
                                onClick={() => runSelfCheckFix(item)}
                                sx={{
                                  flexShrink: 0,
                                  minWidth: 0,
                                  px: 1.2,
                                  borderRadius: '9px',
                                  fontWeight: 800,
                                }}
                              >
                                {item.fixing
                                  ? '修复中…'
                                  : item.fixLabel || '修复'}
                              </Button>
                            )}
                        </Stack>
                      </Paper>
                    )
                  })
                )}
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5 }}>
              <Button
                color="error"
                onClick={() => setResetConfirmOpen(true)}
                disabled={selfChecking || resetting}
                sx={{ mr: 'auto', fontWeight: 800 }}
              >
                彻底重置
              </Button>
              <Button
                variant="contained"
                color="success"
                onClick={runSelfCheckFixAll}
                disabled={selfChecking || !selfCheckItems.some((it) => it.fix)}
                startIcon={<BuildRounded />}
                sx={{ fontWeight: 800 }}
              >
                尝试修复
              </Button>
              <Button
                onClick={runSelfCheck}
                disabled={selfChecking}
                startIcon={<SpeedRounded />}
              >
                {selfChecking ? '检测中…' : '重新检测'}
              </Button>
              <Button onClick={() => setSelfCheckOpen(false)}>关闭</Button>
            </DialogActions>
          </Dialog>
          <Dialog
            open={resetConfirmOpen}
            onClose={() => !resetting && setResetConfirmOpen(false)}
            fullWidth
            maxWidth="xs"
            slotProps={{
              paper: {
                sx: {
                  ...glassDialogPaperSx,
                  border: '1px solid rgba(229,72,77,.35)',
                },
              },
            }}
          >
            <DialogTitle sx={{ fontWeight: 900, color: '#e5484d', pb: 0.5 }}>
              彻底重置（重建配置）
            </DialogTitle>
            <DialogContent sx={{ pt: 1.5 }}>
              <Alert severity="warning" sx={{ mb: 1.5 }}>
                自动修复无效时使用。将删除当前配置，如需恢复请保留本地备份。
              </Alert>
              <Stack spacing={0.5}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={resetRebuildConfig}
                      onChange={(event) =>
                        setResetRebuildConfig(event.target.checked)
                      }
                    />
                  }
                  label="删除之前的配置并生成全新配置"
                />
                <FormControlLabel
                  disabled={!resetRebuildConfig}
                  control={
                    <Checkbox
                      checked={resetCreateBackup}
                      onChange={(event) =>
                        setResetCreateBackup(event.target.checked)
                      }
                    />
                  }
                  label="重置前创建本地恢复备份（推荐）"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={resetRepairService}
                      onChange={(event) =>
                        setResetRepairService(event.target.checked)
                      }
                    />
                  }
                  label="同时修复系统服务（仅协议不匹配时勾选，需要管理员授权）"
                />
              </Stack>
              <Typography
                sx={{
                  mt: 1,
                  fontSize: 13,
                  color: 'rgba(36,46,66,.78)',
                }}
              >
                删除范围：订阅、基础/运行时配置、DNS
                覆写、受管凭据和客户端设置。 日志、本地备份和稳定设备 ID
                会保留，不会重复占用设备名额。
                <br />
                <b>重启后需重新输入提取码并导入订阅。</b>
              </Typography>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5 }}>
              <Button
                onClick={() => setResetConfirmOpen(false)}
                disabled={resetting}
              >
                取消
              </Button>
              <Button
                color="error"
                variant="contained"
                disableElevation
                onClick={factoryReset}
                disabled={
                  resetting || (!resetRebuildConfig && !resetRepairService)
                }
                sx={{ fontWeight: 800 }}
              >
                {resetting ? '重置中…' : '确认重置并重启'}
              </Button>
            </DialogActions>
          </Dialog>
          <Dialog
            open={Boolean(desktopUpdate)}
            onClose={() => setDesktopUpdate(null)}
            fullWidth
            maxWidth="xs"
            slotProps={{
              paper: {
                sx: glassDialogPaperSx,
              },
            }}
          >
            <DialogTitle sx={{ fontWeight: 900, pb: 0.5 }}>
              发现新版本
            </DialogTitle>
            <DialogContent sx={{ pt: 1.5 }}>
              <Stack spacing={1.2}>
                <Typography sx={{ color: 'rgba(36,46,66,.78)' }}>
                  当前版本 {DESKTOP_VERSION}，最新版本{' '}
                  {desktopUpdate?.latest_version}
                </Typography>
                {desktopUpdate?.notes ? (
                  <Alert severity="info" sx={{ whiteSpace: 'pre-wrap' }}>
                    {desktopUpdate.notes}
                  </Alert>
                ) : null}
                {DESKTOP_PLATFORM === 'linux' ? (
                  <Alert severity="warning">
                    Linux 版本不会自动下载或安装，请根据你的发行版选择 DEB 或
                    RPM 安装包手动更新。
                  </Alert>
                ) : null}
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5 }}>
              <Button onClick={() => setDesktopUpdate(null)}>稍后</Button>
              {DESKTOP_PLATFORM === 'linux' && desktopUpdate?.linux_deb_url ? (
                <Button
                  variant="outlined"
                  onClick={() => {
                    const url = desktopUpdate?.linux_deb_url
                    setDesktopUpdate(null)
                    if (url) openWebUrl(url).catch(() => undefined)
                  }}
                  sx={{ minWidth: 96, fontWeight: 800 }}
                >
                  下载 DEB
                </Button>
              ) : null}
              {DESKTOP_PLATFORM === 'linux' && desktopUpdate?.linux_rpm_url ? (
                <Button
                  variant="outlined"
                  onClick={() => {
                    const url = desktopUpdate?.linux_rpm_url
                    setDesktopUpdate(null)
                    if (url) openWebUrl(url).catch(() => undefined)
                  }}
                  sx={{ minWidth: 96, fontWeight: 800 }}
                >
                  下载 RPM
                </Button>
              ) : null}
              <Button
                variant="contained"
                onClick={() => {
                  const url = desktopUpdate?.download_url
                  setDesktopUpdate(null)
                  if (url) openWebUrl(url).catch(() => undefined)
                }}
                sx={{
                  minWidth: 112,
                  background: 'linear-gradient(135deg, #5f7bf0, #4159e0)',
                  fontWeight: 800,
                  '&:hover': { bgcolor: '#167ce3' },
                }}
              >
                {DESKTOP_PLATFORM === 'linux' ? '默认下载' : '前往下载'}
              </Button>
            </DialogActions>
          </Dialog>
          <Dialog
            open={codeDialogOpen && codeImportPhase !== 'error'}
            onClose={() => {
              if (busy) return
              setCode('')
              setCodeImportPhase('input')
              setCodeImportMessage('')
              setCodeDialogOpen(false)
            }}
            fullWidth
            maxWidth="xs"
            slotProps={{
              paper: {
                sx: glassDialogPaperSx,
              },
            }}
          >
            <DialogTitle sx={{ fontWeight: 900, pb: 0.5 }}>
              {codeDialogTitle}
            </DialogTitle>
            <DialogContent sx={{ pt: 1.5 }}>
              {codeImportPhase === 'input' ? (
                <Stack spacing={1.5}>
                  <Typography
                    sx={{ fontSize: 13, color: 'rgba(36,46,66,.66)' }}
                  >
                    {savedCode
                      ? '输入新的提取码后会自动检查并替换当前订阅。'
                      : '输入提取码后会自动检查服务器、获取订阅并测试网络。'}
                  </Typography>
                  <TextField
                    autoFocus
                    fullWidth
                    size="small"
                    sx={fieldSx}
                    value={code}
                    onChange={(event) => {
                      setCode(event.target.value)
                      setCodeImportMessage('')
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && code.trim() && !busy) {
                        importByCode()
                      }
                    }}
                    label="提取码"
                    placeholder="请输入提取码"
                    disabled={busy}
                    slotProps={{
                      input: {
                        sx: fieldSx,
                        startAdornment: (
                          <KeyRounded
                            sx={{ mr: 1, color: 'rgba(28,141,255,.78)' }}
                          />
                        ),
                      },
                      inputLabel: {
                        sx: {
                          color: 'rgba(36,46,66,.66)',
                          '&.Mui-focused': { color: '#1c8dff' },
                        },
                      },
                    }}
                  />
                  {codeImportMessage && (
                    <Alert severity="warning" sx={{ py: 0.35 }}>
                      {codeImportMessage}
                    </Alert>
                  )}
                </Stack>
              ) : codeImportPhase === 'error' ? (
                <Stack spacing={1.5} sx={{ alignItems: 'center', pt: 0.5 }}>
                  <Box
                    sx={{
                      width: 64,
                      height: 64,
                      borderRadius: '50%',
                      display: 'grid',
                      placeItems: 'center',
                      bgcolor: 'rgba(229,72,77,.1)',
                    }}
                  >
                    <ErrorRounded sx={{ color: '#e5484d', fontSize: 38 }} />
                  </Box>
                  <Typography
                    sx={{
                      textAlign: 'center',
                      fontSize: 14,
                      color: 'rgba(36,46,66,.78)',
                    }}
                  >
                    {codeImportMessage}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ width: '100%' }}>
                    <Button
                      fullWidth
                      variant="outlined"
                      startIcon={<RestartAltRounded />}
                      onClick={() => restartApp()}
                    >
                      重启软件
                    </Button>
                    <Button
                      fullWidth
                      color="error"
                      variant="outlined"
                      startIcon={<DeleteRounded />}
                      onClick={() => {
                        setCodeDialogOpen(false)
                        setResetConfirmOpen(true)
                      }}
                    >
                      彻底重置
                    </Button>
                  </Stack>
                </Stack>
              ) : (
                <Stack spacing={1.6} sx={{ alignItems: 'center', pt: 0.5 }}>
                  <Box
                    sx={{
                      width: 72,
                      height: 72,
                      borderRadius: '50%',
                      display: 'grid',
                      placeItems: 'center',
                      bgcolor:
                        codeImportPhase === 'success'
                          ? 'rgba(24,166,121,.1)'
                          : 'rgba(28,141,255,.09)',
                    }}
                  >
                    {codeImportPhase === 'success' ? (
                      <CheckCircleRounded
                        sx={{ color: '#18a679', fontSize: 44 }}
                      />
                    ) : (
                      <CircularProgress size={38} thickness={4.5} />
                    )}
                  </Box>
                  <Typography
                    sx={{
                      textAlign: 'center',
                      fontSize: 14,
                      fontWeight: 700,
                      color: 'rgba(36,46,66,.78)',
                    }}
                  >
                    {codeImportPhase === 'checking'
                      ? '正在确认提取码和服务器连接，请稍候…'
                      : codeImportPhase === 'downloading'
                        ? '验证成功，正在获取并保存订阅…'
                        : codeImportPhase === 'starting'
                          ? '订阅已导入，正在启动并测试网络…'
                          : codeImportMessage}
                  </Typography>
                  <Stack spacing={0.8} sx={{ width: '100%' }}>
                    {['检查提取码', '获取订阅', '启动并测试网络'].map(
                      (label, index) => {
                        const done = codeImportStep > index
                        const active = codeImportStep === index
                        return (
                          <Paper
                            key={label}
                            elevation={0}
                            sx={{
                              px: 1.25,
                              py: 0.8,
                              borderRadius: '8px',
                              border: '1px solid rgba(45,65,105,.1)',
                              bgcolor: active
                                ? 'rgba(28,141,255,.07)'
                                : 'rgba(255,255,255,.65)',
                            }}
                          >
                            <Stack
                              direction="row"
                              spacing={1}
                              sx={{ alignItems: 'center' }}
                            >
                              <Box
                                sx={{
                                  width: 22,
                                  height: 22,
                                  borderRadius: '50%',
                                  display: 'grid',
                                  placeItems: 'center',
                                  fontSize: 12,
                                  fontWeight: 900,
                                  color: done || active ? '#fff' : '#778095',
                                  bgcolor: done
                                    ? '#18a679'
                                    : active
                                      ? '#1c8dff'
                                      : 'rgba(45,65,105,.1)',
                                }}
                              >
                                {done ? '✓' : index + 1}
                              </Box>
                              <Typography
                                sx={{
                                  fontSize: 13,
                                  fontWeight: active || done ? 800 : 600,
                                  color: 'rgba(36,46,66,.76)',
                                }}
                              >
                                {label}
                              </Typography>
                            </Stack>
                          </Paper>
                        )
                      },
                    )}
                  </Stack>
                </Stack>
              )}
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5 }}>
              {codeImportPhase === 'input' ? (
                <>
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setCode('')
                      setCodeDialogOpen(false)
                    }}
                  >
                    取消
                  </Button>
                  <Button
                    variant="contained"
                    disabled={busy || !code.trim()}
                    onClick={() => importByCode()}
                    sx={{
                      minWidth: 104,
                      background: 'linear-gradient(135deg, #5f7bf0, #4159e0)',
                      fontWeight: 800,
                      '&:hover': { bgcolor: '#167ce3' },
                    }}
                  >
                    {savedCode ? '确认切换' : '开始检查'}
                  </Button>
                </>
              ) : codeImportPhase === 'error' ? (
                <>
                  <Button
                    onClick={() => {
                      setCode('')
                      setCodeImportMessage('')
                      setCodeImportPhase('input')
                      setCodeDialogOpen(false)
                    }}
                  >
                    取消
                  </Button>
                  <Button
                    onClick={() => {
                      setCodeImportPhase('input')
                      setCodeImportMessage('')
                    }}
                  >
                    修改提取码
                  </Button>
                  <Button
                    variant="contained"
                    startIcon={<RefreshRounded />}
                    onClick={() => importByCode()}
                  >
                    重新检测
                  </Button>
                </>
              ) : codeImportPhase === 'success' ? (
                <Button
                  variant="contained"
                  onClick={() => {
                    setCodeImportPhase('input')
                    setCodeImportMessage('')
                    setCodeDialogOpen(false)
                  }}
                >
                  开始使用
                </Button>
              ) : (
                <Typography
                  sx={{
                    mr: 'auto',
                    fontSize: 12,
                    color: 'rgba(36,46,66,.5)',
                  }}
                >
                  检测期间请不要关闭软件
                </Typography>
              )}
            </DialogActions>
          </Dialog>

          {/* 手动配置管理：导入/切换/编辑/删除本地或第三方 Clash 订阅 */}
          <Dialog
            open={profileManagerOpen}
            onClose={() => setProfileManagerOpen(false)}
            fullWidth
            maxWidth="sm"
            slotProps={{ paper: { sx: glassDialogPaperSx } }}
          >
            <DialogTitle sx={{ fontWeight: 900, pb: 0.5 }}>
              手动配置管理
            </DialogTitle>
            <DialogContent sx={{ pt: 1.5 }}>
              <Stack spacing={1.6}>
                {importantStatus && (
                  <Alert severity="warning" onClose={() => setStatus('')}>
                    {importantStatus}
                  </Alert>
                )}
                <Typography sx={{ fontSize: 12, color: 'rgba(36,46,66,.62)' }}>
                  web 断网或无法导入提取码订阅时，可在此手动导入其它 Clash
                  订阅链接、新建/编辑本地配置，并随时切换当前使用的配置文件。
                </Typography>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center' }}
                >
                  <TextField
                    fullWidth
                    size="small"
                    label="订阅链接（http/https）"
                    value={manualImportUrl}
                    onChange={(e) => setManualImportUrl(e.target.value)}
                    disabled={manualBusy}
                    sx={fieldSx}
                  />
                  <Button
                    variant="contained"
                    disabled={manualBusy || !manualImportUrl.trim()}
                    onClick={manualImportByUrl}
                    sx={{
                      minWidth: 84,
                      background: 'linear-gradient(135deg, #5f7bf0, #4159e0)',
                      fontWeight: 800,
                      '&:hover': { bgcolor: '#167ce3' },
                    }}
                  >
                    导入
                  </Button>
                </Stack>
                <Box
                  sx={{
                    pointerEvents: manualBusy || busy ? 'none' : 'auto',
                    opacity: manualBusy ? 0.5 : 1,
                  }}
                >
                  <FileInput
                    onChange={(file, content) => {
                      void manualImportFile(file, content)
                    }}
                  />
                </Box>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={manualBusy}
                  startIcon={<AddRounded />}
                  onClick={manualCreateLocal}
                  sx={outlineButtonSx}
                >
                  新建本地空配置
                </Button>
                <Typography sx={{ fontWeight: 850, fontSize: 13, mt: 0.5 }}>
                  已有配置文件
                </Typography>
                {profileList.length === 0 ? (
                  <Typography sx={{ fontSize: 12, color: 'rgba(36,46,66,.5)' }}>
                    暂无配置文件，请先导入或新建。
                  </Typography>
                ) : (
                  <Stack spacing={1}>
                    {profileList.map((item) => {
                      const isCurrent = profiles?.current === item.uid
                      return (
                        <Paper
                          key={item.uid}
                          elevation={0}
                          sx={{
                            p: 1.2,
                            borderRadius: '12px',
                            border: isCurrent
                              ? '1px solid rgba(28,141,255,.55)'
                              : '1px solid rgba(45,65,105,.18)',
                            bgcolor: isCurrent
                              ? 'rgba(28,141,255,.08)'
                              : 'rgba(255,255,255,.7)',
                          }}
                        >
                          <Stack
                            direction="row"
                            spacing={1}
                            sx={{ alignItems: 'center' }}
                          >
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Stack
                                direction="row"
                                spacing={0.8}
                                sx={{ alignItems: 'center' }}
                              >
                                <Typography
                                  noWrap
                                  sx={{ fontWeight: 800, fontSize: 13 }}
                                >
                                  {item.name || item.uid}
                                </Typography>
                                {isCurrent && (
                                  <Chip
                                    size="small"
                                    label="使用中"
                                    color="primary"
                                  />
                                )}
                              </Stack>
                              <Typography
                                noWrap
                                sx={{
                                  fontSize: 11,
                                  color: 'rgba(36,46,66,.55)',
                                }}
                              >
                                {item.type === 'remote'
                                  ? '远程订阅'
                                  : '本地配置'}
                              </Typography>
                            </Box>
                            <Button
                              size="small"
                              disabled={manualBusy || isCurrent}
                              onClick={() => item.uid && manualSwitch(item.uid)}
                            >
                              切换
                            </Button>
                            <Button
                              size="small"
                              disabled={manualBusy}
                              onClick={() =>
                                item.uid &&
                                manualEdit(item.uid, item.name || item.uid)
                              }
                            >
                              编辑
                            </Button>
                            <IconButton
                              size="small"
                              disabled={manualBusy || isCurrent}
                              onClick={() => item.uid && manualDelete(item.uid)}
                            >
                              <DeleteRounded fontSize="small" />
                            </IconButton>
                          </Stack>
                        </Paper>
                      )
                    })}
                  </Stack>
                )}
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5 }}>
              <Button onClick={() => setProfileManagerOpen(false)}>完成</Button>
            </DialogActions>
          </Dialog>

          {/* 提取码到期提示 */}
          <Dialog
            open={expiredDialogOpen}
            onClose={() => setExpiredDialogOpen(false)}
            fullWidth
            maxWidth="xs"
            slotProps={{ paper: { sx: glassDialogPaperSx } }}
          >
            <DialogTitle sx={{ fontWeight: 900, pb: 0.5 }}>
              {activeRestriction?.reason === 'traffic_limit'
                ? '流量额度已用尽'
                : '提取码已到期'}
            </DialogTitle>
            <DialogContent sx={{ pt: 1.5 }}>
              <Typography sx={{ fontSize: 13.5, lineHeight: 1.7 }}>
                {activeRestriction?.reason === 'traffic_limit'
                  ? '当前流量额度已用尽。'
                  : '当前提取码已到期。'}
                网站续费、管理员加时或额度恢复后，客户端会自动检查并更新订阅，无需重新导入。
              </Typography>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5 }}>
              <Button
                variant="contained"
                onClick={() => {
                  void openRenewal().catch(() => undefined)
                }}
                sx={{
                  background: 'linear-gradient(135deg, #5f7bf0, #4159e0)',
                  fontWeight: 800,
                  '&:hover': { bgcolor: '#167ce3' },
                }}
              >
                去续费
              </Button>
              <Button disabled={busy} onClick={() => void openCodeImport()}>
                切换提取码
              </Button>
              <Button onClick={() => setExpiredDialogOpen(false)}>关闭</Button>
            </DialogActions>
          </Dialog>

          {/* 本地配置编辑器 */}
          {editorState && (
            <EditorViewer
              open={Boolean(editorState)}
              title={`编辑：${editorState.name}`}
              value={editorState.value}
              language="yaml"
              path={`${editorState.uid}.yaml`}
              onChange={(value) =>
                setEditorState((prev) =>
                  prev ? { ...prev, value: value ?? '' } : prev,
                )
              }
              onSave={manualSaveEdit}
              onClose={() => setEditorState(null)}
            />
          )}
        </Stack>
      </Box>
    </BasePage>
  )
}

export default HomePage
