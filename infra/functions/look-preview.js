// CloudFront Function (JavaScript runtime 2.0) on /l/*: a share link's preview for chat apps and social sites.
// They read a link's Open Graph tags and never see the part after "#", so share links carry the look in the
// path (/l/<base64url look>). This answers with that look's tags, then sends people into the app at
// /#look=<look>. Only ES 5.1 globals and atob, which the 2.0 runtime documents; no modules. Under 10 KB.
var SITE = 'https://altrobe.com'
var RACES = { 1: ['Human', 'Alliance'], 2: ['Orc', 'Horde'], 3: ['Dwarf', 'Alliance'], 4: ['Night Elf', 'Alliance'],
  5: ['Undead', 'Horde'], 6: ['Tauren', 'Horde'], 7: ['Gnome', 'Alliance'], 8: ['Troll', 'Horde'],
  95: ['High Order Skyborne', 'Alliance'], 96: ['Windshaper Skyborne', 'Horde'] }
var CLASSES = { 1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue', 5: 'Priest', 7: 'Shaman', 8: 'Mage', 9: 'Warlock', 11: 'Druid' }
var PLAIN = { title: 'Altrobe', description: 'Plan your WoW Forever character: dress any race in any gear or set, name it, and share the look with a link.',
  image: SITE + '/og-image.png' }

function html(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// base64url to a string: atob gives one character per byte, decodeURIComponent turns the UTF-8 bytes into text.
function decode(payload) {
  var bin = atob(payload.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((payload.length + 3) % 4))
  var pct = ''
  for (var i = 0; i < bin.length; i++) pct += '%' + ('0' + bin.charCodeAt(i).toString(16)).slice(-2)
  return JSON.parse(decodeURIComponent(pct))
}

function clip(text, max) {
  text = String(text || '').trim()
  return text.length > max ? text.slice(0, max) : text
}

// The look's title and description, or null when the link isn't a look this knows.
function describe(look) {
  if (!look || typeof look !== 'object' || !RACES[look.race]) return null
  var race = RACES[look.race], id = look.identity && typeof look.identity === 'object' ? look.identity : {}
  var name = clip([id.firstName, id.lastName].filter(Boolean).join(' '), 30)
  var level = typeof id.level === 'number' && id.level >= 1 && id.level <= 60 ? 'Level ' + Math.floor(id.level) + ' ' : ''
  var cls = CLASSES[id.classId] ? ' ' + CLASSES[id.classId] : ''
  var who = level || cls ? level + race[0] + cls : race[0] + (look.sex === 1 ? ' female' : ' male')
  var guild = clip(id.guild, 30)
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
    + '<meta http-equiv="refresh" content="0; url=' + html(target) + '">'
    + '</head><body><p><a href="' + html(target) + '">Open this look in Altrobe</a></p></body></html>'
}

function handler(event) {
  var m = /^\/l\/([A-Za-z0-9_-]{1,6000})\/?$/.exec(event.request.uri)
  var card = null
  if (m) {
    try { card = describe(decode(m[1])) } catch (e) { card = null }
  }
  var url = card ? SITE + '/l/' + m[1] : SITE + '/'
  var target = card ? '/#look=' + m[1] : '/'
  return {
    statusCode: 200,
    statusDescription: 'OK',
    headers: {
      'content-type': { value: 'text/html; charset=utf-8' },
      'cache-control': { value: 'public, max-age=86400' },
      'x-content-type-options': { value: 'nosniff' },
    },
    body: { encoding: 'text', data: page(card || PLAIN, url, target) },
  }
}
