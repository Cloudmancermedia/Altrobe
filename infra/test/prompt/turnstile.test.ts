import { describe, expect, test } from 'vitest'
import { verifyTurnstile } from '../../lambda/prompt/turnstile.js'

const answer = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 })
const args = { secret: 's', token: 't', ip: '203.0.113.7', hostnames: ['altrobe.com', 'www.altrobe.com'], action: 'prompt' }

describe('the Turnstile check', () => {
  test('passes a token issued on our hostname for our action', async () => {
    expect(await verifyTurnstile(answer({ success: true, hostname: 'altrobe.com', action: 'prompt' }), args)).toBe(true)
  })

  test('refuses another hostname, another action, or a failed check', async () => {
    expect(await verifyTurnstile(answer({ success: true, hostname: 'evil.example', action: 'prompt' }), args)).toBe(false)
    expect(await verifyTurnstile(answer({ success: true, hostname: 'altrobe.com', action: 'login' }), args)).toBe(false)
    expect(await verifyTurnstile(answer({ success: false, hostname: 'altrobe.com', action: 'prompt' }), args)).toBe(false)
  })

  test("passes Cloudflare's testing keys, which only a test secret accepts", async () => {
    // With the always-pass test secret, siteverify answers hostname example.com, no action, and marks the
    // result; production secrets reject the dummy tokens (developers.cloudflare.com/turnstile/troubleshooting/testing/).
    expect(await verifyTurnstile(answer({ success: true, hostname: 'example.com', metadata: { result_with_testing_key: true } }), args)).toBe(true)
    expect(await verifyTurnstile(answer({ success: false, hostname: 'example.com', metadata: { result_with_testing_key: true } }), args)).toBe(false)
  })
})
