import cdk = require('@aws-cdk/core');
import ec2 = require('@aws-cdk/aws-ec2');
import ecs = require('@aws-cdk/aws-ecs');
import elbv2 = require('@aws-cdk/aws-elasticloadbalancingv2');
import route53 = require("@aws-cdk/aws-route53");
import targets = require('@aws-cdk/aws-route53-targets');
import certmgr = require("@aws-cdk/aws-certificatemanager");

interface ALBPerHostRoutingProps extends cdk.StackProps {
  vpcId: string,
  hosts: string[],
}

export class AlbPerHostRoutingStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: ALBPerHostRoutingProps) {
    super(scope, id, props);

    if (!props.vpcId)
      console.warn(`Using default VPC due to no vpc is specified.`);
    const vpc = ec2.Vpc.fromLookup(this, 'vpc', props.vpcId ?{
      vpcId: props.vpcId,
    } : {
      isDefault: true
    });

    const primaryHost = props.hosts[0];
    const domain = primaryHost.substring(primaryHost.indexOf('.') + 1);
    const hostedZone = route53.HostedZone.fromLookup(this, `HostedZone-${domain}`, {
      domainName: domain,
      privateZone: false
    });

    const certificate = new certmgr.DnsValidatedCertificate(this, `Certificate-${primaryHost}`, {
      domainName: primaryHost,
      hostedZone,
      subjectAlternativeNames: props.hosts.slice(1),
      validationMethod: certmgr.ValidationMethod.DNS
    });
    const certificates = [certificate];
    // const certificates = props.hosts.map(host => {
    //   const hostedZone = route53.HostedZone.fromLookup(this, `HostedZone-${host}`, {
    //     domainName: host.substring(host.indexOf('.') + 1),
    //     privateZone: false
    //   });
  
    //   const certificate = new certmgr.DnsValidatedCertificate(this, `Certificate-${host}`, {
    //     domainName: host,
    //     hostedZone,
    //     validationMethod: certmgr.ValidationMethod.DNS
    //   });
    //   return certificate;
    // });

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc
    });

    const lb = new elbv2.ApplicationLoadBalancer(this, 'ALB-For-Multiple-Hosts', { 
      vpc, 
      internetFacing: true,
      http2Enabled: true 
    });

    // redirect 80 to 443
    const listener80 = new elbv2.CfnListener(this, 'Listener80', { 
      defaultActions: [{
        redirectConfig: {
          protocol: elbv2.Protocol.HTTPS,
          port: '443',
          statusCode: 'HTTP_301'
        },
        type: 'redirect'
      }],
      loadBalancerArn: lb.loadBalancerArn,
      port: 80,
      protocol: elbv2.Protocol.HTTP,
    });
    lb.connections.allowFromAnyIpv4(ec2.Port.tcp(listener80.port), 'Listener 80');
    
    const listener443 = lb.addListener('Listener443', { port: 443 });
    listener443.addCertificateArns('certs', certificates.map(cert => cert.certificateArn));

    const targetGroups : Array<elbv2.ApplicationTargetGroup> = [];
    let priority = 2000;
    for (const hostname of props.hosts) {
      const legalHostname = hostname.replace(/\./g, '-');
      const fargateTaskDefinition = new ecs.FargateTaskDefinition(this, `TaskDef-${hostname}`, {
        // minimal configuration of fargate
        // https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-cpu-memory-error.html
        memoryLimitMiB: 512, 
        cpu: 256
      });
      const container = fargateTaskDefinition.addContainer(`WebContainer-${legalHostname}`, {
        // Use an image from DockerHub
        image: ecs.ContainerImage.fromRegistry("nginx:1.17-alpine"),
        memoryLimitMiB: 128,
        // ... other options here ...
      });
      container.addPortMappings({
        containerPort: 80,
      });
      const service = new ecs.FargateService(this, `Service-${legalHostname}`, {
        cluster,
        taskDefinition: fargateTaskDefinition,
        desiredCount: 2
      });

      const target = listener443.addTargets(`Forward-For-${legalHostname}`, {
        hostHeader: hostname,
        protocol: elbv2.ApplicationProtocol.HTTP,
        priority: priority,
        targets: [service]
      });

      targetGroups.push(target);
      priority += 10 + Math.floor(Math.random() * 9);
    };

    listener443.addTargetGroups('Targets', {
      targetGroups: [ targetGroups[0] ]
    });
    
    for (const hostname of props.hosts) {
      const hostedZone = route53.HostedZone.fromLookup(this, `Route53HostedZone-${hostname}`, {
        domainName: hostname.substring(hostname.indexOf('.') + 1),
        privateZone: false
      });

      new route53.ARecord(this, `AAlias-${hostname}`, {
        zone: hostedZone,
        recordName: hostname,
        ttl: cdk.Duration.minutes(10),
        target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(lb)),
      });
      new route53.AaaaRecord(this, `AaaaAlias-${hostname}`, {
        zone: hostedZone,
        recordName: hostname,
        ttl: cdk.Duration.minutes(10),
        target: route53.AddressRecordTarget.fromAlias(new targets.LoadBalancerTarget(lb)),
      });
    }
  }
}
