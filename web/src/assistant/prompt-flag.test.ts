import { describe, expect, test } from 'vitest'
import { promptBoxOn } from './prompt-flag'

describe('whether the hosted prompt box shows', () => {
  test('never without the build flag, whatever the URL says', () => {
    expect(promptBoxOn(undefined, '')).toBe(false)
    expect(promptBoxOn(undefined, '?prompt=preview')).toBe(false)
    expect(promptBoxOn('', '?prompt=preview')).toBe(false)
    expect(promptBoxOn('yes', '?prompt=preview')).toBe(false)
  })

  test('always when the build flag is 1', () => {
    expect(promptBoxOn('1', '')).toBe(true)
    expect(promptBoxOn('1', '?look=abc')).toBe(true)
  })

  test('in a preview build, only for a URL with ?prompt=preview', () => {
    expect(promptBoxOn('preview', '')).toBe(false)
    expect(promptBoxOn('preview', '?prompt=1')).toBe(false)
    expect(promptBoxOn('preview', '?prompt=preview')).toBe(true)
    expect(promptBoxOn('preview', '?x=1&prompt=preview')).toBe(true)
  })
})
