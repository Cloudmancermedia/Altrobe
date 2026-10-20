import { describe, expect, test } from 'vitest'
import { defaultTooltipMode, tooltipClass } from './tooltip'

describe('the character tooltip', () => {
  test('shows on hover where the device can hover, and is off on touch screens', () => {
    expect(defaultTooltipMode(true)).toBe('hover')
    expect(defaultTooltipMode(false)).toBe('off')
  })

  test('each mode has its own class, so CSS shows it on hover, always, or never', () => {
    expect(tooltipClass('hover')).toBe('unit-tooltip on-hover')
    expect(tooltipClass('always')).toBe('unit-tooltip pinned')
    expect(tooltipClass('off')).toBe('unit-tooltip')
  })
})
