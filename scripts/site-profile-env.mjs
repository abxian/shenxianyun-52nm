import fs from 'node:fs'

import { readSiteProfile } from './site-profile.mjs'

const destination = process.env.GITHUB_ENV
if (!destination) throw new Error('GITHUB_ENV is required')

const profile = readSiteProfile(process.cwd())
fs.appendFileSync(
  destination,
  [
    `ARTIFACT_BASENAME=${profile.desktopArtifactBasename}`,
    `PRODUCT_NAME=${profile.desktopProductName}`,
    '',
  ].join('\n'),
)
