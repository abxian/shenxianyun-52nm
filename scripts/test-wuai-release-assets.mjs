import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

import { readSiteProfile } from './site-profile.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const profile = readSiteProfile(root)
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')

test('release and Intel recovery retain Wuai profile asset names', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wuai-release-'))
  try {
    const output = path.join(directory, 'output')
    const environment = path.join(directory, 'environment')
    const result = spawnSync('node', ['scripts/site-profile-env.mjs'], {
      cwd: root,
      env: { ...process.env, GITHUB_ENV: environment, GITHUB_OUTPUT: output },
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(
      fs.readFileSync(output, 'utf8'),
      /^artifact_basename=Wuaiyun$/m,
    )
    assert.match(fs.readFileSync(environment, 'utf8'), /^PRODUCT_NAME=吾爱云$/m)
    assert.equal(profile.githubRepository, 'abxian/shenxianyun-52nm')
    const workflow = read('.github/workflows/release.yml')
    assert.ok(
      workflow.includes(
        // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions syntax
        "assetNamePattern: '${{ steps.release_artifact_names.outputs.artifact_basename }}_[version]_[arch][setup][ext]'",
      ),
    )
    for (const arch of ['aarch64', 'x64']) {
      assert.ok(
        // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions version
        workflow.includes(`Wuaiyun_${'${{ env.VERSION }}'}_${arch}.dmg`),
      )
    }
    const intel = read('.github/workflows/macos-intel.yml')
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell version
    for (const name of ['Wuaiyun_${VERSION}_x64.dmg', 'Wuaiyun.app.tar.gz'])
      assert.ok(intel.includes(name))
    assert.ok(intel.includes('cp "$SOURCE_SIG" "$SIG"'))
    assert.doesNotMatch(`${workflow}\n${intel}`, /Clash\.Verge/)
    assert.match(workflow, /ENABLE_DUFS_PUBLISH: 'false'/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

// Execute actual updater functions; only await their existing entrypoint.
// Synthetic imports/fetch keep every release/network write inside this test.
async function generateActualUpdater(reverse, versioned) {
  const version = '2.5.39'
  const repository = profile.githubRepository
  const base = `https://github.com/${repository}/releases/download/v${version}/`
  const intel = versioned
    ? `Wuaiyun_${version}_x64.app.tar.gz`
    : 'Wuaiyun.app.tar.gz'
  const arm = versioned
    ? `Wuaiyun_${version}_aarch64.app.tar.gz`
    : 'Wuaiyun_aarch64.app.tar.gz'
  const windows = `Wuaiyun_${version}_x64-setup.exe`
  const names = [
    intel,
    `${intel}.sig`,
    arm,
    `${arm}.sig`,
    windows,
    `${windows}.sig`,
    `Wuaiyun_${version}_amd64.deb`,
  ]
  const assets = names.map((name) => ({
    name,
    browser_download_url: base + name,
  }))
  if (reverse) assets.reverse()
  const uploads = new Map()
  const fetched = []
  const scoped = (args) =>
    assert.equal(`${args.owner}/${args.repo}`, repository)
  const github = {
    rest: {
      repos: {
        listTags: async (args) => {
          scoped(args)
          return { data: [{ name: `v${version}` }] }
        },
        getReleaseByTag: async (args) => {
          scoped(args)
          assert.ok([`v${version}`, 'updater'].includes(args.tag))
          return {
            data: args.tag === 'updater' ? { id: 17, assets: [] } : { assets },
          }
        },
        uploadReleaseAsset: async (args) => {
          scoped(args)
          assert.equal(args.release_id, 17)
          uploads.set(args.name, JSON.parse(args.data))
        },
      },
    },
  }
  const context = vm.createContext({
    process: {
      env: {
        GITHUB_TOKEN: 'isolated-test-value',
        ENABLE_DUFS_PUBLISH: 'false',
      },
      cwd: () => root,
      exitCode: 0,
    },
    console: { log() {}, error: (...args) => assert.fail(args.join(' ')) },
    fetch: async (url, options) => {
      assert.ok(
        assets.some(
          (a) => a.browser_download_url === url && a.name.endsWith('.sig'),
        ),
      )
      assert.equal(options.method, 'GET')
      fetched.push(url)
      return { text: async () => `signature-for:${url}` }
    },
  })
  const synthetic = (values) =>
    new vm.SyntheticModule(
      Object.keys(values),
      function () {
        for (const [name, value] of Object.entries(values))
          this.setExport(name, value)
      },
      { context },
    )
  const dependencies = {
    '@actions/github': synthetic({
      context: { repo: { owner: 'abxian', repo: 'shenxianyun-52nm' } },
      getOctokit: () => github,
    }),
    './site-profile.mjs': synthetic({ readSiteProfile }),
    './updatelog.mjs': synthetic({
      resolveUpdateLog: async () => 'Wuai release',
      resolveUpdateLogDefault: async () => 'Wuai release',
    }),
  }
  const original = read('scripts/updater.mjs')
  assert.equal(original.split('resolveUpdater().catch(').length, 2)
  const module = new vm.SourceTextModule(
    original.replace(
      'resolveUpdater().catch(',
      'await resolveUpdater().catch(',
    ),
    { context },
  )
  await module.link((specifier) => {
    assert.ok(dependencies[specifier], specifier)
    return dependencies[specifier]
  })
  await module.evaluate({ timeout: 5000 })
  assert.equal(context.process.exitCode, 0)
  assert.equal(uploads.size, 2)
  assert.equal(fetched.length, 3)
  const regular = uploads.get('update.json')
  const proxy = uploads.get('update-proxy.json')
  assert.equal(regular.version, version)
  const expected = {
    darwin: intel,
    'darwin-intel': intel,
    'darwin-x86_64': intel,
    'darwin-aarch64': arm,
    win64: windows,
    'windows-x86_64': windows,
  }
  assert.deepEqual(
    Object.keys(regular.platforms).sort(),
    Object.keys(expected).sort(),
  )
  for (const [key, filename] of Object.entries(expected)) {
    assert.equal(regular.platforms[key].url, base + filename)
    assert.equal(
      regular.platforms[key].signature,
      `signature-for:${base}${filename}.sig`,
    )
    assert.equal(
      proxy.platforms[key].url,
      `https://gh-proxy.org/${base}${filename}`,
    )
    assert.equal(
      proxy.platforms[key].signature,
      regular.platforms[key].signature,
    )
  }
}

for (const versioned of [false, true]) {
  for (const reverse of [false, true]) {
    test(`actual updater preserves Mac architectures and signatures (versioned=${versioned}, reversed=${reverse})`, async () => {
      await generateActualUpdater(reverse, versioned)
    })
  }
}
