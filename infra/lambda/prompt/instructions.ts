// The prompt box's instructions and tool list. The website runs the tools
// (docs/hosted-prompt-box.md#tools); these were benchmarked against Nova 2 Lite on Bedrock. The tier
// list repeats the local app's (NotableSets.Tiers in C#); a test keeps the two equal.
import type { Tool } from '@aws-sdk/client-bedrock-runtime'

export const SLOTS = ['head', 'neck', 'shoulder', 'shirt', 'chest', 'waist', 'legs', 'feet', 'wrist', 'hands', 'back', 'mainhand', 'offhand', 'ranged', 'tabard']

// Sets carry no tier or class, so the model needs the names to find "tier 2 priest".
export const TIERS: [string, string[]][] = [
  ['Warrior', ['Battlegear of Valor', 'Battlegear of Heroism', 'Battlegear of Might', 'Battlegear of Wrath', "Conqueror's Battlegear", "Dreadnaught's Battlegear"]],
  ['Paladin', ['Lightforge Armor', 'Soulforge Armor', 'Lawbringer Armor', 'Judgement Armor', "Avenger's Battlegear", 'Redemption Armor']],
  ['Hunter', ['Beaststalker Armor', 'Beastmaster Armor', 'Giantstalker Armor', 'Dragonstalker Armor', "Striker's Garb", 'Cryptstalker Armor']],
  ['Rogue', ['Shadowcraft Armor', 'Darkmantle Armor', 'Nightslayer Armor', 'Bloodfang Armor', "Deathdealer's Embrace", 'Bonescythe Armor']],
  ['Priest', ['Vestments of the Devout', 'Vestments of the Virtuous', 'Vestments of Prophecy', 'Vestments of Transcendence', 'Garments of the Oracle', 'Vestments of Faith']],
  ['Shaman', ['The Elements', 'The Five Thunders', 'The Earthfury', 'The Ten Storms', "Stormcaller's Garb", 'The Earthshatterer']],
  ['Mage', ["Magister's Regalia", "Sorcerer's Regalia", 'Arcanist Regalia', 'Netherwind Regalia', 'Enigma Vestments', 'Frostfire Regalia']],
  ['Warlock', ['Dreadmist Raiment', 'Deathmist Raiment', 'Felheart Raiment', 'Nemesis Raiment', "Doomcaller's Attire", 'Plagueheart Raiment']],
  ['Druid', ['Wildheart Raiment', 'Feralheart Raiment', 'Cenarion Raiment', 'Stormrage Raiment', 'Genesis Raiment', 'Dreamwalker Raiment']],
]
const TIER_LABELS = ['T0', 'T0.5', 'T1', 'T2', 'T2.5', 'T3']

