import { context, getOctokit } from '@actions/github'

import { resolveUpdateLog, resolveUpdateLogDefault } from './updatelog.mjs'

// Add stable update JSON filenames
const UPDATE_TAG_NAME = 'updater'
const UPDATE_JSON_FILE = 'update.json'
const UPDATE_JSON_PROXY = 'update-proxy.json'
// Add alpha update JSON filenames
const ALPHA_TAG_NAME = 'updater-alpha'
const ALPHA_UPDATE_JSON_FILE = 'update.json'
const ALPHA_UPDATE_JSON_PROXY = 'update-proxy.json'

/// generate update.json
/// upload to update tag's release asset
async function resolveUpdater() {
  if (process.env.GITHUB_TOKEN === undefined) {
    throw new Error('GITHUB_TOKEN is required')
  }

  const options = { owner: context.repo.owner, repo: context.repo.repo }
  const github = getOctokit(process.env.GITHUB_TOKEN)

  // Fetch all tags using pagination
  let allTags = []
  let page = 1
  const perPage = 100

  while (true) {
    const { data: pageTags } = await github.rest.repos.listTags({
      ...options,
      per_page: perPage,
      page: page,
    })

    allTags = allTags.concat(pageTags)

    // Break if we received fewer tags than requested (last page)
    if (pageTags.length < perPage) {
      break
    }

    page++
  }

  const tags = allTags
  console.log(`Retrieved ${tags.length} tags in total`)

  // More flexible tag detection with regex patterns
  const stableTagRegex = /^v\d+\.\d+\.\d+$/ // Matches vX.Y.Z format
  // const preReleaseRegex = /^v\d+\.\d+\.\d+-(alpha|beta|rc|pre)/i; // Matches vX.Y.Z-alpha/beta/rc format
  const preReleaseRegex = /^(alpha|beta|rc|pre)$/i // Matches exact alpha/beta/rc/pre tags

  // Get the latest stable tag and pre-release tag
  const stableTag = tags.find((t) => stableTagRegex.test(t.name))
  const preReleaseTag = tags.find((t) => preReleaseRegex.test(t.name))

  console.log('All tags:', tags.map((t) => t.name).join(', '))
  console.log('Stable tag:', stableTag ? stableTag.name : 'None found')
  console.log(
    'Pre-release tag:',
    preReleaseTag ? preReleaseTag.name : 'None found',
  )
  console.log()

  // Process stable release
  if (stableTag) {
    await processRelease(github, options, stableTag, false)
  }

  // Process pre-release if found
  if (preReleaseTag) {
    await processRelease(github, options, preReleaseTag, true)
  }
}

