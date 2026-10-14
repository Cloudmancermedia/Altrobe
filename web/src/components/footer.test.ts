import { describe, expect, test } from 'vitest'
import { copyrightLine, footerLinks } from './footer'

const LOCAL_APP = 'Download the local app (works on Apple silicon Macs; Windows needs beta testers)'

describe('footerLinks', () => {
  test('every page links to a GitHub issue for problems and rights concerns, and to the source', () => {
    const labels = footerLinks({ installs: true, session: true, assistant: true }).map((l) => l.label)
    expect(labels).toEqual(['Report a problem or rights concern', 'Source code', 'Licenses', 'Item names: cmangos'])
    expect(footerLinks({ installs: true, session: true, assistant: true })[0].href).toBe('https://github.com/Cloudmancermedia/altrobe/issues/new')
  })

  test('the hosted site, which has no install picker, also offers the local app', () => {
    const links = footerLinks({ installs: false, session: false, assistant: false })
    expect(links.map((l) => l.label)).toEqual([LOCAL_APP, 'Report a problem or rights concern', 'Source code', 'Licenses', 'Item names: cmangos'])
    // /releases/latest skips pre-releases, and the local app is in beta.
    expect(links[0].href).toBe('https://github.com/Cloudmancermedia/altrobe/releases')
  })

  test('links the licence notices the build serves beside the app', () => {
    const notices = footerLinks({ installs: false, session: false, assistant: false }).find((l) => l.label === 'Licenses')
    expect(notices?.href).toBe('/THIRD_PARTY_NOTICES.txt')
  })

  test('the copyright line carries the current year, so it never needs a yearly edit', () => {
    expect(copyrightLine(new Date('2026-10-14T12:00:00Z'))).toBe('© 2026 Ryan Williams')
    expect(copyrightLine(new Date('2031-03-01T12:00:00Z'))).toBe('© 2026–2031 Ryan Williams')
  })
})
