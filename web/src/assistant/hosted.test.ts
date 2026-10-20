import { describe, expect, test, vi } from 'vitest'
import handler from '../../../infra/lambda/prompt/handler.ts?raw'
import { closedText, DAILY_COMMANDS, MAX_RESULT_CHARS, MAX_STEPS, quotaText, resetTimeLabel, runHostedCommand, type HostedOptions } from './hosted'
import type { ToolOutcome } from './hosted-tools'

const RESET = '2026-10-20T13:00:00Z'
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A step that asks for tool calls. */
const toolStep = (n: number, calls: { name: string; input: Record<string, unknown> }[], extra: Record<string, unknown> = {}) => {
  const toolUses = calls.map((c, i) => ({ toolUseId: `t${n}-${i}`, ...c }))
  return json(200, {
    ticket: `ticket-${n}`, stop: 'tool_use', toolUses,
    message: { role: 'assistant', content: toolUses.map((t) => ({ toolUse: t })) },
    text: '', remaining: 19, resetAt: RESET, ...extra,
  })
}
const endStep = (n: number, text: string) => json(200, {
  ticket: `ticket-${n}`, stop: 'end', toolUses: [], message: { role: 'assistant', content: [{ text }] }, text, remaining: 19, resetAt: RESET,
})

/** A fake prompt API answering each request with the next scripted response, keeping each request body. */
function fakeApi(...responses: (Response | Error)[]) {
  const bodies: Record<string, unknown>[] = []
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)))
    const next = responses.shift()
    if (!next) throw new Error('no more scripted responses')
    if (next instanceof Error) throw next
    return next
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, bodies, calls: fetch }
}

function options(api: ReturnType<typeof fakeApi>, extra: Partial<HostedOptions> = {}) {
  const tools: { name: string; input: Record<string, unknown> }[] = []
  const steps: string[] = []
  let tokens = 0
  const opts: HostedOptions = {
    fetch: api.fetch,
    getToken: async () => `turnstile-${++tokens}`,
    runTool: async (name, input): Promise<ToolOutcome> => { tools.push({ name, input }); return { status: 'success', json: { ok: name } } },
    onStep: (name) => steps.push(name),
    ...extra,
  }
  return { opts, tools, steps, tokenCount: () => tokens }
}

