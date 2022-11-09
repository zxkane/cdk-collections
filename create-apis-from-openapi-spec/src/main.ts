import * as fs from 'fs';
import * as path from 'path';
import { App, Stack, StackProps, Duration, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import { MethodLoggingLevel, ApiDefinition, SpecRestApi } from 'aws-cdk-lib/aws-apigateway';
import { CfnStage, CfnApi } from 'aws-cdk-lib/aws-apigatewayv2';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import * as Mustache from 'mustache';
/* eslint @typescript-eslint/no-require-imports: "off" */
const yaml = require('js-yaml');

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
    const variables = {
      integrationRoleArn: apiRole.roleArn,
      queueName: bufferQueue.queueName,
      queueUrl: bufferQueue.queueUrl,
    };
    const openAPISpec = this.resolve(yaml.load(Mustache.render(
      fs.readFileSync(path.join(__dirname, './http-sqs.yaml'), 'utf-8'), variables)));

    const httpApi = new CfnApi(this, 'http-api-to-sqs', {
      body: openAPISpec,
      failOnWarnings: false,
    });

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

const app = new App();

new MyStack(app, 'create-apis-from-openapi-spec');

app.synth();