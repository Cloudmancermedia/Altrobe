// Counts visits to the website with Cloudflare Web Analytics (docs/deployment.md, "Traffic"): its beacon,
// loaded only when the build sets VITE_CF_ANALYTICS_TOKEN, and never in the local app.

/** The beacon script to add, or null when counting is off. */
export function analyticsBeacon(token: string | undefined, hostedSite: boolean): { src: string; data: string } | null {
  if (!hostedSite || !token) return null
  return { src: 'https://static.cloudflareinsights.com/beacon.min.js', data: JSON.stringify({ token }) }
}

/** Adds the beacon to the page; it reports each page view, including the app's own route changes. */
export function startAnalytics(beacon: { src: string; data: string } | null): void {
  if (!beacon || typeof document === 'undefined') return
  const s = document.createElement('script')
  s.defer = true
  s.src = beacon.src
  s.dataset.cfBeacon = beacon.data
  document.head.appendChild(s)
}