describe('runHostedCommand', () => {
  test('runs tool steps until the model ends, sending the token first and the ticket after', async () => {
    const api = fakeApi(
      toolStep(1, [{ name: 'search_sets', input: { query: 'Judgement' } }]),
      toolStep(2, [{ name: 'set_character', input: { race: 5, sex: 0 } }, { name: 'equip_set', input: { setId: 217 } }]),
      endStep(3, 'Put Judgement on the Undead.'),
    )
    const { opts, tools, steps, tokenCount } = options(api)
    const r = await runHostedCommand('put this Undead in Judgement', opts)

    expect(r).toEqual({ kind: 'done', text: 'Put Judgement on the Undead.', remaining: 19, resetAt: RESET })
    expect(tools.map((t) => t.name)).toEqual(['search_sets', 'set_character', 'equip_set'])
    expect(steps).toEqual(['search_sets', 'set_character', 'equip_set'])
    expect(tokenCount()).toBe(1)

    const [first, second, third] = api.bodies
    expect(first).toEqual({ messages: [{ role: 'user', content: [{ text: 'put this Undead in Judgement' }] }], turnstileToken: 'turnstile-1' })
    expect(second).toMatchObject({ ticket: 'ticket-1' })
    expect(second.turnstileToken).toBeUndefined()
    expect(third).toMatchObject({ ticket: 'ticket-2' })
    // Each later step appends the model's message unchanged and one toolResult per toolUse.
    const messages = third.messages as { role: string; content: Record<string, unknown>[] }[]
    expect(messages).toHaveLength(5)
    expect(messages[1]).toEqual({ role: 'assistant', content: [{ toolUse: { toolUseId: 't1-0', name: 'search_sets', input: { query: 'Judgement' } } }] })
    expect(messages[4]).toEqual({
      role: 'user',
      content: [
        { toolResult: { toolUseId: 't2-0', content: [{ json: { ok: 'set_character' } }], status: 'success' } },
        { toolResult: { toolUseId: 't2-1', content: [{ json: { ok: 'equip_set' } }], status: 'success' } },
      ],
    })
    expect(api.calls).toHaveBeenCalledWith('/api/prompt', expect.objectContaining({ method: 'POST' }))
  })

  test("tells each tool call which command it belongs to: the same within a command, a new one for the next", async () => {
    const seen: (number | undefined)[] = []
    const runTool = async (_n: string, _i: Record<string, unknown>, command?: number): Promise<ToolOutcome> => { seen.push(command); return { status: 'success', json: {} } }
    const two = [{ name: 'get_look', input: {} }, { name: 'get_look', input: {} }]
    const a = fakeApi(toolStep(1, two), toolStep(2, two), endStep(3, 'Done.'))
    await runHostedCommand('one', { ...options(a).opts, runTool })
    const b = fakeApi(toolStep(1, two), endStep(2, 'Done.'))
    await runHostedCommand('two', { ...options(b).opts, runTool })
    expect(new Set(seen.slice(0, 4)).size).toBe(1)
    expect(new Set(seen.slice(4)).size).toBe(1)
    expect(seen[4]).not.toBe(seen[0])
    expect(typeof seen[0]).toBe('number')
  })

  test('a text-only request sends tools: false; other commands never send it', async () => {
    const api = fakeApi(endStep(1, 'A level 60 Undead Paladin in Judgement.'))
    const r = await runHostedCommand('Polish this', { ...options(api).opts, tools: false })
    expect(r).toMatchObject({ kind: 'done', text: 'A level 60 Undead Paladin in Judgement.' })
    expect(api.bodies[0].tools).toBe(false)
    const plain = fakeApi(endStep(1, 'Done.'))
    await runHostedCommand('Put on Judgement', options(plain).opts)
    expect('tools' in plain.bodies[0]).toBe(false)
  })

  test('a name request sends creative on every step; other commands never send it', async () => {
    const api = fakeApi(toolStep(1, [{ name: 'suggest_names', input: {} }]), endStep(2, 'Done.'))
    await runHostedCommand('Suggest five names', { ...options(api).opts, creative: true })
    expect(api.bodies.map((b) => b.creative)).toEqual([true, true])
    const plain = fakeApi(endStep(1, 'Done.'))
    await runHostedCommand('Put on Judgement', options(plain).opts)
    expect('creative' in plain.bodies[0]).toBe(false)
  })

  test('reports each stage as it starts: the human check, each model step, each tool, then idle', async () => {
    const api = fakeApi(toolStep(1, [{ name: 'search_sets', input: { query: 'Judgement' } }, { name: 'equip_set', input: { setId: 217 } }]), endStep(2, 'Done.'))
    const phases: string[] = []
    await runHostedCommand('Put on Judgement', { ...options(api).opts, onPhase: (p) => phases.push(p.kind === 'tool' ? `tool:${p.tool}` : p.kind === 'thinking' ? `thinking:${p.step}` : p.kind) })
    expect(phases).toEqual(['checking', 'thinking:1', 'tool:search_sets', 'tool:equip_set', 'thinking:2', 'idle'])
  })

  test('reports idle however the command ends', async () => {
    const phases: string[] = []
    await runHostedCommand('x', { ...options(fakeApi(json(429, { error: 'ip_limit', message: 'm', resetAt: RESET }))).opts, onPhase: (p) => phases.push(p.kind) })
    expect(phases.at(-1)).toBe('idle')
  })

  test('trims a big tool result so the conversation stays under the API\'s 64 KB', async () => {
    const api = fakeApi(toolStep(1, [{ name: 'search_items', input: {} }]), endStep(2, ''))
    const items = Array.from({ length: 200 }, (_, i) => ({ itemId: 100000 + i, name: `Some Long Item Name Number ${i}`, slot: 'chest', quality: 4 }))
    const { opts } = options(api, { runTool: async () => ({ status: 'success', json: { total: 200, items } }) })
    await runHostedCommand('x', opts)
    const sent = (api.bodies[1].messages as { content: { toolResult?: { content: { json: { items: unknown[]; truncated?: boolean } }[] } }[] }[]).at(-1)!.content[0].toolResult!.content[0].json
    expect(JSON.stringify(sent).length).toBeLessThanOrEqual(MAX_RESULT_CHARS)
    expect(sent.truncated).toBe(true)
    expect(sent.items.length).toBeGreaterThan(0)
  })

  test('shows the model text of each step and reports what is left', async () => {
    const api = fakeApi(toolStep(1, [{ name: 'get_look', input: {} }], { text: 'Checking.', remaining: 4 }), endStep(2, ''))
    const texts: string[] = []
    const quota: number[] = []
    const { opts } = options(api, { onText: (t) => texts.push(t), onQuota: (q) => quota.push(q.remaining) })
    const r = await runHostedCommand('what am I wearing', opts)
    expect(texts).toEqual(['Checking.'])
    expect(quota).toEqual([4, 19])
    expect(r).toMatchObject({ kind: 'done', text: '' })
  })

  test('sends a tool failure back to the model as an error result', async () => {
    const api = fakeApi(toolStep(1, [{ name: 'equip_set', input: { setId: 1 } }]), endStep(2, 'No such set.'))
    const { opts } = options(api, { runTool: async () => ({ status: 'error', json: { error: 'no set 1' } }) })
    await runHostedCommand('x', opts)
    const messages = api.bodies[1].messages as { content: { toolResult?: unknown }[] }[]
    expect(messages[2].content[0].toolResult).toEqual({ toolUseId: 't1-0', content: [{ json: { error: 'no set 1' } }], status: 'error' })
  })

  test(`stops after ${MAX_STEPS} steps`, async () => {
    const steps = Array.from({ length: MAX_STEPS }, (_, i) => toolStep(i + 1, [{ name: 'get_look', input: {} }]))
    const api = fakeApi(...steps)
    const { opts, tools } = options(api)
    const r = await runHostedCommand('loop forever', opts)
    expect(api.calls).toHaveBeenCalledTimes(MAX_STEPS)
    expect(r).toMatchObject({ kind: 'failed', code: 'too_many_steps' })
    // The last step's tool calls still run, so the view shows what the model chose.
    expect(tools).toHaveLength(MAX_STEPS)
    // 1 user message, then a model message and a results message for each of the first seven steps.
    expect((api.bodies[MAX_STEPS - 1].messages as unknown[]).length).toBe(1 + 2 * (MAX_STEPS - 1))
  })

  test.each([
    ['ip_limit', 429],
    ['daily_cap', 429],
  ])('%s closes the box until resetAt', async (code, status) => {
    const api = fakeApi(json(status, { error: code, message: 'Limit reached.', resetAt: RESET }))
    const r = await runHostedCommand('x', options(api).opts)
    expect(r).toEqual({ kind: 'closed', code, resetAt: RESET, message: 'Limit reached.' })
  })

  test('busy asks to try again, disabled turns the box off, model failures ask to try again', async () => {
    expect(await runHostedCommand('x', options(fakeApi(json(429, { error: 'busy', message: 'Busy.' }))).opts)).toEqual({ kind: 'busy' })
    expect(await runHostedCommand('x', options(fakeApi(json(503, { error: 'disabled', message: 'Off.' }))).opts)).toEqual({ kind: 'disabled' })
    expect(await runHostedCommand('x', options(fakeApi(json(502, { error: 'model', message: 'Bedrock failed.' }))).opts))
      .toEqual({ kind: 'failed', code: 'model', message: "The model didn't answer. Try again." })
  })

  test('a 429 or 5xx with no error code, such as an API Gateway throttle, is busy', async () => {
    for (const status of [429, 500, 502, 503, 504]) {
      const api = fakeApi(new Response(JSON.stringify({ message: 'Too Many Requests' }), { status, headers: { 'content-type': 'application/json' } }))
      expect(await runHostedCommand('x', options(api).opts)).toEqual({ kind: 'busy' })
    }
    expect(await runHostedCommand('x', options(fakeApi(new Response('<html>busy</html>', { status: 503 }))).opts)).toEqual({ kind: 'busy' })
  })

  test('turnstile, bad_request and too_many_steps errors show the server message', async () => {
    for (const code of ['turnstile', 'bad_request', 'too_many_steps']) {
      const r = await runHostedCommand('x', options(fakeApi(json(400, { error: code, message: `Server says ${code}.` }))).opts)
      expect(r).toEqual({ kind: 'failed', code, message: `Server says ${code}.` })
    }
  })

  test('an error on a later step ends the command with that error', async () => {
    const api = fakeApi(toolStep(1, [{ name: 'get_look', input: {} }]), json(429, { error: 'busy', message: 'Busy.' }))
    expect(await runHostedCommand('x', options(api).opts)).toEqual({ kind: 'busy' })
  })

  test('a network failure, a page instead of JSON, or a missing token fails plainly', async () => {
    expect(await runHostedCommand('x', options(fakeApi(new TypeError('Failed to fetch'))).opts))
      .toMatchObject({ kind: 'failed', code: 'network' })
    const html = new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } })
    expect(await runHostedCommand('x', options(fakeApi(html)).opts)).toMatchObject({ kind: 'failed', code: 'network' })
    const noToken = options(fakeApi(), { getToken: async () => { throw new Error('blocked') } })
    expect(await runHostedCommand('x', noToken.opts)).toMatchObject({ kind: 'failed', code: 'turnstile' })
  })

  test('stopping aborts the request and runs no more tools', async () => {
    const controller = new AbortController()
    const api = fakeApi(toolStep(1, [{ name: 'get_look', input: {} }, { name: 'list_animations', input: {} }]))
    const { opts, tools } = options(api, {
      signal: controller.signal,
      runTool: async (name) => { tools.push({ name, input: {} }); controller.abort(); return { status: 'success', json: {} } },
    })
    expect(await runHostedCommand('x', opts)).toEqual({ kind: 'stopped' })
    expect(tools.map((t) => t.name)).toEqual(['get_look'])
  })
})

