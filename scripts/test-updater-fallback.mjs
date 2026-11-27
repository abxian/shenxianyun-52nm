import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import ts from 'typescript'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

function actualArrow(source, name, ports) {
  const tree = ts.createSourceFile(
    'source.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  let body
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) {
      body = ts.isCallExpression(node.initializer)
        ? node.initializer.arguments[0].getText(tree)
        : node.initializer.getText(tree)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.ok(body, `actual callback ${name} exists`)
  const js = ts.transpileModule(`const callback = ${body}`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText
  return new Function('ports', `with(ports){${js}; return callback}`)(ports)
}

test('Mac Home uses the Wuai mirror before the matching GitHub Release', async () => {
  const [home, service] = await Promise.all([
    read('src/pages/home.tsx'),
    read('src/services/update.ts'),
  ])
  const base = 'https://mirror.example.net:5443'
  for (const [arch, suffix, available] of [
    ['aarch64', 'aarch64', true],
    ['x86_64', 'x64', true],
    ['aarch64', 'aarch64', false],
  ]) {
    const expected = `${base}/sxy/wuai/assets/v2.5.43/Wuaiyun_2.5.43_${suffix}.dmg`
    const fallback =
      'https://github.com/abxian/shenxianyun-52nm/releases/tag/v2.5.43'
    const opened = []
    const downloadUrl = actualArrow(service, 'macosDufsDownloadUrl', {
      ensureSemver: (version) => version,
      refreshEndpoints: async () => ({ download_base: base }),
      fetchWithVerifiedTls: async (url, options) => {
        assert.equal(url, expected)
        assert.equal(options.method, 'HEAD')
        return new Response(null, {
          status: available ? 200 : 404,
          headers: { 'Content-Length': available ? '100' : '0' },
        })
      },
    })
    await actualArrow(home, 'doUpdate', {
      updateInfo: { available: true, version: '2.5.43' },
      updating: false,
      isMacOS: true,
      getAppArch: async () => arch,
      macosDufsDownloadUrl: downloadUrl,
      releaseUrlForVersion: (version) => {
        assert.equal(version, '2.5.43')
        return fallback
      },
      openWebUrl: async (url) => opened.push(url),
      setUpdating: () => assert.fail('Mac must not install in-place'),
    })()
    assert.deepEqual(opened, [available ? expected : fallback])
  }
})

test('metadata endpoints remain on the independent GitHub mirror and origin', async () => {
  const config = JSON.parse(await read('src-tauri/tauri.conf.json'))
  const endpoints = config.plugins.updater.endpoints

  assert.ok(endpoints[0].includes('github.com/abxian/shenxianyun-52nm/'))
  assert.ok(endpoints[1].includes('github.com/abxian/shenxianyun-52nm/'))
  assert.equal(endpoints.length, 2)
})

test('Windows update entry points use the in-app fallback command', async () => {
  const [home, viewer, service, updater] = await Promise.all([
    read('src/pages/home.tsx'),
    read('src/components/setting/mods/update-viewer.tsx'),
    read('src/services/update.ts'),
    read('src-tauri/src/core/updater.rs'),
  ])

  assert.match(home, /downloadAndInstallWithFallback\(updateInfo/)
  assert.match(viewer, /downloadAndInstallWithFallback\(updateInfo/)
  assert.doesNotMatch(home, /updateInfo\.downloadAndInstall/)
  assert.doesNotMatch(viewer, /updateInfo\.downloadAndInstall/)
  assert.match(service, /invoke<void>\('install_app_update_with_fallback'/)
  assert.match(updater, /UpdateSource::Dufs/)
  assert.match(updater, /UpdateSource::Github/)
  assert.match(updater, /update\.install\(&?bytes\)/)
  assert.match(updater, /tokio::task::spawn_blocking/)
  assert.match(updater, /NotificationSystem::broadcast\(/)
  assert.doesNotMatch(updater, /open::|open_web_url/)
})

test('manual release links stay bound to the Wuai profile', async () => {
  const [home, viewer, service] = await Promise.all([
    read('src/pages/home.tsx'),
    read('src/components/setting/mods/update-viewer.tsx'),
    read('src/services/update.ts'),
  ])
  const combined = `${home}\n${viewer}\n${service}`

  assert.match(combined, /DOMAIN_PROFILE\.githubRepository/)
  assert.doesNotMatch(combined, /abxian\/shenxianyun\/releases/)
  assert.doesNotMatch(combined, /clash-verge-rev\/clash-verge-rev\/releases/)
})
