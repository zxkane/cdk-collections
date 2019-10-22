import cdk = require('@aws-cdk/core');
import eks = require('@aws-cdk/aws-eks');
import ec2 = require('@aws-cdk/aws-ec2');
import iam = require('@aws-cdk/aws-iam');

export class EKSLoadbalancerStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here
    const vpc = new ec2.Vpc(this, 'EKS-VPC', {
      cidr: '10.8.0.0/16',
      enableDnsHostnames: true,
      enableDnsSupport: true,
      maxAzs: 2,
      subnetConfiguration: [ 
        { 
          cidrMask: 24, 
          name: 'Public', 
          subnetType: ec2.SubnetType.PUBLIC
        }, 
        { 
          cidrMask: 24, 
          name: 'Private', 
          subnetType: ec2.SubnetType.PRIVATE
        }
      ]
    });
    // const vpc = ec2.Vpc.fromLookup(this, 'vpc', {
    //   isDefault: true
    // });
    const cluster = new eks.Cluster(this, 'EKS-LB', {
      vpc,
      defaultCapacity: 2,
      defaultCapacityInstance: new ec2.InstanceType('m5.large')
    });
    const clusterAdmin = new iam.Role(this, 'EKS-LB-AdminRole', {
      assumedBy: new iam.AccountRootPrincipal()
    });
    cluster.awsAuth.addMastersRole(clusterAdmin);

    const appLabel = { app: "hello-kubernetes" };
    const deployment = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "hello-kubernetes" },
      spec: {
        replicas: 3,
        selector: { matchLabels: appLabel },
        template: {
          metadata: { labels: appLabel },
          spec: {
            containers: [
              {
                name: "hello-kubernetes",
                image: "paulbouwer/hello-kubernetes:1.5",
                ports: [ { containerPort: 8080 } ]
              }
            ]
          }
        }
      }
    };

    const lbType = this.node.tryGetContext('load-balancer-type');
    const clbAnnotations = {
      "service.beta.kubernetes.io/aws-load-balancer-connection-idle-timeout": "60",
      "service.beta.kubernetes.io/aws-load-balancer-healthcheck-interval": "20",
      "service.beta.kubernetes.io/aws-load-balancer-backend-protocol": "http"
    };
    const nlbAnnotations = {
      "service.beta.kubernetes.io/aws-load-balancer-type": "nlb"
    };
    const service = {
      apiVersion: "v1",
      kind: "Service",
      metadata: { 
        name: "hello-kubernetes",
        annotations: lbType === 'nlb' ? nlbAnnotations : clbAnnotations
      },
      spec: {
        type: "LoadBalancer",
        ports: [ { port: 80, targetPort: 8080 } ],
        selector: appLabel
      }
    };

    // option 1: use a construct
    // new eks.KubernetesResource(this, 'hello-kub', {
    //   cluster,
    //   manifest: [ deployment, service ]
    // });

    // or, option2: use `addResource`
    cluster.addResource('hello-kub', service, deployment);
  }
}
