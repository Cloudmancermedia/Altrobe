import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, clearCache, features, getCharacters, getStatus, hostedPrompt, selectInstall } from './api/client'
import { AboutDialog } from './components/AboutDialog'
import { AiCounter } from './components/Ai'
import { copyrightLine, SUPPORT } from './components/footer'
import { launchBanner } from './identity/name-rules'
import type { CharactersResponse, ResolvedItem, Status } from './api/types'
import { commands, store } from './app-state'
import { CharacterPanel, CustomizationPanel } from './components/CharacterPanel'
import { IdentityPanel } from './components/IdentityPanel'
import { HostedPromptPanel, PromptPanel } from './components/PromptPanel'
import { ItemSearch } from './components/Items'
import { PaperDoll } from './components/PaperDoll'
import { ComparePanel, InstallPicker, Notices, SharePanel } from './components/Panels'
import { useBaseLook, useTitles } from './hooks'
import { nameplate, titlesFor, tooltipLines } from './identity/identity'
import { characterLabel } from './labels'
import { defaultsFrom, emptyLook, lookFromFragment, lookFromLocation, type KnownCharacters } from './look/look'
import { rememberItems, setNotices, useStore } from './store'
import type { Stage } from './viewer/stage'
import { Viewer, type ViewerCell } from './viewer/Viewer'
import { installTestHooks } from './test-hooks'
import { connectSession } from './session'
import './App.css'
import { defaultTooltipMode, type TooltipMode } from './viewer/tooltip'
import { foreverChoice, openFailedNotice } from './components/install-choice'

type Phase = 'starting' | 'no-install' | 'offline' | 'error' | 'ready'

const known = (c: CharactersResponse): KnownCharacters => c.races.flatMap((r) => r.sexes.map((s) => ({ race: r.race, sex: s.sex })))

/** The Orc male if the install has it, else the first character with any model. */
function defaultCharacter(c: CharactersResponse) {
  const all = c.races.flatMap((r) => r.sexes.filter((s) => s.hd || s.sd).map((s) => ({ race: r.race, sex: s.sex, models: s.hd ? 'hd' as const : 'sd' as const })))
  return all.find((x) => x.race === 2 && x.sex === 0) ?? all[0]
}

const itemSpeedParam = Number(new URLSearchParams(location.search).get('itemspeed') ?? '')

// A preview link (/l/<look>) that reached the app, read once at startup: the app lives at /, and its links
// build on the address, so the path gives way to / at once. Every load reads the look from startPath.
const startPath = typeof location === 'undefined' ? '/' : location.pathname
if (startPath.startsWith('/l/')) history.replaceState(null, '', `/${location.search}${location.hash}`)

const BANNER_KEY = 'altrobe.bannerDismissed.foreverLaunch'

/** The launch and reservation dates over the app, until launch day ends. Dismissing it is remembered in this browser. */
function LaunchBanner() {
  const [text] = useState(() => launchBanner(new Date()))
  const [dismissed, setDismissed] = useState(() => {
    try { return globalThis.localStorage?.getItem(BANNER_KEY) === '1' } catch { return false }
  })
  if (!text || dismissed) return null
  const dismiss = () => {
    setDismissed(true)
    try { globalThis.localStorage?.setItem(BANNER_KEY, '1') } catch { /* not kept */ }
  }
  return (
    <section className="banner small" aria-label="WoW Forever launch">
      <span>{text}</span>
      <button type="button" className="link" aria-label="Dismiss" onClick={dismiss}>×</button>
    </section>
  )
}

