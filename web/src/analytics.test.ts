import { describe, expect, test } from 'vitest'
import { analyticsBeacon } from './analytics'

describe('analyticsBeacon', () => {
  test("is Cloudflare Web Analytics' beacon with the site's token, on the website only", () => {
    expect(analyticsBeacon('abc123', true)).toEqual({
      src: 'https://static.cloudflareinsights.com/beacon.min.js',
      data: '{"token":"abc123"}',
    })
  })

  test('is off without a token, and in the local app', () => {
    expect(analyticsBeacon(undefined, true)).toBeNull()
    expect(analyticsBeacon('', true)).toBeNull()
    expect(analyticsBeacon('abc123', false)).toBeNull()
  })
})
