import { ConverseCommand, type ConverseCommandOutput, type Message } from '@aws-sdk/client-bedrock-runtime'
import { SYSTEM, LATER_TOOLS, TOOLS } from './instructions.js'

/** Nova 2 Lite through the US cross-region inference profile. */
export const MODEL_ID = 'us.amazon.nova-2-lite-v1:0'
/** Cloudflare's siteverify call gives up after this (turnstile.ts). */
export const TURNSTILE_TIMEOUT_MS = 5_000
// One attempt, 15 seconds: a step takes about a second (benchmark, 2026-10-18), and a retry would run
// past the Lambda's 30 seconds before the spend is recorded (prompt-api.ts LAMBDA_TIMEOUT_SECONDS).
export const BEDROCK_CLIENT = { region: 'us-east-1', maxAttempts: 1, requestHandler: { requestTimeout: 15_000 } }
/** Dollars per million tokens for Nova 2 Lite on the us cross-region profile, from AWS's price list. */
const PRICE = { input: 0.33, output: 2.75 }
const MAX_TEXT = 200

export interface Bedrock { send(command: ConverseCommand): Promise<Pick<ConverseCommandOutput, 'output' | 'stopReason' | 'usage'>> }
export interface Usage { inputTokens?: number; outputTokens?: number }
export interface ToolUse { toolUseId: string; name: string; input: unknown }
export interface Reply {
  stop: 'tool_use' | 'end'
  toolUses: ToolUse[]
  text: string
  /** The model's message, trimmed to what the API returns: the text, then the tool calls. */
  message: { role: 'assistant'; content: ({ text: string } | { toolUse: ToolUse })[] }
}

/** A call's cost in millionths of a dollar, rounded up. */
export function costMicroUsd(usage: Usage | undefined): number {
  return Math.ceil((usage?.inputTokens ?? 0) * PRICE.input + (usage?.outputTokens ?? 0) * PRICE.output)
}

/**
 * Temperature 0 keeps outfit and customization commands predictable. Name requests run warmer: at 0 the
 * model lands on the same stock names, and the name lists refuse those (benchmarked 2026-10-19).
 */
export const NAME_TEMPERATURE = 0.8

/**
 * One model step. `start` makes the model call the start tool, which says whether the request is a new
 * look: the first step of a command that may change the look.
 */
export function converse(bedrock: Bedrock, messages: unknown[], creative = false, tools = true, start = false) {
  return bedrock.send(new ConverseCommand({
    modelId: MODEL_ID,
    system: [{ text: SYSTEM }],
    messages: messages as Message[],
    ...(tools ? { toolConfig: start ? { tools: TOOLS, toolChoice: { tool: { name: 'start' } } } : { tools: LATER_TOOLS } } : {}),
    inferenceConfig: { maxTokens: 600, temperature: creative ? NAME_TEMPERATURE : 0 },
  }))
}

/**
 * Keeps only the reply's text (at most 200 characters) and tool calls, so the API can't serve as a
 * general chatbot. Tool calls count only when the model stopped to use them.
 */
export function shapeReply(message: Message | { role: string; content?: unknown[] } | undefined, stopReason: string | undefined): Reply {
  const content = (message?.content ?? []) as Record<string, any>[]
  const joined = content.filter((c) => typeof c.text === 'string').map((c) => c.text as string).join(' ').replace(/\s+/g, ' ').trim()
  const text = Array.from(joined).slice(0, MAX_TEXT).join('').trim()
  const calls: ToolUse[] = content.filter((c) => c.toolUse).map((c) => ({ toolUseId: c.toolUse.toolUseId, name: c.toolUse.name, input: c.toolUse.input ?? {} }))
  const stop = stopReason === 'tool_use' && calls.length > 0 ? 'tool_use' : 'end'
  const toolUses = stop === 'tool_use' ? calls : []
  return {
    stop, toolUses, text,
    message: { role: 'assistant', content: [...(text ? [{ text }] : []), ...toolUses.map((toolUse) => ({ toolUse }))] },
  }
}
