import cdk = require('@aws-cdk/core');
import ec2 = require('@aws-cdk/aws-ec2');
import iam = require('@aws-cdk/aws-iam');

export class Ec2LaunchTemplateMultipleRegionsStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here
    const stack = cdk.Stack.of(this);
    // create ec2's instance profile for pushing metrics and get conf of cloudwatch Agent
    const ec2Role = new iam.Role(this, `EC2LaunchRole-${stack.region}`, {
      roleName: `EC2LaunchRole-${stack.region}`,
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('ec2.amazonaws.com')),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ]
    });
    const ec2IAMProfile = new iam.CfnInstanceProfile(this, 'EC2LaunchRoleInstanceProfile', {
      roles: [ ec2Role.roleName ]
    });

    /** 
     * create launch template to install ssm agent, cloudwatch agent and essential softwares when launching phase, 
     * also give the role of ec2
    */
    const myInstanceLaunchTemplate = new ec2.CfnLaunchTemplate(this, 'MyInstancesLaunchTemplate', {
      launchTemplateName: 'my-instances-launch-template',
      launchTemplateData: {
        iamInstanceProfile: {
          arn: ec2IAMProfile.attrArn,
        },
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO).toString(),
        userData: cdk.Fn.base64(`#!/bin/bash -xe
          DISTRIBUTION="amazon_linux"
          CPE=""
          if [ -e "/etc/system-release-cpe" ]; then CPE=$(</etc/system-release-cpe);
          elif [ -e "/etc/os-release" ]; then 
            CPE=$(cat /etc/os-release | grep CPE_NAME | cut -d'=' -f2)
            if [ "$CPE" == "" ]; then
              DISTRIBUTION=$(cat /etc/os-release | grep ^ID= | cut -d'=' -f2)
            fi
          fi
          if [ "$CPE" != "" ]; then 
            IFS=':' read -ra cpe_array <<< "$CPE"
            DISTRIBUTION=\${cpe_array[2]}
            if [ "$DISTRIBUTION" == "o" ]; then
              DISTRIBUTION="amazon_linux"
            fi
          fi
          case "$DISTRIBUTION" in
          "debian"|"ubuntu")
            TEMP_DEB="$(mktemp)" &&
            wget -O "$TEMP_DEB" "https://s3.${stack.region}.amazonaws.com/amazoncloudwatch-agent-${stack.region}/$DISTRIBUTION/amd64/latest/amazon-cloudwatch-agent.deb" &&
            dpkg -i "$TEMP_DEB"
            rm -f "$TEMP_DEB"
            if [ "$DISTRIBUTION" == "debian" ]; then
              wget -O "$TEMP_DEB" https://s3.amazonaws.com/ec2-downloads-windows/SSMAgent/latest/debian_amd64/amazon-ssm-agent.deb
              dpkg -i "$TEMP_DEB"
              rm -f "$TEMP_DEB"
            else
              snap install amazon-ssm-agent --classic
            fi
            ;;
          *) # amazon linux/linux2, centos, rhel
            yum update -y
            yum install -y https://s3.amazonaws.com/ec2-downloads-windows/SSMAgent/latest/linux_amd64/amazon-ssm-agent.rpm
            yum install -y docker tmux
            rpm -Uvh https://s3.${stack.region}.amazonaws.com/amazoncloudwatch-agent-${stack.region}/$DISTRIBUTION/amd64/latest/amazon-cloudwatch-agent.rpm
            systemctl start docker.service
            case "$DISTRIBUTION" in
            "amazon_linux"|"amazon_linux2") 
              usermod -a -G docker ec2-user
              ;;
            esac
            ;;
          esac
        `)
      }
    });
  }
}
