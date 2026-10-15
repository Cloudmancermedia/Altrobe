import { describe, expect, test } from 'vitest'
import html from '../index.html?raw'
import ogImage from '../public/og-image.png?inline'

// A link to altrobe.com pasted into Discord, Reddit or a chat app shows a preview built from these tags.
const meta = (attr: 'name' | 'property', key: string) => html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]+)"`))?.[1]

describe('index.html link preview', () => {
  test('has a description, and Open Graph and large-card tags', () => {
    expect(meta('name', 'description')).toBeTruthy()
    expect(meta('property', 'og:title')).toBeTruthy()
    expect(meta('property', 'og:description')).toBe(meta('name', 'description'))
    expect(meta('property', 'og:url')).toBe('https://altrobe.com/')
    expect(meta('property', 'og:type')).toBe('website')
    expect(meta('name', 'twitter:card')).toBe('summary_large_image')
  })

  test('points at a 1200x630 PNG the site serves', () => {
    const url = meta('property', 'og:image')!
    expect(url).toBe('https://altrobe.com/og-image.png')
    // public/og-image.png as a data URL. PNG IHDR: width and height are big-endian at bytes 16 and 20.
    const png = new DataView(Uint8Array.from(atob(ogImage.split(',')[1]), (c) => c.charCodeAt(0)).buffer)
    expect([png.getUint32(16), png.getUint32(20)]).toEqual([1200, 630])
    expect(meta('property', 'og:image:width')).toBe('1200')
    expect(meta('property', 'og:image:height')).toBe('630')
    expect(meta('property', 'og:image:alt')).toBeTruthy()
  })
})
