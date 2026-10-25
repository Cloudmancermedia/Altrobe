import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { App } from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { describe, expect, test } from 'vitest'
import { CiStack, DEPLOY_ROLE_NAME, DIFF_ROLE_NAME, GITHUB_SUBJECT, PUBLISH_ROLE_NAME } from '../src/ci-stack.js'
import { DnsStack } from '../src/dns-stack.js'
import { BEDROCK_MONTHLY_LIMIT_USD, BudgetStack, SPEND_ALARM_MICRO_USD_PER_HOUR } from '../src/budget-stack.js'
import { PromptStack } from '../src/prompt-stack.js'
import { SiteStack } from '../src/site-stack.js'
import { API_DOMAIN_PARAMETER, PROMPT_METRICS, PROMPT_METRICS_NAMESPACE, PROMPT_ROLE_NAME, SWITCH_PARAMETER } from '../src/prompt-api.js'

const env = { account: '123456789012', region: 'us-east-1' }
// The repository's immutable OIDC subject, as app.ts deploys it: owner and repository, each with its ID.
const subject = GITHUB_SUBJECT

function stacks(opts: { createOidcProvider?: boolean; webDistPath?: string } = {}) {
  const app = new App()
  const dns = new DnsStack(app, 'AltrobeDns', { env, domainName: 'altrobe.com' })
  const ci = new CiStack(app, 'AltrobeCi', { env, subject, createOidcProvider: opts.createOidcProvider })
  const prompt = new PromptStack(app, 'AltrobePrompt', { env, hostnames: ['altrobe.com', 'www.altrobe.com'] })
  const site = new SiteStack(app, 'AltrobeSite', { env, zone: dns.zone, domainName: 'altrobe.com', deployRoleName: DEPLOY_ROLE_NAME, publishRoleName: PUBLISH_ROLE_NAME, webDistPath: opts.webDistPath })
  return { dns: Template.fromStack(dns), ci: Template.fromStack(ci), site: Template.fromStack(site), siteStack: site, prompt: Template.fromStack(prompt) }
}

