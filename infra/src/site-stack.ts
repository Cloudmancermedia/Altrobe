import { existsSync } from 'node:fs'
import { Annotations, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib'
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager'
import {
  AllowedMethods, CachePolicy, Distribution, Function as CfFunction, FunctionCode, FunctionEventType, HeadersFrameOption,
  HeadersReferrerPolicy, ResponseHeadersPolicy, ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront'
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins'
import { Role } from 'aws-cdk-lib/aws-iam'
import { ARecord, AaaaRecord, RecordTarget, type IHostedZone } from 'aws-cdk-lib/aws-route53'
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets'
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3'
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment'
import type { Construct } from 'constructs'

export interface SiteStackProps extends StackProps {
  zone: IHostedZone
  domainName: string
  /** The GitHub deploy role (CiStack), granted the bundle bucket and invalidations by name. */
  deployRoleName: string
  /** The GitHub publish role (CiStack), granted the bundle bucket and asset invalidations by name. */
  publishRoleName: string
  /** The static web build (`npm --prefix web run build:static`). Without it, nothing is deployed to the site bucket. */
  webDistPath?: string
}

// The public site: the web app at altrobe.com (www redirects to it) and the baked game bundles at
// assets.altrobe.com, on separate buckets and hostnames (docs/hosted-pipeline.md). Both buckets
// are private; CloudFront reads them through origin access control. Bundles are data: the publish
// step uploads them with the publish role (or the deploy role by hand), never through CDK.
export class SiteStack extends Stack {
  constructor(scope: Construct, id: string, props: SiteStackProps) {
    super(scope, id, props)
    const apex = props.domainName
    const www = `www.${apex}`
    const assets = `assets.${apex}`

    // CloudFront needs the certificate in us-east-1; this stack is deployed there.
    const certificate = new Certificate(this, 'Certificate', {
      domainName: apex,
      subjectAlternativeNames: [www, assets],
      validation: CertificateValidation.fromDns(props.zone),
    })

    const privateBucket = (id: string) => new Bucket(this, id, {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    })
    const siteBucket = privateBucket('SiteBucket')
    const bundleBucket = privateBucket('BundleBucket')

    // www.altrobe.com answers with a permanent redirect to the same path on the apex.
    const toApex = new CfFunction(this, 'WwwToApex', {
      code: FunctionCode.fromInline(`function handler(event) {
  var request = event.request;
  if (request.headers.host && request.headers.host.value === '${www}') {
    return { statusCode: 301, statusDescription: 'Moved Permanently', headers: { location: { value: 'https://${apex}' + request.uri } } };
  }
  return request;
}`),
    })

    // Vite names everything under static/ by content hash, so browsers may keep it for good. index.html
    // names the current hashes and changes on every deploy, so browsers recheck it each time.
    const cacheControlHeaders = (id: string, value: string) => new ResponseHeadersPolicy(this, id, {
      customHeadersBehavior: { customHeaders: [{ header: 'Cache-Control', value, override: true }] },
    })
    const appPageHeaders = cacheControlHeaders('AppPageHeaders', 'no-cache')
    const appStaticHeaders = cacheControlHeaders('AppStaticHeaders', 'public, max-age=31536000, immutable')
    const siteOrigin = S3BucketOrigin.withOriginAccessControl(siteBucket)

    const appDistribution = new Distribution(this, 'AppDistribution', {
      domainNames: [apex, www],
      certificate,
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: siteOrigin,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: appPageHeaders,
        functionAssociations: [{ function: toApex, eventType: FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        'static/*': {
          origin: siteOrigin,
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          compress: true,
          cachePolicy: CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: appStaticHeaders,
          functionAssociations: [{ function: toApex, eventType: FunctionEventType.VIEWER_REQUEST }],
        },
      },
      // The app routes in the browser: unknown paths get index.html (S3 answers 403 for a missing key
      // through origin access control).
      errorResponses: [403, 404].map((code) => ({ httpStatus: code, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.minutes(1) })),
      comment: `${apex} web app`,
    })

    // Models and textures under {product}/{build}/v{N}/ never change, so they are cached for a year.
    // {product}/current.json moves when a new build is published, so it is cached for a minute. A build's
    // JSON (catalog, sets, items) can be rewritten when a bake change republishes the same build: CloudFront
    // keeps it until the publish step invalidates the build, and browsers recheck it after five minutes.
    const buildCache = new CachePolicy(this, 'BuildCache', {
      defaultTtl: Duration.days(365), minTtl: Duration.days(1), maxTtl: Duration.days(365),
      enableAcceptEncodingGzip: true, enableAcceptEncodingBrotli: true,
    })
    const pointerCache = new CachePolicy(this, 'PointerCache', {
      defaultTtl: Duration.minutes(1), minTtl: Duration.seconds(0), maxTtl: Duration.minutes(1),
      enableAcceptEncodingGzip: true, enableAcceptEncodingBrotli: true,
    })
    // The cache policies above set CloudFront's TTLs only; Cache-Control tells browsers the same, so a
    // returning visitor reuses the files it already has.
    const assetHeaderConfig = (cacheControl: string) => ({
      customHeadersBehavior: { customHeaders: [{ header: 'Cache-Control', value: cacheControl, override: true }] },
      corsBehavior: {
        accessControlAllowOrigins: [`https://${apex}`],
        accessControlAllowMethods: ['GET', 'HEAD'],
        accessControlAllowHeaders: ['*'],
        accessControlAllowCredentials: false,
        accessControlMaxAge: Duration.days(1),
        originOverride: true,
      },
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
      },
    })
    const assetHeaders = new ResponseHeadersPolicy(this, 'AssetHeaders', assetHeaderConfig('public, max-age=31536000, immutable'))
    const pointerHeaders = new ResponseHeadersPolicy(this, 'PointerHeaders', assetHeaderConfig('public, max-age=60'))
    const dataHeaders = new ResponseHeadersPolicy(this, 'DataHeaders', assetHeaderConfig('public, max-age=300'))
    const bundleOrigin = S3BucketOrigin.withOriginAccessControl(bundleBucket)
    const assetDistribution = new Distribution(this, 'AssetDistribution', {
      domainNames: [assets],
      certificate,
      defaultBehavior: {
        origin: bundleOrigin,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: buildCache,
        responseHeadersPolicy: assetHeaders,
      },
      additionalBehaviors: {
        '*/current.json': {
          origin: bundleOrigin,
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          compress: true,
          allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: pointerCache,
          responseHeadersPolicy: pointerHeaders,
        },
        '*.json': {
          origin: bundleOrigin,
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          compress: true,
          allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: buildCache,
          responseHeadersPolicy: dataHeaders,
        },
      },
      comment: `${assets} game bundles`,
    })

    for (const [name, distribution] of [[apex, appDistribution], [www, appDistribution], [assets, assetDistribution]] as const) {
      const target = RecordTarget.fromAlias(new CloudFrontTarget(distribution))
      const recordName = name === apex ? undefined : name
      new ARecord(this, `${name}-A`, { zone: props.zone, recordName, target })
      new AaaaRecord(this, `${name}-AAAA`, { zone: props.zone, recordName, target })
    }

    // Imported by name, so these grants live in this stack and CiStack never waits on it.
    const deployRole = Role.fromRoleName(this, 'DeployRole', props.deployRoleName)
    bundleBucket.grantReadWrite(deployRole)
    appDistribution.grantCreateInvalidation(deployRole)
    assetDistribution.grantCreateInvalidation(deployRole)
    // Publishing deletes builds older than the previous one, so it needs delete as well as write.
    const publishRole = Role.fromRoleName(this, 'PublishRole', props.publishRoleName)
    bundleBucket.grantReadWrite(publishRole)
    bundleBucket.grantDelete(publishRole)
    assetDistribution.grantCreateInvalidation(publishRole)

    if (props.webDistPath && existsSync(props.webDistPath)) {
      new BucketDeployment(this, 'WebDeployment', {
        sources: [Source.asset(props.webDistPath)],
        destinationBucket: siteBucket,
        distribution: appDistribution,
        distributionPaths: ['/*'],
        memoryLimit: 512,
      })
    } else {
      Annotations.of(this).addWarning(`No web build at ${props.webDistPath ?? '(unset)'}: the site bucket's contents are left as they are. Run npm --prefix web run build:static first to deploy the app.`)
    }

    new CfnOutput(this, 'BundleBucketName', { value: bundleBucket.bucketName, description: 'GitHub repository variable BUNDLE_BUCKET' })
    new CfnOutput(this, 'AssetDistributionId', { value: assetDistribution.distributionId, description: 'GitHub repository variable ASSET_DISTRIBUTION_ID' })
    new CfnOutput(this, 'AppDistributionId', { value: appDistribution.distributionId })
  }
}
