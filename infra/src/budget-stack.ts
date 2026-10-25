import { Duration, Stack, type StackProps } from 'aws-cdk-lib'
import { CfnBudget, CfnBudgetsAction } from 'aws-cdk-lib/aws-budgets'
import { Alarm, ComparisonOperator, Metric, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch'
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions'
import { Topic } from 'aws-cdk-lib/aws-sns'
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions'
import { PROMPT_METRICS, PROMPT_METRICS_NAMESPACE } from './prompt-api.js'
import { Effect, ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam'
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources'
import type { Construct } from 'constructs'

// The prompt box's Bedrock backstop (docs/hosted-prompt-box.md, limit 7): $300 a month for launch
// weeks, raised with the daily cap on 2026-10-20 (it was $100 with a $10 cap). The daily cap ($25) is
// the real control; this catches the cap failing, and leaves room for about twelve full-cap days a
// month before it cuts Bedrock off.
export const BEDROCK_MONTHLY_LIMIT_USD = 300
// A quarter of the daily cap in one hour: at that rate the box closes for everyone within four hours, so
// the alarm comes while there is time to act (the kill switch, or a lower per-IP limit).
export const SPEND_ALARM_MICRO_USD_PER_HOUR = 6_250_000

export interface BudgetStackProps extends StackProps {
  /** Where the alerts go. Comes from the deploy environment, never the repository. */
  email: string
  monthlyLimitUsd: number
  /** The tag every Altrobe resource carries (app.ts); the budget counts only spend with it. */
  tag: { key: string; value: string }
  /** Changes on every deploy so the tag activation runs again (see below). */
  runId: string
  /** The monthly Bedrock spend past which the prompt API loses bedrock:InvokeModel. */
  bedrockMonthlyLimitUsd: number
  /** The prompt API's Lambda role (prompt-api.ts PROMPT_ROLE_NAME), by name so this stack never waits on AltrobeSite's outputs. */
  promptRoleName: string
}

// A monthly cost budget for Altrobe's own resources, so other spend in the account doesn't count.
export class BudgetStack extends Stack {
  constructor(scope: Construct, id: string, props: BudgetStackProps) {
    super(scope, id, props)
    const { email, tag } = props
    const alert = (notificationType: string, threshold: number): CfnBudget.NotificationWithSubscribersProperty => ({
      notification: { notificationType, comparisonOperator: 'GREATER_THAN', threshold, thresholdType: 'PERCENTAGE' },
      subscribers: [{ subscriptionType: 'EMAIL', address: email }],
    })

    new CfnBudget(this, 'Budget', {
      budget: {
        budgetName: 'altrobe-monthly',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: props.monthlyLimitUsd, unit: 'USD' },
        filterExpression: { tags: { key: tag.key, values: [tag.value], matchOptions: ['EQUALS'] } },
      },
      notificationsWithSubscribers: [alert('ACTUAL', 80), alert('FORECASTED', 100)],
    })

    // A budget sees a tag only once it is activated for cost allocation, and AWS lists a new tag key
    // for activation up to 24 hours after resources first carry it. Activating an active tag does
    // nothing and an unknown one is reported, not thrown, so this runs on every deploy and takes
    // effect on the first deploy after AWS has seen the tag.
    const call = {
      service: 'CostExplorer',
      action: 'updateCostAllocationTagsStatus',
      parameters: { CostAllocationTagsStatus: [{ TagKey: tag.key, Status: 'Active' }] },
      region: 'us-east-1',
      physicalResourceId: PhysicalResourceId.of(`cost-tag-${tag.key}-${props.runId}`),
    }
    new AwsCustomResource(this, 'ActivateCostTag', {
      onCreate: call,
      onUpdate: call,
      policy: AwsCustomResourcePolicy.fromStatements([
        new PolicyStatement({ actions: ['ce:UpdateCostAllocationTagsStatus'], resources: ['*'] }),
      ]),
      installLatestAwsSdk: false,
    })

    // The prompt box's last line of defence (docs/hosted-prompt-box.md, limit 7). Bedrock calls on an
    // inference profile carry no tags, so this budget counts the account's whole Bedrock service.
    // Past it, Budgets attaches a policy denying bedrock:InvokeModel to the prompt API's role, with no
    // approval; it stays attached until reversed by hand (docs/deployment.md).
    const bedrockBudget = new CfnBudget(this, 'BedrockBudget', {
      budget: {
        budgetName: 'altrobe-bedrock-monthly',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: props.bedrockMonthlyLimitUsd, unit: 'USD' },
        filterExpression: { dimensions: { key: 'SERVICE', values: ['Amazon Bedrock'] } },
      },
      notificationsWithSubscribers: [alert('ACTUAL', 80)],
    })
    const denyBedrock = new ManagedPolicy(this, 'DenyBedrock', {
      managedPolicyName: 'altrobe-prompt-deny-bedrock',
      description: 'Attached by the altrobe-bedrock-monthly budget action: stops the prompt API calling Bedrock.',
      statements: [new PolicyStatement({ effect: Effect.DENY, actions: ['bedrock:InvokeModel'], resources: ['*'] })],
    })
    const promptRoleArn = this.formatArn({ service: 'iam', region: '', resource: 'role', resourceName: props.promptRoleName })
    // Budgets' service role (docs.aws.amazon.com/cost-management/latest/userguide/budgets-action-role.html),
    // narrowed to attaching and detaching this one policy on this one role.
    const actionRole = new Role(this, 'BudgetActionRole', {
      assumedBy: new ServicePrincipal('budgets.amazonaws.com').withConditions({
        StringEquals: { 'aws:SourceAccount': this.account },
        ArnLike: { 'aws:SourceArn': `arn:${this.partition}:budgets::${this.account}:budget/*` },
      }),
    })
    actionRole.addToPolicy(new PolicyStatement({
      actions: ['iam:AttachRolePolicy', 'iam:DetachRolePolicy'],
      resources: [promptRoleArn],
      conditions: { ArnEquals: { 'iam:PolicyARN': denyBedrock.managedPolicyArn } },
    }))
    const action = new CfnBudgetsAction(this, 'DenyBedrockAction', {
      budgetName: 'altrobe-bedrock-monthly',
      actionType: 'APPLY_IAM_POLICY',
      approvalModel: 'AUTOMATIC',
      notificationType: 'ACTUAL',
      actionThreshold: { type: 'PERCENTAGE', value: 100 },
      definition: { iamActionDefinition: { policyArn: denyBedrock.managedPolicyArn, roles: [props.promptRoleName] } },
      executionRoleArn: actionRole.roleArn,
      subscribers: [{ type: 'EMAIL', address: email }],
    })
    // The budget and the role's policy must exist before Budgets checks it can run the action.
    action.node.addDependency(bedrockBudget, actionRole)

    // The prompt API's alarms, on the metrics AltrobePrompt counts from its logs (prompt-api.ts), by name.
    // Budgets lag by hours; these come within minutes. AWS emails once to confirm the subscription.
    const topic = new Topic(this, 'PromptAlarms', { displayName: 'Altrobe prompt box' })
    topic.addSubscription(new EmailSubscription(email))
    const alarm = (id: string, metricName: string, period: Duration, threshold: number, comparisonOperator: ComparisonOperator, description: string) => {
      const a = new Alarm(this, id, {
        metric: new Metric({ namespace: PROMPT_METRICS_NAMESPACE, metricName, statistic: 'Sum', period }),
        threshold, comparisonOperator, evaluationPeriods: 1,
        treatMissingData: TreatMissingData.NOT_BREACHING,
        alarmDescription: description,
      })
      a.addAlarmAction(new SnsAction(topic))
    }
    alarm('DailyCapAlarm', PROMPT_METRICS.dailyCap, Duration.minutes(5), 1, ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      "The prompt box reached the day's spend cap and is closed for everyone until 13:00 UTC.")
    alarm('SpendAlarm', PROMPT_METRICS.spend, Duration.hours(1), SPEND_ALARM_MICRO_USD_PER_HOUR, ComparisonOperator.GREATER_THAN_THRESHOLD,
      "The prompt box spent over a quarter of the day's cap in an hour.")
    alarm('SpendErrorAlarm', PROMPT_METRICS.spendErrors, Duration.minutes(5), 1, ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      "A prompt box step's spend failed to save, so the daily cap undercounts.")
  }
}
