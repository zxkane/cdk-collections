# Create a EKS cluster to expose a service via AWS ELB

- Create a EKS cluster with two m5.large instances
- Create a deployment with three replicas in EKS
- Create a service as load balancer via AWS CLB or NLB

## How to deploy this app
```shell
cdk deploy
```
or use NLB as load balancer
```shell
cdk deploy -c load-balancer-type=nlb
```