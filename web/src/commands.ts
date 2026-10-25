// The command API. The UI, the prompt box and MCP commands (session.ts) change the look only
// through these functions. `transitions` are pure (look in, look out);
// createCommands wires them to the app store and the server.

import type { AnimationInfo, CharactersResponse, CustomizationOption, ItemSearchQuery, ItemSearchResult, ModelSet, TitleInfo } from './api/types'
import { describeCharacter, identitySummary, wornSets, type DescribeSet } from './identity/describe'
import {
  MAX_COMPARE, MAX_LABEL, MODEL_SETS, VIEWS, canonicalLook, normalizeLook, readIdentity, shareUrl,
  type CompareCharacter, type Identity, type Look, type View,
} from './look/look'
import { randomCustomization } from './viewer/customize'
import { isSlotName, type SlotName } from './viewer/dress'
import type { AppState, Store } from './store'

export type Result = { look: Look; error?: undefined } | { look?: undefined; error: string }

/** A side-by-side character as commands take it: models defaults to hd; the rest is optional. */
export interface CompareInput {
  race: number
  sex: number
  models?: ModelSet
  label?: string
  items?: Record<string, number>
  hide?: string[]
  custom?: Record<string, number>
  identity?: Identity
  anim?: string
}

const isId = (x: unknown): x is number => Number.isInteger(x) && (x as number) > 0

/** Checks a character against the server's list when it is known. Returns an error or null. */
function characterError(characters: CharactersResponse | null | undefined, race: number, sex: number, models: ModelSet): string | null {
  if (!Number.isInteger(race) || !(sex === 0 || sex === 1)) return `not a character: race ${race} sex ${sex}`
  if (!MODEL_SETS.includes(models)) return `unknown models "${models}"`
  if (!characters) return null
  const r = characters.races.find((x) => x.race === race)
  const s = r?.sexes.find((x) => x.sex === sex)
  if (!r || !s) return `no character data for race ${race} sex ${sex}`
  if (!s[models]) return `${r.name} ${sex === 0 ? 'male' : 'female'} has no ${models.toUpperCase()} model`
  return null
}

/**
 * Slots to empty when a set replaces the last one: those wearing a piece of some set (`setPieces`, from
 * /sets/pieces) that the new set does not fill. Loose items, such as a cloak picked by hand, stay.
 */
export function replacedSetSlots(items: Look['items'], pieces: { slot: string; itemId: number }[], setPieces: ReadonlySet<number>): SlotName[] {
  const filled = new Set(pieces.map((p) => p.slot))
  return (Object.entries(items) as [SlotName, number][]).filter(([slot, id]) => !filled.has(slot) && setPieces.has(id)).map(([slot]) => slot)
}

/** Slots wearing a piece of some set (`setPieces`, from /sets/pieces). Loose items and weapons outside sets stay. */
export function setPieceSlots(items: Look['items'], setPieces: ReadonlySet<number>): SlotName[] {
  return (Object.entries(items) as [SlotName, number][]).filter(([, id]) => setPieces.has(id)).map(([slot]) => slot)
}

/**
 * The character the panels edit, as a look of its own: 0 is the main character, n the nth side-by-side
 * one, in the main outfit when it has none. The name and the side-by-side list belong to the main one.
 */
export function characterLook(look: Look, index: number): Look {
  const c = index > 0 ? look.compare[index - 1] : undefined
  if (!c) return look
  const { identity: _, anim: mainAnim, sheathed: mainSheathed, sheatheOnBack: mainOnBack, ...rest } = look
  const anim = c.anim ? (c.anim === 'Stand' ? undefined : c.anim) : mainAnim
  // Sheathing is its own once its outfit or animation is; until then it is the main character's.
  const sheathed = ownSheathing(c) ? c.sheathed : mainSheathed, onBack = ownSheathing(c) ? c.sheatheOnBack : mainOnBack
  return {
    ...rest, race: c.race, sex: c.sex, models: c.models, custom: c.custom ?? {}, items: c.items ?? look.items, hide: c.items ? c.hide ?? [] : look.hide, compare: [],
    ...(c.identity ? { identity: c.identity } : {}), ...(anim ? { anim } : {}), ...(sheathed ? { sheathed } : {}), ...(onBack ? { sheatheOnBack: onBack } : {}),
  }
}

