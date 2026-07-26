import fs from 'node:fs'
import path from 'node:path'

const required = [
  'profile.id',
  'site.name',
  'client.name',
  'desktop.product.name',
  'desktop.identifier',
  'deep.link.scheme',
  'api.domestic.base',
  'api.bases',
  'discovery.urls',
  'official.domain.suffixes',
  'github.repository',
  'updater.endpoints',
]

const parseList = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

export const readSiteProfile = (root = process.cwd()) => {
  const file = path.join(root, 'site-profile.properties')
  const values = {}
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) throw new Error(`Invalid site profile line: ${raw}`)
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
  }
  for (const key of required) {
    if (!values[key]) throw new Error(`Missing site profile value: ${key}`)
  }
  if (!/^[a-z][a-z0-9+.-]{1,31}$/.test(values['deep.link.scheme'])) {
    throw new Error('deep.link.scheme must be a valid URI scheme')
  }
  if (!values['subscription.name.template'].includes('{code}')) {
    throw new Error('subscription.name.template must contain {code}')
  }
  new URL(values['api.domestic.base'])
  const urlKeys = ['api.bases', 'discovery.urls', 'updater.endpoints']
  for (const key of urlKeys) {
    for (const value of parseList(values[key])) new URL(value)
  }
  return {
    profileId: values['profile.id'],
    siteName: values['site.name'],
    clientName: values['client.name'],
    nodeBrand: values['node.brand'] || values['client.name'],
    subscriptionNameTemplate: values['subscription.name.template'] || '{code}',
    desktopProductName: values['desktop.product.name'],
    desktopIdentifier: values['desktop.identifier'],
    deepLinkScheme: values['deep.link.scheme'],
    domesticApiBase: values['api.domestic.base'].replace(/\/+$/, ''),
    apiBases: parseList(values['api.bases']).map((value) =>
      value.replace(/\/+$/, ''),
    ),
    discoveryUrls: parseList(values['discovery.urls']),
    officialDomainSuffixes: parseList(values['official.domain.suffixes']),
    githubRepository: values['github.repository'],
    updaterEndpoints: parseList(values['updater.endpoints']),
  }
}

const writeJsonIfChanged = (file, value) => {
  const next = `${JSON.stringify(value, null, 2)}\n`
  if (fs.readFileSync(file, 'utf8') !== next) fs.writeFileSync(file, next)
}

const escapeXml = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

export const applySiteProfile = (root = process.cwd()) => {
  const profile = readSiteProfile(root)
  for (const relative of [
    'src-tauri/tauri.conf.json',
    'src-tauri/tauri.windows.conf.json',
    'src-tauri/tauri.macos.conf.json',
    'src-tauri/tauri.linux.conf.json',
  ]) {
    const file = path.join(root, relative)
    const config = JSON.parse(fs.readFileSync(file, 'utf8'))
    config.identifier = profile.desktopIdentifier
    if (relative.endsWith('/tauri.conf.json')) {
      config.productName = profile.desktopProductName
      config.plugins ??= {}
      config.plugins['deep-link'] ??= {}
      config.plugins['deep-link'].desktop ??= {}
      config.plugins['deep-link'].desktop.schemes = [
        'clash',
        'clash-verge',
        profile.deepLinkScheme,
      ]
      config.plugins.updater ??= {}
      config.plugins.updater.endpoints = profile.updaterEndpoints
    } else if (Object.hasOwn(config, 'productName')) {
      config.productName = profile.desktopProductName
    }
    writeJsonIfChanged(file, config)
  }

  const endpointsFile = path.join(root, 'endpoints.json')
  const endpoints = JSON.parse(fs.readFileSync(endpointsFile, 'utf8'))
  endpoints.profile = profile.profileId
  endpoints.brand = {
    site_name: profile.siteName,
    client_name: profile.clientName,
    node_brand: profile.nodeBrand,
    subscription_name_template: profile.subscriptionNameTemplate,
    managed_import_scheme: profile.deepLinkScheme,
  }
  endpoints.api_bases = profile.apiBases
  endpoints.sub_base = profile.domesticApiBase
  endpoints.download_base = profile.domesticApiBase
  writeJsonIfChanged(endpointsFile, endpoints)

  const indexFile = path.join(root, 'src/index.html')
  const indexHtml = fs.readFileSync(indexFile, 'utf8')
  const nextIndex = indexHtml.replace(
    /<title>[^<]*<\/title>/,
    `<title>${profile.clientName}</title>`,
  )
  if (nextIndex !== indexHtml) fs.writeFileSync(indexFile, nextIndex)

  const logoFile = path.join(root, 'src/assets/image/logo.svg')
  const logo = fs.readFileSync(logoFile, 'utf8')
  const nextLogo = logo.replace(
    /(<text\b[^>]*>)[\s\S]*?(<\/text>)/,
    `$1${escapeXml(profile.clientName)}$2`,
  )
  if (nextLogo === logo && !logo.includes(escapeXml(profile.clientName))) {
    throw new Error('Unable to update client name in src/assets/image/logo.svg')
  }
  if (nextLogo !== logo) fs.writeFileSync(logoFile, nextLogo)
  return profile
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const profile = applySiteProfile(process.cwd())
  process.stdout.write(
    `Applied site profile ${profile.profileId} (${profile.clientName})\n`,
  )
}
