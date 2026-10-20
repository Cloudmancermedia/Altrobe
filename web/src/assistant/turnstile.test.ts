import { describe, expect, test, vi } from 'vitest'
import { createTurnstile, siteKeyFrom, TEST_SITE_KEY, type TurnstileApi } from './turnstile'

type Opts = Record<string, (arg?: string) => void> & { sitekey: string; action: string; appearance: string }

function fakeApi() {
  const rendered: Opts[] = []
  const api: TurnstileApi = {
    render: vi.fn((_el: unknown, opts: unknown) => { rendered.push(opts as Opts); return `w${rendered.length}` }),
    remove: vi.fn(),
  }
  return { api, rendered }
}

const container = {} as HTMLElement

describe('turnstile', () => {
  test('uses the configured site key, else the always-pass test key outside production builds', () => {
    expect(siteKeyFrom({ VITE_TURNSTILE_SITE_KEY: '0x4AAA', PROD: true })).toBe('0x4AAA')
    expect(siteKeyFrom({ PROD: false })).toBe(TEST_SITE_KEY)
    expect(TEST_SITE_KEY).toBe('1x00000000000000000000AA')
    expect(siteKeyFrom({ PROD: true })).toBe('')
  })

  test('loads the script only on the first token, and renders a fresh widget per token', async () => {
    const { api, rendered } = fakeApi()
    const load = vi.fn(async () => api)
    const t = createTurnstile({ siteKey: 'key', load })
    expect(load).not.toHaveBeenCalled()

    const first = t.getToken(container)
    await vi.waitFor(() => expect(rendered).toHaveLength(1))
    expect(rendered[0]).toMatchObject({ sitekey: 'key', action: 'prompt', appearance: 'interaction-only' })
    rendered[0].callback('token-1')
    expect(await first).toBe('token-1')
    expect(api.remove).toHaveBeenCalledWith('w1')

    const second = t.getToken(container)
    await vi.waitFor(() => expect(rendered).toHaveLength(2))
    rendered[1].callback('token-2')
    expect(await second).toBe('token-2')
    expect(load).toHaveBeenCalledTimes(2)
  })

  test('fails on a widget error or with no site key', async () => {
    const { api, rendered } = fakeApi()
    const t = createTurnstile({ siteKey: 'key', load: async () => api })
    const p = t.getToken(container)
    await vi.waitFor(() => expect(rendered).toHaveLength(1))
    rendered[0]['error-callback']('110200')
    await expect(p).rejects.toThrow('110200')
    expect(api.remove).toHaveBeenCalledWith('w1')
    await expect(createTurnstile({ siteKey: '', load: async () => api }).getToken(container)).rejects.toThrow('site key')
  })

  test('stops waiting when the command is stopped', async () => {
    const { api, rendered } = fakeApi()
    const controller = new AbortController()
    const p = createTurnstile({ siteKey: 'key', load: async () => api }).getToken(container, controller.signal)
    await vi.waitFor(() => expect(rendered).toHaveLength(1))
    controller.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(api.remove).toHaveBeenCalledWith('w1')
  })

  test('fails instead of waiting forever: a widget that does not render, an expired token or challenge, or no answer in time', async () => {
    const broken: TurnstileApi = { render: () => undefined, remove: vi.fn() }
    await expect(createTurnstile({ siteKey: 'key', load: async () => broken }).getToken(container)).rejects.toThrow('show')

    for (const cb of ['expired-callback', 'timeout-callback']) {
      const { api, rendered } = fakeApi()
      const p = createTurnstile({ siteKey: 'key', load: async () => api }).getToken(container)
      await vi.waitFor(() => expect(rendered).toHaveLength(1))
      rendered[0][cb]()
      await expect(p).rejects.toThrow()
      expect(api.remove).toHaveBeenCalledWith('w1')
    }

    const { api } = fakeApi()
    const slow = createTurnstile({ siteKey: 'key', load: async () => api, timeoutMs: 20 }).getToken(container)
    await expect(slow).rejects.toThrow('took too long')
    expect(api.remove).toHaveBeenCalledWith('w1')
  })
})
