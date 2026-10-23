// The app's one store and command set. Components import these; tests build their own.
import { useMemo } from 'react'
import { getSetPieces, getTitles, searchItems, searchSets } from './api/client'
import { characterLook, createCommands } from './commands'
import type { Look } from './look/look'
import { createStore, initialState, useStore } from './store'

export const store = createStore(initialState())

export const commands = createCommands({
  store,
  searchItems: (q) => searchItems(q),
  appUrl: () => location.href,
  titles: () => getTitles(),
  searchSets: (q) => searchSets({ q, limit: 20 }),
  setPieces: () => getSetPieces(),
})

/** The character the panels edit (AppState.selected), as a look of its own (characterLook). */
export function useEditing(): { look: Look; index: number } {
  const look = useStore(store, (s) => s.look)
  const index = useStore(store, (s) => s.selected)
  return useMemo(() => ({ look: characterLook(look, index), index }), [look, index])
}

/** The class that filters sets and weapons: the edited character's Identity class, one choice for both panels. */
export function useFindClass(): [number, (classId: number) => void] {
  const classId = useEditing().look.identity?.classId ?? 0
  return [classId, (id: number) => commands.edit.set_identity({ classId: id || null })]
}
