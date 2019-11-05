import cdk = require('@aws-cdk/core');
import ec2 = require("@aws-cdk/aws-ec2");
import rds = require("@aws-cdk/aws-rds");
import lambda = require('@aws-cdk/aws-lambda');
import path = require('path');
import logs = require("@aws-cdk/aws-logs");
import events = require("@aws-cdk/aws-events");
import targets = require("@aws-cdk/aws-events-targets");

export class RdsAuditLogStack extends cdk.Stack {

  readonly dbclusterid: string;

  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here
    // create a vpc in two AZs
    const vpc = new ec2.Vpc(this, 'MyVPC', {
      cidr: '10.0.0.0/16',
      enableDnsHostnames: true,
      enableDnsSupport: true,
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'ingress',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 22,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE
        }
      ]
    });

    // create Aurora cluster
    const masterUser = 'master';
    const ec2InstanceType = ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE2, ec2.InstanceSize.MEDIUM);

    const dbclsterpar = new rds.CfnDBClusterParameterGroup(this, 'RDSPG', {
      description: 'parameter group of rds cluster',
      family: 'aurora-mysql5.7',
      parameters: {
        server_audit_logging: '1',
        server_audit_events: 'QUERY,QUERY_DML',
        server_audit_logs_upload: '1',
        server_audit_incl_users: [masterUser].join(','),
        server_audit_excl_users: 'rdsadmin',
      },
    });

    const rdssubnet = new rds.CfnDBSubnetGroup(this, 'RDSSubnetGroup', {
      dbSubnetGroupDescription: 'subnet group of rds cluster',
      subnetIds: vpc.privateSubnets.map(function (subnet) {
        return subnet.subnetId;
      }),
    });

    const secret = new rds.DatabaseSecret(this, 'Secret', {
      username: masterUser,
    });
    const port = 3306;

    const sg = new ec2.SecurityGroup(this, "RDS_SG", {
      vpc,
      allowAllOutbound: true,
      description: "SG_for_RDS",
      securityGroupName: "SG" 
    });
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(port), 'rds port', false);

    const dbcluster = new rds.CfnDBCluster(this, 'RDSCluster', {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL.name,
      availabilityZones: vpc.availabilityZones,
      databaseName: 'AuditLogAnalytics',
      dbClusterParameterGroupName: dbclsterpar.ref,
      dbSubnetGroupName: rdssubnet.ref,
      masterUsername: masterUser,
      masterUserPassword: secret.secretValueFromJson('password').toString(),
      port,
      vpcSecurityGroupIds: [
        sg.securityGroupId
      ],
      enableCloudwatchLogsExports: [
        'audit'
      ],
      enableIamDatabaseAuthentication: true,
    });
    dbcluster.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY, {
      applyToUpdateReplacePolicy: true
    });

    const instanceCount = 1;
    for (let i = 0; i < instanceCount; i++) {
      const instanceIdentifier = 'AuroraInstance' + (i + 1);
      const instance = new rds.CfnDBInstance(this, instanceIdentifier, {
        engine: dbcluster.engine,
        dbClusterIdentifier: dbcluster.ref,
        dbInstanceIdentifier: instanceIdentifier,
        dbInstanceClass: 'db.' + ec2InstanceType.toString(),
        dbSubnetGroupName: rdssubnet.ref,
        publiclyAccessible: false,
      });
      instance.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY, {
        applyToUpdateReplacePolicy: true
      });
    };

    this.dbclusterid = dbcluster.ref;

    // lambda function to simulate RDS requests
    const rdsSIMRequests = new lambda.Function(this, 'RDSSIMRequests', {
      runtime: lambda.Runtime.NODEJS_10_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../assets/rds-sim-requests')),
      deadLetterQueueEnabled: false,
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
      timeout: cdk.Duration.seconds(60),
      environment: {
        HOST: dbcluster.attrEndpointAddress,
        USERNAME: masterUser,
        PASSWORD: secret.secretValueFromJson('password').toString()
      },
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE
      },
    });

    new events.Rule(this, 'RDSSIMRequestsScheule', {
      enabled: true,
      description: 'Schedule a SIM RDS requeest per 2 min',
      schedule: events.Schedule.rate(cdk.Duration.minutes(2)),
      targets: [ new targets.LambdaFunction(rdsSIMRequests, {
      })]
    });
  }
}