// Process a release (stable or alpha) and generate update files
async function processRelease(github, options, tag, isAlpha) {
  if (!tag) return

  try {
    const { data: release } = await github.rest.repos.getReleaseByTag({
      ...options,
      tag: tag.name,
    })

    const updateData = {
      version: tag.name.replace(/^v/, ''),
      notes: await resolveUpdateLog(tag.name).catch(() =>
        resolveUpdateLogDefault().catch(() => 'No changelog available'),
      ),
      pub_date: new Date().toISOString(),
      platforms: {
        win64: { signature: '', url: '' }, // compatible with older formats
        linux: { signature: '', url: '' }, // compatible with older formats
        darwin: { signature: '', url: '' }, // compatible with older formats
        'darwin-aarch64': { signature: '', url: '' },
        'darwin-intel': { signature: '', url: '' },
        'darwin-x86_64': { signature: '', url: '' },
        'linux-x86_64': { signature: '', url: '' },
        'linux-x86': { signature: '', url: '' },
        'linux-i686': { signature: '', url: '' },
        'linux-aarch64': { signature: '', url: '' },
        'linux-armv7': { signature: '', url: '' },
        'windows-x86_64': { signature: '', url: '' },
        'windows-aarch64': { signature: '', url: '' },
        'windows-x86': { signature: '', url: '' },
        'windows-i686': { signature: '', url: '' },
      },
    }

    const promises = release.assets.map(async (asset) => {
      const { name, browser_download_url } = asset

      // Process all the platform URL and signature data
      // win64 url
      if (name.endsWith('x64-setup.exe')) {
        updateData.platforms.win64.url = browser_download_url
        updateData.platforms['windows-x86_64'].url = browser_download_url
      }
      // win64 signature
      if (name.endsWith('x64-setup.exe.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms.win64.signature = sig
        updateData.platforms['windows-x86_64'].signature = sig
      }

      // win32 url
      if (name.endsWith('x86-setup.exe')) {
        updateData.platforms['windows-x86'].url = browser_download_url
        updateData.platforms['windows-i686'].url = browser_download_url
      }
      // win32 signature
      if (name.endsWith('x86-setup.exe.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['windows-x86'].signature = sig
        updateData.platforms['windows-i686'].signature = sig
      }

      // win arm url
      if (name.endsWith('arm64-setup.exe')) {
        updateData.platforms['windows-aarch64'].url = browser_download_url
      }
      // win arm signature
      if (name.endsWith('arm64-setup.exe.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['windows-aarch64'].signature = sig
      }

      // darwin url (intel)
      if (name.endsWith('.app.tar.gz') && !name.includes('aarch')) {
        updateData.platforms.darwin.url = browser_download_url
        updateData.platforms['darwin-intel'].url = browser_download_url
        updateData.platforms['darwin-x86_64'].url = browser_download_url
      }
      // darwin signature (intel)
      if (name.endsWith('.app.tar.gz.sig') && !name.includes('aarch')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms.darwin.signature = sig
        updateData.platforms['darwin-intel'].signature = sig
        updateData.platforms['darwin-x86_64'].signature = sig
      }

      // darwin url (aarch)
      if (name.endsWith('aarch64.app.tar.gz')) {
        updateData.platforms['darwin-aarch64'].url = browser_download_url
        // 使linux可以检查更新
        updateData.platforms.linux.url = browser_download_url
        updateData.platforms['linux-x86_64'].url = browser_download_url
        updateData.platforms['linux-x86'].url = browser_download_url
        updateData.platforms['linux-i686'].url = browser_download_url
        updateData.platforms['linux-aarch64'].url = browser_download_url
        updateData.platforms['linux-armv7'].url = browser_download_url
      }
      // darwin signature (aarch)
      if (name.endsWith('aarch64.app.tar.gz.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['darwin-aarch64'].signature = sig
        updateData.platforms.linux.signature = sig
        updateData.platforms['linux-x86_64'].signature = sig
        updateData.platforms['linux-x86'].signature = sig
        updateData.platforms['linux-i686'].signature = sig
        updateData.platforms['linux-aarch64'].signature = sig
        updateData.platforms['linux-armv7'].signature = sig
      }
    })

    await Promise.allSettled(promises)
    console.log(updateData)

    // maybe should test the signature as well
    // delete the null field
    Object.entries(updateData.platforms).forEach(([key, value]) => {
      if (!value.url) {
        console.log(`[Error]: failed to parse release for "${key}"`)
        delete updateData.platforms[key]
      }
    })

    // Generate a proxy update file for accelerated GitHub resources
    const updateDataNew = JSON.parse(JSON.stringify(updateData))

    Object.entries(updateDataNew.platforms).forEach(([key, value]) => {
      if (value.url) {
        updateDataNew.platforms[key].url = 'https://gh-proxy.org/' + value.url
      } else {
        console.log(`[Error]: updateDataNew.platforms.${key} is null`)
      }
    })

    // Get the appropriate updater release based on isAlpha flag
    const releaseTag = isAlpha ? ALPHA_TAG_NAME : UPDATE_TAG_NAME
    console.log(
      `Processing ${isAlpha ? 'alpha' : 'stable'} release:`,
      releaseTag,
    )

    try {
      let updateRelease

      try {
        // Try to get the existing release
        const response = await github.rest.repos.getReleaseByTag({
          ...options,
          tag: releaseTag,
        })
        updateRelease = response.data
        console.log(
          `Found existing ${releaseTag} release with ID: ${updateRelease.id}`,
        )
      } catch (error) {
        // If release doesn't exist, create it
        if (error.status === 404) {
          console.log(
            `Release with tag ${releaseTag} not found, creating new release...`,
          )
          const createResponse = await github.rest.repos.createRelease({
            ...options,
            tag_name: releaseTag,
            name: isAlpha
              ? 'Auto-update Alpha Channel'
              : 'Auto-update Stable Channel',
            body: `This release contains the update information for ${isAlpha ? 'alpha' : 'stable'} channel.`,
            prerelease: isAlpha,
          })
          updateRelease = createResponse.data
          console.log(
            `Created new ${releaseTag} release with ID: ${updateRelease.id}`,
          )
        } else {
          // If it's another error, throw it
          throw error
        }
      }

      // File names based on release type
      const jsonFile = isAlpha ? ALPHA_UPDATE_JSON_FILE : UPDATE_JSON_FILE
      const proxyFile = isAlpha ? ALPHA_UPDATE_JSON_PROXY : UPDATE_JSON_PROXY

      // Delete existing assets with these names
      for (const asset of updateRelease.assets) {
        if (asset.name === jsonFile) {
          await github.rest.repos.deleteReleaseAsset({
            ...options,
            asset_id: asset.id,
          })
        }

        if (asset.name === proxyFile) {
          await github.rest.repos
            .deleteReleaseAsset({ ...options, asset_id: asset.id })
            .catch(console.error) // do not break the pipeline
        }
      }

      // Upload new assets
      await github.rest.repos.uploadReleaseAsset({
        ...options,
        release_id: updateRelease.id,
        name: jsonFile,
        data: JSON.stringify(updateData, null, 2),
      })

      await github.rest.repos.uploadReleaseAsset({
        ...options,
        release_id: updateRelease.id,
        name: proxyFile,
        data: JSON.stringify(updateDataNew, null, 2),
      })

      console.log(
        `Successfully uploaded ${isAlpha ? 'alpha' : 'stable'} update files to ${releaseTag}`,
      )

      // 52nm 绑定版本默认只发布到本仓库 GitHub Release。只有显式打开开关且
      // 配置了独立的 52nm 分发服务时才允许上传，避免覆盖旧神仙云 Dufs。
      if (!isAlpha && process.env.ENABLE_DUFS_PUBLISH === 'true') {
        await publishToDufs(updateData, release.assets).catch((err) => {
          console.error('[dufs] publish failed:', err.message)
          process.exitCode = 1
        })
      }
    } catch (error) {
      console.error(
        `Failed to process ${isAlpha ? 'alpha' : 'stable'} release:`,
        error.message,
      )
    }
  } catch (error) {
    if (error.status === 404) {
      console.log(`Release not found for tag: ${tag.name}, skipping...`)
    } else {
      console.error(`Failed to get release for tag: ${tag.name}`, error.message)
    }
  }
}

// get the signature file content
async function getSignature(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/octet-stream' },
  })

  return response.text()
}

// ===== 发布到自有 dufs：国内直连的第一更新通道，不依赖 GitHub / 第三方加速 =====
// 把各平台更新包从 GitHub 搬运到 dufs /updater/ 下，并生成指向 dufs 的 update.json。
// 可选独立分发需要仓库 secrets：DUFS_BASE、DUFS_USER、DUFS_PASS。
async function publishToDufs(updateData, releaseAssets) {
  const base = (process.env.DUFS_BASE || '').replace(/\/+$/, '')
  if (!base) {
    console.log('[dufs] DUFS_BASE not set, skip dufs publish')
    return
  }
  // 下载地址用对外域名(反代)，上传仍走 DUFS_BASE(内穿直连,鉴权稳定)。
  // 未配置 DUFS_PUBLIC_BASE 时下载地址与上传地址一致。
  const publicBase = (process.env.DUFS_PUBLIC_BASE || base).replace(/\/+$/, '')
  const auth =
    'Basic ' +
    Buffer.from(
      `${process.env.DUFS_USER || ''}:${process.env.DUFS_PASS || ''}`,
    ).toString('base64')

  const dufsData = JSON.parse(JSON.stringify(updateData))
  // dufs 不会在 PUT 时自动创建子目录，先 MKCOL 确保 /updater/ 存在（已存在时 405，忽略）
  await fetch(`${base}/updater`, {
    method: 'MKCOL',
    headers: { Authorization: auth },
  }).catch(() => {})
  // 同一文件(多平台复用同一 url)只搬运一次
  const uploaded = new Map()
  for (const [key, value] of Object.entries(dufsData.platforms)) {
    if (!value.url) continue
    const filename = decodeURIComponent(value.url.split('/').pop())
    const target = `${base}/updater/${encodeURIComponent(filename)}`
    if (uploaded.has(value.url)) {
      if (uploaded.get(value.url))
        value.url = `${publicBase}/updater/${encodeURIComponent(filename)}`
      continue
    }
    try {
      // GitHub release 大文件偶发 fetch failed，重试最多 4 次
      let buf = null
      for (let attempt = 1; attempt <= 4 && !buf; attempt++) {
        try {
          const res = await fetch(value.url)
          if (!res.ok) {
            console.log(
              `[dufs] ${filename} HTTP ${res.status} (try ${attempt})`,
            )
            continue
          }
          buf = Buffer.from(await res.arrayBuffer())
        } catch (e) {
          console.log(
            `[dufs] ${filename} fetch err (try ${attempt}): ${e.message}`,
          )
          await new Promise((r) => setTimeout(r, 3000 * attempt))
        }
      }
      if (!buf) {
        uploaded.set(value.url, false)
        continue
      }
      let putOk = false
      for (let attempt = 1; attempt <= 4 && !putOk; attempt++) {
        try {
          const put = await fetch(target, {
            method: 'PUT',
            headers: { Authorization: auth },
            body: buf,
          })
          const head = await fetch(target, {
            method: 'HEAD',
            headers: { Authorization: auth },
          })
          const uploadedSize = Number(head.headers.get('content-length'))
          putOk = put.ok && head.ok && uploadedSize === buf.length
          console.log(
            `[dufs] ${key}: ${filename} -> HTTP ${put.status}, ${uploadedSize}/${buf.length} bytes (try ${attempt})`,
          )
        } catch (e) {
          console.log(
            `[dufs] ${filename} upload err (try ${attempt}): ${e.message}`,
          )
        }
        if (!putOk) await new Promise((r) => setTimeout(r, 3000 * attempt))
      }
      uploaded.set(value.url, putOk)
      if (putOk)
        value.url = `${publicBase}/updater/${encodeURIComponent(filename)}`
    } catch (err) {
      console.log(`[dufs] ${filename} error: ${err.message}`)
      uploaded.set(value.url, false)
    }
  }

  // 同步下载页使用的固定文件名，避免新版本只更新 /updater/ 而根目录仍是旧安装包。
  const stableAliases = [
    { suffix: 'x64-setup.exe', name: '神仙云.exe' },
    { suffix: 'aarch64.dmg', name: '神仙云.dmg' },
    { suffix: 'amd64.deb', name: '神仙云.deb' },
    { suffix: 'x86_64.rpm', name: '神仙云.rpm' },
  ]
  for (const alias of stableAliases) {
    const asset = releaseAssets.find(
      ({ name }) => name.endsWith(alias.suffix) && !name.endsWith('.sig'),
    )
    if (!asset) {
      console.log(`[dufs] root alias ${alias.name}: release asset not found`)
      uploaded.set(`alias:${alias.name}`, false)
      continue
    }

    const target = `${base}/${encodeURIComponent(alias.name)}`
    try {
      let buf = null
      for (let attempt = 1; attempt <= 4 && !buf; attempt++) {
        try {
          const res = await fetch(asset.browser_download_url)
          if (!res.ok) {
            console.log(
              `[dufs] ${alias.name} HTTP ${res.status} (try ${attempt})`,
            )
            continue
          }
          buf = Buffer.from(await res.arrayBuffer())
        } catch (e) {
          console.log(
            `[dufs] ${alias.name} fetch err (try ${attempt}): ${e.message}`,
          )
          await new Promise((r) => setTimeout(r, 3000 * attempt))
        }
      }
      if (!buf) {
        uploaded.set(`alias:${alias.name}`, false)
        continue
      }

      let putOk = false
      for (let attempt = 1; attempt <= 4 && !putOk; attempt++) {
        try {
          const put = await fetch(target, {
            method: 'PUT',
            headers: { Authorization: auth },
            body: buf,
          })
          const head = await fetch(target, {
            method: 'HEAD',
            headers: { Authorization: auth },
          })
          const uploadedSize = Number(head.headers.get('content-length'))
          putOk = put.ok && head.ok && uploadedSize === buf.length
          console.log(
            `[dufs] root alias ${alias.name} -> HTTP ${put.status}, ${uploadedSize}/${buf.length} bytes (try ${attempt})`,
          )
        } catch (e) {
          console.log(
            `[dufs] ${alias.name} upload err (try ${attempt}): ${e.message}`,
          )
        }
        if (!putOk) await new Promise((r) => setTimeout(r, 3000 * attempt))
      }
      uploaded.set(`alias:${alias.name}`, putOk)
    } catch (err) {
      console.log(`[dufs] ${alias.name} error: ${err.message}`)
      uploaded.set(`alias:${alias.name}`, false)
    }
  }

  const putJson = await fetch(`${base}/update.json`, {
    method: 'PUT',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(dufsData, null, 2),
  })
  console.log(`[dufs] update.json -> HTTP ${putJson.status}`)
  const failedUploads = [...uploaded.values()].filter((ok) => !ok).length
  if (!putJson.ok || failedUploads > 0) {
    throw new Error(
      `dufs publish incomplete: ${failedUploads} file(s) failed, update.json HTTP ${putJson.status}`,
    )
  }
}

resolveUpdater().catch(console.error)
