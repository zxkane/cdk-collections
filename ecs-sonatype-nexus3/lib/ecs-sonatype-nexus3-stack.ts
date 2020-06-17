import cdk = require('@aws-cdk/core');
import cfn = require('@aws-cdk/aws-cloudformation');
import ec2 = require('@aws-cdk/aws-ec2');
import ecs = require('@aws-cdk/aws-ecs');
import * as efs from '@aws-cdk/aws-efs';
import elbv2 = require('@aws-cdk/aws-elasticloadbalancingv2');
import iam = require('@aws-cdk/aws-iam');
import lambda = require('@aws-cdk/aws-lambda');
import lambdaNodejs = require('@aws-cdk/aws-lambda-nodejs');
import s3 = require('@aws-cdk/aws-s3');
import fs = require('fs');
import path = require('path');

export class EcsSonatypeNexus3Stack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const stack = cdk.Stack.of(this);
    // The code that defines your stack goes here
    const vpc = ec2.Vpc.fromLookup(this, 'vpc', {
      isDefault: true
    });

    const albPort80 = 80;
    const albSG = new ec2.SecurityGroup(this, "ALBSG", {
      vpc,
      allowAllOutbound: false,
      description: "SG of ALB",
    });
    const nexus3ALB = new elbv2.ApplicationLoadBalancer(this, 'Nexus3ALB', {
      vpc,
      internetFacing: true,
      http2Enabled: true,
      securityGroup: albSG
    });

    const cluster = new ecs.Cluster(this, `Nexus3Cluster`, {
      vpc,
    });

    // use custom resource to create task definition to support EFS volume
    const ecsRulePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ecs:RegisterTaskDefinition",
        "ecs:ListTaskDefinitions",
        "ecs:DescribeTaskDefinition",
      ],
      resources: ['*'],
    });
    const ecsTaskDefRole = new iam.Role(this, `CustomResource-ECS-Role`, {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        ecs: new iam.PolicyDocument({
          statements: [ecsRulePolicy]
        }),
        iam: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "iam:PassRole",
              ],
              resources: ['*'],
            })
          ]
        })
      },
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ]
    });
    const ecsTaskDefHandler = new lambdaNodejs.NodejsFunction(this, `ECSTaskDefinitionHandler`, {
      role: ecsTaskDefRole,
      runtime: lambda.Runtime.NODEJS_12_X,
      entry: path.join(__dirname, '../assets/ecs-task-def/ecs.ts'),
      handler: 'taskDefinition',
      minify: false,
      sourceMaps: true,
      timeout: cdk.Duration.minutes(2),
    });

    const nexusBlobBucket = new s3.Bucket(this, `nexus3-blobstore`);

    const s3BucketPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:ListBucket',
        's3:CreateBucket',
        's3:GetBucketAcl',
      ],
      resources: ['*'],
    });
    const s3ObjectPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:PutObject',
        's3:GetObject',
        's3:DeleteObject',
        's3:PutObjectTagging',
        's3:GetObjectTagging',
        's3:DeleteObjectTagging',
        's3:GetLifecycleConfiguration',
        's3:PutLifecycleConfiguration',
      ],
      resources: [
        nexusBlobBucket.bucketArn,
        nexusBlobBucket.arnForObjects('*')
      ],
    });
    const nexus3TaskRole = new iam.Role(this, `Nexus3-Task-Role`, {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      inlinePolicies: {
        s3: new iam.PolicyDocument({
          statements: [s3BucketPolicy, s3ObjectPolicy]
        }),
      },
    });

    const logsPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "logs:CreateLogGroup",
      ],
      resources: ['*'],
    });
    const executionRole = new iam.Role(this, `Nexus3-Execution-Role`, {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
      inlinePolicies: {
        logs: new iam.PolicyDocument({
          statements: [logsPolicy]
        }),
      }
    });

    const fileSystem = new efs.FileSystem(this, 'Nexus3FileSystem', {
      vpc,
      encrypted: false,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_14_DAYS,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING
    });

    const nexus3Port = 8081;
    const nexus3SG = new ec2.SecurityGroup(this, "Nexus3ServiceSG", {
      vpc,
      description: "SG of Nexus3 repo manager",
      allowAllOutbound: true, // need internet access
    });

    fileSystem.connections.allowDefaultPortFrom(nexus3SG,
      'allow access efs from nexus3 security group');
    nexus3SG.addIngressRule(albSG, ec2.Port.tcp(nexus3Port), 'Allow requests from ALB.');
    albSG.addEgressRule(nexus3SG, ec2.Port.tcp(nexus3Port), 'Access to Nexus3 service from ALB.');

    const containerName = 'nexus3';
    // FIXME: Nexus3 fails to be started when using same share data that is used by another running instance
    const nexus3TaskDef = new cfn.CustomResource(this, `CFN-CustomResource-ECS-TaskDefinition`, {
      provider: cfn.CustomResourceProvider.lambda(ecsTaskDefHandler),
      resourceType: 'Custom::ECS-TaskDefinition',
      properties: {
        ContainerName: containerName,
        ContainerPort: nexus3Port,
        FileSystemId: fileSystem.fileSystemId,
        FileSystemRootDirectory: '/',
        Family: 'nexus3',
        TaskRoleARN: nexus3TaskRole.roleArn,
        ExecutionRoleARN: executionRole.roleArn,
        Region: this.region,
        Template: Buffer.from(fs.readFileSync(path.join(__dirname, './nexus3-task.json'), 'utf-8')).toString('base64'),
      }
    });

    const listener80 = nexus3ALB.addListener('Listener80', {
      port: albPort80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: true,
    });

    const albTarget : elbv2.IApplicationLoadBalancerTarget = {
      attachToApplicationTargetGroup(targetGroup) {

        const nexusService = new ecs.CfnService(stack, `Nexus3Service`, {
          cluster: cluster.clusterArn,
          desiredCount: 1,
          enableEcsManagedTags: true,
          healthCheckGracePeriodSeconds: 180,
          launchType: ecs.LaunchType.FARGATE,
          loadBalancers: [
            {
              containerName: containerName,
              containerPort: nexus3Port,
              targetGroupArn: targetGroup.targetGroupArn,
            }
          ],
          networkConfiguration: {
            awsvpcConfiguration: {
              subnets: vpc.privateSubnets.map(subnet => subnet.subnetId),
              securityGroups: [nexus3SG.securityGroupId],
              assignPublicIp: 'DISABLED'
            }
          },
          platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
          propagateTags: ecs.PropagatedTagSource.SERVICE,
          taskDefinition: `${nexus3TaskDef.getAttString('taskDefinitionArn')}`,
          serviceName: `Nexus3-Service`,
        });
        nexusService.node.addDependency(listener80);

        return { targetType: elbv2.TargetType.IP };
      },
    };

    const nexus3TargetGroup = new elbv2.ApplicationTargetGroup(this, 'Nexus3TargetGroup', {
      deregistrationDelay: cdk.Duration.seconds(200),
      healthCheck: {
        protocol: elbv2.Protocol.HTTP,
        path: '/',
        port: `${nexus3Port}`,
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 5,
        interval: cdk.Duration.seconds(30),
      },
      protocol: elbv2.ApplicationProtocol.HTTP,
      slowStart: cdk.Duration.seconds(180),
      targets: [albTarget],
      port: nexus3Port,
      vpc,
    });

    
    listener80.addTargetGroups(`Forward-To-Nexus3-Proxy-Repo`, {
      targetGroups: [nexus3TargetGroup],
    });

    new cdk.CfnOutput(this, 'Endpoint', {
      value: `http://${nexus3ALB.loadBalancerDnsName}`,
      description: 'endpoint of Nexus3 ALB'
    });
  }
}
