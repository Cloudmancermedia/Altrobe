import { readFileSync, statSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'

// The CloudFront Function as CloudFront runs it: a file declaring `handler`, no modules.
const path = new URL('../functions/look-preview.js', import.meta.url)
const source = readFileSync(path, 'utf8')
const handler = new Function(`${source}\nreturn handler`)() as (event: unknown) => { statusCode: number; headers: Record<string, { value: string }>; body: { encoding: string; data: string } }

const encode = (look: unknown) => Buffer.from(JSON.stringify(look), 'utf8').toString('base64url')
// A link as the app makes it now (web/src/look/look.ts encodeLook): "2.", the card, then the rest compressed.
const encode2 = ({ race, sex, form, identity, ...rest }: Record<string, unknown>) =>
  `2.${encode(JSON.parse(JSON.stringify({ race, sex, form, identity })))}.${deflateRawSync(JSON.stringify(rest)).toString('base64url')}`
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

  test('a druid form is named by its form, not the sex it has no say in', () => {
    const cat = { ...look, race: 4, form: 'cat', identity: undefined }
    expect(meta(handler(event(`/l/${encode(cat)}`)).body.data, 'og:title')).toBe('Night Elf Cat Form')
    expect(meta(handler(event(`/l/${encode({ ...cat, form: 'moonkin', identity: { level: 60, classId: 11 } })}`)).body.data, 'og:title')).toBe('Level 60 Night Elf Moonkin Form')
    expect(meta(handler(event(`/l/${encode({ ...cat, form: 'flight' })}`)).body.data, 'og:title')).toBe('Night Elf female')
  })

  test('previews a look with four characters side by side without per-byte work in JavaScript', () => {
    // CloudFront stopped the old decode, which percent-encoded every byte in a loop, with "RangeError:
    // Instruction limit exceeded" from two side-by-side characters on (aws cloudfront test-function,
    // 2026-10-21; one character already used 92% of the compute limit). Node has no such limit, so this
    // counts the per-byte calls instead.
    const side = (race: number, label: string) => ({ race, sex: 0, models: 'hd', label, items: { head: 16955, chest: 16958, legs: 16954, hands: 16956, feet: 16957, waist: 16952, wrist: 16951, shoulder: 16953, mainhand: 17182 } })
    const four = { ...look, compare: [side(2, 'Orc Mage?'), side(6, 'Tauren Druid?'), side(95, 'Skyborne Hunter?')] }
    const payload = encode(four)
    expect(payload.length).toBeGreaterThan(1000)
    const charCodeAt = String.prototype.charCodeAt
    let calls = 0
    String.prototype.charCodeAt = function (this: string, i = 0) { calls++; return charCodeAt.call(this, i) }
    try {
      const r = handler(event(`/l/${payload}`))
      expect(r.statusCode).toBe(200)
      expect(meta(r.body.data, 'og:title')).toBe('Morgwyn Duskveil · Level 60 Undead Paladin')
      expect(r.body.data).toContain(`url=/shared#look=${payload}`)
    } finally {
      String.prototype.charCodeAt = charCodeAt
    }
    // Only the shown name and guild, letter by letter; the old decode made 784 calls on this link.
    expect(calls).toBeLessThan(100)
  })

  test("previews the largest look the format allows: six characters, every slot, accented labels", () => {
    // CloudFront stopped this one too, after the first fix, with "Regex execute instruction limit exceeded"
    // (test-function, 2026-10-21): a regex over the whole link costs more the longer the link.
    const items = Object.fromEntries(['head', 'neck', 'shoulder', 'shirt', 'chest', 'waist', 'legs', 'feet', 'wrist', 'hands', 'back', 'mainhand', 'offhand', 'ranged', 'tabard'].map((s, i) => [s, 240000 + i * 137]))
    const custom = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(30000 + i), 400000 + i]))
    const char = (race: number) => ({ race, sex: 1, models: 'hd', label: 'Ü'.repeat(40), items, hide: ['head', 'back', 'tabard'], custom })
    const big = { ...look, items, custom, hide: ['head'], anim: 'AttackTwoHand', identity: { firstName: 'Zoë', lastName: 'Ünderhill', guild: 'Ñ'.repeat(24), titleId: 1284, level: 60, classId: 2, pvp: true },
      compare: [2, 6, 95, 1, 4].map(char) }
    const payload = encode(big)
    expect(payload.length).toBeGreaterThan(4500)
    const charCodeAt = String.prototype.charCodeAt
    let calls = 0
    String.prototype.charCodeAt = function (this: string, i = 0) { calls++; return charCodeAt.call(this, i) }
    let r
    try { r = handler(event(`/l/${payload}`)) } finally { String.prototype.charCodeAt = charCodeAt }
    expect(meta(r.body.data, 'og:title')).toBe('Zoë Ünderhill · Level 60 Undead Paladin')
    expect(meta(r.body.data, 'og:description')).toContain(`&lt;${'Ñ'.repeat(24)}&gt;`)
    // Only the shown name and guild are decoded byte by byte, not the labels.
    expect(calls).toBeLessThan(100)
  })

  test('decodes UTF-8 names and a % in a label', () => {
    const r = handler(event(`/l/${encode({ ...look, identity: { firstName: 'Zoë', guild: '100% Ñoño' }, compare: [{ race: 2, sex: 0, label: '50% orc' }] })}`))
    expect(meta(r.body.data, 'og:title')).toBe('Zoë · Undead female')
    expect(meta(r.body.data, 'og:description')).toContain('&lt;100% Ñoño&gt;')
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

  test('a look too long for a preview card still opens: the plain preview, and the look passed on unread', () => {
    // Reading a look costs CloudFront compute that grows with its length: a 5,996-character look used 100%
    // (test-function, 2026-10-23). Past MAX_LOOK the card is the plain one, but the link must still open.
    const max = Number(/var MAX_LOOK = (\d+)/.exec(source)?.[1])
    const long = { ...look, compare: Array.from({ length: 5 }, (_, i) => ({ race: 2, sex: 0, label: 'x'.repeat(40), items: Object.fromEntries(Array.from({ length: 15 }, (_, j) => [`s${j}`, 100000 + i * 100 + j])) })) }
    // Base64 makes 4 characters of every 3 bytes, so this lands just past MAX_LOOK.
    const payload = encode({ ...long, pad: 'p'.repeat(Math.ceil((max - encode(long).length) * 3 / 4) + 30) })
    expect(payload.length).toBeGreaterThan(max)
    expect(payload.length).toBeLessThan(max + 100)
    const html = handler(event(`/l/${payload}`, 'https://www.reddit.com/')).body.data
    expect(meta(html, 'og:image')).toBe('https://altrobe.com/og-image.png')
    expect(html).toContain(`url=/shared/reddit.com#look=${payload}"`)
  })

  test('a compressed link previews from its card alone, and passes the whole link on', () => {
    const payload = encode2(look)
    const html = handler(event(`/l/${payload}`, 'https://discord.com/channels/1/2')).body.data
    expect(meta(html, 'og:title')).toBe('Morgwyn Duskveil · Level 60 Undead Paladin')
    expect(meta(html, 'og:image')).toBe('https://altrobe.com/og/5-1.jpg')
    expect(meta(html, 'og:url')).toBe(`https://altrobe.com/l/${payload}`)
    expect(html).toContain(`url=/shared/discord.com#look=${payload}"`)
    expect(meta(handler(event(`/l/${encode2({ ...look, race: 4, form: 'cat', identity: undefined })}`)).body.data, 'og:title')).toBe('Night Elf Cat Form')
  })

  test('a compressed link with characters outside base64url, or the wrong number of parts, gets the plain preview', () => {
    const [, card, body] = encode2(look).split('.')
    for (const bad of [`2.${card}.${body}"><b>`, `2.${card}`, `2.${card}.${body}.${body}`, `2..${body}`]) {
      const html = handler(event(`/l/${bad}`)).body.data
      expect(meta(html, 'og:image'), bad).toBe('https://altrobe.com/og-image.png')
      expect(html, bad).toContain('url=/"')
      expect(html, bad).not.toContain('<b>')
    }
  })

  test('fits CloudFront Functions: under 10 KB, and only globals the 2.0 runtime documents', () => {
    expect(statSync(path).size).toBeLessThan(10 * 1024)
    expect(source).not.toMatch(/\brequire\(|\bBuffer\b|\bTextDecoder\b|\bimport\b|\bexport\b/)
  })
})
