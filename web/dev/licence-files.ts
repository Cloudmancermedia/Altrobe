// Copies the repository's LICENSE and THIRD_PARTY_NOTICES.md into every web build as plain text, so
// the site serves the notices for the code it sends to browsers (React, three.js, the wow.export
// ports). The footer links them. Runs at build time only; nothing here ships in the app's code.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

export function licenceFiles(): Plugin {
  return {
    name: 'altrobe-licence-files',
    apply: 'build',
    generateBundle() {
      for (const [from, fileName] of [['LICENSE', 'LICENSE.txt'], ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.txt']])
        this.emitFile({ type: 'asset', fileName, source: readFileSync(`${repoRoot}${from}`, 'utf8') })
    },
  }
}
