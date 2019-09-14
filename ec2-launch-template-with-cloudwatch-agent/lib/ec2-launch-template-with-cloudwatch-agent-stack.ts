import cdk = require('@aws-cdk/core');
import ssm = require('@aws-cdk/aws-ssm');
import iam = require('@aws-cdk/aws-iam');
import ec2 = require('@aws-cdk/aws-ec2');

export class Ec2LaunchTemplateWithCloudwatchAgentStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // create parameter store value for configuration of cloudwatch agent
    const SSMPrefix = 'AmazonCloudWatch-';
    const parameterName = SSMPrefix + 'linux';
    const param = new ssm.StringParameter(this, 'CloudWatchAgentConf', {
      description: 'Configuration of CloudWatch Agent for Linux',
      parameterName,
      stringValue: `
          {
            "metrics":{
              "metrics_collected":{
                  "disk": {
                    "measurement": [
                      "used_percent",
                      "inodes_free"
                    ],
                    "metrics_collection_interval": 60,
                    "resources": [
                      "*"
                    ]
                  },
                  "mem":{
                    "measurement":[
                        "mem_used_percent"
                    ],
                    "metrics_collection_interval": 60
                  },
                  "swap":{
                    "measurement":[
                        "swap_used_percent"
                    ],
                    "metrics_collection_interval": 60
                  }
              }
            }
        }
      `,
    });

    // create ec2's instance profile for pushing metrics and get conf of cloudwatch Agent
    const ec2Role = new iam.Role(this, 'CloudWatchAgentRole', {
      roleName: 'CloudWatchAgentRole',
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('ec2.amazonaws.com')),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ]
    });
    const ec2IAMProfile = new iam.CfnInstanceProfile(this, 'CloudWatchAgentRoleInstanceProfile', {
      roles: [ ec2Role.roleName ]
    });

    // create launch template to install cloudwatch agent and speicfy the role of ec2
    const cloudwatchAgentLaunchTemplate = new ec2.CfnLaunchTemplate(this, 'CloudWatchAgent', {
      launchTemplateName: 'CloudWatchAgent',
      launchTemplateData: {
        iamInstanceProfile: {
          arn: ec2IAMProfile.attrArn,
        },
        userData: cdk.Fn.base64(`
          #!/bin/bash
          rpm -Uvh https://s3.${cdk.Stack.of(this).region}.amazonaws.com/amazoncloudwatch-agent-${cdk.Stack.of(this).region}/amazon_linux/amd64/latest/amazon-cloudwatch-agent.rpm
          /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c ssm:${parameterName} -s
        `)
      }
    });
  }
}
