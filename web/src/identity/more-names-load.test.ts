import { describe, expect, test, vi } from 'vitest'

const getNames = vi.fn()
vi.mock('../api/client', () => ({ getNames: () => getNames() }))

describe('getKnownNames', () => {
  test("tries the game's lists again after a failed load, instead of keeping the failure for the visit", async () => {
    const { getKnownNames } = await import('./more-names')
    getNames.mockRejectedValueOnce(new Error('offline'))
    await expect(getKnownNames()).rejects.toThrow('offline')
    getNames.mockResolvedValueOnce({ 2: { male: ['Grukk'], female: [], last: [] } })
    expect((await getKnownNames()).has('grukk')).toBe(true)
  })
})
