// The hosted prompt box's tools, run in the browser (docs/hosted-prompt-box.md, "Tools"). The prompt
// API names the tools and the model picks them; this file runs them against the static bundle and the
// command API, with the same rules as the local app's MCP tools (importer/src/Altrobe.Server/McpTools.cs).
import { searchItemsIn, searchSetsIn, type BundleItem, type BundleSet } from '../api/search'
import { replacedSetSlots, type Commands } from '../commands'
import { runRemoteCommand } from '../session'
import type { TitleInfo } from '../api/types'
import type { AppState, Store } from '../store'
import { ARMOR_TYPES, armorFor, buildOutfit, CLASS_NAMES } from './outfit'
import { batchProblems, pairProblems } from '../identity/name-rules'
import { FAMOUS_NAMES } from '../identity/famous-names'

export interface ToolDeps {
  cmd: Commands
  store: Store<AppState>
  /** The bundle's catalog.json and sets.json, with every field the filters need. */
  catalog: () => Promise<BundleItem[]>
  sets: () => Promise<BundleSet[]>
  /** Item IDs of every set piece (set-pieces.json), for equip_set's replace. */
  setPieces: () => Promise<number[]>
  /** Waits for the view to draw a change before answering (waitForDrawn in the app). */
  settle?: () => Promise<unknown>
  /** Every title (titles.json), for set_identity's title by wording. */
  titles?: () => Promise<TitleInfo[]>
  /** Every name in the game's and Altrobe's name lists, lowercased: suggest_names refuses them. */
  knownNames?: () => Promise<Set<string>>
}

/** One tool's answer, ready to go back to the model as a toolResult. */
export interface ToolOutcome {
  status: 'success' | 'error'
  json: Record<string, unknown>
}

// ItemCatalog.WeaponTypes and HandsByInventoryType values.
const WEAPONS = ['axe', 'bow', 'crossbow', 'dagger', 'fishing pole', 'fist weapon', 'gun', 'mace', 'misc', 'polearm', 'staff', 'sword', 'thrown', 'wand']
const HANDS = ['one-hand', 'two-hand', 'main hand', 'off hand', 'shield', 'held in off hand', 'ranged', 'thrown']

class ToolError extends Error {}

type Input = Record<string, unknown>

// A comma-separated list (or an array) checked against the allowed values, lowercased (McpTools.List).
function list(value: unknown, allowed: string[], what: string): string[] | undefined {
  const values = (Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(',') : [])
    .map((v) => v.trim().toLowerCase()).filter(Boolean)
  if (!values.length) return undefined
  const bad = values.find((v) => !allowed.includes(v))
  if (bad !== undefined) throw new ToolError(`Unknown ${what} "${bad}". Use one of: ${allowed.join(', ')}.`)
  return values
}

// Models send numbers as numbers, but a string such as "217" is read too.
function int(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : undefined
}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi)

const VIEWS = ['front', 'side', 'back', 'head']
// "High Warlord %s" -> "high warlord"; the model names a title by its words, without the name.
const titleText = (t: string) => t.replace('%s', '').replace(/\s+/g, ' ').trim()
const titleWords = (t: string) => titleText(t).toLowerCase()

const summary = (i: BundleItem) => ({
  itemId: i.itemId, name: i.name, slot: i.slot, quality: i.unnamed ? null : i.quality,
  requiredLevel: i.requiredLevel ?? null, itemLevel: i.itemLevel ?? null, armor: i.armor ?? null, weapon: i.weapon ?? null, hands: i.hands ?? null,
  internal: i.internal ?? false, unnamed: i.unnamed ?? false, newInForever: i.newInForever ?? false,
})

