import { createHmac, timingSafeEqual } from 'node:crypto'
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import type { Counters } from './counters.js'
import { dayOf, isoSeconds } from './day.js'
import { rateKey, viewerIp } from './ip.js'
import { converse, costMicroUsd, shapeReply, type Bedrock } from './model.js'
import type { Secrets } from './settings.js'
import { digest, readTicket, signTicket } from './tickets.js'
import { verifyTurnstile, type Fetch } from './turnstile.js'
import { parseRequest } from './validate.js'

export const PATH = '/api/prompt'
export const ORIGIN_HEADER = 'x-altrobe-origin'
// Model steps a day per IP address: a simple command costs a few, a big comparison more (decided 2026-10-21;
// it replaced 20 commands a day). The check is at a command's start, so one that starts within it finishes.
export const DAILY_STEPS = 100
const DAILY_CAP_MICRO_USD = 25_000_000
// Eleven steps of work, plus start. Nine ran out on ordinary commands (2026-10-21).
const MAX_STEPS = 12
const TICKET_SECONDS = 120
/** How long a day's spend total is kept after the day ends. */
const SPEND_KEPT_SECONDS = 7 * 86_400

export interface Deps {
  now(): Date
  counters: Counters
  bedrock: Bedrock
  fetch: Fetch
  secrets(): Promise<Secrets>
  /** False when the kill switch reads `off`. */
  enabled(): Promise<boolean>
  randomId(): string
  /** One structured entry per request. Never the IP address, the typed text or tool content. */
  log(entry: Record<string, unknown>): void
  config: { hostnames: string[]; action: string }
}

type ErrorCode = 'bad_request' | 'turnstile' | 'ip_limit' | 'daily_cap' | 'too_many_steps' | 'disabled' | 'unavailable' | 'model'
const ERRORS: Record<ErrorCode, [number, string]> = {
  bad_request: [400, "The prompt box couldn't read that request."],
  turnstile: [400, "Couldn't confirm you're human. Try again."],
  ip_limit: [429, "You've used today's AI allowance."],
  daily_cap: [429, 'The prompt box is closed for today.'],
  too_many_steps: [429, 'That took too many steps. Try something simpler.'],
  disabled: [503, 'The prompt box is off for now.'],
  unavailable: [503, 'The prompt box is having trouble. Try again in a moment.'],
  model: [502, "The model didn't answer. Try again."],
}

const json = (statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
})

const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest()

