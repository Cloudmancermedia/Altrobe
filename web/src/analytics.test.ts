import { describe, expect, test } from 'vitest'
import { analyticsBeacon } from './analytics'

describe('analyticsBeacon', () => {
  test("is Cloudflare Web Analytics' beacon with the site's token, on the website only", () => {
    // As Cloudflare's snippet loads it; "spa": false, since the app's own address changes are each look
    // change, not a page (developers.cloudflare.com/web-analytics/get-started/web-analytics-spa/).
    expect(analyticsBeacon('abc123', true)).toEqual({
      src: 'https://static.cloudflareinsights.com/beacon.min.js',
      type: 'module',
      data: '{"token":"abc123","spa":false}',
    })
  })

  test('is off without a token, and in the local app', () => {
    expect(analyticsBeacon(undefined, true)).toBeNull()
    expect(analyticsBeacon('', true)).toBeNull()
    expect(analyticsBeacon('abc123', false)).toBeNull()
  })
})
