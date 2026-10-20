import { GetItemCommand, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb'

/** The two daily counters, in one DynamoDB table keyed by `pk`, expiring through the `expiresAt` TTL. */
export interface Counters {
  /** Counts a command; the count after it, or undefined when the key had already reached the limit. */
  countCommand(key: string, limit: number, expiresAt: number): Promise<number | undefined>
  /** Today's Bedrock spend, in millionths of a dollar. */
  spent(dayId: string): Promise<number>
  addSpend(dayId: string, microUsd: number, expiresAt: number): Promise<void>
  /** Marks a ticket used; false when it already was, so each step's ticket works once. */
  useTicket(key: string, expiresAt: number): Promise<boolean>
}

export interface DynamoSend { send(command: any): Promise<any> }

export function dynamoCounters(db: DynamoSend, table: string): Counters {
  const add = (pk: string, amount: number, expiresAt: number, limit?: number) => db.send(new UpdateItemCommand({
    TableName: table,
    Key: { pk: { S: pk } },
    UpdateExpression: 'ADD n :add SET expiresAt = :exp',
    ...(limit === undefined ? {} : { ConditionExpression: 'attribute_not_exists(n) OR n < :limit' }),
    ExpressionAttributeValues: {
      ':add': { N: String(amount) }, ':exp': { N: String(expiresAt) },
      ...(limit === undefined ? {} : { ':limit': { N: String(limit) } }),
    },
    ReturnValues: 'UPDATED_NEW',
  }))
  return {
    async countCommand(key, limit, expiresAt) {
      try {
        const r = await add(key, 1, expiresAt, limit)
        return Number(r.Attributes?.n?.N)
      } catch (e) {
        if ((e as Error).name === 'ConditionalCheckFailedException') return undefined
        throw e
      }
    },
    async spent(dayId) {
      const r = await db.send(new GetItemCommand({ TableName: table, Key: { pk: { S: `spend#${dayId}` } }, ConsistentRead: true }))
      return Number(r.Item?.n?.N ?? 0)
    },
    async addSpend(dayId, microUsd, expiresAt) {
      await add(`spend#${dayId}`, microUsd, expiresAt)
    },
    async useTicket(key, expiresAt) {
      try {
        await db.send(new PutItemCommand({
          TableName: table,
          Item: { pk: { S: key }, expiresAt: { N: String(expiresAt) } },
          ConditionExpression: 'attribute_not_exists(pk)',
        }))
        return true
      } catch (e) {
        if ((e as Error).name === 'ConditionalCheckFailedException') return false
        throw e
      }
    },
  }
}
