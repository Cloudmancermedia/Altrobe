import type { Features } from '../api/backend'

const REPO = 'https://github.com/Cloudmancermedia/altrobe'

/** Support for the project: the footer and the About dialog both show it on its own. */
/** The footer's note on the game build the app reads, or why there's none yet. */
export function gameDataLine(active: { product: string; build: string } | null | undefined, phase: string): string {
  if (active) return `Game data: ${active.product} ${active.build}`
  return phase === 'starting' ? 'Connecting…' : 'No install'
}

/** Under the name in the top bar: what the site is, for a first-time visitor. */
export const TAGLINE = 'WoW: Forever model viewer and character planner'

export const SUPPORT = { label: 'Buy me a coffee', href: 'https://buymeacoffee.com/cloudmancer' }

/** The maintainer's walkthrough of the site on YouTube (2026-10-23): under the tagline and in About. */
export const TUTORIAL = { label: 'Watch the tutorial', href: 'https://www.youtube.com/watch?v=Ij51rZt48V8' }

export interface AboutLink { label: string; href: string; note?: string }

/**
 * The About dialog's links. Problems and rights concerns go to a public GitHub issue, never an email address.
 * The local app isn't offered on the website until it has had more testing (decided 2026-10-16); it stays
 * in the repository, and its releases page is `${REPO}/releases` when it comes back.
 */
// `_features` decides what the local app adds once it is offered again (the website has no install picker).
export function aboutLinks(_features: Features): AboutLink[] {
  return [
    TUTORIAL,
    { label: 'Source code', href: REPO },
    { label: 'Report a problem or rights concern', href: `${REPO}/issues/new` },
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

/** The website's visit counter (web/src/analytics.ts). About shows it only when counting is on. */
export const ANALYTICS_PRIVACY = "Cloudflare Web Analytics counts visits to the site. It doesn't collect personal data."

/** What the hosted prompt box does with what you type (docs/hosted-prompt-box.md, "Privacy"). About shows it only when the box is on. */
export const PROMPT_PRIVACY = "The prompt box sends what you type to Amazon Bedrock to run the model. Altrobe doesn't store it, "
  + "and it isn't used to train models. "
  + 'To enforce the daily limit, Altrobe keeps a hashed form of your IP address for one day. '
  + "Cloudflare Turnstile checks that you're human."
