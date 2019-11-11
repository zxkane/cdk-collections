# Create a EC2 launch template with SSM, Cloudwatch agents and essential softwares in all regions

- Create an instance role with SSM, Cloudwatch managed permissions
- Create the EC2 launch template to install Cloudwatch agent, SSM Agent and essential softwares, such as docker, tmux

### How to deploy
```shell
npm i
cdk deploy 'MyEc2LaunchTemplate*' --require-approval never
# create launch templates in China regions
cdk deploy 'MyEc2LaunchTemplate*' --require-approval never --region cn-northwest-1
```

### Bonus
A simple shell function to launch EC2 instance via above launch template in any region
```shell
function ec2-launch {
  templateName='my-instances-launch-template'
  region="$1"
  if [ -z "$region" ]; then
    echo 'missing region' >> /dev/stderr
    exit 100
  fi
  amiid=`aws ssm get-parameters --names /aws/service/ami-amazon-linux-latest/amzn2-ami-hvm-x86_64-gp2 --query 'Parameters[0].[Value]' --output text --region $region`
  keyname=`aws ec2 describe-key-pairs --output text --query 'KeyPairs[0].KeyName' --region $region`
  vpcid=`aws ec2 describe-vpcs --filters 'Name=isDefault,Values=true' --out text --query 'Vpcs[0].VpcId' --region $region`
  sgids=`aws ec2 describe-security-groups --filters "Name=vpc-id,Values=\$vpcid" --query 'SecurityGroups[*].GroupId' --output text --region $region`
  templateVersion=`aws ec2 describe-launch-templates --launch-template-name $templateName --query 'LaunchTemplates[0].LatestVersionNumber' --output text --region $region`
  aws ec2 run-instances --launch-template "LaunchTemplateName=$templateName,Version=$templateVersion" --image-id "$amiid" --associate-public-ip-address  --key-name "$keyname" --security-group-ids "$sgids" --query 'Instances[*].{Instance:InstanceId,AZ:Placement.AvailabilityZone,Dns:NetworkInterfaces[0].Association.PublicDnsName,State:State.Name}' --output table --region $@
}

# launch a default instance in ap-east-1
ec2-launch ap-east-1
# launch a c5.xlarge instance in ap-northeast-1
ec2-launch ap-northeast-1 --instance-type c5.xlarge
```