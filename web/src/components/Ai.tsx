import { useEffect, useState } from 'react'
import { store } from '../app-state'
import { quotaText, savedQuota } from '../assistant/hosted'
import { statusText } from '../assistant/status'
import { useStore } from '../store'

/** On a button that spends one of the daily AI commands. Screen readers hear what it means, not "AI". */
export function AiTag() {
  return <><span className="badge" aria-hidden="true">AI</span><span className="visually-hidden">, uses an AI command</span></>
}

/** The running command's status line (phase and seconds), in the panel that asked for it. */
export function AiStatus({ from }: { from: 'ask' | 'names' }) {
  const status = useStore(store, (s) => s.aiStatus)
  const [now, setNow] = useState(0)
  const mine = status?.from === from ? status : null
  useEffect(() => {
    // Until the first tick, `now` is from before this phase began, so the line shows no seconds yet.
    if (!mine) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [mine])
  if (!mine) return null
  return <p className="ai-status small" role="status"><span className="ai-pulse" aria-hidden="true" />{statusText(mine.phase, (now - mine.since) / 1000)}</p>
}

const QUOTA_KEY = 'altrobe.aiQuota'

/**
 * The top bar's share of today's AI allowance, shared by Ask and Suggest names. Kept in this browser, so a
 * reload shows what the last answer said rather than all of it.
 */
export function AiCounter() {
  const quota = useStore(store, (s) => s.aiQuota)
  const closed = useStore(store, (s) => s.aiClosed)
  useEffect(() => {
    if (quota) { try { globalThis.localStorage?.setItem(QUOTA_KEY, JSON.stringify(quota)) } catch { /* not kept */ } return }
    let raw: string | null = null
    try { raw = globalThis.localStorage?.getItem(QUOTA_KEY) ?? null } catch { /* none kept */ }
    const kept = savedQuota(raw, new Date())
    if (kept) store.set({ aiQuota: kept })
  }, [quota])
  // A count from before the daily reset is no longer true, so it goes until the next answer.
  useEffect(() => {
    if (!quota) return
    const wait = new Date(quota.resetAt).getTime() - Date.now()
    if (!(wait > 0)) return
    const t = setTimeout(() => store.set({ aiQuota: null }), Math.min(wait, 24 * 3600_000))
    return () => clearTimeout(t)
  }, [quota])
  return <span className="small ai-counter">{quotaText(quota, closed)}</span>
}
