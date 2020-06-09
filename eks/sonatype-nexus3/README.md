# Deploying Sonatype Nexus3 on EKS

Deploy Sonatype Nexus3 via Helm on EKS.

- Use EFS via EFS CSI driver, PV and PVC as Nexus3 data storage
- Create a dedicated S3 bucket as Nexus3 blobstore
- Use external DNS to create record in Route53 for ingress domain name 
- Use ACM to get certificate of domain name

## Usage

### Prerequisites
- A public hosted zone in Route53(optional)
- Has default VPC with public and private subnets cross two available zones at least
- Install dependencies of app
```
npm run init
```

### Deploy app in managed EC2 nodes
```
npm run deploy -- -c domainName=<the hostname of nexus3 deployment>
```

### Deploy app with Route53 managed domain name
```
npm run deploy -- -c domainName=<nexus.mydomain.com> -c r53Domain=<mydomain.com>
```