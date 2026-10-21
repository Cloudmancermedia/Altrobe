import { readFileSync, statSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

// The CloudFront Function as CloudFront runs it: a file declaring `handler`, no modules.
const path = new URL('../functions/look-preview.js', import.meta.url)
const source = readFileSync(path, 'utf8')
const handler = new Function(`${source}\nreturn handler`)() as (event: unknown) => { statusCode: number; headers: Record<string, { value: string }>; body: { encoding: string; data: string } }

const encode = (look: unknown) => Buffer.from(JSON.stringify(look), 'utf8').toString('base64url')
const event = (uri: string, referer?: string) => ({ version: '1.0', context: {}, viewer: {}, request: { method: 'GET', uri, querystring: {}, headers: referer ? { referer: { value: referer } } : {}, cookies: {} } })
const meta = (html: string, key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1]

describe('the look preview function', () => {
  const look = { v: 1, game: 'forever', race: 5, sex: 1, models: 'hd', items: { chest: 16958 }, identity: { firstName: 'Morgwyn', lastName: 'Duskveil', guild: 'Ashen Vanguard', level: 60, classId: 2 } }

  test("answers a look link with that look's preview: name, level, race and class, the race portrait, and a link into the app", () => {
    const payload = encode(look)
    const r = handler(event(`/l/${payload}`))
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type'].value).toBe('text/html; charset=utf-8')
    const html = r.body.data
    expect(meta(html, 'og:title')).toBe('Morgwyn Duskveil · Level 60 Undead Paladin')
    expect(meta(html, 'og:description')).toBe('&lt;Ashen Vanguard&gt; · Horde. Open this look in Altrobe, the WoW Forever character planner.')
    expect(meta(html, 'og:image')).toBe('https://altrobe.com/og/5-1.jpg')
    expect(meta(html, 'og:url')).toBe(`https://altrobe.com/l/${payload}`)
    expect(meta(html, 'twitter:card')).toBe('summary_large_image')
    expect(html).toContain(`url=/shared#look=${payload}`)
  })

  test('sends people on under /shared, with the site they came from in the path, so visit counts can tell shared looks and their sources apart', () => {
    const payload = encode(look)
    const target = (referer?: string) => /url=([^"]*)"/.exec(handler(event(`/l/${payload}`, referer)).body.data)?.[1]
    expect(target('https://www.reddit.com/r/wowforever/comments/abc/')).toBe(`/shared/reddit.com#look=${payload}`)
    expect(target('https://discord.com/channels/1/2')).toBe(`/shared/discord.com#look=${payload}`)
    expect(target('https://altrobe.com/')).toBe(`/shared#look=${payload}`)
    expect(target('javascript:alert(1)')).toBe(`/shared#look=${payload}`)
    expect(target('https://<b>.example/')).toBe(`/shared#look=${payload}`)
  })

  test("the refresh sends no referrer, so the app's visit counter sees an arrival from outside, and the page isn't kept, since it depends on the referrer", () => {
    const r = handler(event(`/l/${encode(look)}`, 'https://www.reddit.com/'))
    expect(r.body.data).toContain('<meta name="referrer" content="no-referrer">')
    expect(r.headers['cache-control'].value).toBe('no-store')
  })

  test('without a name, the title is the character; accents in names come through', () => {
    expect(meta(handler(event(`/l/${encode({ ...look, identity: undefined })}`)).body.data, 'og:title')).toBe('Undead female')
    expect(meta(handler(event(`/l/${encode({ ...look, identity: { firstName: 'Zoë', level: 12 } })}`)).body.data, 'og:title')).toBe('Zoë · Level 12 Undead')
  })

  test('escapes what players type, so a name or guild cannot add HTML', () => {
    const html = handler(event(`/l/${encode({ ...look, identity: { firstName: '"><script>x</script>', guild: '<b>' } })}`)).body.data
    expect(html).not.toContain('<script>x')
    expect(html).not.toContain('<b>')
  })

  test('a broken or foreign link gets the plain site preview and goes to the home page', () => {
    for (const uri of ['/l/', '/l/@@@', `/l/${Buffer.from('not json').toString('base64url')}`, '/l/' + 'A'.repeat(9000)]) {
      const html = handler(event(uri)).body.data
      expect(meta(html, 'og:image'), uri.slice(0, 20)).toBe('https://altrobe.com/og-image.png')
      expect(html, uri.slice(0, 20)).toContain('url=/"')
    }
  })

  test('fits CloudFront Functions: under 10 KB, and only globals the 2.0 runtime documents', () => {
    expect(statSync(path).size).toBeLessThan(10 * 1024)
    expect(source).not.toMatch(/\brequire\(|\bBuffer\b|\bTextDecoder\b|\bimport\b|\bexport\b/)
  })
})
