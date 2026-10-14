import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { App } from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { describe, expect, test } from 'vitest'
import { CiStack, DEPLOY_ROLE_NAME, DIFF_ROLE_NAME, GITHUB_SUBJECT, PUBLISH_ROLE_NAME } from '../src/ci-stack.js'
import { DnsStack } from '../src/dns-stack.js'
import { BudgetStack } from '../src/budget-stack.js'
import { SiteStack } from '../src/site-stack.js'

const env = { account: '123456789012', region: 'us-east-1' }
// The repository's immutable OIDC subject, as app.ts deploys it: owner and repository, each with its ID.
const subject = GITHUB_SUBJECT

function stacks(opts: { createOidcProvider?: boolean; webDistPath?: string } = {}) {
  const app = new App()
  const dns = new DnsStack(app, 'AltrobeDns', { env, domainName: 'altrobe.com' })
  const ci = new CiStack(app, 'AltrobeCi', { env, subject, createOidcProvider: opts.createOidcProvider })
  const site = new SiteStack(app, 'AltrobeSite', { env, zone: dns.zone, domainName: 'altrobe.com', deployRoleName: DEPLOY_ROLE_NAME, publishRoleName: PUBLISH_ROLE_NAME, webDistPath: opts.webDistPath })
  return { dns: Template.fromStack(dns), ci: Template.fromStack(ci), site: Template.fromStack(site), siteStack: site }
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
      expect(text).toContain('repo:Cloudmancermedia@52295078/Altrobe@1413879660:')
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
      .filter((d) => JSON.stringify(d.Properties.DistributionConfig.Aliases).includes('assets.altrobe.com'))
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
})
