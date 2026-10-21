// CloudFront Function (JavaScript runtime 2.0) on /l/*: a share link's preview for chat apps and social sites.
// They read a link's Open Graph tags and never see the part after "#", so share links carry the look in the
// path (/l/<base64url look>). This answers with that look's tags, then sends people into the app at
// /shared/<site>#look=<look> (sharedPath below). Only ES 5.1 globals and atob, which the 2.0 runtime documents; no modules. Under 10 KB.
var SITE = 'https://altrobe.com'
// The longest look this reads, in base64url characters; longer links get the plain preview. CloudFront
// refuses URLs over 8,192 bytes. web/src/look/look.test.ts keeps the largest possible look under this.
var MAX_LOOK = 6000
var RACES = { 1: ['Human', 'Alliance'], 2: ['Orc', 'Horde'], 3: ['Dwarf', 'Alliance'], 4: ['Night Elf', 'Alliance'],
  5: ['Undead', 'Horde'], 6: ['Tauren', 'Horde'], 7: ['Gnome', 'Alliance'], 8: ['Troll', 'Horde'],
  95: ['High Order Skyborne', 'Alliance'], 96: ['Windshaper Skyborne', 'Horde'] }
var CLASSES = { 1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue', 5: 'Priest', 7: 'Shaman', 8: 'Mage', 9: 'Warlock', 11: 'Druid' }
var PLAIN = { title: 'Altrobe', description: 'Plan your WoW Forever character: dress any race in any gear or set, name it, and share the look with a link.',
  image: SITE + '/og-image.png' }

function html(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// base64url to the look. CloudFront limits a function's instructions, and its regex work separately, so
// nothing here walks the whole link in JavaScript or with a regex (both ran out on long looks, 2026-10-21).
// atob gives one character per byte, and JSON.parse takes that as it is: UTF-8 bytes never look like a
// quote or a backslash, so strings come out with their bytes as characters, and text() turns the few shown
// ones back into text.
function decode(payload) {
  return JSON.parse(atob(payload.split('-').join('+').split('_').join('/') + '==='.slice((payload.length + 3) % 4)))
}

// A decoded string's UTF-8 bytes as text; the string as it is when it isn't UTF-8. A loop, not a regex:
// CloudFront's regex budget ran out on a 24-letter accented guild (test-function, 2026-10-21). Names and
// guilds are at most 24 letters, 4 bytes each at most, so the loop stays short.
function text(s) {
  if (typeof s !== 'string') return s
  s = s.slice(0, 96)
  var pct = ''
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i)
    pct += c < 0x80 && c !== 0x25 ? s.charAt(i) : '%' + c.toString(16)
  }
  try {
    return decodeURIComponent(pct)
  } catch (e) {
    return s
  }
}

function clip(text, max) {
  text = String(text || '').trim()
  return text.length > max ? text.slice(0, max) : text
}

// The look's title and description, or null when the link isn't a look this knows.
function describe(look) {
  if (!look || typeof look !== 'object' || !RACES[look.race]) return null
  var race = RACES[look.race], id = look.identity && typeof look.identity === 'object' ? look.identity : {}
  var name = clip([text(id.firstName), text(id.lastName)].filter(Boolean).join(' '), 30)
  var level = typeof id.level === 'number' && id.level >= 1 && id.level <= 60 ? 'Level ' + Math.floor(id.level) + ' ' : ''
  var cls = CLASSES[id.classId] ? ' ' + CLASSES[id.classId] : ''
  var who = level || cls ? level + race[0] + cls : race[0] + (look.sex === 1 ? ' female' : ' male')
  var guild = clip(text(id.guild), 30)
  return {
    title: name ? name + ' · ' + who : who,
    description: (guild ? '<' + guild + '> · ' : '') + race[1] + '. Open this look in Altrobe, the WoW Forever character planner.',
    image: SITE + '/og/' + look.race + '-' + (look.sex === 1 ? 1 : 0) + '.jpg',
  }
}

function page(card, url, target) {
  var t = html(card.title), d = html(card.description)
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>' + t + '</title>'
    + '<meta name="description" content="' + d + '">'
    + '<meta property="og:type" content="website"><meta property="og:site_name" content="Altrobe">'
    + '<meta property="og:title" content="' + t + '"><meta property="og:description" content="' + d + '">'
    + '<meta property="og:url" content="' + html(url) + '"><meta property="og:image" content="' + html(card.image) + '">'
    + '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'
    + '<meta name="twitter:card" content="summary_large_image">'
    + '<meta name="referrer" content="no-referrer">'
    + '<meta http-equiv="refresh" content="0; url=' + html(target) + '">'
    + '</head><body><p><a href="' + html(target) + '">Open this look in Altrobe</a></p></body></html>'
}

// Where a shared look sends people: /shared, then the site the link was opened from (Referer, www.
// dropped), so the visit counter (web/src/analytics.ts), which drops query strings, can tell shared looks
// and their sources apart. Apps often send no Referer; those land on /shared.
function sharedPath(headers) {
  var m = headers.referer && /^https?:\/\/(?:www\.)?([a-z0-9.-]{1,64})(?:[:\/?#]|$)/i.exec(headers.referer.value)
  var host = m ? m[1].toLowerCase() : ''
  return host && host !== 'altrobe.com' ? '/shared/' + host : '/shared'
}

function handler(event) {
  // /l/<look>, by string tests: a regex over the whole link costs more the longer it is. A link whose
  // characters aren't base64url fails in atob or JSON.parse and gets the plain preview.
  var uri = event.request.uri
  var look = uri.slice(0, 3) === '/l/' ? uri.slice(3) : ''
  if (look.slice(-1) === '/') look = look.slice(0, -1)
  var card = null
  if (look.length > 0 && look.length <= MAX_LOOK) {
    try { card = describe(decode(look)) } catch (e) { card = null }
  }
  var url = card ? SITE + '/l/' + look : SITE + '/'
  var target = card ? sharedPath(event.request.headers) + '#look=' + look : '/'
  return {
    statusCode: 200,
    statusDescription: 'OK',
    headers: {
      'content-type': { value: 'text/html; charset=utf-8' },
      // The target depends on the Referer, so a kept copy would send the next visit the wrong way.
      'cache-control': { value: 'no-store' },
      'x-content-type-options': { value: 'nosniff' },
    },
    body: { encoding: 'text', data: page(card || PLAIN, url, target) },
  }
}
