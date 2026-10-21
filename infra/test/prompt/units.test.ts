import { describe, expect, test } from 'vitest'
import { dayOf, isoSeconds } from '../../lambda/prompt/day.js'
import { rateKey, viewerIp } from '../../lambda/prompt/ip.js'
import { digest, readTicket, signTicket } from '../../lambda/prompt/tickets.js'
import { costMicroUsd, shapeReply } from '../../lambda/prompt/model.js'
import { SYSTEM, TOOLS, TOOL_NAMES } from '../../lambda/prompt/instructions.js'

describe('the day', () => {
  test('runs from 13:00 UTC to 13:00 UTC the next day', () => {
    const before = dayOf(new Date('2026-10-20T12:59:59.999Z'))
    expect(before.id).toBe('2026-10-19')
    expect(isoSeconds(before.resetAt)).toBe('2026-10-20T13:00:00Z')
    const at = dayOf(new Date('2026-10-20T13:00:00.000Z'))
    expect(at.id).toBe('2026-10-20')
    expect(isoSeconds(at.resetAt)).toBe('2026-10-21T13:00:00Z')
  })

  test('crosses month and year ends', () => {
    expect(dayOf(new Date('2027-01-01T05:00:00Z')).id).toBe('2026-12-31')
    expect(isoSeconds(dayOf(new Date('2026-12-31T20:00:00Z')).resetAt)).toBe('2027-01-01T13:00:00Z')
    expect(isoSeconds(dayOf(new Date('2028-02-28T14:00:00Z')).resetAt)).toBe('2028-02-29T13:00:00Z')
  })
})

