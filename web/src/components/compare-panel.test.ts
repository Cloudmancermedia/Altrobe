import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { emptyLook } from '../look/look'
import { ComparePanel } from './Panels'

describe('the side-by-side panel', () => {
  test("doesn't mention an AI the website doesn't have", () => {
    const characters = { build: 'b', races: [{ race: 1, name: 'Human', femaleName: 'Human', clientFileString: 'Human', sexes: [{ sex: 0, hd: true, sd: true, chrModelId: 1, sdChrModelId: 257 }], classes: [] }] }
    const html = renderToStaticMarkup(createElement(ComparePanel, { characters: characters as never, look: emptyLook(1, 0) }))
    expect(html).toContain('Each wears the main outfit unless it has its own.')
    expect(html).not.toMatch(/Claude/)
  })
})