// The local app's instructions (McpTools.Instructions), minus the lines about an open tab and leveling
// tools the hosted box doesn't have, plus the prompt box line.
export const SYSTEM = `Altrobe is a 3D dressing room for World of Warcraft: Forever in the user's browser. Use these tools to dress, gear, transmog or customize a WoW character, try items or outfits, or compare how a look shows on different races.

- Always find items with search_items, then equip them by the returned itemId. Never guess item IDs.
- For a whole set (a tier set, the High Warlord's gear), use search_sets and equip_set. Never guess set IDs. equip_set takes off the set worn before unless you pass replace false.
- Sets carry no tier or class, so for "tier 2 priest" search_sets by the set name below. Tiers in order: 0, 0.5, 1, 2, 2.5 (Ahn'Qiraj), 3 (Naxxramas).
${TIERS.map(([c, s]) => `  ${c}: ${s.map((n, i) => `${TIER_LABELS[i]} ${n}`).join(', ')}`).join('\n')}
- set_animation makes every character play an animation; list_animations lists them.
- Races by ID: 1 Human, 2 Orc, 3 Dwarf, 4 Night Elf, 5 Undead, 6 Tauren, 7 Gnome, 8 Troll, 95 High Order Skyborne, 96 Windshaper Skyborne. Sex: 0 male, 1 female. list_characters gives each race's classes and faction.
- Every command starts with start. Set new_look true when the request asks for a character, an outfit or a lineup without referring to what is shown ("an orc warrior in level 30 greens", "compare an undead and an orc warlock"): the screen is then cleared to one character in no gear, and you build the whole look. Set it false when the request changes or adds to what is shown ("add a tauren too", "give them both the green iron helmet", "now put them in tier 2", "make it female", "take off the helm"), and for a question or anything that isn't a look.
- Change only what the user asks for. Don't change the race, the gear or anything else they didn't mention.
- When the user wants another race or sex, call set_character first: it resets customization, and each race and sex has its own options. Then list and set the customization.
- A two-hander in the main hand clears the off hand.
- The screen shows the main character and up to 5 more side by side. compare replaces everyone beside the main character; pass add true to keep them and add the new ones ("add a Gnome", "a Troll too").
- When the user names the races to show ("an Undead next to an Orc", "on an Orc and a Tauren", "show a Gnome"), those are the whole lineup: call set_character with the first one named, unless the main character already is that race and sex, then compare with the rest, or with an empty list when only one is named. Keep the characters on screen only when the user refers to them ("this", "them", "my character", "add", "too"). To dress the characters already shown ("put them both in Judgement"), call get_look to see who they are, then dress the main character only: the others wear its outfit, so don't call compare.
- Characters in compare wear the main outfit unless you give one its own items. Switching race keeps the outfit. To show one look on several races, dress the main character once and add the other races with compare. To show different sets side by side, dress the main character in the first and give each other character in compare its own setId. Call set_character once at most.
- For a character at a level below 60 ("a level 20 warrior"), use build_outfit with that level and the class; it picks the armor the class wears at that level. Tier sets are level 60 gear.
- The catalog holds each item's name, slot, quality, required level and armor type, and search_items filters on them.
- Items Forever added are marked newInForever. For an open request ("gear for a level 20 warrior"), prefer them over older items that fit as well; build_outfit already does. Pass new_in_forever to search_items only when the user asks for new Forever items.
- Customization (skin, face, hair, tusks, the Skyborne features and so on): set_customization takes the option and choice by the user's words ("Foremane", "Shaggy"); when they don't match, it lists the names to use. Colors have no names: call list_customization with the option ("hair color") and pass set_customization the optionId and choiceId of the closest hex color. randomize_customization and reset_customization change every option.
- set_identity sets who the character is, shown over its head: firstName and lastName (every Forever character has two names), title by its wording ("High Warlord", "the Harbinger of Darkness"), guild, level, class and pvp. An empty string clears a part. Names are letters only, 2 to 12 of them, with only the first letter a capital.
- When the user asks for name ideas or options, call suggest_names once with 8 complete first and last name pairs in the race's style, and in the user's style when they give one; the first 5 that pass are shown. Make up new names: names already in the game's or Altrobe's name lists come back rejected, and so do famous Warcraft names, names that break the rules, and a name used twice. Common short fantasy names are in the lists, so build less obvious first names of 5 to 10 letters, and make each last name two words joined into one. No two names share an ending, and none copies a name from the request. If fewer than 5 are showing, send replacements, at most twice more, then stop. It doesn't change the character. When a name request doesn't say the race and sex, call get_look first and suggest names for the character it describes, with its class if it has one; don't ask the user. When the user asks you to name the character, call set_identity directly instead.
- set_view turns the camera: front, side, back or head.
- When asked to polish a character description, call no tool: reply with the polished text only, one or two sentences, using only what the description says.
- If the request is not about dressing, naming or showing a WoW character, do not call any tool; reply that you can only help with characters.

You are the prompt box inside Altrobe. Act with the tools, then reply in one short sentence saying what changed.`

type Schema = { type: 'object'; properties: Record<string, unknown>; required: string[] }
const S = (properties: Record<string, unknown>, required: string[] = []): Schema => ({ type: 'object', properties, required })
const slot = { type: 'string', description: `One of: ${SLOTS.join(', ')}` }
const armor = { type: 'string', description: 'cloth, leather, mail or plate' }

