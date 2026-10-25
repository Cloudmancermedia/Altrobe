import { useSyncExternalStore } from 'react'
import type { AnimationInfo, CharactersResponse, CustomizationOption, ItemSearchResult, Status } from './api/types'
import { emptyLook, type Look } from './look/look'
import type { NamePair } from './identity/name-rules'
import type { HostedPhase, HostedResult } from './assistant/hosted'

export interface ItemInfo {
  name: string
  quality?: number
  iconFileDataId?: number
}

export interface AppState {
  look: Look
  /** The character the panels edit: 0 the main one, n the nth side-by-side one. Not part of the look. */
  selected: number
  /** Notices by source (e.g. "link", "cell:0"), so each source replaces only its own. */
  notices: Record<string, string[]>
  status: Status | null
  characters: CharactersResponse | null
  /** Default choice per option ID for the main character, from its base look. */
  defaults: Record<string, number>
  /** Every customization option and its choices for the main character, from its base look. */
  options: CustomizationOption[]
  /** Animations the main character's body model has. */
  animations: AnimationInfo[]
  /** Names and icons for item IDs seen in search results or resolved data. */
  itemInfo: Record<number, ItemInfo>
  /** Offer every class, not only the race's own (a Tauren in priest sets). Remembered in this browser. */
  anyClass: boolean
  /** A request from the character screen to search one slot's items; `n` changes on every request. */
  findSlot: { slot: string; n: number } | null
  /** Name pairs saved for reservation day. Remembered in this browser. */
  shortlist: NamePair[]
  /** The last name suggestions, from the model (suggest_names) or the lists, shown in the Identity panel. */
  nameIdeas: NamePair[]
  /** Where the suggestions came from when it wasn't the model; null for the model's. */
  nameIdeasNote: string | null
  /** A command for the hosted prompt box to send, from another panel; `n` changes on every request. */
  ask: { text: string; n: number; creative?: boolean } | null
  /** What's left of the hosted prompt box's daily allowance, in model steps, from its last answer, for the top bar. */
  aiQuota: { remaining: number; limit: number; resetAt: string } | null
  /** The daily limits closed the hosted prompt box until resetAt; the top bar says when it reopens. */
  aiClosed: { code: 'ip_limit' | 'daily_cap'; resetAt: string } | null
  /** The hosted prompt box is running a command; other AI buttons wait. */
  aiBusy: boolean
  /** What the running command is doing and since when, and which panel asked, so that panel shows the status line. */
  aiStatus: { from: 'ask' | 'names'; phase: HostedPhase; since: number } | null
  /** How the request `n` ended in the prompt box, with the model's reply when it finished, so the panel that asked can use it or fall back. */
  askDone: { n: number; kind: HostedResult['kind']; text?: string } | null
}

export interface Store<T> {
  get(): T
  set(update: Partial<T> | ((s: T) => Partial<T>)): void
  subscribe(listener: () => void): () => void
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(update) {
      const patch = typeof update === 'function' ? update(state) : update
      state = { ...state, ...patch }
      for (const l of listeners) l()
    },
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}

export const initialState = (): AppState => ({
  look: emptyLook(2, 0),
  selected: 0,
  notices: {},
  status: null,
  characters: null,
  defaults: {},
  options: [],
  animations: [],
  itemInfo: {},
  anyClass: readAnyClass(),
  findSlot: null,
  shortlist: readShortlist(),
  nameIdeas: [],
  nameIdeasNote: null,
  ask: null,
  askDone: null,
  aiQuota: null,
  aiClosed: null,
  aiBusy: false,
  aiStatus: null,
})

const ANY_CLASS_KEY = 'altrobe.anyClass'
// Storage can be missing or throw (private windows, blocked site data); the setting then just isn't kept.
function readAnyClass(): boolean {
  try { return globalThis.localStorage?.getItem(ANY_CLASS_KEY) === '1' } catch { return false }
}
export function setAnyClass(store: Store<AppState>, anyClass: boolean) {
  store.set({ anyClass })
  try { globalThis.localStorage?.setItem(ANY_CLASS_KEY, anyClass ? '1' : '0') } catch { /* not kept */ }
}

const SHORTLIST_KEY = 'altrobe.shortlist'
function readShortlist(): NamePair[] {
  try {
    const list: unknown = JSON.parse(globalThis.localStorage?.getItem(SHORTLIST_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((p): p is NamePair => typeof p?.firstName === 'string' && typeof p?.lastName === 'string') : []
  } catch { return [] }
}
export function setShortlist(store: Store<AppState>, shortlist: NamePair[]) {
  store.set({ shortlist })
  try { globalThis.localStorage?.setItem(SHORTLIST_KEY, JSON.stringify(shortlist)) } catch { /* not kept */ }
}

export function useStore<T, R>(store: Store<T>, select: (s: T) => R): R {
  const get = () => select(store.get())
  // The same snapshot for a static render (the panel tests), where there is no server state.
  return useSyncExternalStore(store.subscribe, get, get)
}

export function rememberItems(store: Store<AppState>, items: (ItemSearchResult | { itemId: number; name: string })[]) {
  const known = store.get().itemInfo
  const fresh = items.filter((i) => !known[i.itemId] || ('quality' in i && known[i.itemId].quality === undefined))
  if (!fresh.length) return
  store.set((s) => ({
    itemInfo: {
      ...s.itemInfo,
      ...Object.fromEntries(fresh.map((i) => [i.itemId, { ...s.itemInfo[i.itemId], ...('quality' in i ? { name: i.name, quality: i.quality, iconFileDataId: i.iconFileDataId } : { name: i.name }) }])),
    },
  }))
}

export function setNotices(store: Store<AppState>, source: string, list: string[]) {
  const cur = store.get().notices[source] ?? []
  if (cur.length === list.length && cur.every((n, i) => n === list[i])) return
  store.set((s) => ({ notices: { ...s.notices, [source]: list } }))
}
