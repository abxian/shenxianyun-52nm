import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./updater.mjs', import.meta.url), 'utf8')

test('omits unsupported Linux auto-update entries', () => {
  assert.doesNotMatch(source, /platforms\.linux/)
  assert.doesNotMatch(source, /platforms\[['"]linux-/)
  assert.doesNotMatch(source, /['"]linux(?:-[^'"]+)?['"]:\s*\{/)
})

test('keeps macOS ARM assets scoped to Darwin', () => {
  const armUrlBlock = source.match(
    /if \(name\.endsWith\('aarch64\.app\.tar\.gz'\)\) \{([\s\S]*?)\n\s*\}/,
  )
  const armSignatureBlock = source.match(
    /if \(name\.endsWith\('aarch64\.app\.tar\.gz\.sig'\)\) \{([\s\S]*?)\n\s*\}/,
  )
  assert.ok(armUrlBlock)
  assert.ok(armSignatureBlock)
  assert.match(armUrlBlock[1], /darwin-aarch64/)
  assert.match(armSignatureBlock[1], /darwin-aarch64/)
  assert.doesNotMatch(armUrlBlock[1], /linux/)
  assert.doesNotMatch(armSignatureBlock[1], /linux/)
})
