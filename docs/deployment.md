# Deployment

The hosted site runs on AWS. Every AWS resource is defined in `infra/` with the AWS CDK in
TypeScript; nothing is changed by hand in the console. GitHub Actions deploys from `main`. This page
covers the first-time setup, how CI deploys, and how a game bundle is published.

## What is deployed

All in one AWS account, in us-east-1 (CloudFront needs its certificate there).

| Stack | Holds |
| --- | --- |
| `AltrobeDns` | the `altrobe.com` public hosted zone; outputs its nameservers |
| `AltrobeCi` | GitHub's OIDC provider and three roles: `altrobe-github-diff` (read only, any branch or pull request in the repository), `altrobe-github-deploy` (only jobs in the `production` environment) and `altrobe-github-publish` (workflows on `main`, no approval; the bundle bucket and the asset distribution only) |
| `AltrobeSite` | the certificate for `altrobe.com`, `www.altrobe.com` and `assets.altrobe.com`; a private bucket and CloudFront distribution for the web app (www redirects to the apex; browsers keep the hashed files under `static/` for a year and recheck `index.html` on every visit); a private bucket and distribution for the game bundles at `assets.altrobe.com`; DNS records; the web app's files; the `/api/*` route to the prompt box's API |
| `AltrobePrompt` | the hosted prompt box's API (below): the Lambda, API Gateway, the counters table, the kill switch, its secrets, and an SSM parameter with the API's hostname that `AltrobeSite` reads for its `/api/*` route. It deploys before `AltrobeSite`, and alone with `npx cdk deploy AltrobePrompt` |
| `AltrobeBudget` | a $50-a-month cost budget that counts only resources tagged `project=altrobe` (every stack above carries the tag), emailing at 80% of actual spend and 100% of forecast spend. A second budget, $300 a month, counts the account's Bedrock spend; past it, a budget action denies the prompt API `bedrock:InvokeModel`. It exists only when an alert address is set; see below. |

