import { fileURLToPath } from 'node:url'
import { App, Tags } from 'aws-cdk-lib'
import { BEDROCK_MONTHLY_LIMIT_USD, BudgetStack } from './budget-stack.js'
import { CiStack, DEPLOY_ROLE_NAME, GITHUB_SUBJECT, PUBLISH_ROLE_NAME } from './ci-stack.js'
import { DnsStack } from './dns-stack.js'
import { PROMPT_ROLE_NAME } from './prompt-api.js'
import { PromptStack } from './prompt-stack.js'
import { SiteStack } from './site-stack.js'

// The account comes from the credentials in use (CDK_DEFAULT_ACCOUNT): the maintainer's profile on
// the first local deploy, the GitHub deploy role after that. No account ID is kept in the repo.
const app = new App()
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' }
const domainName = 'altrobe.com'
// The repository's immutable OIDC subject (ci-stack.ts GITHUB_SUBJECT). Renaming or recreating the
// repository changes it.
const subject = (app.node.tryGetContext('githubSubject') as string | undefined) ?? GITHUB_SUBJECT
const webDistPath = (app.node.tryGetContext('webDist') as string | undefined) ?? fileURLToPath(new URL('../../web/dist-static', import.meta.url))

const dns = new DnsStack(app, 'AltrobeDns', { env, domainName })
new CiStack(app, 'AltrobeCi', { env, subject, createOidcProvider: app.node.tryGetContext('createGithubOidcProvider') === 'true' })
// Uses the zone from AltrobeDns, so it deploys after it; AltrobeCi stands alone, so the first local
// deploy can be AltrobeDns and AltrobeCi only (docs/deployment.md).
// The prompt API deploys before the site, whose /api/* route reads the API's address from SSM.
const prompt = new PromptStack(app, 'AltrobePrompt', { env, hostnames: [domainName, `www.${domainName}`] })
const site = new SiteStack(app, 'AltrobeSite', { env, zone: dns.zone, domainName, deployRoleName: DEPLOY_ROLE_NAME, publishRoleName: PUBLISH_ROLE_NAME, webDistPath })
site.addStackDependency(prompt)

// Every Altrobe resource carries this tag, so the budget counts only Altrobe's spend. The budget
// exists only when an alert address is set (repository secret BUDGET_EMAIL in CI, or
// ALTROBE_BUDGET_EMAIL locally); it is never kept in the repository.
const costTag = { key: 'project', value: 'altrobe' }
Tags.of(app).add(costTag.key, costTag.value)
const budgetEmail = process.env.ALTROBE_BUDGET_EMAIL
if (budgetEmail) {
  const budget = new BudgetStack(app, 'AltrobeBudget', {
    env, email: budgetEmail, monthlyLimitUsd: 50, tag: costTag, runId: process.env.GITHUB_RUN_ID ?? String(Date.now()),
    bedrockMonthlyLimitUsd: BEDROCK_MONTHLY_LIMIT_USD, promptRoleName: PROMPT_ROLE_NAME,
  })
  // The budget action names the prompt API's role, so the role must exist first.
  budget.addStackDependency(prompt)
}
