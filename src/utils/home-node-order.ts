const pinnedRank = ({ name, type }: { name: string; type?: string }) => {
  const kind = type?.toLowerCase()
  const balances = kind === 'loadbalance' || kind === 'load-balance'
  const fallsBack = kind === 'fallback'
  const measures = kind === 'urltest' || kind === 'url-test'
  if (name.includes('自动选择') && (balances || fallsBack || measures)) return 0
  if (name === '负载均衡' && balances) return 1
  if (name === '轮询负载均衡' && balances) return 2
  if (name === '故障转移' && fallsBack) return 3
  return 4
}

export const isAutomaticNode = (node: { name: string; type?: string }) =>
  pinnedRank(node) < 4

// Automatic policies stay pinned; measured latency only reorders manual nodes.
export const sortHomeNodes = <T extends { name: string; type?: string }>(
  nodes: T[],
  rank: (node: T) => number,
): T[] =>
  [...nodes].sort((a, b) => {
    const pinA = pinnedRank(a)
    const pinB = pinnedRank(b)
    if (pinA !== pinB) return pinA - pinB
    return pinA < 4 ? 0 : rank(a) - rank(b)
  })
