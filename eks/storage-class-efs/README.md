# Create a EKS cluster with EFS provisioner

- Create a EKS cluster with two t3.large spot instances
- Provision the EFS provisioner
- Create a deployment with simple file uploader to mount EFS PVC
- Create a service as load balancer via AWS NLB

## How to deploy this app
### Prerequisites
- Create an EFS file system

### How to deploy
```shell
cdk deploy -c file-system-id=<your filesystemid of efs> -c vpcId=<vpc of efs>
```