describe('the viewer address', () => {
  test('reads IPv4 and IPv6 from CloudFront-Viewer-Address (ip:port)', () => {
    expect(viewerIp({ 'cloudfront-viewer-address': '198.51.100.10:46532' }, '10.0.0.1')).toBe('198.51.100.10')
    expect(viewerIp({ 'cloudfront-viewer-address': '2001:db8:3333:4444:5555:6666:7777:8888:46532' })).toBe('2001:db8:3333:4444:5555:6666:7777:8888')
    expect(viewerIp({ 'cloudfront-viewer-address': '2001:db8::1:443' })).toBe('2001:db8::1')
    expect(viewerIp({ 'cloudfront-viewer-address': '[2001:db8::1]:443' })).toBe('2001:db8::1')
  })

  test('falls back to the source IP when the header is missing or malformed, and gives up on neither', () => {
    expect(viewerIp({}, '203.0.113.9')).toBe('203.0.113.9')
    expect(viewerIp({ 'cloudfront-viewer-address': 'nonsense' }, '203.0.113.9')).toBe('203.0.113.9')
    expect(viewerIp({ 'cloudfront-viewer-address': '198.51.100.10' }, '203.0.113.9')).toBe('203.0.113.9')
    expect(viewerIp({}, 'nope')).toBeUndefined()
    expect(viewerIp({})).toBeUndefined()
  })

  test('limits IPv4 by address and IPv6 by its /64, since one host can hold a whole /64', () => {
    expect(rateKey('198.51.100.10')).toBe('198.51.100.10')
    expect(rateKey('2001:db8:3333:4444:5555:6666:7777:8888')).toBe('2001:db8:3333:4444::/64')
    expect(rateKey('2001:DB8:3333:4444::1')).toBe('2001:db8:3333:4444::/64')
    expect(rateKey('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(rateKey('::ffff:198.51.100.10')).toBe('198.51.100.10')
  })
})

describe('the ticket', () => {
  const key = Buffer.alloc(32, 7)
  const claims = { commandId: 'c1', step: 2, exp: 1000, remaining: 19, digest: 'd1' }

  test('round-trips for the same IP before it expires', () => {
    const t = signTicket(key, claims, 'ipA')
    expect(readTicket(key, t, 'ipA', 999)).toEqual(claims)
    expect(readTicket(key, t, 'ipA', 1000)).toEqual(claims)
  })

  test('is refused when expired, from another IP, under another key, or altered', () => {
    const t = signTicket(key, claims, 'ipA')
    expect(readTicket(key, t, 'ipA', 1001)).toBeNull()
    expect(readTicket(key, t, 'ipB', 999)).toBeNull()
    expect(readTicket(Buffer.alloc(32, 8), t, 'ipA', 999)).toBeNull()
    const [, mac] = t.split('.')
    const forged = Buffer.from(JSON.stringify({ ...claims, step: 1 })).toString('base64url')
    expect(readTicket(key, `${forged}.${mac}`, 'ipA', 999)).toBeNull()
    for (const junk of ['', 'a', 'a.b', '..', `${forged}.`, 'x'.repeat(5000)]) expect(readTicket(key, junk, 'ipA', 999)).toBeNull()
  })

  test("the digest ignores key order but not content", () => {
    expect(digest([{ role: 'user', content: [{ text: 'a' }] }])).toBe(digest([{ content: [{ text: 'a' }], role: 'user' }]))
    expect(digest([{ role: 'user', content: [{ text: 'a' }] }])).not.toBe(digest([{ role: 'user', content: [{ text: 'b' }] }]))
  })
})

describe('the model step', () => {
  test("costs Nova 2 Lite's price: $0.33 per 1M input tokens and $2.75 per 1M output tokens, in micro-dollars", () => {
    expect(costMicroUsd({ inputTokens: 1_000_000, outputTokens: 0 })).toBe(330_000)
    expect(costMicroUsd({ inputTokens: 0, outputTokens: 1_000_000 })).toBe(2_750_000)
    expect(costMicroUsd({ inputTokens: 3000, outputTokens: 100 })).toBe(Math.ceil(990 + 275))
    expect(costMicroUsd(undefined)).toBe(0)
  })

  test('returns tool calls in order and at most 200 characters of text', () => {
    const r = shapeReply({
      role: 'assistant',
      content: [
        { text: 'x'.repeat(150) },
        { toolUse: { toolUseId: 't1', name: 'search_sets', input: { query: 'Judgement' } } },
        { text: 'y'.repeat(150) },
        { toolUse: { toolUseId: 't2', name: 'get_look', input: {} } },
      ],
    }, 'tool_use')
    expect(r.stop).toBe('tool_use')
    expect(r.text).toHaveLength(200)
    expect(r.toolUses.map((t) => t.toolUseId)).toEqual(['t1', 't2'])
    expect(r.message).toEqual({ role: 'assistant', content: [{ text: r.text }, { toolUse: r.toolUses[0] }, { toolUse: r.toolUses[1] }] })
  })

  test('ends with no tool calls when the model stops for any other reason', () => {
    const r = shapeReply({ role: 'assistant', content: [{ text: '  Put Judgement on the Undead. ' }, { toolUse: { toolUseId: 't', name: 'get_look', input: {} } }] }, 'max_tokens')
    expect(r).toEqual({ stop: 'end', toolUses: [], text: 'Put Judgement on the Undead.', message: { role: 'assistant', content: [{ text: 'Put Judgement on the Undead.' }] } })
    expect(shapeReply({ role: 'assistant', content: [] }, 'end_turn').text).toBe('')
  })
})

describe('the instructions', () => {
  test('keep the tier labels, the off-topic line and every tool in the contract', () => {
    expect(SYSTEM).toContain('Warrior: T0 Battlegear of Valor, T0.5 Battlegear of Heroism, T1 Battlegear of Might, T2 Battlegear of Wrath')
    expect(SYSTEM).toContain('If the request is not about dressing, naming or showing a WoW character, do not call any tool')
    expect(TOOL_NAMES).toEqual(['start', 'search_items', 'search_sets', 'equip_set', 'equip_item', 'unequip', 'list_characters', 'set_character', 'get_look', 'compare', 'build_outfit', 'list_animations', 'set_animation',
      'list_customization', 'set_customization', 'randomize_customization', 'reset_customization', 'set_identity', 'set_view', 'suggest_names'])
    expect(SYSTEM).toContain('When the user asks for name ideas or options, call suggest_names')
    expect(SYSTEM).toContain("When a name request doesn't say the race and sex, call get_look first")
    expect(SYSTEM).toContain('When asked to polish a character description, call no tool')
    expect(TOOLS.every((t) => t.toolSpec?.inputSchema?.json)).toBe(true)
  })

  test('prefer items new in Forever for open requests, and offer the filter', () => {
    expect(SYSTEM).toContain('For an open request ("gear for a level 20 warrior"), prefer them')
    const search = TOOLS.find((t) => t.toolSpec?.name === 'search_items')!.toolSpec!.inputSchema!.json as { properties: Record<string, unknown> }
    expect(search.properties.new_in_forever).toEqual({ type: 'boolean', description: expect.any(String) })
  })

  test('offer only tools the website runs (web/src/assistant/hosted-tools.ts)', async () => {
    const { readFileSync } = await import('node:fs')
    const web = readFileSync(new URL('../../../web/src/assistant/hosted-tools.ts', import.meta.url), 'utf8')
    for (const name of TOOL_NAMES) expect(web, name).toMatch(new RegExp(`\\b${name}(\\(|:)`))
  })
})

describe('the time budget', () => {
  test('one Bedrock attempt, Turnstile and the store calls fit inside the Lambda timeout', async () => {
    const { BEDROCK_CLIENT, TURNSTILE_TIMEOUT_MS } = await import('../../lambda/prompt/model.js')
    const { LAMBDA_TIMEOUT_SECONDS } = await import('../../src/prompt-api.js')
    expect(BEDROCK_CLIENT.maxAttempts).toBe(1)
    // 5 seconds left over for SSM, Secrets Manager (cached after a cold start) and DynamoDB.
    expect(BEDROCK_CLIENT.requestHandler.requestTimeout + TURNSTILE_TIMEOUT_MS + 5_000).toBeLessThanOrEqual(LAMBDA_TIMEOUT_SECONDS * 1000)
  })
})

describe('the tier sets', () => {
  test('match the local app list (NotableSets.Tiers in C#), class by class and tier by tier', async () => {
    const { readFileSync } = await import('node:fs')
    const { TIERS } = await import('../../lambda/prompt/instructions.js')
    const cs = readFileSync(new URL('../../../importer/src/Altrobe.Core/Catalog/NotableSets.cs', import.meta.url), 'utf8')
    const local = [...cs.matchAll(/new\(\d+, "([^"]+)", \[([^\]]+)\]\)/g)].map(([, c, list]) => [c, [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1])])
    expect(local).toHaveLength(9)
    expect(TIERS).toEqual(local)
  })
})
