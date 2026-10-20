// The hosted prompt box's agent loop (docs/hosted-prompt-box.md). One typed command is one to
// MAX_STEPS requests to POST /api/prompt: the first carries a Turnstile token, each later one the
// ticket the last answer gave. The API relays one model step; the browser runs the tool calls it
// returns and sends their results back with the next step.
import type { ToolOutcome } from './hosted-tools'

export const MAX_STEPS = 8
/**
 * The most a tool result may add to the conversation, in characters of JSON. The browser resends the
 * whole conversation each step and the API refuses bodies over 64 KB, so 8 steps of results must fit.
 */
export const MAX_RESULT_CHARS = 4_000

/** Shortens the result's longest list until it fits, and says so, so the model knows there was more. */
export function fitResult(json: Record<string, unknown>): Record<string, unknown> {
  let out = json
  while (JSON.stringify(out).length > MAX_RESULT_CHARS) {
    const lists = Object.entries(out).filter(([, v]) => Array.isArray(v) && v.length > 0) as [string, unknown[]][]
    if (lists.length === 0) return { error: 'The result was too large to send back.' }
    const [key, list] = lists.reduce((a, b) => (JSON.stringify(b[1]).length > JSON.stringify(a[1]).length ? b : a))
    out = { ...out, [key]: list.slice(0, Math.max(0, Math.floor(list.length / 2))), truncated: true }
  }
  return out
}
export const PROMPT_URL = '/api/prompt'

type Content = Record<string, unknown>
interface Message { role: 'user' | 'assistant'; content: Content[] }
interface ToolUse { toolUseId: string; name: string; input: Record<string, unknown> }
interface StepResponse {
  ticket: string
  stop: 'tool_use' | 'end'
  toolUses: ToolUse[]
  message: Message
  text: string
  remaining: number
  resetAt: string
}

export interface Quota { remaining: number; resetAt: string }

/** How a command ended. Each kind is one state of the box. */
export type HostedResult =
  | ({ kind: 'done'; text: string } & Quota)
  /** ip_limit or daily_cap: no more commands until resetAt. */
  | { kind: 'closed'; code: 'ip_limit' | 'daily_cap'; resetAt: string; message: string }
  | { kind: 'busy' }
  /** The kill switch is on. */
  | { kind: 'disabled' }
  | { kind: 'stopped' }
  | { kind: 'failed'; code: string; message: string }

/** What a command is doing now, for the box's status line. Idle once it ends, however it ends. */
export type HostedPhase =
  | { kind: 'checking' }
  | { kind: 'thinking'; step: number }
  | { kind: 'tool'; tool: string; input: Record<string, unknown> }
  | { kind: 'idle' }

export interface HostedOptions {
  fetch?: typeof fetch
  url?: string
  /** A fresh Turnstile token; called once per command. */
  getToken: () => Promise<string>
  /** Runs one tool call. `command` is the same number for every call in one command and new for the next. */
  runTool: (name: string, input: Record<string, unknown>, command?: number) => Promise<ToolOutcome>
  /** Before each tool call, for the box's step list. */
  onStep?: (name: string, input: Record<string, unknown>) => void
  /** The model's short reply text, when a step has any. */
  onText?: (text: string) => void
  /** Each stage as it starts: the Turnstile check, each model step, each tool call; then idle. */
  onPhase?: (phase: HostedPhase) => void
  onQuota?: (q: Quota) => void
  signal?: AbortSignal
  /** A name request (Suggest names): the API runs the model less predictably, for varied names. */
  creative?: boolean
  /** False for a text-only request: the API offers the model no tools, so it can only write text. */
  tools?: boolean
}

const MESSAGES: Record<string, string> = {
  model: "The model didn't answer. Try again.",
  network: "Couldn't reach the prompt service. Try again in a moment.",
  turnstile: "The check that you're human didn't pass. Try again.",
  too_many_steps: 'That took too many steps. Try a shorter request.',
}

const failed = (code: string, message?: string): HostedResult => ({ kind: 'failed', code, message: message || MESSAGES[code] || 'Something went wrong. Try again.' })

function errorResult(status: number, body: { error?: string; message?: string; resetAt?: string } | null): HostedResult {
  // A throttle from API Gateway or Lambda comes without the API's error code (docs/hosted-prompt-box.md).
  if (!body?.error && (status === 429 || status >= 500)) return { kind: 'busy' }
  const code = body?.error ?? `http_${status}`
  switch (code) {
    case 'ip_limit':
    case 'daily_cap':
      return { kind: 'closed', code, resetAt: body?.resetAt ?? '', message: body?.message ?? '' }
    case 'busy': return { kind: 'busy' }
    case 'disabled': return { kind: 'disabled' }
    // Bedrock's own error text means nothing to a player.
    case 'model': return failed('model')
    default: return failed(code, body?.message)
  }
}

