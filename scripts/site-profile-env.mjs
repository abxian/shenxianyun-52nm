import fs from 'node:fs'

import { readSiteProfile } from './site-profile.mjs'

const destination = process.env.GITHUB_ENV
if (!destination) throw new Error('GITHUB_ENV is required')

const profile = readSiteProfile(process.cwd())
const values = [
  `ARTIFACT_BASENAME=${profile.desktopArtifactBasename}`,
  `PRODUCT_NAME=${profile.desktopProductName}`,
  '',
].join('\n')
fs.appendFileSync(destination, values)

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    [
      `artifact_basename=${profile.desktopArtifactBasename}`,
      `product_name=${profile.desktopProductName}`,
      '',
    ].join('\n'),
  )
}
