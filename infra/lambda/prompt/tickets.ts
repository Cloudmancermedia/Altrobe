import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/**
 * What a ticket vouches for. It is issued with each step's response and is good for the next step
 * only, for two minutes, from the same IP address (hashed into the MAC, never into the ticket).
 */
export interface TicketClaims {
  commandId: string
  /** The step this ticket allows. */
  step: number
  /** Expiry, seconds since the epoch. */
  exp: number
  /** Commands the IP address had left when the command started. */
  remaining: number
  /** The conversation so far: digest() of the messages the next step must start with. */
  digest: string
}

const MAX_TICKET = 1024

const mac = (key: Buffer, c: TicketClaims, ipHash: string) =>
  createHmac('sha256', key).update([c.commandId, ipHash, c.step, c.exp, c.remaining, c.digest].join('|')).digest()

export function signTicket(key: Buffer, claims: TicketClaims, ipHash: string): string {
  const { commandId, step, exp, remaining, digest } = claims
  const payload = Buffer.from(JSON.stringify({ commandId, step, exp, remaining, digest })).toString('base64url')
  return `${payload}.${mac(key, claims, ipHash).toString('base64url')}`
}

/** The ticket's claims, or null when it is malformed, altered, from another IP address or expired. */
export function readTicket(key: Buffer, ticket: string, ipHash: string, nowSeconds: number): TicketClaims | null {
  if (ticket.length > MAX_TICKET) return null
  const [payload, signature, extra] = ticket.split('.')
  if (!payload || !signature || extra !== undefined) return null
  let c: TicketClaims
  try {
    c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!c || typeof c !== 'object' || typeof c.commandId !== 'string' || typeof c.digest !== 'string'
    || ![c.step, c.exp, c.remaining].every(Number.isInteger)) return null
  const expected = mac(key, c, ipHash)
  const given = Buffer.from(signature, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  if (nowSeconds > c.exp) return null
  return { commandId: c.commandId, step: c.step, exp: c.exp, remaining: c.remaining, digest: c.digest }
}

/** A SHA-256 of the messages as canonical JSON (keys sorted), so key order can't change it. */
export function digest(messages: unknown[]): string {
  return createHash('sha256').update(canonical(messages)).digest('base64url')
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object')
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(v) ?? 'null'
}