function webDist() {
  const dir = mkdtempSync(join(tmpdir(), 'altrobe-web-'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Altrobe</title>')
  return dir
}

describe('AltrobeDns', () => {
  test('creates the altrobe.com zone and outputs its nameservers for the registrar', () => {
    const { dns } = stacks()
    dns.hasResourceProperties('AWS::Route53::HostedZone', { Name: 'altrobe.com.' })
    expect(Object.keys(dns.findOutputs('*', { Value: Match.objectLike({ 'Fn::Join': Match.anyValue() }) }))).not.toHaveLength(0)
  })
})

describe('AltrobeCi', () => {
  test("uses the account's existing GitHub OIDC provider unless asked to create one", () => {
    // CI deploys with no context, so the default must be the provider the account already has.
    const { ci } = stacks()
    ci.resourceCountIs('AWS::IAM::OIDCProvider', 0)
    expect(JSON.stringify(ci.findResources('AWS::IAM::Role'))).toContain(':oidc-provider/token.actions.githubusercontent.com')
    stacks({ createOidcProvider: true }).ci.hasResourceProperties('AWS::IAM::OIDCProvider', {
      Url: 'https://token.actions.githubusercontent.com', ClientIdList: ['sts.amazonaws.com'],
    })
  })

  test('the deploy role trusts only this repository in the production environment', () => {
    stacks().ci.hasResourceProperties('AWS::IAM::Role', {
      RoleName: DEPLOY_ROLE_NAME,
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: [Match.objectLike({
          Action: 'sts:AssumeRoleWithWebIdentity',
          Condition: {
            StringEquals: {
              'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
              'token.actions.githubusercontent.com:sub': `${subject}:environment:production`,
            },
          },
        })],
      }),
    })
  })

  test('the publish role trusts only workflows running on main, with no environment approval', () => {
    stacks().ci.hasResourceProperties('AWS::IAM::Role', {
      RoleName: PUBLISH_ROLE_NAME,
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: [Match.objectLike({
          Action: 'sts:AssumeRoleWithWebIdentity',
          Condition: {
            StringEquals: {
              'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
              'token.actions.githubusercontent.com:sub': `${subject}:ref:refs/heads/main`,
            },
          },
        })],
      }),
    })
  })

  test('the publish role may not assume the CDK bootstrap roles', () => {
    const { ci } = stacks()
    const roles = ci.findResources('AWS::IAM::Role', { Properties: { RoleName: PUBLISH_ROLE_NAME } })
    const [id] = Object.keys(roles)
    const policies = Object.values(ci.findResources('AWS::IAM::Policy')).filter((p) => JSON.stringify(p.Properties.Roles).includes(id))
    expect(policies).toHaveLength(0)
  })

  test('the diff role trusts this repository only and may assume only the CDK lookup role', () => {
    const { ci } = stacks()
    ci.hasResourceProperties('AWS::IAM::Role', {
      RoleName: DIFF_ROLE_NAME,
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: [Match.objectLike({
          Condition: {
            StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
            StringLike: { 'token.actions.githubusercontent.com:sub': `${subject}:*` },
          },
        })],
      }),
    })
    const policies = ci.findResources('AWS::IAM::Policy')
    const diff = Object.values(policies).find((p) => JSON.stringify(p).includes(DIFF_ROLE_NAME) || JSON.stringify(p.Properties.Roles).includes('DiffRole'))
    const text = JSON.stringify(diff)
    expect(text).toContain('cdk-hnb659fds-lookup-role')
    expect(text).not.toContain('cdk-hnb659fds-deploy-role')
  })

  test('trust keys only on aud and the immutable sub, which names the owner and repository by ID', () => {
    // GitHub gives repositories created after 2026-07-15 an immutable subject (owner@id/repo@id), so a
    // deleted name can't be reclaimed into these roles. Recreating the repository changes the IDs.
    const roles = Object.values(stacks().ci.findResources('AWS::IAM::Role'))
    expect(roles).toHaveLength(3)
    for (const r of roles) {
      const text = JSON.stringify(r.Properties.AssumeRolePolicyDocument)
      // The name is matched exactly, case included: GitHub's sub_claim_prefix since the rename to Altrobe.
      expect(text).toContain('repo:Cloudmancermedia@52295078/Altrobe@1426387099:')
      expect(text).not.toContain('/altrobe@')
      expect(text).not.toContain('repo:Cloudmancermedia/Altrobe:')
      const keys = r.Properties.AssumeRolePolicyDocument.Statement.flatMap((s: { Condition: Record<string, Record<string, string>> }) =>
        Object.values(s.Condition).flatMap((c) => Object.keys(c)))
      expect(keys.sort()).toEqual(['token.actions.githubusercontent.com:aud', 'token.actions.githubusercontent.com:sub'])
    }
  })

  test('the deploy role may assume the CDK bootstrap roles that deploy and publish assets', () => {
    const text = JSON.stringify(stacks().ci.findResources('AWS::IAM::Policy'))
    for (const r of ['deploy-role', 'file-publishing-role', 'image-publishing-role', 'lookup-role']) expect(text).toContain(`cdk-hnb659fds-${r}-123456789012-us-east-1`)
  })
})