/** Whether a side-by-side character sheathes on its own: once its outfit or its animation is its own. */
export function ownSheathing(c: CompareCharacter): boolean {
  return !!(c.items || c.anim)
}

/** Drops a character's own sheathing once neither its outfit nor its animation is its own. */
function bindSheathing(c: CompareCharacter): CompareCharacter {
  if (ownSheathing(c)) return c
  const next = { ...c }
  delete next.sheathed
  delete next.sheatheOnBack
  return next
}

export const transitions = {
  equipItem(look: Look, slot: string, itemId: number): Result {
    if (!isSlotName(slot)) return { error: `unknown slot "${slot}"` }
    if (!isId(itemId)) return { error: `not an item ID: ${itemId}` }
    // A character holds one kind of weapon: a ranged one takes off both hands, a hand weapon the ranged one.
    const items = { ...look.items, [slot]: itemId }
    if (slot === 'ranged') { delete items.mainhand; delete items.offhand }
    if (slot === 'mainhand' || slot === 'offhand') delete items.ranged
    return { look: { ...look, items, hide: look.hide.filter((h) => h in items) } }
  },

  /**
   * Several items in one change, such as the pieces of a set. `clear` empties slots first (the pieces of
   * a set being replaced; see replacedSetSlots). Other slots keep what they have.
   */
  equipItems(look: Look, items: { slot: string; itemId: number }[], clear: string[] = []): Result {
    if (!Array.isArray(items) || items.length === 0) return { error: 'no items to equip' }
    let next = look
    for (const slot of clear) {
      const r = transitions.unequip(next, slot)
      if (r.error !== undefined) return r
      next = r.look
    }
    for (const { slot, itemId } of items) {
      const r = transitions.equipItem(next, slot, itemId)
      if (r.error !== undefined) return r
      next = r.look
    }
    return { look: next }
  },

  unequip(look: Look, slot: string): Result {
    if (!isSlotName(slot)) return { error: `unknown slot "${slot}"` }
    const items = { ...look.items }
    delete items[slot]
    return { look: { ...look, items, hide: look.hide.filter((s) => s !== slot) } }
  },

  /** Empties several slots at once, such as both weapon slots or a set's pieces. */
  unequipSlots(look: Look, slots: string[]): Result {
    let next = look
    for (const slot of slots) {
      const r = transitions.unequip(next, slot)
      if (r.error !== undefined) return r
      next = r.look
    }
    return { look: next }
  },

  /**
   * Changes the character's name, title, guild, level, class or PvP flag. Fields not given stay; an
   * empty string or null clears one. Values a share link would drop are refused.
   */
  setIdentity(look: Look, change: { [K in keyof Identity]?: Identity[K] | null | '' }): Result {
    const merged: Record<string, unknown> = { ...look.identity }
    for (const [k, v] of Object.entries(change ?? {})) {
      if (v === null || v === '' || v === undefined) delete merged[k]
      else merged[k] = v
    }
    const notices: string[] = []
    const identity = readIdentity(merged, notices)
    if (notices.length) return { error: notices.join('; ') }
    const next = { ...look }
    if (identity) next.identity = identity
    else delete next.identity
    return { look: next }
  },

  /** Sheathed hip weapons go on the back (true) or stay on the hip (false), as Forever's option allows. */
  setSheatheOnBack(look: Look, onBack: boolean): Result {
    const next = { ...look }
    if (onBack) next.sheatheOnBack = true
    else delete next.sheatheOnBack
    return { look: next }
  },

  /** Puts weapons away (on the back or hip; a ranged weapon isn't shown) or takes them out. */
  setSheathed(look: Look, sheathed: boolean): Result {
    const next = { ...look }
    if (sheathed) next.sheathed = true
    else delete next.sheathed
    return { look: next }
  },

  /** Takes everything off, stops the animation and removes the side-by-side characters. The character and its customizations stay. */
  clearAll(look: Look): Result {
    return { look: { ...look, items: {}, hide: [], anim: undefined, compare: [] } }
  },

  /** Customization option IDs belong to one body model, so changing race, sex or models clears them. */
  setCharacter(look: Look, race: number, sex: number, models: ModelSet = look.models, characters?: CharactersResponse | null): Result {
    const err = characterError(characters, race, sex, models)
    if (err) return { error: err }
    const same = look.race === race && look.sex === sex && look.models === models
    return { look: { ...look, race, sex: sex as 0 | 1, models, custom: same ? look.custom : {} } }
  },

  /** `options` are the main character's, from its base look; without them only the IDs' shape is checked. */
  setCustomization(look: Look, optionId: number, choiceId: number, options?: CustomizationOption[] | null): Result {
    if (!isId(optionId) || !isId(choiceId)) return { error: `not an option ID and choice ID: ${optionId}, ${choiceId}` }
    if (options?.length) {
      const o = options.find((x) => x.optionId === optionId)
      if (!o) return { error: `no customization option ${optionId} for this character` }
      if (!o.choices.some((c) => c.choiceId === choiceId)) return { error: `${o.name || `option ${optionId}`} has no choice ${choiceId}` }
    }
    return { look: { ...look, custom: { ...look.custom, [String(optionId)]: choiceId } } }
  },

  /** A random choice for every option of the main character. */
  randomizeCustomization(look: Look, options: CustomizationOption[] | null | undefined, random?: () => number): Result {
    if (!options?.length) return { error: 'no customization options for this character yet' }
    return { look: { ...look, custom: randomCustomization(options, random) } }
  },

  /** Back to the default choice for every option. */
  resetCustomization(look: Look): Result {
    return { look: { ...look, custom: {} } }
  },

  /**
   * The characters shown next to the main one, in order; at most MAX_COMPARE. A character with
   * `items` wears its own outfit (and `hide`); without, it wears the main outfit.
   */
  compare(look: Look, characters: CompareInput[], known?: CharactersResponse | null): Result {
    if (!Array.isArray(characters)) return { error: 'compare needs a list of characters' }
    if (characters.length > MAX_COMPARE) return { error: `side by side shows at most ${MAX_COMPARE + 1} characters` }
    const list: CompareCharacter[] = []
    for (const c of characters) {
      const models = c.models ?? 'hd'
      const err = characterError(known, c.race, c.sex, models)
      if (err) return { error: err }
      const entry: CompareCharacter = { race: c.race, sex: c.sex as 0 | 1, models }
      const label = typeof c.label === 'string' ? c.label.trim().slice(0, MAX_LABEL) : ''
      if (label) entry.label = label
      if (c.items) {
        const items: CompareCharacter['items'] = {}
        for (const [slot, id] of Object.entries(c.items)) {
          if (!isSlotName(slot)) return { error: `unknown slot "${slot}"` }
          if (!isId(id)) return { error: `not an item ID: ${id}` }
          items[slot] = id
        }
        entry.items = items
      }
      if (c.hide) {
        const bad = c.hide.find((s) => !isSlotName(s))
        if (bad !== undefined) return { error: `unknown slot "${bad}"` }
        entry.hide = [...new Set(c.hide)] as SlotName[]
      }
      if (c.custom) {
        for (const [o, ch] of Object.entries(c.custom)) if (!isId(Number(o)) || !isId(ch)) return { error: `not an option ID and choice ID: ${o}, ${ch}` }
        entry.custom = { ...c.custom }
      }
      if (c.identity !== undefined) {
        const notices: string[] = []
        const identity = readIdentity(c.identity, notices)
        if (notices.length) return { error: notices.join('; ') }
        if (identity) entry.identity = identity
      }
      if (typeof c.anim === 'string' && c.anim.trim()) entry.anim = c.anim.trim()
      list.push(entry)
    }
    return { look: { ...look, compare: list } }
  },

  /** A side-by-side character (0-based) drops its own outfit and wears the main one again. */
  wearMainOutfit(look: Look, index: number): Result {
    if (!Number.isInteger(index) || index < 0 || index >= look.compare.length) return { error: `no side-by-side character ${index + 1}` }
    const compare = look.compare.map((c, i) => {
      if (i !== index) return c
      const next = { ...c }
      delete next.items
      delete next.hide
      return bindSheathing(next)
    })
    return { look: { ...look, compare } }
  },

  /**
   * Empties slots on every outfit: the main one and each side-by-side character's own. `slots` may be a
   * function of an outfit's items, for slots that differ by outfit (its set pieces).
   */
  unequipEveryone(look: Look, slots: string[] | ((items: Look['items']) => string[])): Result {
    const of = (items: Look['items']) => (typeof slots === 'function' ? slots(items) : slots)
    const r = transitions.unequipSlots(look, of(look.items))
    if (r.error !== undefined) return r
    const compare: CompareCharacter[] = []
    for (const c of look.compare) {
      if (!c.items) { compare.push(c); continue }
      const own = transitions.unequipSlots({ ...look, items: c.items, hide: c.hide ?? [] }, of(c.items))
      if (own.error !== undefined) return own
      const next: CompareCharacter = { ...c, items: own.look.items }
      if (own.look.hide.length) next.hide = own.look.hide
      else delete next.hide
      compare.push(next)
    }
    return { look: { ...r.look, compare } }
  },

  /** Every character stands: the main animation stops and no side-by-side character keeps its own. */
  standEveryone(look: Look): Result {
    const next = { ...look, compare: look.compare.map((c) => { const x = { ...c }; delete x.anim; return bindSheathing(x) }) }
    delete next.anim
    return { look: next }
  },

  /** A side-by-side character (0-based) gets its own animation, starting from the main one. */
  ownAnimation(look: Look, index: number): Result {
    if (!Number.isInteger(index) || index < 0 || index >= look.compare.length) return { error: `no side-by-side character ${index + 1}` }
    return { look: { ...look, compare: look.compare.map((c, i) => (i === index ? { ...c, anim: look.anim ?? 'Stand' } : c)) } }
  },

  /** A side-by-side character (0-based) plays the main animation again. */
  mainAnimation(look: Look, index: number): Result {
    if (!Number.isInteger(index) || index < 0 || index >= look.compare.length) return { error: `no side-by-side character ${index + 1}` }
    return { look: { ...look, compare: look.compare.map((c, i) => { if (i !== index) return c; const next = { ...c }; delete next.anim; return bindSheathing(next) }) } }
  },

  /** A side-by-side character (0-based) gets a copy of the main outfit as its own, to change. */
  ownOutfit(look: Look, index: number): Result {
    if (!Number.isInteger(index) || index < 0 || index >= look.compare.length) return { error: `no side-by-side character ${index + 1}` }
    const compare = look.compare.map((c, i) => (i === index
      ? { ...c, items: { ...look.items }, ...(look.hide.length ? { hide: [...look.hide] } : {}) }
      : c))
    return { look: { ...look, compare } }
  },

  /**
   * Applies a change to one character (see characterLook): 0 the main one, n the nth side-by-side one. A
   * change to the gear of a character in the main outfit gives it its own; the main outfit stays.
   */
  editCharacter(look: Look, index: number, change: (character: Look) => Result): Result {
    if (index === 0) return change(look)
    const c = Number.isInteger(index) && index > 0 ? look.compare[index - 1] : undefined
    if (!c) return { error: `no side-by-side character ${index}` }
    const before = characterLook(look, index)
    const r = change(before)
    if (r.error !== undefined) return r
    const after = r.look
    const next: CompareCharacter = { ...c, race: after.race, sex: after.sex, models: after.models }
    if (Object.keys(after.custom).length) next.custom = after.custom
    else delete next.custom
    if (after.identity && Object.keys(after.identity).length) next.identity = after.identity
    else delete next.identity
    // Like the outfit: another animation on a character playing the main one gives it its own.
    if (c.anim || after.anim !== before.anim) next.anim = after.anim ?? 'Stand'
    let main = look
    if (c.items || after.items !== before.items || after.hide !== before.hide) {
      next.items = after.items
      if (after.hide.length) next.hide = after.hide
      else delete next.hide
    }
    if (ownSheathing(next)) {
      if (after.sheathed) next.sheathed = true
      else delete next.sheathed
      if (after.sheatheOnBack) next.sheatheOnBack = true
      else delete next.sheatheOnBack
    } else if (after.sheathed !== before.sheathed || after.sheatheOnBack !== before.sheatheOnBack) {
      // In the main outfit and animation, a character sheathes with the main one.
      main = { ...look }
      if (after.sheathed) main.sheathed = true
      else delete main.sheathed
      if (after.sheatheOnBack) main.sheatheOnBack = true
      else delete main.sheatheOnBack
    }
    return { look: { ...main, compare: look.compare.map((x, i) => (i === index - 1 ? next : x)) } }
  },

  setVisibility(look: Look, slot: string, visible: boolean): Result {
    if (!isSlotName(slot)) return { error: `unknown slot "${slot}"` }
    const hide = look.hide.filter((s) => s !== slot)
    if (!visible) hide.push(slot)
    return { look: { ...look, hide } }
  },

  /** Every character plays this animation. `animations` are the main character's; empty checks only the shape. */
  setAnimation(look: Look, name: string, animations: AnimationInfo[]): Result {
    if (typeof name !== 'string' || !name.trim()) return { error: 'set_animation needs an animation name' }
    const wanted = name.trim()
    const found = animations.length ? animations.find((a) => a.name.toLowerCase() === wanted.toLowerCase()) : { id: -1, name: wanted }
    if (!found) return { error: `no animation "${wanted}" for this character; list_animations shows what it has` }
    const next = { ...look }
    if (found.name.toLowerCase() === 'stand') delete next.anim
    else next.anim = found.name
    return { look: next }
  },

  setView(look: Look, view: string): Result {
    if (!VIEWS.includes(view as View)) return { error: `unknown view "${view}"` }
    return { look: { ...look, cam: { view: view as View } } }
  },
}

