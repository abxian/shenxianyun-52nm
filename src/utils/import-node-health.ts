export type ImportNodeCandidate = {
  name: string
  type?: string
}

export type RankedImportNode = {
  name: string
  delay: number
}

const RESERVED_PROXY_NAMES = new Set([
  'DIRECT',
  'REJECT',
  'REJECT-DROP',
  'PASS',
  'COMPATIBLE',
])

const RESERVED_PROXY_TYPES = new Set([
  'direct',
  'reject',
  'rejectdrop',
  'pass',
  'compatible',
])

export const listImportNodeCandidates = (
  proxies: ImportNodeCandidate[] = [],
) => {
  const seen = new Set<string>()

  return proxies
    .filter((proxy) => {
      const name = proxy.name?.trim()
      if (!name || seen.has(name)) return false

      const normalizedName = name.toUpperCase()
      const normalizedType = String(proxy.type || '')
        .toLowerCase()
        .replaceAll('-', '')
      if (
        RESERVED_PROXY_NAMES.has(normalizedName) ||
        RESERVED_PROXY_TYPES.has(normalizedType)
      ) {
        return false
      }

      seen.add(name)
      return true
    })
    .map((proxy) => proxy.name.trim())
}

export const rankHealthyImportNodes = (
  candidateNames: string[],
  delays: Record<string, number>,
  timeout: number,
): RankedImportNode[] => {
  const candidateOrder = new Map(
    candidateNames.map((name, index) => [name, index]),
  )

  return candidateNames
    .map((name) => ({ name, delay: Number(delays[name]) }))
    .filter(
      ({ delay }) => Number.isFinite(delay) && delay > 0 && delay < timeout,
    )
    .sort(
      (a, b) =>
        a.delay - b.delay ||
        (candidateOrder.get(a.name) ?? 0) - (candidateOrder.get(b.name) ?? 0),
    )
}

export class ImportNodeHealthError extends Error {
  readonly candidateCount: number
  readonly healthyCount: number

  constructor(message: string, candidateCount: number, healthyCount = 0) {
    super(message)
    this.name = 'ImportNodeHealthError'
    this.candidateCount = candidateCount
    this.healthyCount = healthyCount
  }
}
