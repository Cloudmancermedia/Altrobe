// Cloudflare Turnstile for the hosted prompt box: a token per command, so the prompt API can check
// that a person sent it. The script loads the first time the box sends, never on page load. Each
// token renders a fresh widget that shows only when Cloudflare wants an interaction, then removes it.
// https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/

/** Cloudflare's always-pass test key (visible widget), for dev and tests. */
export const TEST_SITE_KEY = '1x00000000000000000000AA'
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=altrobeTurnstileReady'
/** The action the prompt API checks the token against. */
export const ACTION = 'prompt'

export interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string | undefined
  remove(widgetId: string): void
}

/** VITE_TURNSTILE_SITE_KEY, else the test key outside production builds. A production build without one gets no token. */
export function siteKeyFrom(env: { VITE_TURNSTILE_SITE_KEY?: string; PROD?: boolean }): string {
  return env.VITE_TURNSTILE_SITE_KEY || (env.PROD ? '' : TEST_SITE_KEY)
}

let loading: Promise<TurnstileApi> | undefined

/** Adds Cloudflare's script once; a failed load is dropped so the next command tries again. */
export function loadTurnstile(): Promise<TurnstileApi> {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const w = window as unknown as { turnstile?: TurnstileApi; altrobeTurnstileReady?: () => void }
    w.altrobeTurnstileReady = () => (w.turnstile ? resolve(w.turnstile) : reject(new Error('Turnstile did not start.')))
    const script = document.createElement('script')
    script.src = SCRIPT
    script.onerror = () => { script.remove(); reject(new Error("Couldn't load Cloudflare Turnstile.")) }
    document.head.appendChild(script)
  }).catch((e) => { loading = undefined; throw e })
  return loading
}

/** How long a token may take, including a challenge the player has to click. */
export const TOKEN_TIMEOUT_MS = 90_000

export function createTurnstile({ siteKey, load = loadTurnstile, timeoutMs = TOKEN_TIMEOUT_MS }: { siteKey: string; load?: () => Promise<TurnstileApi>; timeoutMs?: number }) {
  return {
    /** A fresh token. `container` is where the widget shows if Cloudflare asks for a click. */
    async getToken(container: HTMLElement, signal?: AbortSignal): Promise<string> {
      if (!siteKey) throw new Error('No Turnstile site key is set.')
      const api = await load()
      return new Promise<string>((resolve, reject) => {
        let id: string | undefined
        // A widget that never answers (a challenge left unsolved) must not hold the box forever.
        const timer = setTimeout(() => done(() => reject(new Error('The human check took too long.'))), timeoutMs)
        const done = (fn: () => void) => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          if (id !== undefined) api.remove(id)
          id = undefined
          fn()
        }
        const onAbort = () => done(() => reject(new DOMException('Stopped', 'AbortError')))
        if (signal?.aborted) { onAbort(); return }
        signal?.addEventListener('abort', onAbort)
        id = api.render(container, {
          sitekey: siteKey,
          action: ACTION,
          appearance: 'interaction-only',
          callback: (token: string) => done(() => resolve(token)),
          'error-callback': (code: string) => done(() => reject(new Error(`Turnstile error ${code}`))),
          'expired-callback': () => done(() => reject(new Error('The human check expired.'))),
          'timeout-callback': () => done(() => reject(new Error('The human check timed out.'))),
        })
        if (id === undefined) done(() => reject(new Error("Turnstile didn't show.")))
      })
    },
  }
}
