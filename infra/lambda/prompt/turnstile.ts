import { TURNSTILE_TIMEOUT_MS } from './model.js'

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

/**
 * Cloudflare's server-side check of a Turnstile token
 * (https://developers.cloudflare.com/turnstile/get-started/server-side-validation/). A token works
 * once, for 300 seconds, and must have been issued on our hostname for our action.
 */
export async function verifyTurnstile(fetch: Fetch, args: { secret: string; token: string; ip: string; hostnames: string[]; action: string }): Promise<boolean> {
  try {
    const res = await fetch(SITEVERIFY, {
      method: 'POST',
      body: new URLSearchParams({ secret: args.secret, response: args.token, remoteip: args.ip }),
      signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
    })
    if (!res.ok) return false
    const r = await res.json() as { success?: boolean; hostname?: string; action?: string; metadata?: { result_with_testing_key?: boolean } }
    if (r.success !== true) return false
    // Cloudflare's testing keys answer for example.com with no action. Only the always-pass test secret
    // accepts their dummy tokens, so this lets a test deployment through and never a production one.
    if (r.metadata?.result_with_testing_key === true) return true
    return args.hostnames.includes(r.hostname ?? '') && r.action === args.action
  } catch {
    return false
  }
}
