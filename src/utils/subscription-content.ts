import yaml from 'js-yaml'
import { isEqual } from 'lodash-es'

const mapping = (content: string) => {
  const value = yaml.load(content)
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('订阅内容不是有效的 YAML 配置')
  return value as Record<string, unknown>
}

// Merge protected rules BEFORE the single validation/apply, so the core never
// briefly runs the remote configuration without the user's existing rules.
// null means no semantic change and no configuration write is necessary.
export const prepareSubscriptionContent = (
  previous: string,
  downloaded: string,
): string | null => {
  const local = mapping(previous)
  const next = { ...mapping(downloaded) }
  if (Array.isArray(local.rules)) next.rules = local.rules
  for (const key of ['rule-providers', 'sub-rules']) {
    const value = local[key]
    if (value && typeof value === 'object') next[key] = value
  }
  return isEqual(local, next) ? null : yaml.dump(next, { lineWidth: -1 })
}