/** Returns the function that runs one tool call. It never throws: failures come back as status "error". */
export function createHostedTools(deps: ToolDeps): (name: string, input: Input, command?: number) => Promise<ToolOutcome> {
  const { cmd, store } = deps

  // A look command through the same dispatch as the local app's MCP channel.
  async function command(name: string, args: Input): Promise<Record<string, unknown>> {
    const r = await runRemoteCommand(cmd, store, name, args, deps.settle)
    if (!r.ok) throw new ToolError(r.error ?? `${name} failed`)
    return r.result as Record<string, unknown>
  }

  // The command whose name suggestions are showing.
  let ideasFor: number | undefined
  // Calls per tool in the running command. Nova ignores "do this once" in the instructions, so the
  // tools hold it to it (benchmarked 2026-10-19).
  let callsFor: number | undefined
  let calls: Record<string, number> = {}
  // Set IDs search_sets returned in the running command: Nova guesses set IDs from the tier list
  // otherwise (benchmarked 2026-10-20).
  let foundSets = new Set<number>()
  // Slots equip_item filled in the running command: build_outfit leaves them, so a named item survives it.
  let namedSlots = new Set<string>()
  // The command of the tool call running now (runHostedCommand numbers them).
  let current: number | undefined
  const forCommand = () => {
    if (current !== callsFor) { callsFor = current; calls = {}; foundSets = new Set(); namedSlots = new Set() }
  }
  const callCount = (name: string) => {
    forCommand()
    return (calls[name] = (calls[name] ?? 0) + 1)
  }
  const checkFound = (setId: unknown) => {
    forCommand()
    if (!foundSets.has(int(setId) ?? NaN)) throw new ToolError(`Set ${setId} is not one search_sets returned. Find the set with search_sets first; never guess set IDs.`)
  }
  // "Orc male", for the notes about who stands beside the main character.
  const named = (cs: { race: number; sex: number }[]) =>
    cs.map((c) => `${store.get().characters?.races.find((r) => r.race === c.race)?.name ?? `race ${c.race}`} ${c.sex === 1 ? 'female' : 'male'}`)

  const tools: Record<string, (a: Input) => Promise<Record<string, unknown>>> = {
    // The API makes every command that may change the look begin here. A new look starts from one character
    // in no gear, so the last command's side-by-side characters and outfit don't linger (2026-10-21); the
    // race, customization and name stay, for the model to change if asked.
    async start(a) {
      const fresh = a.new_look === true
      if (fresh) {
        // clear_all isn't on the remote command channel; it takes off the gear, the animation and the
        // side-by-side characters.
        deps.cmd.clear_all()
        await deps.settle?.()
      }
      return { new_look: fresh, look: await command('get_look', {}) }
    },
    async search_items(a) {
      const armor = list(a.armor, ARMOR_TYPES, 'armor type')
      const weapons = list(a.weapon, WEAPONS, 'weapon type')
      const hands = list(a.hands, HANDS, 'hands')
      const quality = int(a.quality)
      const q = typeof a.query === 'string' ? a.query : a.query === undefined || a.query === null ? undefined : String(a.query)
      const limit = clamp(int(a.limit) ?? 20, 1, 50)
      const catalog = await deps.catalog()
      const filters = {
        slots: typeof a.slot === 'string' && a.slot ? [a.slot.toLowerCase()] : undefined,
        qualities: quality === undefined ? undefined : [quality],
        minLevel: int(a.min_level), maxLevel: int(a.max_level), armor, weapons, hands,
        newInForever: a.new_in_forever === true || a.new_in_forever === 'true',
      }
      const search = (loose: boolean, filtered: boolean) => searchItemsIn(catalog, { q, limit, includeInternal: false, loose, ...(filtered ? filters : {}) })
      const page = search(false, true)
      if (page.total || !q?.trim()) return { total: page.total, items: page.items.map(summary) }
      // The user's wording ("green iron helmet" for Green Iron Helm) or a wrong filter (leather for a mail
      // helm) hid an item they named (2026-10-21), so each gets a second try, saying what was relaxed.
      const tries: [boolean, boolean, string][] = [
        [true, true, 'Nothing matched the exact name, so these are close names with those filters.'],
        [false, false, 'Nothing matched the name with those filters, so these match the name alone.'],
        [true, false, 'Nothing matched the exact name or those filters, so these are close names without the filters.'],
      ]
      for (const [loose, filtered, note] of tries) {
        const r = search(loose, filtered)
        if (r.total) return { total: r.total, items: r.items.map(summary), note: `${note} Use one only if it is the item the user named.` }
      }
      return { total: 0, items: [] }
    },

    async search_sets(a) {
      const page = searchSetsIn(await deps.sets(), {
        q: a.query === undefined || a.query === null ? undefined : String(a.query),
        limit: clamp(int(a.limit) ?? 10, 1, 20),
        includeInternal: false,
      })
      forCommand()
      for (const s of page.sets) foundSets.add(s.setId)
      return {
        total: page.total,
        sets: page.sets.map((s) => ({
          setId: s.setId, name: s.name, internal: s.internal, ...(s.unnamed ? { unnamed: true } : {}),
          pieces: s.pieces.map((p) => ({ slot: p.slot, itemId: p.item.itemId, name: p.item.name })),
        })),
      }
    },

    async equip_set(a) {
      checkFound(a.setId)
      const setId = int(a.setId)
      const set = (await deps.sets()).find((s) => s.setId === setId)
      if (!set || !set.pieces.length) throw new ToolError(`Set ${a.setId} is not in the catalog, or has no piece that can be shown. Use search_sets to find a set ID.`)
      const items = set.pieces.map((p) => ({ slot: p.slot, itemId: p.item.itemId }))
      // By default, take off pieces of the set worn before in slots this set does not fill (McpTools.EquipSet).
      const clear = a.replace === false ? [] : replacedSetSlots(store.get().look.items, items, new Set(await deps.setPieces()))
      const look = await command('equip_items', { items, clear })
      const catalog = await deps.catalog()
      const skipped = set.skipped.map((s) => ({ itemId: s.itemId, name: catalog.find((i) => i.itemId === s.itemId)?.name ?? null, reason: s.reason }))
      return { set: set.name, skipped, look }
    },

    async build_outfit(a) {
      const level = int(a.level)
      if (level === undefined || level < 1 || level > 60) throw new ToolError('level must be 1 to 60.')
      // A class decides the armor, whatever armor the model passed: it put leather on warlocks (2026-10-21).
      let armor = typeof a.armor === 'string' && a.armor.trim() ? a.armor.trim().toLowerCase() : undefined
      const className = typeof a.class === 'string' && a.class.trim() ? a.class : undefined
      if (className) {
        armor = armorFor(className, level)
        if (!armor) throw new ToolError(`Unknown class "${a.class}". Use one of: ${CLASS_NAMES.join(', ')}.`)
      }
      if (armor && !ARMOR_TYPES.includes(armor)) throw new ToolError(`Unknown armor type "${a.armor}". Use cloth, leather, mail or plate.`)
      const weapons = list(a.weapons, WEAPONS, 'weapon type')
      const outfit = buildOutfit(await deps.catalog(), { level, armor, weapons, className })
      // forCommand runs in callCount, so namedSlots belongs to this command.
      callCount('build_outfit')
      // A ranged weapon takes off both hands and a hand weapon the ranged one, so either would undo a named weapon.
      const keeps = (slot: string) => namedSlots.has(slot)
        || (slot === 'ranged' && (namedSlots.has('mainhand') || namedSlots.has('offhand')))
        || ((slot === 'mainhand' || slot === 'offhand') && namedSlots.has('ranged'))
      const kept = Object.keys(outfit.items).filter(keeps)
      const picked = Object.entries(outfit.items).filter(([slot]) => !keeps(slot))
      const items = Object.fromEntries(picked.map(([slot, i]) => [slot, {
        itemId: i.itemId, name: i.name, requiredLevel: i.requiredLevel ?? null, quality: i.quality, armor: i.armor ?? null, weapon: i.weapon ?? null, hands: i.hands ?? null,
        newInForever: i.newInForever ?? false,
      }]))
      // Equip it on the main character, as the hosted tool list says; an empty outfit changes nothing.
      const look = picked.length ? await command('equip_items', { items: picked.map(([slot, i]) => ({ slot, itemId: i.itemId })) }) : undefined
      return { level, armor: armor ?? null, items, missing: outfit.missing, ...(kept.length ? { kept } : {}), ...(look ? { look } : {}) }
    },

    async list_characters() {
      const races = store.get().characters?.races ?? []
      return {
        result: races.map((r) => ({
          race: r.race, name: r.name, faction: r.faction ?? null,
          sexes: r.sexes.map((s) => ({ sex: s.sex === 0 ? '0 (male)' : '1 (female)', hd: s.hd, sd: s.sd })),
          classes: r.classes.map((c) => c.name),
        })),
      }
    },

    // The identity comes with it, title and class in words (commands describe_identity).
    get_look: () => command('get_look', {}),

    // Without an option, the option names; with one ("hair"), that option's choices, colors as their hex
    // swatch so "red hair" can be picked. Every choice of every option at once would be too long.
    async list_customization(a) {
      const q = typeof a.option === 'string' ? a.option.trim().toLowerCase() : ''
      const { options, look, characters } = store.get()
      // Each race and sex has its own options; naming whose they are shows the model a list for the wrong race.
      const character = `${characters?.races.find((r) => r.race === look.race)?.name ?? `race ${look.race}`} ${look.sex === 1 ? 'female' : 'male'}`
      if (!q) return { character, options: options.map((o) => ({ optionId: o.optionId, name: o.name, choices: o.choices.length })) }
      const hits = options.filter((o) => o.name.toLowerCase().includes(q))
      if (!hits.length) throw new ToolError(`No customization option matches "${a.option}". Options: ${options.map((o) => o.name).join(', ')}.`)
      return { character, options: hits.map((o) => ({ optionId: o.optionId, name: o.name, choices: o.choices.map((c, i) => ({ choiceId: c.choiceId, name: c.name || `#${i + 1}`, ...(c.swatch ? { color: c.swatch } : {}) })) })) }
    },
    set_customization(a) {
      if (a.optionId !== undefined && a.choiceId !== undefined) return command('set_customization', { optionId: int(a.optionId), choiceId: int(a.choiceId) })
      // By name saves a list_customization step: an exact name first, then the only one containing it.
      const find = <T extends { name: string }>(list: T[], q: unknown): T[] => {
        const want = String(q ?? '').trim().toLowerCase()
        const exact = list.filter((x) => x.name.toLowerCase() === want)
        return exact.length || !want ? exact : list.filter((x) => x.name.toLowerCase().includes(want))
      }
      const options = store.get().options
      const os = find(options, a.option)
      if (os.length !== 1) throw new ToolError(`${os.length ? `"${a.option}" matches several options` : `No option "${a.option}"`}: ${(os.length ? os : options).map((o) => o.name).join(', ')}.`)
      const o = os[0]
      const named = o.choices.filter((c) => c.name)
      if (!named.length) throw new ToolError(`${o.name}'s choices have no names, only colors. Call list_customization with option "${o.name}" and pick by its hex color.`)
      const cs = find(named, a.choice)
      if (cs.length !== 1) throw new ToolError(`${cs.length ? `"${a.choice}" matches several` : `No ${o.name} "${a.choice}"`}. Choices: ${(cs.length ? cs : named).map((c) => c.name).join(', ')}.`)
      return command('set_customization', { optionId: o.optionId, choiceId: cs[0].choiceId })
    },
    randomize_customization: () => command('randomize_customization', {}),
    reset_customization: () => command('reset_customization', {}),

    async set_view(a) {
      const view = typeof a.view === 'string' ? a.view.trim().toLowerCase() : ''
      if (!VIEWS.includes(view)) throw new ToolError(`Unknown view "${a.view}". Use one of: ${VIEWS.join(', ')}.`)
      return command('set_view', { view })
    },

    // Name, title (by its wording, for the character's faction), guild, level, class (by name) and PvP.
    // An empty string clears a part.
    async set_identity(a) {
      const change: Record<string, unknown> = {}
      for (const k of ['firstName', 'lastName', 'guild'] as const) if (k in a) change[k] = a[k] === null ? '' : String(a[k])
      if ('level' in a) change.level = a.level === '' || a.level === null ? '' : int(a.level)
      if ('pvp' in a) change.pvp = a.pvp === true ? true : ''
      const s0 = store.get()
      const race = s0.characters?.races.find((r) => r.race === s0.look.race)
      if ('class' in a) {
        const want = String(a.class ?? '').trim().toLowerCase()
        if (!want) change.classId = ''
        else {
          const cls = (s0.characters?.races ?? []).flatMap((r) => r.classes).find((c) => c.name.toLowerCase() === want)
          if (!cls) throw new ToolError(`Unknown class "${a.class}".`)
          change.classId = cls.classId
        }
      }
      if ('title' in a) {
        const want = titleWords(String(a.title ?? ''))
        if (!want) change.titleId = ''
        else {
          const titles = ((await deps.titles?.()) ?? []).filter((t) => !t.faction || !race?.faction || t.faction === race.faction)
          const t = titles.find((x) => titleWords(x.male) === want || titleWords(x.female) === want)
          if (!t) {
            const close = titles.filter((x) => titleWords(x.male).split(' ').some((w) => want.split(' ').includes(w))).slice(0, 8).map((x) => titleText(x.male))
            const all = titles.slice(0, 12).map((x) => titleText(x.male))
            throw new ToolError(`No title "${a.title}" for this character's faction. Try: ${(close.length ? close : all).join(', ')}.`)
          }
          change.titleId = t.titleId
        }
      }
      const r = deps.cmd.set_identity(change as never)
      if (r.error !== undefined) throw new ToolError(r.error)
      await deps.settle?.()
      return { identity: store.get().look.identity ?? {} }
    },
    list_animations: () => command('list_animations', {}),
    async equip_item(a) {
      const r = await command('equip_item', { slot: a.slot, itemId: int(a.itemId) })
      forCommand()
      if (typeof a.slot === 'string') namedSlots.add(a.slot.toLowerCase())
      return r
    },
    unequip: (a) => command('unequip', { slot: a.slot }),
    async set_character(a) {
      // Nova switched the main character once per race named and then added every race with compare, so
      // "an orc and an undead side by side" showed three characters (2026-10-21). The first race named
      // stays the main character; a note didn't stop it, so a second switch is refused.
      if (callCount('set_character') > 1) {
        const now = named([store.get().look])[0]
        throw new ToolError(`The main character is already ${now} in this command. Add the other races with compare, each with its own items or setId.`)
      }
      const r = await command('set_character', { race: int(a.race), sex: int(a.sex) })
      // Nova leaves the old lineup standing beside a new main character unless told (benchmarked 2026-10-20).
      const beside = store.get().look.compare
      return beside.length ? { ...r, besideIt: named(beside), note: 'These still stand beside the main character. If the user named only this race, call compare with an empty list; if they named others, call compare with those.' } : r
    },
    async compare(a) {
      const characters = Array.isArray(a.characters) ? a.characters as Input[] : []
      for (const c of characters) if (c?.setId !== undefined) checkFound(c.setId)
      // A set by ID saves the model copying each piece's item ID; its own items go on top.
      const all = characters.some((c) => c?.setId !== undefined) ? await deps.sets() : []
      const list = characters.map((c) => {
        if (c?.setId === undefined) return c
        const set = all.find((s) => s.setId === int(c.setId))
        if (!set || !set.pieces.length) throw new ToolError(`Set ${c.setId} is not in the catalog, or has no piece that can be shown. Use search_sets to find a set ID.`)
        const { setId: _, ...rest } = c
        return { ...rest, items: { ...Object.fromEntries(set.pieces.map((p) => [p.slot, p.item.itemId])), ...(c.items as object ?? {}) } }
      })
      // A copy of the main character (same race, sex and outfit) shows the same look twice, so it's left out.
      const main = store.get().look
      const sameItems = (items: unknown) => {
        const own = (items ?? main.items) as Record<string, unknown>
        const keys = new Set([...Object.keys(own), ...Object.keys(main.items)])
        return [...keys].every((k) => int(own[k]) === (main.items as Record<string, number | undefined>)[k])
      }
      const others = list.filter((c) => !(int(c?.race) === main.race && int(c?.sex) === main.sex && sameItems(c?.items)))
      const copies = list.length - others.length
      const before = main.compare
      const r = await command('compare', { characters: a.add === true ? [...before, ...others] : others })
      const notes = copies ? [`Left out ${copies === 1 ? 'a copy' : `${copies} copies`} of the main character: it already shows. Pass compare only the other characters.`] : []
      // A replaced lineup is easy to miss when the user asked to add one (benchmarked 2026-10-20).
      const kept = named(store.get().look.compare)
      const removed = a.add === true ? [] : named(before).filter((n) => !kept.includes(n))
      if (removed.length) notes.push('compare replaced these. If the user asked to add a character, call compare again with add true.')
      return { ...r, ...(removed.length ? { removed } : {}), ...(notes.length ? { note: notes.join(' ') } : {}) }
    },
    set_animation: (a) => command('set_animation', { name: a.name }),

    // Ideas only: the pairs that pass the name check show in the Identity panel, and the look stays as it is.
    // A name the lists already offer goes back too: the lists are the fallback, and the AI is there for new ones.
    async suggest_names(a) {
      const names = Array.isArray(a.names) ? a.names as Input[] : []
      // Three rounds got 8 to 11 of 12 benchmark requests to five names; two got 7 (2026-10-19).
      if (callCount('suggest_names') > 3) throw new ToolError('That is enough name rounds for one command; the panel fills any gap from its lists. Stop calling tools and reply in one sentence.')
      if (names.length === 0 || names.length > 8) throw new ToolError('Give 1 to 8 names.')
      // Without the lists (a failed load), this round just can't refuse their names.
      const known = await deps.knownNames?.().catch(() => undefined) ?? new Set<string>()
      if (current !== undefined && current !== ideasFor) { ideasFor = current; store.set({ nameIdeas: [], nameIdeasNote: null }) }
      const shown: { firstName: string; lastName: string }[] = []
      const rejected: { firstName: string; lastName: string; problems: string[] }[] = []
      // Names already shown count too: replacements must not sound like them.
      const key = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.toLowerCase()
      const accepted = [...store.get().nameIdeas]
      for (const n of names) {
        // Spares past the first 5 that pass cover refusals; once 5 pass, the rest go unread.
        if (store.get().nameIdeas.length + shown.length >= 5) break
        const pair = { firstName: String(n?.firstName ?? '').trim(), lastName: String(n?.lastName ?? '').trim() }
        // The model resends what it already has with its replacements; a pair already shown stays as it is.
        if (store.get().nameIdeas.some((x) => key(x) === key(pair))) continue
        const p = pairProblems(pair)
        const b = batchProblems(pair, accepted)
        const problems = (['firstName', 'lastName'] as const).flatMap((k) => {
          const part = [...(p[k] ?? [])]
          const low = pair[k].toLowerCase()
          if (pair[k] && known.has(low)) part.push('already in the name lists; make up a new one')
          else if (pair[k] && FAMOUS_NAMES.has(low)) part.push('a famous Warcraft name; make up a new one')
          else if (!part.length) part.push(...(b[k] ?? []))
          return part.map((x) => `${k === 'firstName' ? 'first' : 'last'} name: ${x}`)
        })
        if (problems.length) rejected.push({ ...pair, problems })
        else { shown.push(pair); accepted.push(pair) }
      }
      // Replacements for rejected pairs come in a second call, so they join the names already shown.
      store.set((s) => {
        const have = new Set(s.nameIdeas.map(key))
        return { nameIdeas: [...s.nameIdeas, ...shown.filter((p) => !have.has(key(p)))].slice(0, 5), nameIdeasNote: null }
      })
      // Every name showing, so the model knows when it has five.
      return { shown: store.get().nameIdeas.length, rejected }
    },
  }

  return async (name, input, command) => {
    current = command
    // Own keys only: every object also answers to toString, constructor and the like.
    const tool = Object.hasOwn(tools, name) ? tools[name] : undefined
    if (!tool) return { status: 'error', json: { error: `Unknown tool "${name}".` } }
    try {
      const json = await tool(input && typeof input === 'object' ? input : {})
      return { status: 'success', json: Array.isArray(json) ? { result: json } : json }
    } catch (e) {
      return { status: 'error', json: { error: (e as Error).message } }
    }
  }
}