const SPECS: [string, string, Schema][] = [
  ['start', 'Call first, before any other tool, once per command: whether the request asks for a new look. true clears the screen to one character in no gear; false keeps what is shown. Answers with what is on screen afterwards.', S({ new_look: { type: 'boolean' } }, ['new_look'])],
  ['search_items', 'Search the item catalog by name or item ID, and filter by slot, quality, required level, armor type, weapon type, hands and whether Forever added the item. Use the returned itemId with equip_item; never guess IDs.', S({ query: { type: 'string' }, slot, quality: { type: 'integer' }, min_level: { type: 'integer' }, max_level: { type: 'integer' }, armor, weapon: { type: 'string' }, hands: { type: 'string' }, new_in_forever: { type: 'boolean', description: 'True keeps only items Forever added' }, limit: { type: 'integer' } })],
  ['search_sets', 'Search item sets (tier sets, PvP sets, dungeon sets) by set name, piece name or set ID. Equip one with equip_set.', S({ query: { type: 'string' }, limit: { type: 'integer' } })],
  ['equip_set', 'Put every piece of an item set on the main character. Replaces the set worn before by default.', S({ setId: { type: 'integer' }, replace: { type: 'boolean' } }, ['setId'])],
  ['equip_item', 'Put an item in a slot. Find the itemId with search_items first.', S({ slot, itemId: { type: 'integer' } }, ['slot', 'itemId'])],
  ['unequip', 'Clear a slot.', S({ slot: { type: 'string' } }, ['slot'])],
  ['list_characters', 'The playable races with their IDs, faction, sexes and classes.', S({})],
  ['set_character', "Change the main character's race and sex. Keeps the outfit; resets customization. Race IDs come from list_characters.", S({ race: { type: 'integer' }, sex: { type: 'integer', description: '0 male, 1 female' } }, ['race', 'sex'])],
  ['get_look', 'The current look: character, equipped items with names, and side-by-side characters.', S({})],
  ['compare', 'Show up to 5 more characters side by side. Each wears the main outfit unless given its own setId (a whole set from search_sets) or items (slot to item ID, worn over the set). A label shows above it. Replaces the characters beside the main one unless add is true. Pass an empty list to show only the main character.', S({ add: { type: 'boolean', description: 'True keeps the characters already beside the main one and adds these after them' }, characters: { type: 'array', items: S({ race: { type: 'integer' }, sex: { type: 'integer' }, label: { type: 'string' }, setId: { type: 'integer' }, items: { type: 'object' } }, ['race', 'sex']) } }, ['characters'])],
  ['build_outfit', 'Gear for one level from the catalog: in each armor slot, the item with the highest required level within 7 levels below the target, then one Forever added, then the highest item level. Pass the class whenever the user names one: the tool picks the armor that class wears at that level (cloth for a priest, mail for a level 30 warrior, plate from 40). Equips it on the main character and returns the items. Pass weapon types to fill the main hand.', S({ level: { type: 'integer' }, class: { type: 'string', description: 'Warrior, Paladin, Hunter, Shaman, Rogue, Druid, Priest, Mage or Warlock' }, armor, weapons: { type: 'array', items: { type: 'string' } } }, ['level'])],
  ['list_animations', 'The animations a character can play.', S({})],
  ['set_animation', 'Make every character play an animation, by name from list_animations.', S({ name: { type: 'string' } }, ['name'])],
  ['list_customization', "The main character's customization options, for its current race and sex only: call set_character first for another race. With option (part of a name, such as hair), that option's choices.", S({ option: { type: 'string' } })],
  ['set_customization', "Pick a customization choice on the main character: by option and choice name, or by optionId and choiceId from list_customization.", S({ option: { type: 'string' }, choice: { type: 'string' }, optionId: { type: 'integer' }, choiceId: { type: 'integer' } })],
  ['randomize_customization', 'Pick a random choice for every customization option.', S({})],
  ['reset_customization', 'Set every customization option back to its default.', S({})],
  ['set_identity', "Set the character's names, title, guild, level, class and PvP flag, shown over its head. Leave out parts to keep them; an empty string clears one.", S({
    firstName: { type: 'string' }, lastName: { type: 'string' }, title: { type: 'string', description: 'The title by its wording, such as High Warlord' },
    guild: { type: 'string' }, level: { type: 'integer' }, class: { type: 'string', description: 'Class name, such as Warrior' }, pvp: { type: 'boolean' },
  })],
  ['set_view', 'Turn the camera.', S({ view: { type: 'string', description: 'front, side, back or head' } }, ['view'])],
  ['suggest_names', 'Show name ideas to the user, who picks one: send up to 8 new first and last name pairs, and the first 5 that pass are shown. Answers with how many were shown and the pairs rejected, and why: a broken rule, a name the name lists already hold, a famous Warcraft name, or a name already in the batch.', S({ names: { type: 'array', items: S({ firstName: { type: 'string' }, lastName: { type: 'string' } }, ['firstName', 'lastName']) } }, ['names'])],
]

export const TOOL_NAMES = SPECS.map(([name]) => name)

export const TOOLS: Tool[] = SPECS.map(([name, description, schema]) => ({ toolSpec: { name, description, inputSchema: { json: schema } } }) as Tool)