describe('AltrobeSite', () => {
  test('both buckets block every kind of public access and are encrypted', () => {
    const { site } = stacks()
    const buckets = site.findResources('AWS::S3::Bucket')
    expect(Object.keys(buckets)).toHaveLength(2)
    for (const b of Object.values(buckets)) {
      expect(b.Properties.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true,
      })
      expect(b.Properties.BucketEncryption).toBeDefined()
    }
  })

  test('CloudFront reads the buckets through origin access control, and only CloudFront may read them', () => {
    const { site } = stacks()
    site.resourceCountIs('AWS::CloudFront::OriginAccessControl', 2)
    for (const p of Object.values(site.findResources('AWS::S3::BucketPolicy'))) {
      const allows = p.Properties.PolicyDocument.Statement.filter((s: { Effect: string }) => s.Effect === 'Allow')
      for (const s of allows) expect(s.Principal).toEqual({ Service: 'cloudfront.amazonaws.com' })
    }
  })

  test('both distributions are HTTPS only, compressed, and serve their own hostnames on one certificate', () => {
    const { site } = stacks()
    site.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'altrobe.com', SubjectAlternativeNames: Match.arrayWith(['www.altrobe.com', 'assets.altrobe.com']), ValidationMethod: 'DNS',
    })
    const dists = Object.values(site.findResources('AWS::CloudFront::Distribution'))
    expect(dists.map((d) => d.Properties.DistributionConfig.Aliases).sort()).toEqual([['altrobe.com', 'www.altrobe.com'], ['assets.altrobe.com']])
    for (const d of dists) {
      const behaviors = [d.Properties.DistributionConfig.DefaultCacheBehavior, ...(d.Properties.DistributionConfig.CacheBehaviors ?? [])]
      for (const b of behaviors) {
        expect(b.ViewerProtocolPolicy).toBe('redirect-to-https')
        expect(b.Compress).toBe(true)
      }
    }
  })

  test('the app sends www to the apex and falls back to index.html for app routes', () => {
    const { site } = stacks()
    site.hasResourceProperties('AWS::CloudFront::Function', {
      FunctionCode: Match.stringLikeRegexp('www\\.altrobe\\.com'),
    })
    site.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: ['altrobe.com', 'www.altrobe.com'],
        CustomErrorResponses: Match.arrayWith([Match.objectLike({ ErrorCode: 404, ResponseCode: 200, ResponsePagePath: '/index.html' })]),
      }),
    })
  })

  test('assets allow only https://altrobe.com cross-origin, cache builds for a year and current.json for a minute', () => {
    const { site } = stacks()
    site.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        CorsConfig: Match.objectLike({ AccessControlAllowOrigins: { Items: ['https://altrobe.com'] } }),
      }),
    })
    site.hasResourceProperties('AWS::CloudFront::CachePolicy', { CachePolicyConfig: Match.objectLike({ DefaultTTL: 31536000 }) })
    site.hasResourceProperties('AWS::CloudFront::CachePolicy', { CachePolicyConfig: Match.objectLike({ DefaultTTL: 60, MaxTTL: 60 }) })
    site.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: ['assets.altrobe.com'],
        CacheBehaviors: [Match.objectLike({ PathPattern: '*/current.json' }), Match.objectLike({ PathPattern: '*.json' })],
      }),
    })
  })

  test('the app page and its build files send security headers, HSTS among them', () => {
    const { site } = stacks()
    const policies = Object.values(site.findResources('AWS::CloudFront::ResponseHeadersPolicy'))
      .map((p) => p.Properties.ResponseHeadersPolicyConfig)
      .filter((c) => ['no-cache', 'public, max-age=31536000, immutable'].includes(c.CustomHeadersConfig?.Items?.[0]?.Value) && !c.CorsConfig)
    expect(policies.length).toBe(2)
    for (const c of policies) {
      expect(c.SecurityHeadersConfig).toEqual({
        ContentTypeOptions: { Override: true },
        FrameOptions: { FrameOption: 'DENY', Override: true },
        ReferrerPolicy: { ReferrerPolicy: 'strict-origin-when-cross-origin', Override: true },
        StrictTransportSecurity: { AccessControlMaxAgeSec: 31536000, IncludeSubdomains: false, Override: true },
      })
    }
  })

  test('browsers keep build files for a year and recheck current.json after a minute', () => {
    const { site } = stacks()
    const cacheControl = (value: string) => site.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        CustomHeadersConfig: { Items: [{ Header: 'Cache-Control', Value: value, Override: true }] },
      }),
    })
    cacheControl('public, max-age=31536000, immutable')
    cacheControl('public, max-age=60')
  })

  test("browsers recheck a build's JSON after five minutes, since a rebake can rewrite it in place", () => {
    const { site } = stacks()
    const policies = site.findResources('AWS::CloudFront::ResponseHeadersPolicy')
    const [assets] = Object.values(site.findResources('AWS::CloudFront::Distribution'))
      .filter((d) => (d.Properties.DistributionConfig.Aliases as string[]).some((alias) => alias === 'assets.altrobe.com'))
    const json = assets.Properties.DistributionConfig.CacheBehaviors.find((b: { PathPattern: string }) => b.PathPattern === '*.json')
    const header = policies[json.ResponseHeadersPolicyId.Ref].Properties.ResponseHeadersPolicyConfig
    expect(header.CustomHeadersConfig.Items[0]).toEqual({ Header: 'Cache-Control', Value: 'public, max-age=300', Override: true })
    // Same CORS as the rest of the bundle.
    expect(header.CorsConfig.AccessControlAllowOrigins.Items).toEqual(['https://altrobe.com'])
  })

  test('browsers keep the web app\'s hashed files for a year and recheck index.html every time', () => {
    const { site } = stacks()
    const policies = site.findResources('AWS::CloudFront::ResponseHeadersPolicy')
    const cacheControlOf = (ref: { Ref: string } | undefined) =>
      ref && policies[ref.Ref]?.Properties.ResponseHeadersPolicyConfig.CustomHeadersConfig?.Items
        .find((h: { Header: string }) => h.Header === 'Cache-Control')?.Value
    const [app] = Object.values(site.findResources('AWS::CloudFront::Distribution'))
      .filter((d) => JSON.stringify(d.Properties.DistributionConfig.Comment).includes('web app'))
    const config = app.Properties.DistributionConfig
    expect(cacheControlOf(config.DefaultCacheBehavior.ResponseHeadersPolicyId)).toBe('no-cache')
    const statics = config.CacheBehaviors.find((b: { PathPattern: string }) => b.PathPattern === 'static/*')
    expect(statics).toBeDefined()
    expect(cacheControlOf(statics.ResponseHeadersPolicyId)).toBe('public, max-age=31536000, immutable')
  })

  test('apex, www and assets point at CloudFront over IPv4 and IPv6', () => {
    const { site } = stacks()
    for (const type of ['A', 'AAAA'])
      for (const name of ['altrobe.com.', 'www.altrobe.com.', 'assets.altrobe.com.'])
        site.hasResourceProperties('AWS::Route53::RecordSet', { Name: name, Type: type, AliasTarget: Match.anyValue() })
  })

  test('the deploy role may write the bundle bucket and invalidate both distributions', () => {
    const text = JSON.stringify(stacks().site.findResources('AWS::IAM::Policy'))
    expect(text).toContain(DEPLOY_ROLE_NAME)
    expect(text).toContain('s3:PutObject')
    expect(text).toContain('cloudfront:CreateInvalidation')
  })

  test('the publish role may read, write, list and delete the bundle bucket and invalidate only the asset distribution', () => {
    const { site } = stacks()
    const policies = Object.values(site.findResources('AWS::IAM::Policy')).filter((p) => JSON.stringify(p.Properties.Roles).includes(PUBLISH_ROLE_NAME))
    expect(policies).toHaveLength(1)
    const statements = policies[0].Properties.PolicyDocument.Statement as { Action: string | string[]; Resource: unknown }[]
    const actions = statements.flatMap((s) => [s.Action].flat())
    for (const a of ['s3:GetObject*', 's3:PutObject', 's3:DeleteObject*', 's3:List*']) expect(actions).toContain(a)
    const invalidations = statements.filter((s) => [s.Action].flat().includes('cloudfront:CreateInvalidation'))
    expect(invalidations).toHaveLength(1)
    const target = JSON.stringify(invalidations[0].Resource)
    expect(target).toContain('AssetDistribution')
    expect(target).not.toContain('AppDistribution')
    expect(actions.filter((a) => !a.startsWith('s3:') && a !== 'cloudfront:CreateInvalidation')).toEqual([])
  })

  test('the web build deploys only when it exists; bundle data never goes through CDK', () => {
    expect(Object.keys(stacks().site.findResources('Custom::CDKBucketDeployment'))).toHaveLength(0)
    const { site } = stacks({ webDistPath: webDist() })
    expect(Object.keys(site.findResources('Custom::CDKBucketDeployment'))).toHaveLength(1)
  })
})