export interface CommandContext {
  store: Store<AppState>
  searchItems: (query: ItemSearchQuery) => Promise<ItemSearchResult[]>
  /** The app's own URL, for share links. */
  appUrl: () => string
  /** Every title, for the titled name. Without it the name shows untitled. */
  titles?: () => Promise<TitleInfo[]>
  /** Sets whose name or a piece's name holds the text, for naming a worn set. Without it items go by name. */
  searchSets?: (q: string) => Promise<DescribeSet[]>
  /** Item IDs of every set piece, so items in no set are not searched. */
  setPieces?: () => Promise<number[]>
}

export type Commands = ReturnType<typeof createCommands>

export function createCommands({ store, searchItems, appUrl, titles, searchSets, setPieces }: CommandContext) {
  // Every change is stamped with the build of the data it was made with.
  function apply(r: Result): Result {
    if (r.error !== undefined) {
      store.set((s) => ({ notices: { ...s.notices, commands: [r.error] } }))
      return r
    }
    const build = store.get().status?.active?.build
    const look = build ? { ...r.look, build } : r.look
    // A side-by-side character that is gone can't stay selected.
    store.set((s) => ({ look, notices: { ...s.notices, commands: [] }, ...(s.selected > look.compare.length ? { selected: 0 } : {}) }))
    return { look }
  }
  const look = () => store.get().look
  // The panels edit the character selected on screen; the prompt box and MCP commands always the main one.
  const onSelected = (change: (character: Look) => Result) => apply(transitions.editCharacter(look(), store.get().selected, change))
  const characters = () => store.get().characters
  const allTitles = async () => (await titles?.().catch(() => undefined)) ?? []

  return {
    search_items: (query: ItemSearchQuery) => searchItems(query),
    equip_item: (slot: SlotName | string, itemId: number) => apply(transitions.equipItem(look(), slot, itemId)),
    equip_items: (items: { slot: SlotName | string; itemId: number }[], clear?: string[]) => apply(transitions.equipItems(look(), items, clear)),
    unequip: (slot: SlotName | string) => apply(transitions.unequip(look(), slot)),
    set_character: (race: number, sex: number, models?: ModelSet) =>
      apply(transitions.setCharacter(look(), race, sex, models, characters())),
    set_customization: (optionId: number, choiceId: number) => apply(transitions.setCustomization(look(), optionId, choiceId, store.get().options)),
    randomize_customization: () => apply(transitions.randomizeCustomization(look(), store.get().options)),
    reset_customization: () => apply(transitions.resetCustomization(look())),
    compare: (list: CompareInput[]) => apply(transitions.compare(look(), list, characters())),
    wear_main_outfit: (index: number) => apply(transitions.wearMainOutfit(look(), index)),
    own_outfit: (index: number) => apply(transitions.ownOutfit(look(), index)),
    own_animation: (index: number) => apply(transitions.ownAnimation(look(), index)),
    unequip_everyone: (slots: string[] | ((items: Look['items']) => string[])) => apply(transitions.unequipEveryone(look(), slots)),
    stand_everyone: () => apply(transitions.standEveryone(look())),
    main_animation: (index: number) => apply(transitions.mainAnimation(look(), index)),
    /** Which character the panels edit: 0 the main one, n the nth side-by-side one. */
    select: (index: number) => store.set({ selected: Number.isInteger(index) && index >= 0 && index <= look().compare.length ? index : 0 }),
    /** The same changes, on the selected character. `options` are that character's, from its base look. */
    edit: {
      equip_item: (slot: SlotName | string, itemId: number) => onSelected((l) => transitions.equipItem(l, slot, itemId)),
      equip_items: (items: { slot: SlotName | string; itemId: number }[], clear?: string[]) => onSelected((l) => transitions.equipItems(l, items, clear)),
      unequip: (slot: SlotName | string) => onSelected((l) => transitions.unequip(l, slot)),
      unequip_slots: (slots: (SlotName | string)[]) => onSelected((l) => transitions.unequipSlots(l, slots)),
      set_visibility: (slot: SlotName | string, visible: boolean) => onSelected((l) => transitions.setVisibility(l, slot, visible)),
      set_character: (race: number, sex: number, models?: ModelSet) => onSelected((l) => transitions.setCharacter(l, race, sex, models ?? l.models, characters())),
      set_customization: (optionId: number, choiceId: number, options: CustomizationOption[] | null) => onSelected((l) => transitions.setCustomization(l, optionId, choiceId, options)),
      randomize_customization: (options: CustomizationOption[] | null) => onSelected((l) => transitions.randomizeCustomization(l, options)),
      reset_customization: () => onSelected((l) => transitions.resetCustomization(l)),
      set_identity: (change: Parameters<typeof transitions.setIdentity>[1]) => onSelected((l) => transitions.setIdentity(l, change)),
      set_sheathed: (sheathed: boolean) => onSelected((l) => transitions.setSheathed(l, sheathed)),
      set_sheathe_on_back: (onBack: boolean) => onSelected((l) => transitions.setSheatheOnBack(l, onBack)),
      /** `animations` are the selected character's, from its base look. */
      set_animation: (name: string, animations: AnimationInfo[]) => onSelected((l) => transitions.setAnimation(l, name, animations)),
    },
    set_visibility: (slot: SlotName | string, visible: boolean) => apply(transitions.setVisibility(look(), slot, visible)),
    set_view: (view: View | string) => apply(transitions.setView(look(), view)),
    unequip_slots: (slots: (SlotName | string)[]) => apply(transitions.unequipSlots(look(), slots)),
    clear_all: () => apply(transitions.clearAll(look())),
    set_sheathed: (sheathed: boolean) => apply(transitions.setSheathed(look(), sheathed)),
    set_sheathe_on_back: (onBack: boolean) => apply(transitions.setSheatheOnBack(look(), onBack)),
    set_identity: (change: Parameters<typeof transitions.setIdentity>[1]) => apply(transitions.setIdentity(look(), change)),
    set_animation: (name: string) => apply(transitions.setAnimation(look(), name, store.get().animations)),
    /** Replaces the whole look, e.g. from a saved file. Returns the notices from reading it. */
    open_look: (input: unknown): { look: Look | null; notices: string[] } => {
      const r = normalizeLook(input, { characters: characters()?.races.flatMap((x) => x.sexes.map((s) => ({ race: x.race, sex: s.sex }))) })
      if (r.look) store.set((s) => ({ look: r.look!, notices: { ...s.notices, link: r.notices, commands: [] } }))
      else store.set((s) => ({ notices: { ...s.notices, link: r.notices } }))
      return r
    },
    /** The look in canonical form (sorted keys, defaults left out), as saved and shared. */
    get_look: () => canonicalLook(look(), { defaults: store.get().defaults }),
    share_link: () => shareUrl(appUrl(), look(), { defaults: store.get().defaults }),
    /** Who the character is, with the title and class in words; undefined without an identity. */
    describe_identity: async () => {
      const list = await allTitles()
      return identitySummary(look(), list, characters())
    },
    /** The look as text to copy: identity, outfit, side-by-side characters and the share link (identity/describe.ts). */
    describe_look: async () => {
      const [list, pieces] = await Promise.all([allTitles(), setPieces?.().catch(() => undefined)])
      const s = store.get()
      const outfits = [s.look.items, ...s.look.compare.flatMap((c) => (c.items ? [c.items] : []))]
      const sets = searchSets ? await wornSets(outfits, s.itemInfo, searchSets, pieces && new Set(pieces)) : []
      // The look may have changed while the data loaded; describe the one showing now.
      const now = store.get()
      return describeCharacter(now.look, { characters: now.characters, titles: list, itemInfo: now.itemInfo, sets, link: shareUrl(appUrl(), now.look, { defaults: now.defaults }) })
    },
  }
}
