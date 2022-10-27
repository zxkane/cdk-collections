import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { App, Stack, StackProps, Duration, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import { MethodLoggingLevel, ApiDefinition, SpecRestApi } from 'aws-cdk-lib/aws-apigateway';
import { CfnStage, CfnApi } from 'aws-cdk-lib/aws-apigatewayv2';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { AwsCustomResource, PhysicalResourceId, AwsCustomResourcePolicy } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import * as Mustache from 'mustache';

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    // define resources here...
    const bufferQueue = new Queue(this, 'event-queue', {
      encryption: QueueEncryption.SQS_MANAGED,
      visibilityTimeout: Duration.seconds(30),
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const apiRole = new Role(this, 'api-gateway-role', {
      assumedBy: new ServicePrincipal('apigateway.amazonaws.com'),
    });
    bufferQueue.grantSendMessages(apiRole);

    // import openapi as http api
    const bucket = new Bucket(this, 'provisioning-bucket', {
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const variables = {
      integrationRoleArn: apiRole.roleArn,
      queueName: bufferQueue.queueName,
      queueUrl: bufferQueue.queueUrl,
    };
    const openAPISpec = this.resolve(Mustache.render(
      fs.readFileSync(path.join(__dirname, './http-sqs.yaml'), 'utf-8'), variables));

    const contentHash = strHash(JSON.stringify(openAPISpec));

    const openAPIFile = `install/openapi-${contentHash}.yaml`;
    const sdkPutCall = {
      service: 'S3',
      action: 'putObject',
      parameters: {
        Body: openAPISpec,
        Bucket: bucket.bucketName,
        Key: openAPIFile,
      },
      physicalResourceId: PhysicalResourceId.of(`openapi-upsert-${contentHash}`),
    };
    const sdkDeleteCall = {
      service: 'S3',
      action: 'deleteObject',
      parameters: {
        Bucket: bucket.bucketName,
        Key: openAPIFile,
      },
      physicalResourceId: PhysicalResourceId.of(`openapi-delete-${contentHash}`),
    };
    const createOpenAPIFile = new AwsCustomResource(
      this,
      'CreateOpenAPIDefinition',
      {
        onCreate: sdkPutCall,
        onUpdate: sdkPutCall,
        onDelete: sdkDeleteCall,
        installLatestAwsSdk: false,
        policy: AwsCustomResourcePolicy.fromSdkCalls({
          resources: [bucket.arnForObjects('install/openapi-*.yaml')],
        }),
      },
    );

    const httpApi = new CfnApi(this, 'http-api-to-sqs', {
      bodyS3Location: {
        bucket: bucket.bucketName,
        key: openAPIFile,
      },
      failOnWarnings: false,
    });
    httpApi.node.addDependency(createOpenAPIFile);

    new CfnStage(this, 'DefaultStage', {
      apiId: httpApi.ref,
      stageName: '$default',
      autoDeploy: true,
    });
    new CfnOutput(this, 'HttpAPIEndpoint', {
      value: httpApi.attrApiEndpoint,
      description: 'url of http api',
    });

    // import openapi as REST api
    const deployOptions = {
      stageName: '',
      loggingLevel: MethodLoggingLevel.ERROR,
      dataTraceEnabled: false,
      metricsEnabled: true,
      tracingEnabled: false,
    };
    const restOpenAPISpec = this.resolve(Mustache.render(
      fs.readFileSync(path.join(__dirname, './rest-sqs.yaml'), 'utf-8'),
      variables));
    new SpecRestApi(this, 'rest-to-sqs', {
      apiDefinition: ApiDefinition.fromInline(restOpenAPISpec),
      endpointExportName: 'APIEndpoint',
      deployOptions,
    });
  }
}

function strHash(content: string): string {
  const sum = crypto.createHash('sha256');
  sum.update(content);
  return sum.digest('hex');
}

const app = new App();

new MyStack(app, 'create-apis-from-openapi-spec');

app.synth();