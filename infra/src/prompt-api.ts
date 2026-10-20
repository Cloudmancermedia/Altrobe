import { fileURLToPath } from 'node:url'
import { Duration, RemovalPolicy, SecretValue, Stack } from 'aws-cdk-lib'
import { HttpApi, HttpStage, PayloadFormatVersion } from 'aws-cdk-lib/aws-apigatewayv2'
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import { AllowedMethods, CachePolicy, OriginProtocolPolicy, OriginRequestCookieBehavior, OriginRequestHeaderBehavior, OriginRequestPolicy, OriginRequestQueryStringBehavior, ViewerProtocolPolicy, type BehaviorOptions } from 'aws-cdk-lib/aws-cloudfront'
import { HttpOrigin } from 'aws-cdk-lib/aws-cloudfront-origins'
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb'
import { ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam'
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs'
import { Secret } from 'aws-cdk-lib/aws-secretsmanager'
import { StringParameter } from 'aws-cdk-lib/aws-ssm'
import { Construct } from 'constructs'

/** The Lambda's role, by name, so the budget action in AltrobeBudget can target it without a cross-stack reference. */
export const PROMPT_ROLE_NAME = 'altrobe-prompt-api'
/** The kill switch: `off` closes the prompt box (docs/deployment.md). */
export const SWITCH_PARAMETER = '/altrobe/prompt/switch'
/** Cloudflare's Turnstile secret key. CDK creates it with a placeholder; the maintainer sets the value. */
export const TURNSTILE_SECRET_NAME = 'altrobe/prompt/turnstile-secret'
export const HMAC_SECRET_NAME = 'altrobe/prompt/hmac-key'
export const ORIGIN_SECRET_NAME = 'altrobe/prompt/origin-verify'
/** The API's execute-api hostname, written by AltrobePrompt and read by the app distribution in AltrobeSite. */
export const API_DOMAIN_PARAMETER = '/altrobe/prompt/api-domain'
/** Must match the handler's ORIGIN_HEADER. */
const ORIGIN_HEADER = 'x-altrobe-origin'
export const INFERENCE_PROFILE = 'us.amazon.nova-2-lite-v1:0'
export const FOUNDATION_MODEL = 'amazon.nova-2-lite-v1:0'
/** The Lambda's timeout; one Bedrock attempt and Turnstile fit inside it (lambda/prompt/model.ts). */
export const LAMBDA_TIMEOUT_SECONDS = 30
/** Most commands running at once. Requests past it are throttled. */
export const RESERVED_CONCURRENCY = 5

export interface PromptApiProps {
  /** The hostnames a Turnstile token may come from. */
  hostnames: string[]
}

// The hosted prompt box's API (docs/hosted-prompt-box.md): an HTTP API in front of one Lambda that
// holds the instructions, the tool list and the Bedrock permission. It lives in its own stack
// (AltrobePrompt) and publishes its hostname in SSM; the app distribution routes /api/* to it with
// promptBehavior(). Requests that skip CloudFront lack the origin header and are refused.
export class PromptApi extends Construct {
  readonly fn: NodejsFunction
  readonly table: Table

  constructor(scope: Construct, id: string, props: PromptApiProps) {
    super(scope, id)
    const stack = Stack.of(this)

    // The per-IP and spend counters. Every item expires: an IP count when its day ends, a day's spend a week later.
    this.table = new Table(this, 'Counters', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: RemovalPolicy.DESTROY,
    })
    const killSwitch = new StringParameter(this, 'Switch', {
      parameterName: SWITCH_PARAMETER,
      stringValue: 'on',
      description: 'The hosted prompt box: on, or off to close it for everyone.',
    })
    const generated = (id: string, secretName: string, description: string, length: number) => new Secret(this, id, {
      secretName, description, generateSecretString: { passwordLength: length, excludePunctuation: true },
    })
    // Set out of band; until then Turnstile checks fail and every command answers 400 turnstile.
    const turnstile = generated('TurnstileSecret', TURNSTILE_SECRET_NAME, "Cloudflare Turnstile secret key for the prompt box. Set it by hand (docs/deployment.md).", 32)
    const hmacKey = generated('HmacKey', HMAC_SECRET_NAME, 'Root key for the prompt box: daily IP hashes and tickets.', 64)
    const origin = generated('OriginSecret', ORIGIN_SECRET_NAME, 'Header value CloudFront adds to /api/* so the API refuses requests that skip it.', 48)

    const role = new Role(this, 'Role', {
      roleName: PROMPT_ROLE_NAME,
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
    })
    const infraDir = fileURLToPath(new URL('..', import.meta.url))
    this.fn = new NodejsFunction(this, 'Function', {
      entry: fileURLToPath(new URL('../lambda/prompt/index.ts', import.meta.url)),
      projectRoot: infraDir,
      depsLockFilePath: fileURLToPath(new URL('../package-lock.json', import.meta.url)),
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(LAMBDA_TIMEOUT_SECONDS),
      reservedConcurrentExecutions: RESERVED_CONCURRENCY,
      role,
      logGroup: new LogGroup(this, 'Logs', { retention: RetentionDays.TWO_WEEKS, removalPolicy: RemovalPolicy.DESTROY }),
      // The AWS SDK is bundled, not taken from the runtime, so the deployed version is the tested one.
      bundling: { externalModules: [], minify: true, sourceMap: false },
      environment: {
        TABLE_NAME: this.table.tableName,
        SWITCH_PARAMETER: killSwitch.parameterName,
        TURNSTILE_SECRET_ID: turnstile.secretArn,
        HMAC_KEY_SECRET_ID: hmacKey.secretArn,
        ORIGIN_SECRET_ID: origin.secretArn,
        TURNSTILE_HOSTNAMES: props.hostnames.join(','),
        TURNSTILE_ACTION: 'prompt',
      },
    })
    // Every call the Lambda makes: UpdateItem and GetItem, GetParameter, GetSecretValue, and Converse.
    this.table.grantReadWriteData(this.fn)
    killSwitch.grantRead(this.fn)
    for (const s of [turnstile, hmacKey, origin]) s.grantRead(this.fn)
    // Converse needs bedrock:InvokeModel on the inference profile and on the model in every Region it routes to.
    this.fn.addToRolePolicy(new PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        stack.formatArn({ service: 'bedrock', resource: 'inference-profile', resourceName: INFERENCE_PROFILE, region: 'us-east-1' }),
        `arn:${stack.partition}:bedrock:*::foundation-model/${FOUNDATION_MODEL}`,
      ],
    }))

    const api = new HttpApi(this, 'Api', {
      apiName: 'altrobe-prompt',
      description: 'The hosted prompt box (docs/hosted-prompt-box.md). Reached through the app distribution at /api/*.',
      createDefaultStage: false,
      defaultIntegration: new HttpLambdaIntegration('Prompt', this.fn, { payloadFormatVersion: PayloadFormatVersion.VERSION_2_0 }),
    })
    // A rate limit in front of the Lambda, so a flood is turned away by API Gateway (429) before it
    // invokes anything. Real commands stay far below it: reserved concurrency already allows only 5 at once.
    new HttpStage(this, 'Stage', { httpApi: api, stageName: '$default', autoDeploy: true, throttle: { rateLimit: 10, burstLimit: 20 } })

    new StringParameter(this, 'Domain', {
      parameterName: API_DOMAIN_PARAMETER,
      stringValue: `${api.apiId}.execute-api.${stack.region}.${stack.urlSuffix}`,
      description: "The prompt API's execute-api hostname, for the app distribution's /api/* route.",
    })
  }
}

