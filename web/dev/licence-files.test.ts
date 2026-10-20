import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'
import { licenceFiles, repoRoot } from './licence-files.ts'

describe('licence files', () => {
  test('the build emits the licence and the third-party notices as text files', () => {
    const emitted: { fileName: string; source: string }[] = []
    const plugin = licenceFiles()
    ;(plugin.generateBundle as (this: unknown) => void).call({ emitFile: (f: { fileName: string; source: string }) => emitted.push(f) })
    expect(emitted.map((f) => f.fileName).sort()).toEqual(['LICENSE.txt', 'THIRD_PARTY_NOTICES.txt'])
    expect(emitted.find((f) => f.fileName === 'LICENSE.txt')!.source).toMatch(/^MIT License/)
    expect(emitted.find((f) => f.fileName === 'THIRD_PARTY_NOTICES.txt')!.source).toContain('## On altrobe.com')
  })

  test('the notices name every source file whose header says it is ported from wow.export', () => {
    const notices = readFileSync(join(repoRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8')
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : /\.(ts|cs)$/.test(e.name) && !/\.test\.ts$|Tests?\.cs$/.test(e.name) ? [join(dir, e.name)] : [])
    const ported = [join(repoRoot, 'web/src'), join(repoRoot, 'importer/src')].flatMap(walk)
      .filter((f) => /wow\.export/i.test(readFileSync(f, 'utf8').split('\n').slice(0, 15).join('\n')))
    expect(ported.length).toBeGreaterThan(0)
    // Named by file, or by its folder when the notice covers a whole folder.
    const missing = ported.map((f) => relative(repoRoot, f)).filter((f) => {
      const name = f.split('/').pop()!
      const folder = f.slice(0, f.lastIndexOf('/') + 1)
      return !notices.includes(`\`${name}\``) && !notices.includes(`\`${folder}\``)
    })
    expect(missing).toEqual([])
  })
})
