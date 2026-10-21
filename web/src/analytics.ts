// Counts visits to the website with Cloudflare Web Analytics (docs/deployment.md, "Traffic"): its beacon,
// loaded only when the build sets VITE_CF_ANALYTICS_TOKEN, and never in the local app.

type Beacon = { src: string; type: string; data: string }

/**
 * The beacon script to add, or null when counting is off. The app changes its own address on every look
 * change, which the beacon would count as page views, so SPA measurement is off: a page view is a load.
 */
export function analyticsBeacon(token: string | undefined, hostedSite: boolean): Beacon | null {
  if (!hostedSite || !token) return null
  return { src: 'https://static.cloudflareinsights.com/beacon.min.js', type: 'module', data: JSON.stringify({ token, spa: false }) }
}

/** Adds the beacon to the page; it reports the page view and the path the visitor landed on. */
export function startAnalytics(beacon: Beacon | null): void {
  if (!beacon || typeof document === 'undefined') return
  const s = document.createElement('script')
  s.type = beacon.type
  s.src = beacon.src
  s.dataset.cfBeacon = beacon.data
  document.head.appendChild(s)
}
