import { describe, expect, test } from 'vitest'
import { stepLabel } from './events'
import { statusText } from './status'

describe('statusText', () => {
  test('says what the AI is doing now, with the seconds once a second has passed', () => {
    expect(statusText({ kind: 'checking' }, 0)).toBe("Checking you're human…")
    expect(statusText({ kind: 'thinking', step: 1 }, 0)).toBe('Thinking…')
    expect(statusText({ kind: 'thinking', step: 3 }, 4)).toBe('Thinking about the next step… 4s')
    const input = { query: 'Judgement' }
    expect(statusText({ kind: 'tool', tool: 'search_sets', input }, 2)).toBe(`${stepLabel({ type: 'step', tool: 'search_sets', arguments: input })}… 2s`)
    expect(statusText({ kind: 'idle' }, 9)).toBe('')
  })
})
