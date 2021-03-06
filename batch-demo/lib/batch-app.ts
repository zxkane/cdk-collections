import apigateway = require('@aws-cdk/aws-apigateway');
import apigatewayv2 = require('@aws-cdk/aws-apigatewayv2');
import batch = require('@aws-cdk/aws-batch');
import cdk = require('@aws-cdk/core');
import dynamodb = require('@aws-cdk/aws-dynamodb');
import ec2 = require('@aws-cdk/aws-ec2');
import elbv2 = require('@aws-cdk/aws-elasticloadbalancingv2');
import elbv2Target = require('@aws-cdk/aws-elasticloadbalancingv2-targets');
import iam = require('@aws-cdk/aws-iam');
import lambda = require('@aws-cdk/aws-lambda');
import logs = require('@aws-cdk/aws-logs');
import path = require('path');
import sqs = require('@aws-cdk/aws-sqs');
import region_info = require('@aws-cdk/region-info');
import { SqsEventSource } from '@aws-cdk/aws-lambda-event-sources';
import { DockerImageAsset } from '@aws-cdk/aws-ecr-assets';

export class BatchAppStack extends cdk.Stack {

    constructor(scope: cdk.Construct, id: string, props: cdk.StackProps) {
        super(scope, id, props);

        const stack = cdk.Stack.of(this);

        const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', {
            isDefault: true,
        });
        /** 
         * create receiver lambda behind a public ALB, 
         * which sends messge to SQS queue
        */
        const queueName = 'BatchJobJobQueue';
        const pollerTimeoutInSecs = 60 * 5;

        const sqsQueue = new sqs.Queue(this, 'JobQueue', {
            queueName,
            retentionPeriod: cdk.Duration.days(7),
            /**
             * Timeout best practise suggested by doc,
             * https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html#events-sqs-queueconfig
             */
            visibilityTimeout: cdk.Duration.seconds(6 * pollerTimeoutInSecs),
            deadLetterQueue: {
                queue: new sqs.Queue(this, `${queueName}-DeadLetter`, {
                    queueName: `${queueName}-DeadLetter`,
                    retentionPeriod: cdk.Duration.days(14),
                    visibilityTimeout: cdk.Duration.seconds(6 * pollerTimeoutInSecs),
                }),
                maxReceiveCount: 5
            }
        });

        const apiMode = (this.node.tryGetContext('ApiMode') || 'ALB').toUpperCase();
        const authType = (this.node.tryGetContext('Auth') || '').toUpperCase();

        const taskReceiverFn = new lambda.Function(this, 'TaskReceiver', {
            runtime: lambda.Runtime.PYTHON_3_7,
            handler: 'task.receiver',
            code: lambda.Code.fromAsset(path.join(__dirname, '../assets/task-receiver')),
            deadLetterQueueEnabled: false,
            tracing: lambda.Tracing.ACTIVE,
            logRetention: logs.RetentionDays.ONE_WEEK,
            timeout: cdk.Duration.seconds(60),
            vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE
            },
            environment: {
                QUEUE_NAME: queueName
            }
        });

        sqsQueue.grantSendMessages(taskReceiverFn);

        /**
         * Create a DynamoDB table for presisting the job info
         */
        const jobTable = new dynamodb.Table(this, 'BatchAppJobs', {
            partitionKey: { name: 'job_id', type: dynamodb.AttributeType.STRING },
        });

        /**
         * Create AWS Batch job for 'compute' task
         */
        const JOB_DEFINITION_NAME = 'BatchAppComputing'
        const JOB_QUEUE = 'ComputeJobQueue'

        const batchServiceRole = new iam.Role(this, `BatchServiceRole`, {
            assumedBy: new iam.CompositePrincipal(
                new iam.ServicePrincipal('batch.amazonaws.com')),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSBatchServiceRole'),
            ]
        });

        const ec2Role = new iam.Role(this, `BatchEC2Role`, {
            assumedBy: new iam.CompositePrincipal(
                new iam.ServicePrincipal('ec2.amazonaws.com')),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceforEC2Role'),
            ]
        });
        const ec2IAMProfile = new iam.CfnInstanceProfile(this, 'BatchEC2RoleInstanceProfile', {
            roles: [ec2Role.roleName]
        });

        // TODO move docker image release out of stack
        const computeImage = new DockerImageAsset(this, 'ComputeImage', {
            directory: path.join(__dirname, '../assets/compute-task')
        });

        // TODO add necessary permission
        const jobRole = new iam.Role(this, 'BatchJobRole', {
            assumedBy: new iam.CompositePrincipal(
                new iam.ServicePrincipal('ecs-tasks.amazonaws.com')),
        });
        jobTable.grantReadWriteData(jobRole);
        new batch.CfnJobDefinition(this, 'ComputingBatch', {
            type: 'container',
            containerProperties: {
                image: computeImage.imageUri,
                memory: 1024,
                vcpus: 1,
                command: [
                    'python3',
                    '/app/compute.py',
                    '--jobid',
                    'Ref::JobID',
                    'Ref::TaskFlag'
                ],
                environment: [
                    {
                        name: 'TABLE_NAME',
                        value: jobTable.tableName
                    },
                    {
                        name: 'AWS_DEFAULT_REGION',
                        value: stack.region
                    }
                ],
                jobRoleArn: jobRole.roleArn
            },
            jobDefinitionName: JOB_DEFINITION_NAME,
            retryStrategy: {
                attempts: 3
            },
            timeout: {
                attemptDurationSeconds: 60 * 60
            }
        });
        
        const batchSG = new ec2.SecurityGroup(this, 'BatchSG', {
            vpc,
            allowAllOutbound: true,
            securityGroupName: 'ComputBatchSG'
        });
        const spotFleetRole = new iam.Role(this, `SpotFleetRole`, {
            assumedBy: new iam.CompositePrincipal(
                new iam.ServicePrincipal('ec2.amazonaws.com')),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2SpotFleetTaggingRole'),
            ]
        });
        const spotEnv = new batch.CfnComputeEnvironment(this, 'SpotEnv', {
            serviceRole: batchServiceRole.roleArn,
            type: 'MANAGED',
            state: 'ENABLED',
            computeResources: {
                instanceTypes: [
                    'c5.large',
                    'c5.xlarge',
                    'c5.2xlarge',
                    'c5.4xlarge',
                    'c5.9xlarge',
                    'c5.12xlarge',
                ],
                instanceRole: ec2IAMProfile.attrArn,
                maxvCpus: 128,
                minvCpus: 0,
                subnets: vpc.privateSubnets.map(subnet => subnet.subnetId),
                securityGroupIds: [batchSG.securityGroupId],
                type: 'SPOT',
                // use spot fleet
                allocationStrategy: 'SPOT_CAPACITY_OPTIMIZED',
                spotIamFleetRole: spotFleetRole.roleArn,
            }
        });
        const onDemandEnv = new batch.CfnComputeEnvironment(this, 'OnDemandEnv', {
            serviceRole: batchServiceRole.roleArn,
            type: 'MANAGED',
            state: 'ENABLED',
            computeResources: {
                instanceTypes: [
                    'c5.large',
                    'c5.xlarge',
                    'c5.2xlarge',
                    'c5.4xlarge',
                    'c5.9xlarge',
                    'c5.12xlarge',
                ],
                instanceRole: ec2IAMProfile.attrArn,
                maxvCpus: 128,
                minvCpus: 0,
                subnets: vpc.privateSubnets.map(subnet => subnet.subnetId),
                securityGroupIds: [batchSG.securityGroupId],
                type: 'EC2',
                allocationStrategy: 'BEST_FIT_PROGRESSIVE',
            }
        });
        new batch.CfnJobQueue(this, 'ComputeJobQueue', {
            computeEnvironmentOrder: [
                {
                    computeEnvironment: spotEnv.ref,
                    order: 5
                },
                {
                    computeEnvironment: onDemandEnv.ref,
                    order: 20
                }
            ],
            priority: 10,
            jobQueueName: JOB_QUEUE,
            state: 'ENABLED'
        });

        /**
         * A lambda consumes the SQS queue, it splits job to tasks 
         * then send taks to batch job queue
         */
        const jobSplitterFn = new lambda.Function(this, 'JobSplitter', {
            runtime: lambda.Runtime.PYTHON_3_7,
            handler: 'splitter.split',
            code: lambda.Code.fromAsset(path.join(__dirname, '../assets/job-splitter')),
            deadLetterQueueEnabled: false,
            tracing: lambda.Tracing.ACTIVE,
            logRetention: logs.RetentionDays.ONE_WEEK,
            timeout: cdk.Duration.seconds(pollerTimeoutInSecs),
            vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE
            },
            environment: {
                JOB_DEFINITION_NAME,
                JOB_QUEUE,
                TABLE_NAME: jobTable.tableName
            }
        });
        sqsQueue.grantConsumeMessages(jobSplitterFn);
        jobSplitterFn.addEventSource(new SqsEventSource(sqsQueue, {
            batchSize: 5 // default
        }));

        const batchPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
        });
        batchPolicy.addActions("batch:SubmitJob");
        batchPolicy.addResources(
            `arn:${stack.partition}:batch:${stack.region}:${stack.account}:job-definition/${JOB_DEFINITION_NAME}`,
            `arn:${stack.partition}:batch:${stack.region}:${stack.account}:job-queue/${JOB_QUEUE}`,
        );
        jobSplitterFn.addToRolePolicy(batchPolicy);
        jobTable.grantReadWriteData(jobSplitterFn);

        /**
         * Job API to expose job data
         */
        const jobAPIFn = new lambda.Function(this, 'JobAPI', {
            runtime: lambda.Runtime.PYTHON_3_7,
            handler: 'api.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../assets/job-api')),
            deadLetterQueueEnabled: false,
            tracing: lambda.Tracing.ACTIVE,
            logRetention: logs.RetentionDays.ONE_WEEK,
            timeout: cdk.Duration.seconds(20),
            vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE
            },
            environment: {
                TABLE_NAME: jobTable.tableName
            }
        });
        jobTable.grantReadData(jobAPIFn);

        const apiVersion = 'v1';
        const apiTasks = 'tasks';
        const apiSubmitTask = 'new-task';
        const jobAPIPath = `/${apiVersion}/${apiTasks}/`;
        const submitAPIPath = `/${apiVersion}/${apiSubmitTask}`;

        switch (apiMode) {
            case 'ALB':
                const lb = new elbv2.ApplicationLoadBalancer(this, 'ALB-For-Receiver', {
                    vpc,
                    internetFacing: true, // set 'false' if only for intranet 
                    http2Enabled: false
                });
                const httpPort = 9999; // requires ICP or whitelist for using 80/443
                const listener80 = lb.addListener('Listener80', { 
                    port: httpPort,
                    protocol: elbv2.ApplicationProtocol.HTTP
                });
                listener80.addFixedResponse('Default404', {
                    statusCode: '404',
                    contentType: elbv2.ContentType.APPLICATION_JSON,
                    messageBody: JSON.stringify({
                        msg: 'not found'
                    }),
                });
                listener80.addTargets(`Forward-For-TaskReceiverFn`, {
                    pathPattern: submitAPIPath,
                    priority: 10,
                    targets: [new elbv2Target.LambdaTarget(taskReceiverFn)],
                });
                listener80.addTargets(`Forward-For-JobAPI`, {
                    pathPattern: `${jobAPIPath}*`,
                    priority: 20,
                    targets: [new elbv2Target.LambdaTarget(jobAPIFn)],
                });
                new cdk.CfnOutput(this, 'Endpoint', {
                    value: `http://${lb.loadBalancerDnsName}:${httpPort}${submitAPIPath}`,
                    exportName: 'TaskReceiver',
                    description: 'endpoint of task receiver'
                });        
                new cdk.CfnOutput(this, 'Restful Endpoint', {
                    value: `http://${lb.loadBalancerDnsName}:${httpPort}${jobAPIPath}<job-id>`,
                    exportName: 'JobAPI',
                    description: 'endpoint of job api'
                });
                break;
            case 'RESTAPI':
                const api = new apigateway.RestApi(this, 'task-api', {
                    deployOptions: {
                        stageName: apiVersion,
                        loggingLevel: apigateway.MethodLoggingLevel.INFO,
                        dataTraceEnabled: true
                    }
                });
                const submitTask = api.root.addResource(apiSubmitTask);
                let methodOptions = {} as apigateway.MethodOptions;
                if (authType == 'IAM') {
                    methodOptions = Object.assign(methodOptions, {
                        authorizationType: apigateway.AuthorizationType.IAM,
                    });
                    
                }
                const submitTaskMethod = submitTask.addMethod('PUT', new apigateway.LambdaIntegration(taskReceiverFn), methodOptions);
                const tasks = api.root.addResource(apiTasks);
                const taskProxy = '{task}';
                const task = tasks.addResource(taskProxy);
                const queryTaskMethod = task.addMethod('GET', new apigateway.LambdaIntegration(jobAPIFn), methodOptions);
                if (authType == 'IAM') {
                    // create a role for execute APIs by any user in current account
                    const apiExecutePolicy = new iam.PolicyStatement({
                        effect: iam.Effect.ALLOW,
                        actions: [
                            "execute-api:Invoke",
                            "execute-api:InvalidateCache",
                            "execute-api:ManageConnections"
                        ],
                        resources: [
                            submitTaskMethod.methodArn, 
                            queryTaskMethod.methodArn.replace(taskProxy, '*'),
                        ],
                    });
                    new iam.Role(this, 'APIExecuteRole', {
                        roleName: `${stack.stackName}-API-Execute-Role`,
                        assumedBy: new iam.AccountPrincipal(stack.account),
                        inlinePolicies: {
                            api: new iam.PolicyDocument({
                                statements: [apiExecutePolicy]
                            }),
                        }
                    });
                }
                new cdk.CfnOutput(this, 'Endpoint', {
                    value: `${submitTask.url}`,
                    exportName: 'TaskReceiver',
                    description: 'endpoint of task receiver'
                });        
                new cdk.CfnOutput(this, 'Restful Endpoint', {
                    value: `${task.url}`,
                    exportName: 'JobAPI',
                    description: 'endpoint of job api'
                });
                break;
            case 'HTTPAPI':
                const apiv2 = new apigatewayv2.CfnApi(this, `task-api`, {
                    name: 'TaskAPI',
                    protocolType: 'HTTP',
                });
                const v1Stage = new apigatewayv2.CfnStage(this, 'V1Stage', {
                    apiId: apiv2.ref,
                    stageName: apiVersion,
                    autoDeploy: true,
                });

                const taskInfoIntegration = new apigatewayv2.CfnIntegration(this, `TaskInfoInteg`, {
                    apiId: apiv2.ref,
                    integrationType: 'AWS_PROXY',
                    connectionType: 'INTERNET',
                    description: 'Integ with lambda get task info by task id',
                    integrationUri: `arn:${stack.partition}:apigateway:${stack.region}:lambda:path/2015-03-31/functions/${jobAPIFn.functionArn}/invocations`,
                    integrationMethod: 'POST',
                    payloadFormatVersion: '1.0',
                });
                const taskInfoMethod = 'GET';
                const taskInfoRouteKey = `/${apiTasks}/{task}`;
                const taskInfoRoute = new apigatewayv2.CfnRoute(this, 'TaskInfoRoute', {
                    apiId: apiv2.ref,
                    routeKey: `${taskInfoMethod} ${taskInfoRouteKey}`,
                    authorizationType: 'NONE',
                    target: `integrations/${taskInfoIntegration.ref}`,
                });
                jobAPIFn.addPermission('invokeByHttpApi', {
                    principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
                    sourceArn: `arn:${stack.partition}:execute-api:${stack.region}:${stack.account}:${apiv2.ref}/${v1Stage.stageName}/${taskInfoMethod}${taskInfoRouteKey}`,
                });

                const submitTaskHTTPMethod = 'PUT';
                const submitTaskRouteKey = `/${apiSubmitTask}`;
                const submitTaskIntegration = new apigatewayv2.CfnIntegration(this, `SubmitTaskInteg`, {
                    apiId: apiv2.ref,
                    integrationType: 'AWS_PROXY',
                    connectionType: 'INTERNET',
                    description: 'Integ with lambda submit new task',
                    integrationUri: `arn:${stack.partition}:apigateway:${stack.region}:lambda:path/2015-03-31/functions/${taskReceiverFn.functionArn}/invocations`,
                    integrationMethod: 'POST',
                    payloadFormatVersion: '1.0',
                });
                const sumbitTaskRoute = new apigatewayv2.CfnRoute(this, 'SubmitTasksRoute', {
                    apiId: apiv2.ref,
                    routeKey: `${submitTaskHTTPMethod} ${submitTaskRouteKey}`,
                    authorizationType: 'NONE',
                    target: `integrations/${submitTaskIntegration.ref}`,
                });
                taskReceiverFn.addPermission('invokeByHttpApi', {
                    principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
                    sourceArn: `arn:${stack.partition}:execute-api:${stack.region}:${stack.account}:${apiv2.ref}/${v1Stage.stageName}/${submitTaskHTTPMethod}${submitTaskRouteKey}`,
                });

                const apiv2Deploymnet = new apigatewayv2.CfnDeployment(this, 'APIDeployment', {
                    apiId: apiv2.ref,
                    stageName: v1Stage.stageName,
                });
                apiv2Deploymnet.node.addDependency(v1Stage);
                apiv2Deploymnet.node.addDependency(taskInfoRoute);
                apiv2Deploymnet.node.addDependency(sumbitTaskRoute);

                const regionInfo = region_info.RegionInfo.get(stack.region);
                new cdk.CfnOutput(this, 'SubmitTaskEndpoint', {
                    value: `${submitTaskHTTPMethod} https://${apiv2.ref}.execute-api.${stack.region}.${regionInfo.domainSuffix}/${v1Stage.stageName}${submitTaskRouteKey}`,
                    exportName: 'TaskReceiver',
                    description: 'endpoint of task receiver'
                });
                new cdk.CfnOutput(this, 'GetInfoEndpoint', {
                    value: `${taskInfoMethod} https://${apiv2.ref}.execute-api.${stack.region}.${regionInfo.domainSuffix}/${v1Stage.stageName}${taskInfoRouteKey}`,
                    exportName: 'JobAPI',
                    description: 'endpoint of job api'
                });
                break;
            default:
                throw new Error(`Unknown api mode '${apiMode}' is specified.`);
        }
        
    }
}