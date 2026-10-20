import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import { GetParameterCommand } from '@aws-sdk/client-ssm'

export interface Secrets {
  turnstileSecret: string
  /** The root of every HMAC key: the daily IP-hash keys and the ticket key derive from it. */
  hmacKey: Buffer
  /** The header value CloudFront adds, so requests that skip CloudFront are refused. */
  originSecret: string
}

interface Send { send(command: any): Promise<any> }

/** Reads the secrets once per Lambda instance; a failed read is retried on the next request. */
export function secretsLoader(sm: Send, ids: { turnstileSecret: string; hmacKey: string; originSecret: string }): () => Promise<Secrets> {
  let pending: Promise<Secrets> | undefined
  const read = async (id: string) => {
    const r = await sm.send(new GetSecretValueCommand({ SecretId: id }))
    if (!r.SecretString) throw new Error(`Secret ${id} has no value`)
    return r.SecretString as string
  }
  return () => {
    pending ??= Promise.all([read(ids.turnstileSecret), read(ids.hmacKey), read(ids.originSecret)])
      .then(([turnstileSecret, hmacKey, originSecret]) => ({ turnstileSecret, hmacKey: Buffer.from(hmacKey, 'utf8'), originSecret }))
      .catch((e) => { pending = undefined; throw e })
    return pending
  }
}

const CACHE_MS = 30_000

/**
 * The kill switch: an SSM parameter, cached for 30 seconds. Only `off` turns the box off. If SSM
 * can't be read, the last value stands; with none yet, the box stays off.
 */
export function killSwitch(ssm: Send, name: string, now: () => number = Date.now): () => Promise<boolean> {
  let cached: { enabled: boolean; at: number } | undefined
  return async () => {
    if (cached && now() - cached.at < CACHE_MS) return cached.enabled
    try {
      const r = await ssm.send(new GetParameterCommand({ Name: name }))
      cached = { enabled: String(r.Parameter?.Value ?? '').trim().toLowerCase() !== 'off', at: now() }
    } catch {
      if (!cached) return false
    }
    return cached.enabled
  }
}
