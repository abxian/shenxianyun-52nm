/**
 * 52nm 站点绑定配置。
 *
 * 更换网站时优先只改本文件和仓库根目录 endpoints.json。运行时代码不得再散落
 * 写死 API 域名；发行包下载/更新通道属于独立配置，不与网站 API 混在一起。
 */
export const DOMAIN_PROFILE = {
  id: '52nm',
  domesticApiBase: 'https://api.52nm.de:5443',
  apiBases: [
    'https://api.52nm.de:5443',
    'https://52nm.de',
    'https://www.52nm.de',
  ],
  discoveryUrls: [
    'https://api.52nm.de:5443/api/endpoints',
    'https://raw.githubusercontent.com/abxian/shenxianyun-52nm/main/endpoints.json',
    'https://52nm.de/api/endpoints',
    'https://www.52nm.de/api/endpoints',
  ],
  officialDomainSuffixes: ['52nm.de'],
} as const

export const DOMESTIC_API_HOST = new URL(DOMAIN_PROFILE.domesticApiBase)
  .hostname

export const isOfficialHostname = (hostname: string): boolean => {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, '')
  return DOMAIN_PROFILE.officialDomainSuffixes.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`),
  )
}
