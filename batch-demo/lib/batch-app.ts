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

        const lb = new elbv2.ApplicationLoadBalancer(this, 'ALB-For-Receiver', {
            vpc,
            internetFacing: true, // set 'false' if only for intranet 
            http2Enabled: false
        });

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

        const apiPath = '/v1/new-task';
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
            pathPattern: apiPath,
            priority: 10,
            targets: [new elbv2Target.LambdaTarget(taskReceiverFn)],
        });

        new cdk.CfnOutput(this, 'Endpoint', {
            value: `http://${lb.loadBalancerDnsName}:${httpPort}${apiPath}`,
            exportName: 'TaskReceiver',
            description: 'endpoint of task receiver'
        });

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
            roleName: `BatchApp-batch-service-role`,
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
        const jobAPIPath = '/v1/jobs/'
        listener80.addTargets(`Forward-For-JobAPI`, {
            pathPattern: `${jobAPIPath}*`,
            priority: 20,
            targets: [new elbv2Target.LambdaTarget(jobAPIFn)],
        });
        new cdk.CfnOutput(this, 'Restful Endpoint', {
            value: `http://${lb.loadBalancerDnsName}:${httpPort}${jobAPIPath}<job-id>`,
            exportName: 'JobAPI',
            description: 'endpoint of job api'
        });
    }
}