export default function App() {
  const look = useStore(store, (s) => s.look)
  const notices = useStore(store, (s) => s.notices)
  const status = useStore(store, (s) => s.status)
  const characters = useStore(store, (s) => s.characters)
  const defaults = useStore(store, (s) => s.defaults)
  const [phase, setPhase] = useState<Phase>('starting')
  const stageRef = useRef<Stage | null>(null)

  const fail = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.code === 'no_install') {
      store.set((st) => ({ status: st.status && { ...st.status, active: null } }))
      setPhase('no-install')
      setNotices(store, 'install', ['No game install selected. Choose one to load characters and items.'])
      return
    }
    // An ApiError means the server answered, so "start the server" would be wrong advice.
    setPhase(e instanceof ApiError ? 'error' : 'offline')
    setNotices(store, 'app', [`Altrobe could not start: ${(e as Error).message}`])
  }, [])

  const boot = useCallback(async (s: Status) => {
    try {
      store.set({ status: s })
      // With exactly one Forever product there is nothing to ask; select it and carry on. If that
      // fails, show the picker so the user can choose something else instead of retrying the same.
      const auto = !s.active && foreverChoice(s)
      if (auto) {
        try {
          await selectInstall(auto)
          s = await getStatus()
          store.set({ status: s })
        } catch (e) {
          setPhase('no-install')
          setNotices(store, 'install', [openFailedNotice(auto, (e as Error).message)])
          return
        }
      }
      if (!s.active) {
        setPhase('no-install')
        setNotices(store, 'install', ['No game install selected. Choose one to load characters and items.'])
        return
      }
      setNotices(store, 'install', [])
      clearCache()
      const ch = await getCharacters()
      store.set({ characters: ch })
      // The fragment first: after the first load it holds the current look. Then a preview link's path.
      const fromLink = lookFromLocation({ hash: location.hash, pathname: startPath }, { characters: known(ch) })
      if (fromLink?.look) {
        store.set((st) => ({ look: fromLink.look!, notices: { ...st.notices, link: fromLink.notices } }))
      } else {
        if (fromLink) setNotices(store, 'link', fromLink.notices)
        const d = defaultCharacter(ch)
        if (d) store.set({ look: emptyLook(d.race, d.sex, d.models, s.active.build) })
      }
      setPhase('ready')
      setNotices(store, 'app', [])
    } catch (e) {
      fail(e)
    }
  }, [fail])

  const start = useCallback(() => getStatus().then(boot, fail), [boot, fail])
  useEffect(() => { void start() }, [start])
  useEffect(() => installTestHooks(() => stageRef.current), [])
  // Commands from Claude or another MCP client arrive over the server's session channel. The hosted
  // site has no server to open one with.
  useEffect(() => (phase === 'ready' && features.session ? connectSession(commands, store) : undefined), [phase])

  // Keep the address bar a share link, so a reload keeps the look. replaceState does not fire
  // hashchange; a pasted or edited link does, and loads that look.
  useEffect(() => {
    if (phase === 'ready') history.replaceState(null, '', commands.share_link())
  }, [phase, look, defaults])
  useEffect(() => {
    const onHash = () => {
      const r = lookFromFragment(location.hash, { characters: characters ? known(characters) : undefined })
      if (r?.look) commands.open_look(r.look)
      else if (r && !r.look) setNotices(store, 'link', r.notices)
    }
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [characters])

  const mainBase = useBaseLook(look.race, look.sex, look.models, phase === 'ready')
  useEffect(() => {
    if (mainBase) store.set({ defaults: defaultsFrom(mainBase), options: mainBase.options ?? [], animations: mainBase.animations ?? [] })
  }, [mainBase])

  const allTitles = useTitles()
  const titles = useMemo(() => titlesFor(allTitles, characters?.races.find((r) => r.race === look.race)?.faction), [allTitles, characters, look.race])
  // The tooltip is off by default on touch screens, where a tap leaves a hover stuck on.
  const [tooltipMode, setTooltipMode] = useState<TooltipMode>(() => defaultTooltipMode(typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches))
  const [aboutOpen, setAboutOpen] = useState(false)
  // Narrow screens show one side panel at a time, picked by the tabs under the character screen.
  const [panelTab, setPanelTab] = useState<'find' | 'character'>('find')
  const cells: ViewerCell[] = useMemo(() => [
    {
      key: 'main', main: true, spec: { race: look.race, sex: look.sex, models: look.models }, label: characterLabel(characters, look.race, look.sex, look.models),
      identity: {
        plate: nameplate(look.identity, titles, look.sex),
        tooltip: look.identity ? tooltipLines(look.identity, titles, look.sex, characters?.races.find((r) => r.race === look.race)) : [],
        pvp: look.identity?.pvp ?? false,
        tooltipMode,
      },
    },
    ...look.compare.map((c, i): ViewerCell => ({
      key: `compare${i}`, main: false, spec: { race: c.race, sex: c.sex, models: c.models }, custom: c.custom,
      outfit: c.items ? { items: c.items, hide: c.hide ?? [] } : undefined,
      label: `${c.label ? `${c.label} · ` : ''}${characterLabel(characters, c.race, c.sex, c.models)}`,
    })),
  ], [look.race, look.sex, look.models, look.compare, look.identity, titles, tooltipMode, characters])

  // Drop notices from characters no longer on screen.
  const cellKeys = cells.map((c) => c.key).join()
  useEffect(() => {
    const keep = new Set(cellKeys.split(','))
    const stale = Object.keys(store.get().notices).filter((k) => k.startsWith('cell:') && !keep.has(k.slice(5)))
    if (stale.length) store.set((s) => ({ notices: Object.fromEntries(Object.entries(s.notices).filter(([k]) => !stale.includes(k))) }))
  }, [cellKeys])

  const noticeLabels = Object.fromEntries(cells.map((c) => [`cell:${c.key}`, c.label]))
  const onNotices = useCallback((key: string, list: string[]) => setNotices(store, `cell:${key}`, list), [])
  const onResolved = useCallback((items: ResolvedItem[]) => rememberItems(store, items), [])
  const build = status?.active?.build ?? look.build

  return (
    <div className="app">
      <header className="topbar">
        <h1>Altrobe</h1>
        <span className="muted small">
          {status?.active ? `${status.active.product} ${status.active.build}` : phase === 'starting' ? 'Connecting…' : 'No install'}
        </span>
        {hostedPrompt && <AiCounter />}
        {phase === 'ready' && <SharePanel look={look} defaults={defaults} />}
      </header>
      <LaunchBanner />
      <Notices notices={notices} labels={noticeLabels} />
      {phase === 'no-install' && status && features.installs && (
        <main className="center-panel"><InstallPicker status={status} onSelected={(s) => boot(s)} /></main>
      )}
      {phase === 'error' && status && features.installs && (
        <main className="center-panel">
          <p>The server could not load this game install. Pick another product, or <button type="button" onClick={() => start()}>try again</button>.</p>
          <InstallPicker status={status} onSelected={(s) => boot(s)} />
        </main>
      )}
      {(phase === 'offline' || ((phase === 'error' || phase === 'no-install') && !features.installs)) && (
        <main className="center-panel">
          <p>{features.installs ? 'Start the Altrobe server, then ' : 'Altrobe could not load its game data. '}<button type="button" onClick={() => start()}>try again</button>.</p>
        </main>
      )}
      {phase === 'ready' && characters && (
        <main className="layout">
          <aside className={`side left${panelTab === 'character' ? '' : ' narrow-hidden'}`} aria-label="Character">
            <CharacterPanel characters={characters} look={look} />
            {/* The AI comes first after the character: Ask, then Identity, whose AI buttons share Ask's daily commands. */}
            {features.assistant && <PromptPanel />}
            {hostedPrompt && <HostedPromptPanel />}
            <IdentityPanel characters={characters} look={look} tooltipMode={tooltipMode} onTooltipMode={setTooltipMode} />
            <CustomizationPanel look={look} />
            <ComparePanel characters={characters} look={look} />
          </aside>
          <PaperDoll look={look} build={build}>
            <Viewer cells={cells} look={look} itemSpeed={itemSpeedParam > 0 ? itemSpeedParam : undefined}
              onNotices={onNotices} onResolved={onResolved} onStage={(s) => { stageRef.current = s }} />
          </PaperDoll>
          <div className="segmented panel-tabs" role="radiogroup" aria-label="Panels">
            {([['find', 'Find'], ['character', 'Character']] as const).map(([tab, label]) => (
              <button key={tab} type="button" role="radio" aria-checked={panelTab === tab} onClick={() => setPanelTab(tab)}>{label}</button>
            ))}
          </div>
          <aside className={`side right${panelTab === 'find' ? '' : ' narrow-hidden'}`} aria-label="Find">
            <ItemSearch build={build} />
          </aside>
        </main>
      )}
      {/* Centred under the character: the links, then the copyright. */}
      <footer className="footer small muted">
        <div className="footer-links">
          <button type="button" className="link" onClick={() => setAboutOpen(true)}>About</button>
          <a className="support-link" href={SUPPORT.href} target="_blank" rel="noreferrer">Support Altrobe</a>
        </div>
        <span className="footer-note">{copyrightLine()} · A fan project, not affiliated with Blizzard Entertainment.</span>
      </footer>
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} features={features} hostedPrompt={hostedPrompt} />
    </div>
  )
}