describe('AltrobeBudget', () => {
  const budget = () => Template.fromStack(new BudgetStack(new App(), 'AltrobeBudget', {
    env, email: 'owner@example.com', monthlyLimitUsd: 50, tag: { key: 'project', value: 'altrobe' }, runId: 'run-1',
    bedrockMonthlyLimitUsd: BEDROCK_MONTHLY_LIMIT_USD, promptRoleName: PROMPT_ROLE_NAME,
  }))

  test('alerts by email on Altrobe-tagged spend: 80% actual and 100% forecast of $50 a month', () => {
    budget().hasResourceProperties('AWS::Budgets::Budget', {
      Budget: {
        BudgetType: 'COST', TimeUnit: 'MONTHLY', BudgetLimit: { Amount: 50, Unit: 'USD' },
        FilterExpression: { Tags: { Key: 'project', Values: ['altrobe'], MatchOptions: ['EQUALS'] } },
      },
      NotificationsWithSubscribers: [
        { Notification: { NotificationType: 'ACTUAL', ComparisonOperator: 'GREATER_THAN', Threshold: 80, ThresholdType: 'PERCENTAGE' },
          Subscribers: [{ SubscriptionType: 'EMAIL', Address: 'owner@example.com' }] },
        { Notification: { NotificationType: 'FORECASTED', ComparisonOperator: 'GREATER_THAN', Threshold: 100, ThresholdType: 'PERCENTAGE' },
          Subscribers: [{ SubscriptionType: 'EMAIL', Address: 'owner@example.com' }] },
      ],
    })
  })

  test('activates the tag for cost allocation on every deploy, with only that permission', () => {
    const t = budget()
    const [cr] = Object.values(t.findResources('Custom::AWS'))
    const create = JSON.stringify(cr.Properties.Create)
    expect(create).toContain('updateCostAllocationTagsStatus')
    expect(create).toContain('"TagKey\\":\\"project\\",\\"Status\\":\\"Active\\"')
    expect(JSON.stringify(cr.Properties.Update)).toContain('run-1')
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: { Statement: [{ Action: 'ce:UpdateCostAllocationTagsStatus', Effect: 'Allow', Resource: '*' }] },
    })
  })

  test("past the monthly Bedrock budget, automatically attaches a policy denying bedrock:InvokeModel to the prompt API's role", () => {
    const t = budget()
    t.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: Match.objectLike({
        BudgetName: 'altrobe-bedrock-monthly', BudgetType: 'COST', TimeUnit: 'MONTHLY', BudgetLimit: { Amount: 300, Unit: 'USD' },
        FilterExpression: { Dimensions: { Key: 'SERVICE', Values: ['Amazon Bedrock'] } },
      }),
    })
    const [deny] = Object.entries(t.findResources('AWS::IAM::ManagedPolicy'))
    expect(deny[1].Properties.PolicyDocument.Statement).toEqual([{ Action: 'bedrock:InvokeModel', Effect: 'Deny', Resource: '*' }])
    t.hasResourceProperties('AWS::Budgets::BudgetsAction', {
      ActionType: 'APPLY_IAM_POLICY',
      ApprovalModel: 'AUTOMATIC',
      NotificationType: 'ACTUAL',
      ActionThreshold: { Type: 'PERCENTAGE', Value: 100 },
      Definition: { IamActionDefinition: { PolicyArn: { Ref: deny[0] }, Roles: [PROMPT_ROLE_NAME] } },
      Subscribers: [{ Type: 'EMAIL', Address: 'owner@example.com' }],
    })
  })

  test("emails the prompt API's alarms: the day's cap reached, an hour's spend past a quarter of it, a spend left uncounted", () => {
    const t = budget()
    const topics = Object.keys(t.findResources('AWS::SNS::Topic'))
    expect(topics).toHaveLength(1)
    t.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'email', Endpoint: 'owner@example.com', TopicArn: { Ref: topics[0] } })
    const alarm = (metric: string, period: number, threshold: number, operator: string) => t.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: PROMPT_METRICS_NAMESPACE, MetricName: metric, Statistic: 'Sum', Period: period, EvaluationPeriods: 1,
      Threshold: threshold, ComparisonOperator: operator, TreatMissingData: 'notBreaching', AlarmActions: [{ Ref: topics[0] }],
    })
    alarm(PROMPT_METRICS.dailyCap, 300, 1, 'GreaterThanOrEqualToThreshold')
    alarm(PROMPT_METRICS.spend, 3600, SPEND_ALARM_MICRO_USD_PER_HOUR, 'GreaterThanThreshold')
    alarm(PROMPT_METRICS.spendErrors, 300, 1, 'GreaterThanOrEqualToThreshold')
    expect(SPEND_ALARM_MICRO_USD_PER_HOUR).toBe(6_250_000)
    expect(Object.keys(t.findResources('AWS::CloudWatch::Alarm'))).toHaveLength(3)
  })

  test('the budget action role trusts only Budgets in this account, and may attach only the deny policy to only that role', () => {
    const t = budget()
    const [trust] = Object.values(t.findResources('AWS::IAM::Role'))
      .map((r) => r.Properties.AssumeRolePolicyDocument.Statement).filter((st) => JSON.stringify(st).includes('budgets.amazonaws.com'))
    expect(trust).toHaveLength(1)
    expect(trust[0].Condition.StringEquals).toEqual({ 'aws:SourceAccount': '123456789012' })
    expect(JSON.stringify(trust[0].Condition.ArnLike)).toContain(':budgets::123456789012:budget/*')
    const text = JSON.stringify(Object.values(t.findResources('AWS::IAM::Policy')).filter((p) => JSON.stringify(p).includes('iam:AttachRolePolicy')))
    expect(text).toContain(`:role/${PROMPT_ROLE_NAME}`)
    expect(text).toContain('iam:PolicyARN')
    expect(text).toContain('iam:DetachRolePolicy')
  })
})

