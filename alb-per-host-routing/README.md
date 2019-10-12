# Create an ALB(application load balancer) to serve multiple domain hosts

- Create a ECS cluster using fargate services
- Create a SSL certificate in ACM for all domains
- Create an ALB to route different different fargate services per hosts
- Update existing Route53 hosted zone for new domain name

## How to deploy this app
### Prerequisites
- Create the public hosted zones in Route 53 for your domains

### Steps
```shell
cdk deploy -c hosts=1.test.kane.mx,2.aws.kane.mx,4.aws.kane.mx
```