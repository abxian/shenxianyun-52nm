import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { applySiteProfile } from './site-profile.mjs'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)

test('keeps native tray version text behind runtime brand replacement', () => {
  const brandSource = fs.readFileSync(
    path.join(repositoryRoot, 'src-tauri/src/utils/brand.rs'),
    'utf8',
  )
  const traySource = fs.readFileSync(
    path.join(repositoryRoot, 'src-tauri/src/core/tray/mod.rs'),
    'utf8',
  )

  assert.match(brandSource, /\.replace\("Verge", app_name\)/)
  assert.match(traySource, /build_tray_version_label\(&texts\.verge_version/)
  assert.doesNotMatch(
    traySource,
    /format!\("\{\} \{version\}", texts\.verge_version\)/,
  )
})

test('applies a copied brand without retaining 52nm endpoints', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-profile-'))
  fs.mkdirSync(path.join(root, 'src-tauri'), { recursive: true })
  fs.mkdirSync(path.join(root, 'src/assets/image'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'site-profile.properties'),
    [
      'profile.id=demo',
      'site.name=演示站',
      'client.name=演示云',
      'node.brand=演示节点',
      'subscription.name.template={client_name}-{code}',
      'desktop.product.name=Demo Cloud',
      'desktop.artifact.basename=DemoCloud',
      'desktop.identifier=example.demo.cloud',
      'deep.link.scheme=democloud',
      'api.domestic.base=https://api.example.test',
      'api.bases=https://api.example.test,https://backup.example.test',
      'discovery.urls=https://api.example.test/api/endpoints',
      'official.domain.suffixes=example.test',
      'github.repository=example/demo-cloud',
      'updater.endpoints=https://example.test/update.json',
    ].join('\n'),
  )
  for (const name of [
    'tauri.conf.json',
    'tauri.windows.conf.json',
    'tauri.macos.conf.json',
    'tauri.linux.conf.json',
  ]) {
    fs.writeFileSync(
      path.join(root, 'src-tauri', name),
      JSON.stringify(
        name === 'tauri.conf.json'
          ? {
              identifier: 'old.id',
              productName: 'Old',
              plugins: {
                updater: { endpoints: [] },
                'deep-link': { desktop: { schemes: [] } },
              },
            }
          : { identifier: 'old.id' },
      ),
    )
  }
  fs.writeFileSync(
    path.join(root, 'endpoints.json'),
    JSON.stringify({ bootstrap_proxy: '', updated_at: 'unchanged' }),
  )
  fs.writeFileSync(
    path.join(root, 'src/index.html'),
    '<html><head><title>Old</title></head></html>',
  )
  fs.writeFileSync(
    path.join(root, 'src/assets/image/logo.svg'),
    '<svg><text>Old Brand</text></svg>',
  )

  const profile = applySiteProfile(root)
  assert.equal(profile.profileId, 'demo')
  const tauri = JSON.parse(
    fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'),
  )
  assert.equal(tauri.productName, 'Demo Cloud')
  assert.equal(profile.desktopArtifactBasename, 'DemoCloud')
  assert.equal(tauri.identifier, 'example.demo.cloud')
  assert.equal(tauri.bundle.longDescription, '演示云')
  assert.equal(tauri.bundle.shortDescription, '演示云')
  assert.equal(tauri.bundle.publisher, '演示云')
  assert.deepEqual(tauri.plugins['deep-link'].desktop.schemes, [
    'clash',
    'clash-verge',
    'democloud',
  ])
  const endpoints = fs.readFileSync(path.join(root, 'endpoints.json'), 'utf8')
  assert.match(endpoints, /api\.example\.test/)
  assert.doesNotMatch(endpoints, /52nm/)
  assert.match(
    fs.readFileSync(path.join(root, 'src/index.html'), 'utf8'),
    /<title>演示云<\/title>/,
  )
  assert.match(
    fs.readFileSync(path.join(root, 'src/assets/image/logo.svg'), 'utf8'),
    /<text>演示云<\/text>/,
  )
})