describe('resetTimeLabel', () => {
  test('gives the reset time in the reader\'s time zone', () => {
    expect(resetTimeLabel(RESET, { locale: 'en-US', timeZone: 'America/New_York' })).toBe('9:00 AM')
    expect(resetTimeLabel(RESET, { locale: 'en-GB', timeZone: 'Europe/Berlin' })).toBe('15:00')
  })

  test('falls back to 13:00 UTC wording for a bad date', () => {
    expect(resetTimeLabel('soon')).toBe('13:00 UTC')
  })
})

describe('box copy', () => {
  test('says when a closed box reopens, in local time', () => {
    const utc = { locale: 'en-US', timeZone: 'UTC' }
    expect(closedText('daily_cap', RESET, utc)).toBe('The free daily budget is used up; it reopens at 1:00 PM.')
    expect(closedText('ip_limit', RESET, utc)).toBe("You've used today's free commands. More at 1:00 PM.")
  })

  test('the header counts the commands left of the day\'s limit, and says when a closed box reopens', () => {
    const utc = { locale: 'en-US', timeZone: 'UTC' }
    expect(quotaText({ remaining: 18, resetAt: RESET }, null)).toBe('AI: 18 of 20 left today')
    expect(quotaText({ remaining: 1, resetAt: RESET }, null)).toBe('AI: 1 of 20 left today')
    expect(quotaText({ remaining: 3, resetAt: RESET }, { code: 'ip_limit', resetAt: RESET }, utc)).toBe("You've used today's free commands. More at 1:00 PM.")
    expect(quotaText(null, { code: 'daily_cap', resetAt: RESET }, utc)).toBe('The free daily budget is used up; it reopens at 1:00 PM.')
  })

  test('says nothing before the first command, when the count is unknown', () => {
    expect(quotaText(null, null)).toBe('')
  })

  test('the daily limit matches the prompt API\'s', () => {
    // The API sends only what's left, so the site keeps its own copy of the limit.
    expect(handler).toMatch(new RegExp(`const IP_LIMIT = ${DAILY_COMMANDS}\\b`))
  })
})
