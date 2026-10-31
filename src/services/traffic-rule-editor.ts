export const DOMESTIC_API_DIRECT_RULE = 'DOMAIN,api.52nm.de,DIRECT'

type RuleConfig = Record<string, unknown>
const keys = ['prepend-rules', 'append-rules'] as const
const rulesAt = (data: RuleConfig, key: string): unknown[] =>
  Array.isArray(data[key]) ? data[key] : []

const targetOf = (rule: unknown) =>
  typeof rule === 'string'
    ? rule
        .split(',')
        .slice(0, 2)
        .map((part) => part.trim())
        .join(',')
    : null

export function pinApiDirect(data: RuleConfig): RuleConfig {
  return {
    ...data,
    'prepend-rules': [
      DOMESTIC_API_DIRECT_RULE,
      ...rulesAt(data, 'prepend-rules').filter(
        (rule) => rule !== DOMESTIC_API_DIRECT_RULE,
      ),
    ],
    'append-rules': rulesAt(data, 'append-rules').filter(
      (rule) => rule !== DOMESTIC_API_DIRECT_RULE,
    ),
  }
}

export function upsertTrafficRule(data: RuleConfig, rule: string): RuleConfig {
  if (targetOf(rule) === 'DOMAIN,api.52nm.de') {
    throw new Error('api.52nm.de 始终使用直连，无需添加规则')
  }
  const next = { ...data }
  for (const key of keys) {
    next[key] = rulesAt(data, key).filter(
      (existing) => targetOf(existing) !== targetOf(rule),
    )
  }
  next['prepend-rules'] = [rule, ...rulesAt(next, 'prepend-rules')]
  return pinApiDirect(next)
}

export function removeTrafficRule(data: RuleConfig, raw: string): RuleConfig {
  const next = { ...data }
  for (const key of keys) {
    next[key] = rulesAt(data, key).filter((rule) => rule !== raw)
  }
  return pinApiDirect(next)
}

// saveProfileFile validates, applies and rolls back on failure. Do not claim success
// on a false validation outcome, or trigger a second competing enhancement.
export async function saveRuleEdit(
  save: () => Promise<boolean>,
): Promise<void> {
  if (!(await save())) {
    throw new Error('规则保存或应用失败，请检查规则内容和节点是否有效后重试')
  }
}
