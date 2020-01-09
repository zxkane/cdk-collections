import * as cdk from '@aws-cdk/core';
import apigateway = require('@aws-cdk/aws-apigateway');
import lambda = require('@aws-cdk/aws-lambda');
import logs = require('@aws-cdk/aws-logs');
import path = require('path');

export class UserpoolAppclientCallbackStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here
    const userpool = this.node.tryGetContext('userpool');
    const appclient = this.node.tryGetContext('appclient');
    if (!userpool || !appclient)
      throw new Error('userpool and appclient are mandantory.');

    const callback = new lambda.Function(this, 'AppClientSigninCallback', {
      runtime: lambda.Runtime.PYTHON_3_8,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../assets/callback')),
      deadLetterQueueEnabled: false,
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
      timeout: cdk.Duration.seconds(10),
    });
    const userinfo = new lambda.Function(this, 'AppClientGetUserInfo', {
      runtime: lambda.Runtime.PYTHON_3_8,
      handler: 'decode-verify-jwt.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../assets/get-user')),
      deadLetterQueueEnabled: false,
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
      timeout: cdk.Duration.seconds(60),
      environment: {
        USERPOOL_ID: userpool,
        APP_CLIENT_ID: appclient,
      }
    });

    const apiVersion = 'v1';
    const api = new apigateway.RestApi(this, 'cognito-apis', {
      deployOptions: {
        stageName: apiVersion,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true
      }
    });
    const cognitoResource = api.root.addResource('cognito');
    const callbackPage = cognitoResource.addResource('callback');
    let methodOptions = {} as apigateway.MethodOptions;
    const callbackEndpoint = callbackPage.addMethod('GET', new apigateway.LambdaIntegration(callback), methodOptions);
    const userinfoResource = cognitoResource.addResource('user-info');
    const userinfoEndpoint = userinfoResource.addMethod('POST', new apigateway.LambdaIntegration(userinfo), methodOptions);

    new cdk.CfnOutput(this, 'Cognito App Client Signin Endpoint', {
      value: `${callbackPage.url}`,
      exportName: 'SigninCallback',
      description: 'Signin Callback'
    });
  }
}
