import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
const read = (name) =>
  readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
const profile = Object.fromEntries(
  read('site-profile.properties')
    .split('\n')
    .filter((s) => s && !s.startsWith('#') && s.includes('='))
    .map((s) => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]),
)
test('preserves installed Wuai identity and updater signature while retaining compatible runtime', () => {
  const config = JSON.parse(read('src-tauri/tauri.conf.json'))
  assert.equal(config.productName, profile['client.name'])
  assert.equal(config.identifier, profile['desktop.identifier'])
  assert.equal(config.productName, '吾爱云')
  assert.ok(config.plugins.updater.pubkey)
  for (const url of config.plugins.updater.endpoints)
    assert.ok(url.includes('abxian/shenxianyun-52nm/'))
  assert.match(
    read('src-tauri/src/utils/dirs.rs'),
    /io\.github\.clash-verge-rev/,
  )
})
test('official APIs and profile recognition stay bound to52nm', () => {
  assert.equal(profile['api.domestic.base'], 'https://api.52nm.de:5443')
  assert.match(
    read('src/services/endpoint-resolver.ts'),
    /DOMAIN_PROFILE\.apiBases/,
  )
  assert.match(read('src/pages/home.tsx'), /isOfficialHostname\(host\)/)
  assert.match(read('src/pages/home.tsx'), /getRuntimeBrand\(\)\.client_name/)
  assert.match(
    read('src/services/traffic-rule-editor.ts'),
    /DOMAIN,api\.52nm\.de,DIRECT/,
  )
  const native = read('src-tauri/src/core/updater.rs')
  assert.doesNotMatch(native, /sxy\.sxnn\.de|abxian\/shenxianyun\//)
  assert.match(native, /abxian\/shenxianyun-52nm\//)
})
test('native and translated UI uses the Wuai site profile without showing account codes', () => {
  assert.match(
    read('src-tauri/src/utils/brand.rs'),
    /env!\("CLIENT_DISPLAY_NAME"\)/,
  )
  assert.match(
    read('src/services/visible-brand.ts'),
    /__SITE_PROFILE__\.clientName/,
  )
  assert.match(read('src/services/i18n.ts'), /visibleBrand/)
  assert.doesNotMatch(
    read('src-tauri/src/core/tray/mod.rs'),
    /load_managed_auth|profiles_preview|profiles_\{/,
  )
})
test('keeps derived stable device identity and proxy-only accounting', () => {
  assert.match(
    read('src-tauri/src/cmd/network.rs'),
    /format!\("pc-\{digest:x\}"\)/,
  )
  assert.match(
    read('src/pages/home.tsx'),
    /device_key:\s*deviceKey\s*\|\|\s*getClientId\(\)/,
  )
  assert.match(
    read('src/pages/home.tsx'),
    /desktopProxyTrafficTotals\(connectionResponse.data\)/,
  )
  assert.doesNotMatch(
    read('src/pages/home.tsx'),
    /MachineGuid|IOPlatformUUID|machine-id/,
  )
})
test('release packaging retains independent repository and disabled legacy Dufs writes', () => {
  const workflow = read('.github/workflows/release.yml')
  assert.match(workflow, /吾爱云 PC 52nm/)
  assert.match(workflow, /git merge-base --is-ancestor/)
  assert.match(workflow, /ENABLE_DUFS_PUBLISH: 'false'/)
  assert.match(
    read('scripts/updater.mjs'),
    /process.env.ENABLE_DUFS_PUBLISH === 'true'/,
  )
  assert.match(
    read('scripts/updater-fixed-webview2.mjs'),
    /process.exitCode = 1/,
  )
})
