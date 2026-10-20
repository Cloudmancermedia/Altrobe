// The prompt box's day runs from 13:00 UTC to 13:00 UTC: both daily limits reset then.
const RESET_HOUR_UTC = 13
const DAY_MS = 86_400_000

export interface Day {
  /** The date the day started on, YYYY-MM-DD: the key for that day's counters. */
  id: string
  /** When the limits reset: the next 13:00 UTC. */
  resetAt: Date
}

export function dayOf(now: Date): Day {
  let start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), RESET_HOUR_UTC)
  if (start > now.getTime()) start -= DAY_MS
  return { id: new Date(start).toISOString().slice(0, 10), resetAt: new Date(start + DAY_MS) }
}

/** `2026-10-20T13:00:00Z`: ISO 8601 without milliseconds. */
export const isoSeconds = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z')