All three roles trust the repository's immutable OIDC subject (the token's `sub` claim, such as
`repo:Cloudmancermedia@52295078/Altrobe@1426387099:environment:production`, plus `aud`). GitHub gives
repositories created after July 15, 2026 this form, which names the owner and repository by numeric
ID, so nobody can reclaim a deleted name into these roles
([GitHub changelog](https://github.blog/changelog/2026-04-23-immutable-subject-claims-for-github-actions-oidc-tokens/)).
The subject also holds the owner and repository names, and IAM matches it exactly, case included.
Renaming either one (as from `altrobe` to `Altrobe`) or recreating the repository changes it, and
every job that assumes a role fails with `Not authorized to perform sts:AssumeRoleWithWebIdentity`.
Read the new prefix with `gh api repos/Cloudmancermedia/Altrobe/actions/oidc/customization/sub`
(`sub_claim_prefix`), set `GITHUB_SUBJECT` in `infra/src/ci-stack.ts` or pass
`-c githubSubject=<prefix>`, and deploy `AltrobeCi` locally, since CI can't assume the roles until it
is fixed. The name isn't matched with a wildcard: `*` would also match a crafted branch name in
another repository of the same owner. No AWS account ID or key is stored in the
repository: the account comes from the credentials in use (`CDK_DEFAULT_ACCOUNT`).

## First-time setup

Run once, from a machine with the AWS CLI signed in to the account (a named profile). Bootstrap the
account for CDK first (`npx cdk bootstrap`), with the default qualifier.

1. **Deploy the zone and the GitHub roles.** An account holds one GitHub OIDC provider at most. Check
   for one first (read only):

   ```sh
   aws iam list-open-id-connect-providers --profile <profile>
   ```

   `AltrobeCi` uses the account's existing `token.actions.githubusercontent.com` provider, because CI
   deploys with no extra context. If the list doesn't have one, add `-c createGithubOidcProvider=true`
   to the deploy below, once. **WRITE OPERATION:**

   ```sh
   npm --prefix infra ci
   cd infra && npx cdk deploy AltrobeDns AltrobeCi --profile <profile>
   ```

   Note the outputs: `AltrobeDns.NameServers`, `AltrobeCi.DiffRoleArn`, `AltrobeCi.DeployRoleArn` and
   `AltrobeCi.PublishRoleArn`.

2. **Point the domain at the zone.** At the domain registrar, set the nameservers to the
   four in `AltrobeDns.NameServers`. This is the one step outside AWS. Wait until
   `dig +short NS altrobe.com` lists them (minutes to hours).

3. **Set up GitHub** (repository settings):
   - An environment named `production` with deployment branches limited to `main`. It has no required
     reviewer, so every merge to `main` deploys on its own. Add yourself as a reviewer again if outside
     contributors start sending pull requests.
   - Repository variables `AWS_DIFF_ROLE_ARN`, `AWS_DEPLOY_ROLE_ARN` and `AWS_PUBLISH_ROLE_ARN`, from
     step 1's outputs. The scheduled publish skips until `AWS_PUBLISH_ROLE_ARN` is set.
   - Repository secret `BUDGET_EMAIL`, the address for budget alerts. It is a secret, not a variable,
     so GitHub masks it in this public repository's Actions logs.

4. **Deploy the site.** Either merge to `main`, which deploys on its own, or run it
   locally once. **WRITE OPERATION:**

   ```sh
   npm --prefix web ci
   VITE_ALTROBE_BUNDLE_URL=https://assets.altrobe.com npm --prefix web run build:static
   cd infra && npx cdk deploy AltrobeSite --profile <profile>
   ```

   The certificate validates through DNS, so this waits until step 2 has taken effect.

5. Add repository variables `BUNDLE_BUCKET` and `ASSET_DISTRIBUTION_ID` from `AltrobeSite`'s
   outputs, for the bundle publish step.

### The budget

Budgets see a tag only after it is activated for cost allocation, and AWS lists a new tag key for
activation up to 24 hours after resources first carry it. `AltrobeBudget` activates `project` with a
custom resource on every deploy, so the budget starts counting from the first deploy after AWS has
seen the tag. Until then it reports no spend. To deploy it locally, set the address in the
environment: `ALTROBE_BUDGET_EMAIL=you@example.com npx cdk deploy AltrobeBudget --profile <profile>`
(**WRITE OPERATION**).

### The prompt box

`AltrobePrompt` holds the hosted prompt box's API ([hosted-prompt-box.md](hosted-prompt-box.md)):
an HTTP API and a Lambda (role `altrobe-prompt-api`, reserved concurrency 5), routed from the app
distribution at `/api/*` with caching off. Next to them are a DynamoDB table for the daily counters,
the kill switch parameter and three Secrets Manager secrets. CDK generates the HMAC key
(`altrobe/prompt/hmac-key`) and the header CloudFront adds to every `/api/*` request
(`altrobe/prompt/origin-verify`). The Turnstile secret starts as a random placeholder, so every
command answers 400 `turnstile` until it is set.

Once, around the first deploy that creates them:

1. **Check Lambda's concurrency quota** (read only), before the first deploy. Lambda keeps 100 units
   unreserved, so reserving 5 needs at least 105
   ([Lambda docs](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html)), and
   some new accounts start lower: `aws lambda get-account-settings --profile <profile>`
   (`AccountLimit.UnreservedConcurrentExecutions`). If it's too low, request a quota increase first.
2. **Turn on Bedrock model access** for Amazon Nova 2 Lite in us-east-1, if the account hasn't used it.
3. **Set the Turnstile secret.** In Cloudflare, create a Turnstile widget for `altrobe.com` and
   `www.altrobe.com`. Give its site key to the web build and store its secret key. **WRITE OPERATION:**

   ```sh
   aws secretsmanager put-secret-value --secret-id altrobe/prompt/turnstile-secret \
     --secret-string '<secret key>' --profile <profile>
   ```

   Running Lambda instances keep the old value until they are replaced, so either wait about 15
   minutes or bump the function by deploying again.

To close the box for everyone, flip the kill switch (within 30 seconds; deploys don't reset it, since
CloudFormation only rewrites the parameter when its template value changes). **WRITE OPERATION:**

```sh
aws ssm put-parameter --name /altrobe/prompt/switch --value off --overwrite --profile <profile>
```

Set it back to `on` to reopen. The global $25 daily cap and the per-IP limit reset at 13:00 UTC on
their own. If the Bedrock budget action has fired, the policy `altrobe-prompt-deny-bedrock` stays on
the Lambda's role until the action is reversed, after the cause is understood. **WRITE OPERATION:**

```sh
aws budgets describe-budget-actions-for-budget --account-id <account> --budget-name altrobe-bedrock-monthly --profile <profile>
aws budgets execute-budget-action --account-id <account> --budget-name altrobe-bedrock-monthly \
  --action-id <action id> --execution-type REVERSE_BUDGET_ACTION --profile <profile>
```

The Lambda logs one JSON line per request (outcome, step, tool names, tokens, cost), never the IP
address, the typed text or tool content.

## How CI deploys

- **Every pull request and push** (`.github/workflows/ci.yml`): the `infra` job type-checks, runs the
  CDK assertion tests and synthesizes offline with a placeholder account. No AWS access.
- **`.github/workflows/deploy.yml`**: on pull requests from this repository and on pushes to `main`,
  the `diff` job builds the static web app and runs `cdk diff --all` with the diff role. On `main`,
  the `deploy` job then runs in the `production` environment (main only, no approval), builds the web app and runs
  `cdk deploy --all`. Both jobs skip until their role variable exists. Workflows never use
  `pull_request_target`; top-level permissions are empty and only the jobs that assume a role get
  `id-token: write`.

`npm --prefix infra run synth:offline` and `npm --prefix infra test` run the same checks locally,
without AWS credentials.

Both deploy.yml jobs build the web app with `npm --prefix web run build:static`, the static build
that reads bundles from `assets.altrobe.com`.

## Repository settings

These live in GitHub's settings, not in files, so set them by hand on the repository (again after
recreating it). The files that go with them are in `.github/`: `CODEOWNERS`, `dependabot.yml`, and
the `codeql.yml` and `dependency-review.yml` workflows. Every action in the workflows is pinned to a
commit SHA; Dependabot keeps the pins current.

- **A ruleset on `main`:** require a pull request, require the status checks (CI's `test` and `infra`
  jobs, CodeQL and dependency review), and block force pushes and deletion. Leave required approvals
  at zero: GitHub doesn't let an author approve their own pull request, and only the maintainer has
  write access, so nobody else can merge. `CODEOWNERS` still requests the maintainer's review on
  other people's pull requests.
- **Code security:** turn on the dependency graph (the dependency review workflow fails without it),
  secret scanning with push protection, Dependabot alerts, Dependabot
  security updates, and private vulnerability reporting ([SECURITY.md](SECURITY.md) points reporters
  there).
- **Actions:** set the default workflow permissions to read-only, and require approval before
  running workflows from first-time contributors' forks.

## Publishing a bundle

Bundles are data, not infrastructure: CDK creates the bundle bucket and lets the publish and deploy
roles write it, and `npm run publish:bundle` uploads each build (see
[hosted-pipeline.md](hosted-pipeline.md#publish-a-build)). A build goes to `{product}/{build}/` before
`{product}/current.json` is rewritten, then `current.json` is invalidated in CloudFront. Models and
textures are cached for a year and `current.json` for a minute. A build's JSON (catalog, sets, items)
tells browsers to recheck after five minutes, because republishing the same build after a bake change
rewrites it in place; the publish step then invalidates the whole build in CloudFront.

`.github/workflows/publish.yml` does this on its own every six hours, and on demand from the Actions
tab, with the publish role and no approval: it bakes each new build, checks it, publishes it and
deletes builds older than the previous one. See
[hosted-pipeline.md](hosted-pipeline.md#automatic-publishing). The publish role trusts any workflow
on `main` (sub `...:ref:refs/heads/main`), so whatever merges to `main` can write the bundle bucket;
it can't assume the CDK roles or touch the web app's distribution.

CloudFront compresses only files between 1 KB and 10 MB. The publish step must gzip larger files
itself (such as `catalog.json` and big models) and upload them with `Content-Encoding: gzip`.

## Switching products

The site shows one product, set by the `BUNDLE_PRODUCT` repository variable (unset means
`wow_classic_beta`, Forever's beta). `publish.yml` bakes and publishes that product, and `deploy.yml`
builds the web app to read it (`VITE_ALTROBE_PRODUCT`).

When Forever launches, its beta closes and the game moves to a public product, whose name we only
learn on the day. `publish.yml`'s `launch-watch` job checks every six hours
(`scripts/find-forever-launch.mjs`). When a public product, one named `wow_*` that isn't a beta, PTR
or China product, reaches Forever's 1.60 builds, it opens the issue "Forever is live on a public
product". To switch:

1. Set the variable to the product the issue names:
   `gh variable set BUNDLE_PRODUCT --repo Cloudmancermedia/Altrobe --body <product>`.
2. Run "Publish bundle" from the Actions tab and wait for it to finish. It bakes the new product
   into `{product}/` on the bundle bucket (about 25 minutes), and leaves the beta's folder alone.
3. Run "Deploy" from the Actions tab on `main`. The web app then reads the new
   product.
4. Open altrobe.com: the header shows the new product and build. Close the issue.

Publish before deploying: a web app that points at a product with nothing published shows "Altrobe
could not load its game data".
