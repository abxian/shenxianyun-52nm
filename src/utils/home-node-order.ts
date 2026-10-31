export const isAutomaticNode = (node: { name: string; type?: string }) =>
  node.name.includes('自动选择') &&
  ['urltest', 'url-test', 'fallback', 'loadbalance', 'load-balance'].includes(
    String(node.type || '').toLowerCase(),
  )

// Automatic policies stay pinned; measured latency only reorders manual nodes.
export const sortHomeNodes = <T extends { name: string; type?: string }>(
  nodes: T[],
  rank: (node: T) => number,
): T[] =>
  [...nodes].sort((a, b) => {
    const autoA = isAutomaticNode(a)
    const autoB = isAutomaticNode(b)
    if (autoA !== autoB) return autoA ? -1 : 1
    return autoA ? 0 : rank(a) - rank(b)
  })
