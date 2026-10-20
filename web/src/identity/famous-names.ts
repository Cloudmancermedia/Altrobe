// Famous Warcraft names: characters, clans, places and legendary items. suggest_names refuses them, since a
// player can't count on reserving them, and Altrobe's own lists leave them out (more-names.test.ts).
// Lowercase, letters only, as a name box would hold them ("Kel'Thuzad" is "kelthuzad").
export const FAMOUS_NAMES = new Set([
  // Characters
  'alexstrasza', 'alleria', 'antonidas', 'anduin', 'arthas', 'arugal', 'azshara', 'baine', 'bolvar', 'brann',
  'bronzebeard', 'cairne', 'cenarius', 'chromie', 'dagran', 'darion', 'deathwing', 'draka', 'durotan', 'elune',
  'falstad', 'fandral', 'gallywix', 'garrosh', 'gazlowe', 'gelbin', 'genn', 'greymane', 'grommash', 'guldan',
  'hamuul', 'hogger', 'illidan', 'jaina', 'kaelthas', 'kargath', 'kelthuzad', 'khadgar', 'kilrogg', 'kurdran',
  'liadrin', 'lorthemar', 'lunara', 'magni', 'maiev', 'malfurion', 'malygos', 'mankrik', 'medivh', 'mekkatorque',
  'mograine', 'moira', 'muradin', 'nathanos', 'nefarian', 'nerzhul', 'nozdormu', 'onyxia', 'orgrim', 'putress',
  'ragnaros', 'remulos', 'rexxar', 'rhonin', 'rokhan', 'samuro', 'saurfang', 'senjin', 'shandris', 'staghelm',
  'sylvanas', 'tess', 'thaurissan', 'thrall', 'tirion', 'tyrande', 'uther', 'valeera', 'vancleef', 'varian',
  'varimathras', 'vereesa', 'voljin', 'whitemane', 'xavius', 'ysera', 'zalazane', 'zekhan', 'zuljin', 'hakkar',
  'cthun', 'yogg', 'neltharion', 'sargeras', 'kiljaeden', 'archimonde', 'velen', 'akama', 'vashj', 'kael',
  // Clans and families
  'blackrock', 'bleedinghollow', 'bloodhoof', 'bonechewer', 'burningblade', 'darkspear', 'deathwhisper',
  'doomhammer', 'dragonmaw', 'frostwolf', 'runetotem', 'shadowmoon', 'sunstrider', 'thunderhorn', 'thunderlord',
  'warsong', 'wildhammer', 'windrunner', 'stormrage', 'proudmoore', 'menethil', 'wrynn', 'hellscream',
  // Places
  'azeroth', 'dalaran', 'darnassus', 'draenor', 'eversong', 'gilneas', 'ironforge', 'kalimdor', 'karazhan',
  'lordaeron', 'naxxramas', 'northrend', 'orgrimmar', 'outland', 'quelthalas', 'silvermoon', 'stormwind',
  'teldrassil', 'thunderbluff', 'undercity', 'zulgurub', 'stratholme', 'scholomance', 'shattrath',
  // Well-known private servers
  'warmane', 'nostalrius', 'kronos', 'elysium', 'twinstar', 'lightshope', 'northdale',
  // Legendary items
  'ashbringer', 'atiesh', 'frostmourne', 'gorehowl', 'shalamayne', 'sulfuras', 'thunderfury', 'doomhammer',
])