/**
 * The app distribution's /api/* behavior, built in AltrobeSite from AltrobePrompt's SSM parameter and
 * origin secret by name, so the two stacks share no CloudFormation export.
 */
export function promptBehavior(scope: Construct): BehaviorOptions {
  return {
    origin: new HttpOrigin(StringParameter.valueForStringParameter(scope, API_DOMAIN_PARAMETER), {
      protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY,
      customHeaders: { [ORIGIN_HEADER]: SecretValue.secretsManager(ORIGIN_SECRET_NAME).unsafeUnwrap() },
    }),
    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    compress: true,
    allowedMethods: AllowedMethods.ALLOW_ALL,
    cachePolicy: CachePolicy.CACHING_DISABLED,
    // The viewer's address for the per-IP limit; no cookies, no query strings, and not Host (API Gateway needs its own).
    originRequestPolicy: new OriginRequestPolicy(scope, 'PromptOriginRequest', {
      comment: 'Altrobe prompt API: viewer address and content type only',
      headerBehavior: OriginRequestHeaderBehavior.allowList('CloudFront-Viewer-Address', 'Content-Type'),
      cookieBehavior: OriginRequestCookieBehavior.none(),
      queryStringBehavior: OriginRequestQueryStringBehavior.none(),
    }),
  }
}
