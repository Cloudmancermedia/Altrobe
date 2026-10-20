import { Stack, type StackProps } from 'aws-cdk-lib'
import type { Construct } from 'constructs'
import { PromptApi } from './prompt-api.js'

export interface PromptStackProps extends StackProps {
  /** The hostnames a Turnstile token may come from. */
  hostnames: string[]
}

// The hosted prompt box's API in a stack of its own, so it can deploy and be tested before the site
// routes to it, and so a deploy that doesn't know about it never removes it.
export class PromptStack extends Stack {
  readonly api: PromptApi

  constructor(scope: Construct, id: string, props: PromptStackProps) {
    super(scope, id, props)
    this.api = new PromptApi(this, 'PromptApi', { hostnames: props.hostnames })
  }
}
