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

test('Mac Home retains the independent GitHub Release route without installing', async () => {
  const home = await read('src/pages/home.tsx')
  const urls = []
  await actualArrow(home, 'doUpdate', {
    updateInfo: { available: true, version: '2.5.39' },
    updating: false,
    isMacOS: true,
    DOMAIN_PROFILE: { githubRepository: 'abxian/shenxianyun-52nm' },
    openWebUrl: async (url) => urls.push(url),
    setUpdating: () => assert.fail('Mac must not install in-place'),
  })()
  assert.deepEqual(urls, [
    'https://github.com/abxian/shenxianyun-52nm/releases/latest',
  ])
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
