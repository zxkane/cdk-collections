import { App, Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import { RestApi, Resource, AwsIntegration, JsonSchemaType, LogGroupLogDestination, AccessLogFormat, MethodLoggingLevel, RequestValidator, Model } from 'aws-cdk-lib/aws-apigateway';
import { Table, AttributeType, TableEncryption, BillingMode, StreamViewType, ITable } from 'aws-cdk-lib/aws-dynamodb';
import { ServicePrincipal, Role, PolicyDocument, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export class TODOStack extends Stack {
  readonly gatewayRole: Role;

  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    // define resources here...
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
    this.createToDoAPI(api, todoTable, requestValidator);
  }

  private createToDoAPI(api: RestApi, table: ITable, requestValidator: RequestValidator): void {
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
        required: ['subject', 'description', 'dueDate'],
      },
    });
    const todoAPI = api.root.addResource(todoResourceName, {
      defaultMethodOptions: {
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
#set($subject = "$util.escapeJavaScript($input.path('$.subject'))")
#set($description = "$util.escapeJavaScript($input.path('$.description'))")
{
  "TableName": "${table.tableName}",
  "Key": {
    "id": {
        "S": "todo-$context.requestId"
      }
  },
  "UpdateExpression": "set subject = :s, description = :d, dueDate = :dd, createdTimeInMills = :ct",
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
#set($subject = "$util.escapeJavaScript($input.path('$.subject'))")
#set($description = "$util.escapeJavaScript($input.path('$.description'))")
#set($todoId = "$util.escapeJavaScript($input.params('todoId'))")  
{
  "TableName": "${table.tableName}",
  "Key": {
    "id": {
        "S": "todo-$todoId"
      }
  },
  "UpdateExpression": "set subject = :s, description = :d, dueDate = :dd, lastModifiedTimeInMills = :ct",
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
  "ProjectionExpression": "id, subject, description, dueDate, createdTimeInMills, lastModifiedTimeInMills",
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

// for development, use account/region from cdk cli
const devEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new App();

new TODOStack(app, 'serverlesstodo', { env: devEnv });

app.synth();