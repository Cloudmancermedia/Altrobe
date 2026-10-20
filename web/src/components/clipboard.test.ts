import { afterEach, describe, expect, test, vi } from 'vitest'
import { copyText } from './clipboard'

afterEach(() => { vi.unstubAllGlobals() })

describe('copyText', () => {
  test('writes the text with the clipboard API', async () => {
    const written: string[] = []
    vi.stubGlobal('navigator', { clipboard: { writeText: async (t: string) => { written.push(t) } } })
    const select = vi.fn()
    expect(await copyText('Lord Asher', select)).toBe(true)
    expect(written).toEqual(['Lord Asher'])
    expect(select).not.toHaveBeenCalled()
  })

  test('without the clipboard API (an http page, an old browser), selects the box and copies it', async () => {
    const commands: string[] = []
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('document', { execCommand: (c: string) => { commands.push(c); return true } })
    const select = vi.fn()
    expect(await copyText('Lord Asher', select)).toBe(true)
    expect(select).toHaveBeenCalled()
    expect(commands).toEqual(['copy'])
  })

  test('says so when neither way copies', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => { throw new Error('denied') } } })
    vi.stubGlobal('document', { execCommand: () => false })
    expect(await copyText('x', () => {})).toBe(false)
  })
})
