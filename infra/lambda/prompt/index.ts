// The Lambda entry point: wires the handler to AWS. Configuration comes from the environment the
// CDK stack sets (infra/src/prompt-api.ts).
import { randomUUID } from 'node:crypto'
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { SSMClient } from '@aws-sdk/client-ssm'
import { dynamoCounters } from './counters.js'
import { createHandler } from './handler.js'
import { BEDROCK_CLIENT } from './model.js'
import { killSwitch, secretsLoader } from './settings.js'

const env = (name: string) => {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set`)
  return v
}

export const handler = createHandler({
  now: () => new Date(),
  counters: dynamoCounters(new DynamoDBClient({}), env('TABLE_NAME')),
  // The inference profile lives in us-east-1 and routes within the US.
  bedrock: new BedrockRuntimeClient(BEDROCK_CLIENT),
  fetch: globalThis.fetch,
  secrets: secretsLoader(new SecretsManagerClient({}), {
    turnstileSecret: env('TURNSTILE_SECRET_ID'), hmacKey: env('HMAC_KEY_SECRET_ID'), originSecret: env('ORIGIN_SECRET_ID'),
  }),
  enabled: killSwitch(new SSMClient({}), env('SWITCH_PARAMETER')),
  randomId: randomUUID,
  log: (entry) => console.log(JSON.stringify({ event: 'prompt', ...entry })),
  config: { hostnames: env('TURNSTILE_HOSTNAMES').split(','), action: env('TURNSTILE_ACTION') },
})
