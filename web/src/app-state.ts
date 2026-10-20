// The app's one store and command set. Components import these; tests build their own.
import { getSetPieces, getTitles, searchItems, searchSets } from './api/client'
import { createCommands } from './commands'
import { createStore, initialState } from './store'

export const store = createStore(initialState())

export const commands = createCommands({
  store,
  searchItems: (q) => searchItems(q),
  appUrl: () => location.href,
  titles: () => getTitles(),
  searchSets: (q) => searchSets({ q, limit: 20 }),
  setPieces: () => getSetPieces(),
})
