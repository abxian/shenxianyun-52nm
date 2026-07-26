/** 由仓库根目录 site-profile.properties 注入。复制项目时只修改该文件。 */
export const DOMAIN_PROFILE = {
  id: __SITE_PROFILE__.profileId,
  siteName: __SITE_PROFILE__.siteName,
  clientName: __SITE_PROFILE__.clientName,
  nodeBrand: __SITE_PROFILE__.nodeBrand,
  subscriptionNameTemplate: __SITE_PROFILE__.subscriptionNameTemplate,
  deepLinkScheme: __SITE_PROFILE__.deepLinkScheme,
  domesticApiBase: __SITE_PROFILE__.domesticApiBase,
  apiBases: __SITE_PROFILE__.apiBases,
  discoveryUrls: __SITE_PROFILE__.discoveryUrls,
  officialDomainSuffixes: __SITE_PROFILE__.officialDomainSuffixes,
  githubRepository: __SITE_PROFILE__.githubRepository,
} as const

export const DOMESTIC_API_HOST = new URL(DOMAIN_PROFILE.domesticApiBase)
  .hostname

export const isOfficialHostname = (hostname: string): boolean => {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, '')
  return DOMAIN_PROFILE.officialDomainSuffixes.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`),
  )
}