const sameSecret = (given: string | undefined, expected: string) => {
  const a = Buffer.from(given ?? '')
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function createHandler(deps: Deps) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    const started = Date.now()
    const entry: Record<string, unknown> = {}
    const now = deps.now()
    const day = dayOf(now)
    const resetAt = isoSeconds(day.resetAt)
    const fail = (code: ErrorCode, reason?: string) => {
      const [status, message] = ERRORS[code]
      deps.log({ ...entry, outcome: code, reason, ms: Date.now() - started })
      return json(status, { error: code, message, ...(code === 'ip_limit' || code === 'daily_cap' ? { resetAt } : {}) })
    }

    try {
      if (!(await deps.enabled())) return fail('disabled')
      const secrets = await deps.secrets()
      const headers = event.headers ?? {}
      if (!sameSecret(headers[ORIGIN_HEADER], secrets.originSecret)) return fail('bad_request', 'origin')
      if (event.requestContext?.http?.method !== 'POST' || event.rawPath !== PATH) return fail('bad_request', 'route')

      const body = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : event.body ?? ''
      const req = parseRequest(body)
      if ('invalid' in req) return fail('bad_request', req.invalid)
      const ip = viewerIp(headers, event.requestContext.http.sourceIp)
      if (!ip) return fail('bad_request', 'ip')
      const ipKey = rateKey(ip)
      const ticketKey = hmac(secrets.hmacKey, 'ticket')
      const ticketIp = hmac(ticketKey, `ip|${ipKey}`).toString('hex')
      const nowSeconds = Math.floor(now.getTime() / 1000)
      // The key changes daily, so yesterday's hashes can't be matched to today's.
      const stepsKey = `ip#${hmac(hmac(secrets.hmacKey, `ip|${day.id}`), ipKey).toString('hex')}`
      const stepsExpire = Math.floor(day.resetAt.getTime() / 1000)

      let step: number
      let remaining: number
      let commandId: string
      if (req.kind === 'later') {
        step = req.step
        entry.step = step
        const claims = readTicket(ticketKey, req.ticket, ticketIp, nowSeconds)
        if (!claims) return fail('bad_request', 'ticket')
        if (claims.step !== step || claims.digest !== digest(req.messages.slice(0, -1))) return fail('bad_request', 'ticket_conversation')
        if (step > MAX_STEPS) return fail('too_many_steps')
        ;({ commandId } = claims)
      } else {
        step = 1
        entry.step = step
      }

      if (await deps.counters.spent(day.id) >= DAILY_CAP_MICRO_USD) return fail('daily_cap')
      // Each step's ticket works once: replaying it, even with other tool results, would buy model calls.
      if (req.kind === 'later' && !(await deps.counters.useTicket(`ticket#${commandId!}#${step}`, nowSeconds + TICKET_SECONDS))) return fail('bad_request', 'ticket_used')
      if (req.kind === 'later') {
        // Counted, never refused: a command that started within the allowance finishes (at most MAX_STEPS over).
        const counted = await deps.counters.countCommand(stepsKey, DAILY_STEPS + MAX_STEPS, stepsExpire)
        remaining = Math.max(0, DAILY_STEPS - (counted ?? DAILY_STEPS))
      }

      if (req.kind === 'first') {
        const human = await verifyTurnstile(deps.fetch, {
          secret: secrets.turnstileSecret, token: req.turnstileToken, ip, hostnames: deps.config.hostnames, action: deps.config.action,
        })
        if (!human) return fail('turnstile')
        const counted = await deps.counters.countCommand(stepsKey, DAILY_STEPS, stepsExpire)
        if (counted === undefined) return fail('ip_limit')
        remaining = Math.max(0, DAILY_STEPS - counted)
        commandId = deps.randomId()
      }
      entry.command = commandId!

      let output
      try {
        // A name request doesn't change the look, so only other commands begin with start.
        output = await converse(deps.bedrock, req.messages, req.creative, req.tools, req.kind === 'first' && req.tools && !req.creative)
      } catch (e) {
        return fail('model', (e as Error).name)
      }
      const cost = costMicroUsd(output.usage)
      try {
        await deps.counters.addSpend(day.id, cost, Math.floor(day.resetAt.getTime() / 1000) + SPEND_KEPT_SECONDS)
      } catch (e) {
        entry.spendError = (e as Error).name
      }

      const reply = shapeReply(output.output?.message, output.stopReason)
      const ticket = signTicket(ticketKey, {
        commandId: commandId!, step: step + 1, exp: nowSeconds + TICKET_SECONDS, remaining: remaining!,
        digest: digest([...req.messages, reply.message]),
      }, ticketIp)
      deps.log({
        ...entry, outcome: 'ok', stop: reply.stop, tools: reply.toolUses.map((t) => t.name), stopReason: output.stopReason,
        inputTokens: output.usage?.inputTokens, outputTokens: output.usage?.outputTokens, microUsd: cost, ms: Date.now() - started,
      })
      return json(200, { ticket, stop: reply.stop, toolUses: reply.toolUses, message: reply.message, text: reply.text, remaining: remaining!, limit: DAILY_STEPS, resetAt })
    } catch (e) {
      // DynamoDB, Secrets Manager or SSM failing: retryable, and not the kill switch (which hides the box).
      return fail('unavailable', `internal:${(e as Error).name}`)
    }
  }
}
