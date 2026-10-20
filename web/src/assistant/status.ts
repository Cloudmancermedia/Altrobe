// The prompt box's status line: what the AI is doing now (hosted.ts HostedPhase), so a wait for Turnstile
// or the model never looks like nothing is happening.
import { stepLabel } from './events'
import type { HostedPhase } from './hosted'

export function statusText(phase: HostedPhase, seconds: number): string {
  const what = phase.kind === 'checking' ? "Checking you're human…"
    : phase.kind === 'thinking' ? (phase.step === 1 ? 'Thinking…' : 'Thinking about the next step…')
    : phase.kind === 'tool' ? `${stepLabel({ type: 'step', tool: phase.tool, arguments: phase.input })}…`
    : ''
  return what && seconds >= 1 ? `${what} ${Math.floor(seconds)}s` : what
}
