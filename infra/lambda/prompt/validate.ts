// Request checks from docs/hosted-prompt-box.md. Everything here answers 400 bad_request.
export const MAX_BODY_BYTES = 64 * 1024
export const MAX_MESSAGES = 17
export const MAX_TEXT = 500
const MAX_TOKEN = 2048

export type Message = { role: 'user' | 'assistant'; content: Record<string, any>[] }

export type PromptRequest =
  | { kind: 'first'; messages: Message[]; text: string; turnstileToken: string; creative: boolean; tools: boolean }
  | { kind: 'later'; messages: Message[]; step: number; ticket: string; creative: boolean; tools: boolean }

const isObject = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v)
const onlyKeys = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every((k) => keys.includes(k))

/** The parsed request, or a reason it is refused (for the logs; the reason never holds user text). */
export function parseRequest(body: string): PromptRequest | { invalid: string } {
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) return { invalid: 'too_large' }
  let req: unknown
  try { req = JSON.parse(body) } catch { return { invalid: 'json' } }
  if (!isObject(req) || !Array.isArray(req.messages)) return { invalid: 'shape' }
  const messages = req.messages as unknown[]
  if (messages.length < 1 || messages.length > MAX_MESSAGES) return { invalid: 'message_count' }
  if (messages.length % 2 === 0) return { invalid: 'message_count' }
  for (const [i, m] of messages.entries()) {
    if (!isObject(m) || !onlyKeys(m, ['role', 'content']) || m.role !== (i % 2 === 0 ? 'user' : 'assistant')) return { invalid: 'roles' }
    if (!Array.isArray(m.content) || m.content.length === 0 || !m.content.every(isObject)) return { invalid: 'content' }
  }
  const typed = messages as Message[]
  // A name request (the Identity panel's Suggest names) asks for a less predictable model; nothing else changes.
  if (req.creative !== undefined && typeof req.creative !== 'boolean') return { invalid: 'creative' }
  const creative = req.creative === true
  // A text-only request (the Identity panel's Polish) gets no tools, so the model can only write text. Such a
  // command ends in one step, so a later step never asks for it.
  if (req.tools !== undefined && req.tools !== false) return { invalid: 'tools' }
  const tools = req.tools !== false
  if (!tools && typed.length > 1) return { invalid: 'tools' }

  // The first message must be the typed text and nothing else.
  const opening = typed[0].content
  if (opening.length !== 1 || !onlyKeys(opening[0], ['text']) || typeof opening[0].text !== 'string') return { invalid: 'opening' }
  const text = opening[0].text as string
  if (!text.trim()) return { invalid: 'empty_text' }
  if (Array.from(text).length > MAX_TEXT) return { invalid: 'text_too_long' }

  if (typed.length === 1) {
    const token = req.turnstileToken
    if (typeof token !== 'string' || !token || token.length > MAX_TOKEN) return { invalid: 'turnstile_token' }
    return { kind: 'first', messages: typed, text, turnstileToken: token, creative, tools }
  }

  const ticket = req.ticket
  if (typeof ticket !== 'string' || !ticket) return { invalid: 'ticket_missing' }
  // The last message answers the model's last tool calls: one tool result for each, nothing else.
  // Earlier messages are covered by the ticket's digest.
  const asked = typed[typed.length - 2].content.filter((c) => isObject(c.toolUse)).map((c) => c.toolUse.toolUseId)
  const results = typed[typed.length - 1].content
  if (!results.every(isToolResult)) return { invalid: 'tool_results' }
  const answered = results.map((r) => r.toolResult.toolUseId)
  if (asked.length !== answered.length || [...asked].sort().join('\n') !== [...answered].sort().join('\n')) return { invalid: 'tool_results' }
  return { kind: 'later', messages: typed, step: (typed.length + 1) / 2, ticket, creative, tools }
}

function isToolResult(c: Record<string, any>): boolean {
  if (!onlyKeys(c, ['toolResult']) || !isObject(c.toolResult)) return false
  const r = c.toolResult
  if (!onlyKeys(r, ['toolUseId', 'content', 'status']) || typeof r.toolUseId !== 'string') return false
  if (r.status !== undefined && r.status !== 'success' && r.status !== 'error') return false
  return Array.isArray(r.content) && r.content.every((b: unknown) => isObject(b) && onlyKeys(b, ['json', 'text'])
    && Object.keys(b).length === 1 && (typeof b.text === 'string' || (typeof b.json === 'object' && b.json !== null)))
}
