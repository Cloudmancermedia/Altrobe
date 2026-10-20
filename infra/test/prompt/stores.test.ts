import { describe, expect, test } from 'vitest'
import { dynamoCounters } from '../../lambda/prompt/counters.js'
import { killSwitch, secretsLoader } from '../../lambda/prompt/settings.js'

type Cmd = { constructor: { name: string }; input: Record<string, any> }

// Enough of DynamoDB's UpdateItem and GetItem to run the counters' expressions on one number attribute.
function fakeDynamo() {
  const items = new Map<string, Record<string, any>>()
  const sent: Cmd[] = []
  return {
    items, sent,
    async send(cmd: Cmd) {
      sent.push(cmd)
      if (cmd.constructor.name === 'PutItemCommand') {
        const key = cmd.input.Item.pk.S as string
        if (items.has(key)) throw Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' })
        items.set(key, cmd.input.Item)
        return {}
      }
      const pk = cmd.input.Key.pk.S as string
      const item = items.get(pk)
      if (cmd.constructor.name === 'GetItemCommand') return { Item: item }
      const values = cmd.input.ExpressionAttributeValues
      const n = Number(item?.n?.N ?? 0)
      if (cmd.input.ConditionExpression && item && n >= Number(values[':limit'].N))
        throw Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' })
      const next = { pk: { S: pk }, n: { N: String(n + Number(values[':add'].N)) }, expiresAt: values[':exp'] }
      items.set(pk, next)
      return { Attributes: { n: next.n } }
    },
  }
}

describe('the DynamoDB counters', () => {
  test('count a command with a conditional update and a TTL, and refuse at the limit', async () => {
    const db = fakeDynamo()
    const c = dynamoCounters(db, 'table')
    expect(await c.countCommand('ip#a', 2, 1000)).toBe(1)
    expect(await c.countCommand('ip#a', 2, 1000)).toBe(2)
    expect(await c.countCommand('ip#a', 2, 1000)).toBeUndefined()
    const update = db.sent[0].input
    expect(update).toMatchObject({
      TableName: 'table',
      Key: { pk: { S: 'ip#a' } },
      UpdateExpression: 'ADD n :add SET expiresAt = :exp',
      ConditionExpression: 'attribute_not_exists(n) OR n < :limit',
      ExpressionAttributeValues: { ':add': { N: '1' }, ':limit': { N: '2' }, ':exp': { N: '1000' } },
      ReturnValues: 'UPDATED_NEW',
    })
  })

  test('keep the day\'s spend in micro-dollars, read consistently', async () => {
    const db = fakeDynamo()
    const c = dynamoCounters(db, 'table')
    expect(await c.spent('2026-10-20')).toBe(0)
    await c.addSpend('2026-10-20', 1265, 2000)
    await c.addSpend('2026-10-20', 1000, 2000)
    expect(await c.spent('2026-10-20')).toBe(2265)
    expect(db.sent.find((s) => s.constructor.name === 'GetItemCommand')?.input).toMatchObject({ Key: { pk: { S: 'spend#2026-10-20' } }, ConsistentRead: true })
  })

  test('mark a ticket used once, with a conditional put and a TTL', async () => {
    const db = fakeDynamo()
    const c = dynamoCounters(db, 'table')
    expect(await c.useTicket('ticket#cmd-1#2', 1_800_000_120)).toBe(true)
    expect(await c.useTicket('ticket#cmd-1#2', 1_800_000_120)).toBe(false)
    expect(await c.useTicket('ticket#cmd-1#3', 1_800_000_120)).toBe(true)
    const put = db.sent.find((x) => x.constructor.name === 'PutItemCommand')!
    expect(put.input).toMatchObject({ TableName: 'table', ConditionExpression: 'attribute_not_exists(pk)', Item: { expiresAt: { N: '1800000120' } } })
  })

  test('pass on errors other than the limit', async () => {
    const c = dynamoCounters({ send: async () => { throw Object.assign(new Error('x'), { name: 'ProvisionedThroughputExceededException' }) } }, 't')
    await expect(c.countCommand('k', 1, 1)).rejects.toThrow('x')
  })
})

describe('the kill switch', () => {
  test('reads the parameter, caches it for 30 seconds, and treats only "off" as off', async () => {
    let value = 'on'
    let reads = 0
    let now = 0
    const ssm = { send: async (cmd: Cmd) => { reads++; expect(cmd.input).toEqual({ Name: '/switch' }); return { Parameter: { Value: value } } } }
    const enabled = killSwitch(ssm, '/switch', () => now)
    expect(await enabled()).toBe(true)
    value = ' OFF '
    expect(await enabled()).toBe(true)
    now = 30_001
    expect(await enabled()).toBe(false)
    expect(reads).toBe(2)
  })

  test('keeps the last value when SSM fails, and is off when it never read one', async () => {
    let fail = false
    let now = 0
    const ssm = { send: async () => { if (fail) throw new Error('ssm down'); return { Parameter: { Value: 'on' } } } }
    const enabled = killSwitch(ssm, '/switch', () => now)
    expect(await enabled()).toBe(true)
    fail = true
    now = 60_000
    expect(await enabled()).toBe(true)
    expect(await killSwitch(ssm, '/switch', () => 0)()).toBe(false)
  })
})

describe('the secrets', () => {
  test('are read once, and again after a failed read', async () => {
    const values: Record<string, string> = { ts: 'turnstile', hmac: 'a'.repeat(64), origin: 'o' }
    let reads = 0
    let fail = true
    const sm = { send: async (cmd: Cmd) => { reads++; if (fail) throw new Error('down'); return { SecretString: values[cmd.input.SecretId] } } }
    const load = secretsLoader(sm, { turnstileSecret: 'ts', hmacKey: 'hmac', originSecret: 'origin' })
    await expect(load()).rejects.toThrow('down')
    fail = false
    const s = await load()
    expect(s.turnstileSecret).toBe('turnstile')
    expect(s.originSecret).toBe('o')
    expect(s.hmacKey.length).toBeGreaterThanOrEqual(32)
    const before = reads
    await load()
    expect(reads).toBe(before)
  })
})
