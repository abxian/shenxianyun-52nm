export function summarizeNotice(message: string): string {
  if (/invalid REALITY short ID/i.test(message)) {
    const index = message.match(/proxy\s+(\d+)/i)?.[1]
    return `订阅${index ? `中的编号 ${index} 节点` : '中的节点'} REALITY short ID 无效，原配置已保留。请更新订阅或联系配置提供者修正节点参数。`
  }
  if (message.length > 220) return `${message.slice(0, 180)}…`
  return message
}
