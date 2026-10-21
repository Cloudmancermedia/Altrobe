import { describe, expect, test } from 'vitest'
import { ANALYTICS_PRIVACY, aboutLinks, copyrightLine, PROMPT_PRIVACY, SUPPORT, TAGLINE } from './footer'

const LOCAL_APP = 'Download the local app'

describe('aboutLinks', () => {
  test('the About dialog links to the source, a GitHub issue for problems and rights concerns, and the licences', () => {
    const links = aboutLinks({ installs: true, session: true, assistant: true })
    expect(links.map((l) => l.label)).toEqual(['Source code', 'Report a problem or rights concern', 'Licenses', 'Item names: cmangos'])
    expect(links.find((l) => l.label.startsWith('Report'))?.href).toBe('https://github.com/Cloudmancermedia/altrobe/issues/new')
    // The licence and the notices for the code the site sends to browsers (dev/licence-files.ts).
    expect(links.find((l) => l.label === 'Licenses')?.href).toBe('/THIRD_PARTY_NOTICES.txt')
  })

  test('the website does not offer the local app until it is released', () => {
    // Held back for more testing (decided 2026-10-16); the app stays in the repository.
    const links = aboutLinks({ installs: false, session: false, assistant: false })
    expect(links.map((l) => l.label)).not.toContain(LOCAL_APP)
    expect(links.map((l) => l.href).join()).not.toContain('/releases')
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

describe('PROMPT_PRIVACY', () => {
  test('names what the hosted prompt box sends, keeps and checks', () => {
    expect(PROMPT_PRIVACY).toContain('Amazon Bedrock')
    expect(PROMPT_PRIVACY).toContain("doesn't store it")
    // Amazon Bedrock FAQ (aws.amazon.com/bedrock/faqs/, read 2026-10-19).
    expect(PROMPT_PRIVACY).toContain("isn't used to train models")
    expect(PROMPT_PRIVACY).toContain('hashed form of your IP address for one day')
    expect(PROMPT_PRIVACY).toContain('Cloudflare Turnstile')
    expect(PROMPT_PRIVACY).not.toMatch(/[\u2014\u2018\u2019\u201c\u201d]/)
  })
})

describe('TAGLINE', () => {
  test('says under the name what the site is, for the game it is for', () => {
    expect(TAGLINE).toBe('WoW: Forever model viewer and character planner')
  })
})

describe('ANALYTICS_PRIVACY', () => {
  test('names the visit counter and what Cloudflare says it collects', () => {
    expect(ANALYTICS_PRIVACY).toContain('Cloudflare Web Analytics')
    // "Cloudflare Web Analytics does not collect or use your visitors' personal data"
    // (developers.cloudflare.com/web-analytics/about/, read 2026-10-21).
    expect(ANALYTICS_PRIVACY).toContain("doesn't collect personal data")
    expect(ANALYTICS_PRIVACY).not.toMatch(/[\u2014\u2018\u2019\u201c\u201d]/)
  })
})
