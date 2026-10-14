import type { Features } from '../api/backend'

const REPO = 'https://github.com/Cloudmancermedia/altrobe'

/**
 * The footer's links. Problems and rights concerns go to a public GitHub issue, never an email address.
 * The hosted site (no install picker) also points to the local app's releases.
 */
export function footerLinks(features: Features): { label: string; href: string }[] {
  return [
    // The releases page, not /releases/latest, which skips pre-releases and the local app is in beta.
    ...(features.installs ? [] : [{ label: 'Download the local app (works on Apple silicon Macs; Windows needs beta testers)', href: `${REPO}/releases` }]),
    { label: 'Report a problem or rights concern', href: `${REPO}/issues/new` },
    { label: 'Source code', href: REPO },
    // The licence and the notices for the code the site sends to browsers (dev/licence-files.ts).
    { label: 'Licenses', href: '/THIRD_PARTY_NOTICES.txt' },
    // Credit for the Classic item names the game files leave out (ClassicItemNames, GPL-3.0).
    { label: 'Item names: cmangos', href: 'https://github.com/cmangos/classic-db' },
  ]
}

/** The site's copyright line, from the first year to the visitor's current one (the holder in LICENSE). */
export function copyrightLine(now = new Date()): string {
  const first = 2026
  const year = now.getFullYear()
  return `© ${year > first ? `${first}–${year}` : first} Ryan Williams`
}
