import * as crypto from 'crypto';
import * as path from 'path';
import { CloudFrontToS3 } from '@aws-solutions-constructs/aws-cloudfront-s3';
import { App, Stack, StackProps, RemovalPolicy, CfnOutput, Fn, Duration, Aws } from 'aws-cdk-lib';
import { RestApi, Resource, AwsIntegration, JsonSchemaType, LogGroupLogDestination, AccessLogFormat, MethodLoggingLevel, RequestValidator, Model, CognitoUserPoolsAuthorizer, AuthorizationType, IAuthorizer } from 'aws-cdk-lib/aws-apigateway';
import { SecurityPolicyProtocol, HttpVersion, OriginProtocolPolicy, ViewerProtocolPolicy, CachePolicy, CacheHeaderBehavior, AllowedMethods } from 'aws-cdk-lib/aws-cloudfront';
import { HttpOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { IUserPool, IUserPoolClient, UserPool, AccountRecovery, ClientAttributes, UserPoolClient, UserPoolClientIdentityProvider } from 'aws-cdk-lib/aws-cognito';
import { Table, AttributeType, TableEncryption, BillingMode, StreamViewType, ITable } from 'aws-cdk-lib/aws-dynamodb';
import { ServicePrincipal, Role, PolicyDocument, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { BucketDeployment, Source, CacheControl, StorageClass } from 'aws-cdk-lib/aws-s3-deployment';
import { AwsCustomResource, PhysicalResourceId, AwsCustomResourcePolicy } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

interface UserPoolInfo {
  userpool: IUserPool;
  client: IUserPoolClient;
}

export class TODOStack extends Stack {
  readonly gatewayRole: Role;

  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    // define resources here...
    const poolInfo = this.createUserPool();

    const todoTable = new Table(this, 'TODOTable', {
      partitionKey: { name: 'id', type: AttributeType.STRING },
      removalPolicy: RemovalPolicy.RETAIN,
      contributorInsightsEnabled: true,
      encryption: TableEncryption.AWS_MANAGED,
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
    });

    const logGroup = new LogGroup(this, 'todo-app-access-logs', {
      retention: RetentionDays.ONE_MONTH,
    });
    const api = new RestApi(this, 'todo-app-backend-api', {
      cloudWatchRole: true,
      deployOptions: {
        loggingLevel: MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true,
        accessLogDestination: new LogGroupLogDestination(logGroup),
        accessLogFormat: AccessLogFormat.jsonWithStandardFields(),
        tracingEnabled: true,
      },
    });

    this.gatewayRole = new Role(this, 'api-gateway-role', {
      assumedBy: new ServicePrincipal('apigateway.amazonaws.com'),
      inlinePolicies: {
        table: new PolicyDocument({
          statements: [
            new PolicyStatement({
              actions: [
                'dynamodb:UpdateItem',
                'dynamodb:Scan',
                'dynamodb:DeleteItem',
              ],
              resources: [
                todoTable.tableArn,
              ],
            }),
          ],
        }),
      },
    });

    const requestValidator = new RequestValidator(this, 'RequestValidator', {
      restApi: api,
      validateRequestBody: true,
      validateRequestParameters: true,
    });
    const auth = new CognitoUserPoolsAuthorizer(this, 'todoAuthorizer', {
      cognitoUserPools: [poolInfo.userpool],
    });
    this.createToDoAPI(api, todoTable, requestValidator, auth);

    const cloudFrontS3 = new CloudFrontToS3(this, 'control-plane', {
      insertHttpSecurityHeaders: false,
      cloudFrontDistributionProps: {
        comment: 'It is managed by ServerlessTODO app.',
        minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2019,
        httpVersion: HttpVersion.HTTP2_AND_3,
        additionalBehaviors: {
          ['/prod/*']: {
            origin: new HttpOrigin(Fn.select(2, Fn.split('/', api.url)), {
              protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY,
            }),
            viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            cachePolicy: new CachePolicy(this, 'customCachePolicy', {
              defaultTtl: Duration.seconds(0),
              minTtl: Duration.seconds(0),
              maxTtl: Duration.seconds(1),
              enableAcceptEncodingGzip: true,
              enableAcceptEncodingBrotli: true,
              headerBehavior: CacheHeaderBehavior.allowList('authorization'),
            }),
            allowedMethods: AllowedMethods.ALLOW_ALL,
          },
        },
      },
    });
    const amplifyConfFile = 'aws-exports.json';
    const sdkCall = {
      service: 'S3',
      action: 'putObject',
      parameters: {
        Body: `{
  "aws_project_region": "${Aws.REGION}",
  "Auth": {
    "region": "${Aws.REGION}",
    "userPoolId": "${poolInfo.userpool.userPoolId}",
    "userPoolWebClientId": "${poolInfo.client.userPoolClientId}",
    "authenticationFlowType": "USER_SRP_AUTH"
  },
  "API": {
    "endpoints": [
      {
        "name": "backend-api",
        "endpoint": "https://${cloudFrontS3.cloudFrontWebDistribution.distributionDomainName}/prod/"
      }
    ]
  }
}`,
        Bucket: cloudFrontS3.s3Bucket!.bucketName,
        Key: amplifyConfFile,
      },
      physicalResourceId: PhysicalResourceId.fromResponse('ETag'),
    };
    const createAwsExportsJson = new AwsCustomResource(
      this,
      'CreateAwsExports',
      {
        onCreate: sdkCall,
        onUpdate: sdkCall,
        installLatestAwsSdk: false,
        policy: AwsCustomResourcePolicy.fromSdkCalls({
          resources: [cloudFrontS3.s3Bucket!.arnForObjects(amplifyConfFile)],
        }),
      },
    );
    const websiteDeployment = new BucketDeployment(this, 'DeployWebsite', {
      sources: [
        Source.asset(path.join(__dirname, '../frontend/dist/'), {
          exclude: [],
        }),
      ],
      destinationBucket: cloudFrontS3.s3Bucket!,
      destinationKeyPrefix: '/',
      prune: false,
      retainOnDelete: false,
      cacheControl: [CacheControl.maxAge(Duration.days(7))],
      storageClass: StorageClass.INTELLIGENT_TIERING,
      distribution: cloudFrontS3.cloudFrontWebDistribution,
      distributionPaths: ['/index.html', `/${amplifyConfFile}`, `/${strHash(this.resolve(sdkCall.parameters.Body).toString())}`],
    });
    websiteDeployment.node.addDependency(createAwsExportsJson);

    new CfnOutput(this, 'TODOAppUrl', {
      value: `https://${cloudFrontS3.cloudFrontWebDistribution.distributionDomainName}`,
      description: 'url of TODO app',
    });
  }

  createUserPool(): UserPoolInfo {
    const userpool = new UserPool(this, 'TODOUserPool', {
      signInAliases: {
        email: true,
      },
      keepOriginal: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: false,
        },
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(3),
      },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      selfSignUpEnabled: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const standardCognitoAttributes = {
      email: true,
      emailVerified: true,
      nickname: true,
      preferredUsername: true,
      name: true,
    };
    const clientReadAttributes = new ClientAttributes()
      .withStandardAttributes(standardCognitoAttributes);

    const clientWriteAttributes = new ClientAttributes()
      .withStandardAttributes({
        ...standardCognitoAttributes,
        emailVerified: false,
      });

    // 👇 User Pool Client
    const client = new UserPoolClient(this, 'userpool-client', {
      userPool: userpool,
      authFlows: {
        adminUserPassword: true,
        custom: true,
        userSrp: true,
      },
      oAuth: undefined,
      supportedIdentityProviders:
        [
          UserPoolClientIdentityProvider.COGNITO,
        ],
      readAttributes: clientReadAttributes,
      writeAttributes: clientWriteAttributes,
    });

    return {
      userpool,
      client,
    };
  }

  private createToDoAPI(api: RestApi, table: ITable, requestValidator: RequestValidator, auth: IAuthorizer): void {
    const todoResourceName = 'todo';

    const todoModel = api.addModel('todo-model', {
      contentType: 'application/json',
      schema: {
        type: JsonSchemaType.OBJECT,
        properties: {
          subject: {
            type: JsonSchemaType.STRING,
          },
          description: {
            type: JsonSchemaType.STRING,
          },
          dueDate: {
            type: JsonSchemaType.NUMBER,
          },
        },
        required: ['subject', 'description'],
      },
    });
    const todoAPI = api.root.addResource(todoResourceName, {
      defaultMethodOptions: {
        authorizer: auth,
        authorizationType: AuthorizationType.COGNITO,
      },
    });

    const createTODOIntegration = new AwsIntegration({
      service: 'dynamodb',
      action: 'UpdateItem',
      options: {
        credentialsRole: this.gatewayRole,
        requestParameters: {
          'integration.request.header.Content-Type': "'application/json'",
        },
        integrationResponses: [
          {
            statusCode: '200',
            responseTemplates: {
              'application/json': `{
  "subject": "$util.escapeJavaScript($input.path('$.Attributes.subject.S')).replaceAll(\"\\\\'\",\"'\")",
  "description": "$util.escapeJavaScript($input.path('$.Attributes.description.S')).replaceAll(\"\\\\'\",\"'\")",
  "id": "$input.path('$.Attributes.id.S')",
  "isCompleted": $input.path('$.Attributes.isCompleted.BOOL'),
  "createdTimeInMills": $input.path('$.Attributes.createdTimeInMills.N'),
  "dueDate": $input.path('$.Attributes.dueDate.N')
}
`,
            },
          },
          {
            statusCode: '400',
            selectionPattern: '4\\d{2}',
            responseTemplates: {
              'application/json': `#if($input.path('$.__type') == "com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException")
{
  "message": "the todo id already exists."
}
#end`,
            },
          },
          {
            statusCode: '500',
            responseTemplates: {
              'text/html': 'Error',
            },
            selectionPattern: '500',
          },
        ],
        requestTemplates: {
          'application/json': `#set($dueDate = $input.path('$.dueDate'))
#if($!dueDate)
#set($dueDate = -1)
#end
#set($subject = "$util.escapeJavaScript($input.path('$.subject'))")
#set($description = "$util.escapeJavaScript($input.path('$.description'))")
{
  "TableName": "${table.tableName}",
  "Key": {
    "id": {
        "S": "todo-$context.requestId"
      }
  },
  "UpdateExpression": "set subject = :s, description = :d, dueDate = :dd, createdTimeInMills = :ct, isCompleted = :ic",
  "ExpressionAttributeValues": {
      ":s": {
        "S": "$subject"
      },
      ":d": {
        "S": "$description"
      },
      ":dd": {
        "N": "$dueDate"
      },
      ":ct": {
        "N": "$context.requestTimeEpoch"
      },
      ":ic": {
        "BOOL": "False"
      }
  },
  "ConditionExpression": "attribute_not_exists(id)",
  "ReturnValues": "ALL_NEW"
}
`,
        },
      },
    });

    this.addTODOMethod(todoAPI, 'PUT', 'Create TODO item', requestValidator, createTODOIntegration, todoModel);

    const todoOpAPI = todoAPI.addResource('{todoId}');

    const updateTODOIntegration = new AwsIntegration({
      service: 'dynamodb',
      action: 'UpdateItem',
      options: {
        credentialsRole: this.gatewayRole,
        requestParameters: {
          'integration.request.header.Content-Type': "'application/json'",
        },
        integrationResponses: [
          {
            statusCode: '200',
            responseTemplates: {
              'application/json': `{
  "subject": "$util.escapeJavaScript($input.path('$.Attributes.subject.S'))",
  "id": "$input.path('$.Attributes.id.S')",
  "description": "$util.escapeJavaScript($input.path('$.Attributes.description.S'))",
  "dueDate": $input.path('$.Attributes.dueDate.N')",
  "isCompleted": $input.path('$.Attributes.isCompleted.BOOL'),
  "createdTimeInMills": $input.path('$.Attributes.createdTimeInMills.N'),
  "lastModifiedTimeInMills": $input.path('$.Attributes.lastModifiedTimeInMills.N'),  
}
`,
            },
          },
          {
            statusCode: '400',
            selectionPattern: '4\\d{2}',
            responseTemplates: {
              'application/json': `#if($input.path('$.__type') == "com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException")
{
  "message": "the TODO does NOT exists."
}
#end`,
            },
          },
          {
            statusCode: '500',
            responseTemplates: {
              'text/html': 'Error',
            },
            selectionPattern: '500',
          },
        ],
        requestTemplates: {
          'application/json': `#set($dueDate = $input.path('$.dueDate'))
#if($!dueDate)
#set($dueDate = -1)
#end          
#set($subject = "$util.escapeJavaScript($input.path('$.subject'))")
#set($description = "$util.escapeJavaScript($input.path('$.description'))")
#set($todoId = "$util.escapeJavaScript($input.params('todoId'))")  
#set($isCompleted = "$input.path('$.isCompleted')")
{
  "TableName": "${table.tableName}",
  "Key": {
    "id": {
        "S": "todo-$todoId"
      }
  },
  "UpdateExpression": "set subject = :s, description = :d, dueDate = :dd, lastModifiedTimeInMills = :ct, isCompleted = :ic",
  "ExpressionAttributeValues": {
      ":s": {
        "S": "$subject"
      },
      ":d": {
        "S": "$description"
      },
      ":dd": {
        "N": "$dueDate"
      },
      ":ct": {
        "N": "$context.requestTimeEpoch"
      },
      ":ic": {
        "BOOL": "$isCompleted"
      }      
  },
  "ConditionExpression": "attribute_exists(id)",
  "ReturnValues": "ALL_NEW"
}
`,
        },
      },
    });
    this.addTODOMethod(todoOpAPI, 'POST', 'Update TODO item', requestValidator, updateTODOIntegration, todoModel);

    // Delete
    const deleteTODOIntegration = new AwsIntegration({
      service: 'dynamodb',
      action: 'DeleteItem',
      options: {
        credentialsRole: this.gatewayRole,
        requestParameters: {
          'integration.request.header.Content-Type': "'application/json'",
        },
        integrationResponses: [
          {
            statusCode: '200',
            selectionPattern: '200',
          },
          {
            statusCode: '400',
            selectionPattern: '400',
            responseTemplates: {
              'application/json': `#if($input.path('$.__type') == "com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException")
{
  "message": "the TODO item does not exist or is not owned by you."
}
#end`,
            },
          },
          {
            statusCode: '500',
            responseTemplates: {
              'text/html': 'Error',
            },
            selectionPattern: '500',
          },
        ],
        requestTemplates: {
          'application/json': `#set($todoId = "$util.escapeJavaScript($input.params('todoId'))")  
{
  "TableName": "${table.tableName}",
  "Key": {
    "id": {
        "S": "todo-$todoId"
      }
  }
}
`,
        },
      },
    });
    this.addTODOMethod(todoOpAPI, 'DELETE', 'Delete a TODO item', requestValidator, deleteTODOIntegration);

    // List
    const getTODOsIntegration = new AwsIntegration({
      service: 'dynamodb',
      action: 'Scan',
      options: {
        credentialsRole: this.gatewayRole,
        requestParameters: {
          'integration.request.header.Content-Type': "'application/json'",
        },
        integrationResponses: [
          {
            statusCode: '200',
            responseTemplates: {
              'application/json': `#set($inputRoot = $input.path('$'))
[
  #foreach($item in $inputRoot.Items)
  {
    "id": "$item.id.S",
    "subject": "$util.escapeJavaScript($item.subject.S)",
    "description": "$util.escapeJavaScript($item.description.S)",
    "dueDate": $item.dueDate.N,
    "isCompleted": $item.isCompleted.BOOL,
    "createdTimeInMills": $item.createdTimeInMills.N
    #if("$!item.lastModifiedTimeInMills.N" != "")
    ,
    "lastModifiedTimeInMills": $item.lastModifiedTimeInMills.N
    #end
  }
  #if($foreach.hasNext),#end
  #end
]
`,
            },
          },
          {
            statusCode: '500',
            responseTemplates: {
              'text/html': 'Error',
            },
            selectionPattern: '500',
          },
        ],
        requestTemplates: {
          'application/json': `{
  "TableName": "${table.tableName}",
  "ProjectionExpression": "id, subject, description, dueDate, createdTimeInMills, lastModifiedTimeInMills, isCompleted",
  "FilterExpression": "begins_with(id, :id)",
  "ExpressionAttributeValues": {
      ":id": {"S": "todo-"}
  }
}
`,
        },
      },
    });
    this.addTODOMethod(todoAPI, 'GET', 'Get TODOs', requestValidator, getTODOsIntegration, undefined);

    new CfnOutput(this, 'TODOAPI', {
      value: `${api.url}${todoResourceName}`,
      description: 'url of TODO endpoint',
    });
  }

  private addTODOMethod(
    resource: Resource, action: string, description: string,
    requestValidator: RequestValidator,
    integration: AwsIntegration, model?: Model) {
    resource.addMethod(action, integration, {
      operationName: description,
      requestValidator,
      requestModels: model ? { 'application/json': model } : undefined,
      requestParameters: {
        'method.request.header.content-type': true,
      },
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Content-Type': true,
          },
        },
        {
          statusCode: '400',
          responseParameters: {
            'method.response.header.Content-Type': true,
          },
        },
        {
          statusCode: '404',
          responseParameters: {
            'method.response.header.Content-Type': true,
          },
        },
        {
          statusCode: '500',
          responseParameters: {
            'method.response.header.Content-Type': true,
          },
        },
      ],
    });
  }
}

function strHash(content: string): string {
  const sum = crypto.createHash('sha256');
  sum.update(content);
  return sum.digest('hex');
}

// for development, use account/region from cdk cli
const devEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new App();

new TODOStack(app, 'serverlesstodo', { env: devEnv });

app.synth();