const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError'

// Numbers commands, so the tools can hold a limit or a list to one command.
let commandCount = 0

/** Runs one typed command to the end. It never throws; every outcome is a HostedResult. */
export async function runHostedCommand(text: string, o: HostedOptions): Promise<HostedResult> {
  try {
    return await runSteps(text, o, ++commandCount)
  } finally {
    o.onPhase?.({ kind: 'idle' })
  }
}

async function runSteps(text: string, o: HostedOptions, command: number): Promise<HostedResult> {
  const post = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const messages: Message[] = [{ role: 'user', content: [{ text }] }]
  let ticket: string | undefined

  for (let step = 1; step <= MAX_STEPS; step++) {
    let body: Record<string, unknown>
    if (step === 1) {
      let token: string
      o.onPhase?.({ kind: 'checking' })
      try {
        token = await o.getToken()
      } catch (e) {
        if (isAbort(e) || o.signal?.aborted) return { kind: 'stopped' }
        return failed('turnstile')
      }
      body = { messages, turnstileToken: token }
    } else {
      body = { messages, ticket }
    }
    if (o.creative) body.creative = true
    if (o.tools === false) body.tools = false

    let res: Response
    let data: unknown
    o.onPhase?.({ kind: 'thinking', step })
    try {
      res = await post(o.url ?? PROMPT_URL, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: o.signal,
      })
      data = await res.json().catch(() => null)
    } catch (e) {
      return isAbort(e) || o.signal?.aborted ? { kind: 'stopped' } : failed('network')
    }
    if (!res.ok) return errorResult(res.status, data as { error?: string } | null)
    const r = data as StepResponse | null
    // Anything but the contract's shape (such as index.html from a missing route) is a failure to reach the API.
    if (!r || typeof r !== 'object' || !r.message || !Array.isArray(r.toolUses)) return failed('network')

    ticket = r.ticket
    o.onQuota?.({ remaining: r.remaining, resetAt: r.resetAt })
    if (r.text) o.onText?.(r.text)
    messages.push(r.message)
    if (r.stop !== 'tool_use' || r.toolUses.length === 0) return { kind: 'done', text: r.text ?? '', remaining: r.remaining, resetAt: r.resetAt }

    const results: Content[] = []
    for (const use of r.toolUses) {
      if (o.signal?.aborted) return { kind: 'stopped' }
      o.onStep?.(use.name, use.input ?? {})
      o.onPhase?.({ kind: 'tool', tool: use.name, input: use.input ?? {} })
      const out = await o.runTool(use.name, use.input ?? {}, command)
      results.push({ toolResult: { toolUseId: use.toolUseId, content: [{ json: fitResult(out.json) }], status: out.status } })
    }
    if (o.signal?.aborted) return { kind: 'stopped' }
    messages.push({ role: 'user', content: results })
  }
  // The last step's tool calls have run, so the view shows what the model chose; the model just
  // can't see their results or say it's done.
  return failed('too_many_steps')
}

/** The reset time in the reader's own time zone, such as "3:00 PM". */
export function resetTimeLabel(iso: string, opts: { locale?: string; timeZone?: string } = {}): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '13:00 UTC'
  return d.toLocaleTimeString(opts.locale ?? [], { hour: 'numeric', minute: '2-digit', timeZone: opts.timeZone })
}

/** What the box says while the daily limits keep it closed. */
export function closedText(code: 'ip_limit' | 'daily_cap', resetAt: string, opts: { locale?: string; timeZone?: string } = {}): string {
  const at = resetTimeLabel(resetAt, opts)
  return code === 'daily_cap'
    ? `The free daily budget is used up; it reopens at ${at}.`
    : `You've used today's free commands. More at ${at}.`
}

/** Commands per player per day: the prompt API's IP_LIMIT, which it doesn't send. */
export const DAILY_COMMANDS = 20

/** The top bar's AI counter: what's left today, or when a closed box reopens; nothing before the first command. */
export function quotaText(q: Quota | null, closed: { code: 'ip_limit' | 'daily_cap'; resetAt: string } | null, opts: { locale?: string; timeZone?: string } = {}): string {
  if (closed) return closedText(closed.code, closed.resetAt, opts)
  return q ? `AI: ${q.remaining} of ${DAILY_COMMANDS} left today` : ''
}
