// 校验所有版本号载体是否一致。
//
// 存在的理由：v2.5.41 / v2.5.42 / v2.5.43 三次发版都漏改了 Cargo.lock 的根包
// 版本（一直停在 2.5.40），而发版记录里却写着「版本号已同步」。CI 里 cargo 没
// 用 --locked，所以锁文件不一致不会让流水线变红，只会在下次构建时被静默改写、
// 冒出与本次改动无关的 diff。这个脚本把「漏改」变成一个会失败的显式门禁。
//
// 用法：node scripts/check-version-sync.mjs
// 退出码 0 = 全部一致；1 = 有不一致或读取失败。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

// 每个载体给出「怎么取出版本号」的最小提取器，取不到就报错而不是静默跳过。
const carriers = [
  {
    file: 'package.json',
    extract: (text) => JSON.parse(text).version,
  },
  {
    file: 'src-tauri/tauri.conf.json',
    extract: (text) => JSON.parse(text).version,
  },
  {
    file: 'src-tauri/Cargo.toml',
    // 只取 [package] 段里的第一个 version，避免命中依赖项的 version。
    extract: (text) =>
      text.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1],
  },
  {
    file: 'Cargo.lock',
    // 锁文件里同名字段极多，必须锚定 clash-verge 这个根包。
    extract: (text) =>
      text.match(
        /\[\[package\]\]\nname = "clash-verge"\nversion = "([^"]+)"/,
      )?.[1],
  },
]

const found = []
const problems = []

for (const { file, extract } of carriers) {
  let version
  try {
    version = extract(read(file))
  } catch (err) {
    problems.push(`${file}: 读取或解析失败 —— ${err.message}`)
    continue
  }
  if (!version) {
    problems.push(
      `${file}: 没能提取到版本号（文件结构可能变了，请更新本脚本的提取器）`,
    )
    continue
  }
  found.push({ file, version })
}

if (problems.length === 0) {
  const versions = new Set(found.map((f) => f.version))
  if (versions.size > 1) {
    problems.push(
      `版本号不一致：${found.map((f) => `${f.file}=${f.version}`).join('，')}`,
    )
  }
}

// ---------------------------------------------------------------------------
// 第二项：系统服务（TUN 模式的前提）的 IPC 版本一致性。
//
// 存在的理由：prebuild 过去从 clash-verge-service-ipc 的 releases/latest 下载
// 服务二进制，而客户端链接的是 Cargo 里钉死的那个版本。上游一发新版，安装包里
// 的服务就比客户端新——服务能装上、IPC 也连得上，但客户端的
// is_reinstall_service_needed() 靠版本字符串相等判断，于是恒为「协议不匹配」，
// TUN 模式永远不可用，"修复服务" 还会重装出同一个不匹配的版本。
// 这里把这条隐形约束变成显式门禁。
const serviceCarriers = []
const serviceProblems = []

try {
  const toml = read('src-tauri/Cargo.toml')
  const start = toml.indexOf('clash_verge_service_ipc')
  const open = start < 0 ? -1 : toml.indexOf('{', start)
  let spec = null
  if (open >= 0) {
    let depth = 0
    for (let i = open; i < toml.length; i++) {
      if (toml[i] === '{') depth += 1
      else if (toml[i] === '}') {
        depth -= 1
        if (depth === 0) {
          spec = toml.slice(open, i + 1)
          break
        }
      }
    }
  }
  const declared = spec?.match(/version\s*=\s*"([^"]+)"/)?.[1]
  if (!declared) {
    serviceProblems.push(
      'src-tauri/Cargo.toml: 没能提取到 clash_verge_service_ipc 的版本号',
    )
  } else {
    serviceCarriers.push({ file: 'src-tauri/Cargo.toml', version: declared })
  }
} catch (err) {
  serviceProblems.push(`src-tauri/Cargo.toml: 读取失败 —— ${err.message}`)
}

try {
  const locked = read('Cargo.lock').match(
    /name = "clash_verge_service_ipc"\s*\r?\nversion = "([^"]+)"/,
  )?.[1]
  if (!locked) {
    serviceProblems.push(
      'Cargo.lock: 没能提取到 clash_verge_service_ipc 的解析版本',
    )
  } else {
    serviceCarriers.push({ file: 'Cargo.lock', version: locked })
  }
} catch (err) {
  serviceProblems.push(`Cargo.lock: 读取失败 —— ${err.message}`)
}

// 版本戳只有跑过 prebuild 才有；没有就不检查，有就必须对得上。
for (const stamp of [
  'src-tauri/resources/.service-version',
  'src-tauri/sidecar/.service-version',
]) {
  let raw
  try {
    raw = read(stamp)
  } catch {
    continue
  }
  try {
    const stamped = JSON.parse(raw)?.version
    if (!stamped) throw new Error('版本戳缺少 version 字段')
    serviceCarriers.push({ file: stamp, version: stamped.replace(/^v/, '') })
  } catch (err) {
    serviceProblems.push(`${stamp}: 版本戳无法解析 —— ${err.message}`)
  }
}

if (serviceProblems.length === 0) {
  const serviceVersions = new Set(serviceCarriers.map((c) => c.version))
  if (serviceVersions.size > 1) {
    serviceProblems.push(
      `系统服务 IPC 版本不一致：${serviceCarriers
        .map((c) => `${c.file}=${c.version}`)
        .join('，')}`,
    )
  }
}

problems.push(...serviceProblems)

if (problems.length > 0) {
  console.error('✗ 版本号一致性校验未通过：')
  for (const p of problems) console.error(`  - ${p}`)
  console.error(
    '\n发版时应用版本这四处必须一起改；Cargo.lock 改根包 clash-verge 的 version 即可。',
  )
  if (serviceProblems.length > 0) {
    console.error(
      '系统服务的版本由 src-tauri/Cargo.toml 的 clash_verge_service_ipc 决定，' +
        'prebuild 按它下载对应 tag 的服务二进制；两边不一致会导致 TUN 模式永久不可用。',
    )
  }
  process.exitCode = 1
} else {
  console.log(
    `✓ 版本号一致：${found[0].version}（${found.map((f) => f.file).join('、')}）`,
  )
  console.log(
    `✓ 系统服务 IPC 版本一致：${serviceCarriers[0].version}（${serviceCarriers
      .map((c) => c.file)
      .join('、')}）`,
  )
}