describe('the prompt API (AltrobePrompt)', () => {
  test("stands apart from AltrobeSite, so it deploys alone and main's deploys never remove it", () => {
    const { site } = stacks()
    expect(Object.keys(site.findResources('AWS::Lambda::Function')).filter((k) => k.includes('Prompt'))).toEqual([])
    expect(site.findResources('AWS::DynamoDB::Table')).toEqual({})
    expect(site.findResources('AWS::ApiGatewayV2::Api')).toEqual({})
  })

  test('publishes its address in SSM for the app distribution', () => {
    const { prompt } = stacks()
    prompt.hasResourceProperties('AWS::SSM::Parameter', { Name: API_DOMAIN_PARAMETER, Type: 'String', Value: Match.objectLike({ 'Fn::Join': Match.anyValue() }) })
    expect(JSON.stringify(prompt.findResources('AWS::SSM::Parameter'))).toContain('execute-api')
  })

  test('one Lambda, 30 seconds, reserved concurrency 5, on the named role', () => {
    const { prompt } = stacks()
    prompt.hasResourceProperties('AWS::Lambda::Function', { Timeout: 30, ReservedConcurrentExecutions: 5, Runtime: Match.stringLikeRegexp('^nodejs2[24]') })
    prompt.hasResourceProperties('AWS::IAM::Role', { RoleName: PROMPT_ROLE_NAME })
  })

  test('may invoke only Nova 2 Lite, through the US inference profile', () => {
    const { prompt } = stacks()
    const statements = Object.values(prompt.findResources('AWS::IAM::Policy')).flatMap((p) => p.Properties.PolicyDocument.Statement)
    const bedrock = statements.filter((s: { Action: string | string[] }) => JSON.stringify(s.Action).includes('bedrock'))
    expect(bedrock).toHaveLength(1)
    expect(bedrock[0].Action).toBe('bedrock:InvokeModel')
    const resources = JSON.stringify(bedrock[0].Resource)
    expect(resources).toContain(':bedrock:us-east-1:123456789012:inference-profile/us.amazon.nova-2-lite-v1:0')
    expect(resources).toContain(':bedrock:*::foundation-model/amazon.nova-2-lite-v1:0')
  })

  test('may use the counters table, the kill switch and its three secrets, through grants', () => {
    const { prompt } = stacks()
    const text = JSON.stringify(Object.values(prompt.findResources('AWS::IAM::Policy')).filter((p) => JSON.stringify(p.Properties.Roles).includes('PromptApiRole')))
    for (const a of ['dynamodb:UpdateItem', 'dynamodb:GetItem', 'ssm:GetParameter', 'secretsmanager:GetSecretValue']) expect(text).toContain(a)
  })

  test("counts the day's cap reached, spend and uncounted spend from the Lambda's log lines", () => {
    const { prompt } = stacks()
    const filters = Object.values(prompt.findResources('AWS::Logs::MetricFilter')).map((f) => f.Properties)
    expect(filters).toHaveLength(3)
    const by = (metric: string) => filters.find((f) => f.MetricTransformations[0].MetricName === metric)
    expect(by(PROMPT_METRICS.dailyCap)?.FilterPattern).toBe('{ ($.event = "prompt") && ($.outcome = "daily_cap") }')
    expect(by(PROMPT_METRICS.spend)?.FilterPattern).toBe('{ ($.event = "prompt") && ($.outcome = "ok") }')
    expect(by(PROMPT_METRICS.spend)?.MetricTransformations[0].MetricValue).toBe('$.microUsd')
    expect(by(PROMPT_METRICS.spendErrors)?.FilterPattern).toBe('{ ($.event = "prompt") && ($.spendError = "*") }')
    for (const f of filters) {
      expect(f.MetricTransformations[0].MetricNamespace).toBe(PROMPT_METRICS_NAMESPACE)
      expect(JSON.stringify(f.LogGroupName)).toContain('PromptApiLogs')
    }
  })

  test('the metric filters read fields the handler logs (lambda/prompt/handler.ts)', async () => {
    const { readFileSync } = await import('node:fs')
    const handler = readFileSync(new URL('../lambda/prompt/handler.ts', import.meta.url), 'utf8')
    const index = readFileSync(new URL('../lambda/prompt/index.ts', import.meta.url), 'utf8')
    expect(index).toContain("event: 'prompt'")
    for (const s of ["outcome: 'ok'", 'outcome: code', "'daily_cap'", 'microUsd: cost', 'entry.spendError =']) expect(handler, s).toContain(s)
  })

  test('counters expire through a TTL, on demand', () => {
    stacks().prompt.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST', TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
    })
  })

  test('the kill switch starts on', () => {
    stacks().prompt.hasResourceProperties('AWS::SSM::Parameter', { Name: SWITCH_PARAMETER, Value: 'on', Type: 'String' })
  })

  test('secrets are generated or set by hand, never in the template', () => {
    const { prompt } = stacks()
    const secrets = Object.values(prompt.findResources('AWS::SecretsManager::Secret'))
    expect(secrets).toHaveLength(3)
    for (const s of secrets) {
      expect(s.Properties.GenerateSecretString).toBeDefined()
      expect(s.Properties.SecretString).toBeUndefined()
    }
  })

  test('API Gateway rate-limits the stage in front of the Lambda', () => {
    stacks().prompt.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: '$default', AutoDeploy: true, DefaultRouteSettings: Match.objectLike({ ThrottlingRateLimit: 10, ThrottlingBurstLimit: 20 }),
    })
  })

  test('the app distribution answers /l/* with the look preview function (runtime 2.0), from its own file', () => {
    const { site } = stacks()
    const [app] = Object.values(site.findResources('AWS::CloudFront::Distribution'))
      .filter((d) => JSON.stringify(d.Properties.DistributionConfig.Comment).includes('web app'))
    const preview = app.Properties.DistributionConfig.CacheBehaviors.find((b: { PathPattern: string }) => b.PathPattern === 'l/*')
    expect(preview).toBeDefined()
    expect(preview.AllowedMethods).toEqual(['GET', 'HEAD'])
    expect(preview.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad') // Managed-CachingDisabled
    expect(preview.FunctionAssociations).toHaveLength(1)
    expect(preview.FunctionAssociations[0].EventType).toBe('viewer-request')
    const functions = Object.values(site.findResources('AWS::CloudFront::Function'))
    const fn = functions.find((f) => String(f.Properties.FunctionCode).includes('Open this look in Altrobe'))
    expect(fn?.Properties.FunctionConfig.Runtime).toBe('cloudfront-js-2.0')
  })

  test('the app distribution sends /api/* to the API: no caching, all methods, the viewer address, no cookies, the origin secret', () => {
    const { site } = stacks()
    const [app] = Object.values(site.findResources('AWS::CloudFront::Distribution'))
      .filter((d) => JSON.stringify(d.Properties.DistributionConfig.Comment).includes('web app'))
    const config = app.Properties.DistributionConfig
    const api = config.CacheBehaviors.find((b: { PathPattern: string }) => b.PathPattern === 'api/*')
    expect(api).toBeDefined()
    expect(api.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad') // Managed-CachingDisabled
    expect(api.AllowedMethods).toEqual(['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE'])
    expect(api.FunctionAssociations).toBeUndefined()
    const policies = site.findResources('AWS::CloudFront::OriginRequestPolicy')
    const policy = policies[api.OriginRequestPolicyId.Ref].Properties.OriginRequestPolicyConfig
    expect(policy.HeadersConfig).toEqual({ HeaderBehavior: 'whitelist', Headers: ['CloudFront-Viewer-Address', 'Content-Type'] })
    expect(policy.CookiesConfig).toEqual({ CookieBehavior: 'none' })
    const origin = config.Origins.find((o: { Id: string }) => o.Id === api.TargetOriginId)
    // The API's address comes from AltrobePrompt through SSM, not a CloudFormation export.
    expect(JSON.stringify(site.toJSON().Parameters)).toContain(API_DOMAIN_PARAMETER)
    expect(JSON.stringify(origin.DomainName)).toContain('Ref')
    expect(origin.OriginCustomHeaders[0].HeaderName).toBe('x-altrobe-origin')
    expect(JSON.stringify(origin.OriginCustomHeaders[0].HeaderValue)).toContain('resolve:secretsmanager')
    // The app's index.html fallback stays for 403 and 404 only, which the API never answers.
    expect(config.CustomErrorResponses.map((r: { ErrorCode: number }) => r.ErrorCode).sort()).toEqual([403, 404])
  })
})
