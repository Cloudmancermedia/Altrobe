import { describe, expect, test } from 'vitest'
import { aboutLinks, copyrightLine, SUPPORT } from './footer'

const LOCAL_APP = 'Download the local app'

describe('aboutLinks', () => {
  test('the About dialog links to the source, a GitHub issue for problems and rights concerns, and the licences', () => {
    const links = aboutLinks({ installs: true, session: true, assistant: true })
    expect(links.map((l) => l.label)).toEqual(['Source code', 'Report a problem or rights concern', 'Licenses', 'Item names: cmangos'])
    expect(links.find((l) => l.label.startsWith('Report'))?.href).toBe('https://github.com/Cloudmancermedia/altrobe/issues/new')
    // The licence and the notices for the code the site sends to browsers (dev/licence-files.ts).
    expect(links.find((l) => l.label === 'Licenses')?.href).toBe('/THIRD_PARTY_NOTICES.txt')
  })

  test('the hosted site, which has no install picker, also offers the local app, saying where it works', () => {
    const links = aboutLinks({ installs: false, session: false, assistant: false })
    expect(links[0]).toEqual({
      label: LOCAL_APP,
      // /releases/latest skips pre-releases, and the local app is in beta.
      href: 'https://github.com/Cloudmancermedia/altrobe/releases',
      note: 'Works on Apple silicon Macs; Windows needs beta testers.',
    })
  })

  test('support is its own link, not one among the rest', () => {
    expect(SUPPORT).toEqual({ label: 'Buy me a coffee', href: 'https://buymeacoffee.com/cloudmancer' })
    expect(aboutLinks({ installs: false, session: false, assistant: false }).map((l) => l.href)).not.toContain(SUPPORT.href)
  })
})

describe('copyrightLine', () => {
  test('carries the current year, so it never needs a yearly edit', () => {
    expect(copyrightLine(new Date('2026-10-14T12:00:00Z'))).toBe('© 2026 Ryan Williams')
    expect(copyrightLine(new Date('2031-03-01T12:00:00Z'))).toBe('© 2026–2031 Ryan Williams')
  })
})
