import cdk = require('@aws-cdk/core');
import eks = require('@aws-cdk/aws-eks');
import ec2 = require('@aws-cdk/aws-ec2');
import iam = require('@aws-cdk/aws-iam');

export class StorageClassEfsStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here
    const fileSystemId = this.node.tryGetContext('file-system-id');
    if (!fileSystemId)
      throw new Error(`Pls specify file system id of efs in deployment region ${this.region}.`);

    const vpcId = this.node.tryGetContext('vpcId');
    const vpc = ec2.Vpc.fromLookup(this, 'vpc', vpcId ? {
      vpcId,
    } : {
      isDefault: true
    });
   
    const clusterAdmin = new iam.Role(this, 'EKS-Storage-EFS-AdminRole', {
      assumedBy: new iam.AccountRootPrincipal()
    });
    const subnetSelections = [];
    if (vpc.publicSubnets.length > 0) {
      subnetSelections.push({
        subnetType: ec2.SubnetType.PUBLIC
      });
    }
    if (vpc.privateSubnets.length > 0) {
      subnetSelections.push({
        subnetType: ec2.SubnetType.PRIVATE
      }); 
    }
    const cluster = new eks.Cluster(this, 'EKS-Storeage-EFS', {
      vpc,
      version: '1.14',
      vpcSubnets: [{subnetType: ec2.SubnetType.PUBLIC}],
      defaultCapacity: 0,
      mastersRole: clusterAdmin
    });
    cluster.addCapacity('spot', {
      spotPrice: '0.1',
      instanceType: new ec2.InstanceType('t3.large'),
      maxCapacity: 2,
      bootstrapOptions: {
        kubeletExtraArgs: '--node-labels ec2-type=spot',
        awsApiRetryAttempts: 5
      }
    });

    const provisionerName = 'kane.mx/aws-ef';
    const storageClassName = 'aws-efs';
    const rbac = {
      apiVersion: 'rbac.authorization.k8s.io/v1beta1',
      kind: 'ClusterRoleBinding',
      metadata: {
        name: 'default-admin-rbac'
      },
      subjects: [
        {
          kind: 'ServiceAccount',
          name: 'default',
          namespace: 'default'
        }
      ],
      roleRef: {
        kind: 'ClusterRole',
        name: 'cluster-admin',
        apiGroup: 'rbac.authorization.k8s.io'
      }
    };
    const configmap = { 
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: 'efs-provisioner'
      },
      data: {
        'file.system.id': fileSystemId,
        'aws.region': this.region,
        'provisioner.name': provisionerName,
        'dns.name': ''
      }
    };
    const storageClass = {
      kind: 'StorageClass',
      apiVersion: 'storage.k8s.io/v1',
      metadata: {
        name: storageClassName
      },
      provisioner: provisionerName
    };
    const efsProvisioner = {
      kind: 'Deployment',
      apiVersion: 'extensions/v1beta1',
      metadata: {
        name: 'efs-provisioner'
      },
      spec: {
        replicas: 1,
        strategy: {
          type: 'Recreate'
        },
        template: {
          metadata: {
            labels: {
              app: 'efs-provisioner'
            }
          },
          spec: {
            containers: [
              {
                name: 'efs-provisioner',
                image: 'quay.io/external_storage/efs-provisioner:latest',
                env: [
                  { 
                    name: 'FILE_SYSTEM_ID',
                    valueFrom: {
                      configMapKeyRef: {
                        name: 'efs-provisioner',
                        key: 'file.system.id'
                      }
                    }
                  },
                  {
                    name: 'AWS_REGION',
                    valueFrom: {
                      configMapKeyRef: {
                        name: 'efs-provisioner',
                        key: 'aws.region'
                      }
                    }
                  },
                  {
                    name: 'DNS_NAME',
                    valueFrom: {
                      configMapKeyRef: {
                        name: 'efs-provisioner',
                        key: 'dns.name',
                        optional: true
                      }
                    }
                  },
                  {
                    name: 'PROVISIONER_NAME',
                    valueFrom: {
                      configMapKeyRef: {
                        name: 'efs-provisioner',
                        key: 'provisioner.name',
                      }
                    }
                  }
                ],
                volumeMounts:[
                  {
                    name: 'pv-volume',
                    mountPath: '/persistentvolumes'
                  }
                ]
              }
            ],
            volumes: [
              {
                name: 'pv-volume',
                nfs: {
                  server: `${fileSystemId}.efs.${this.region}.amazonaws.com`,
                  path: '/'
                }
              }
            ]
          }
        }
      }
    };
    cluster.addResource('efs-provisioner', rbac, configmap, storageClass, efsProvisioner);

    const secureToken = 'passw0rd';
    const claim = {
      kind: 'PersistentVolumeClaim',
      apiVersion: 'v1',
      metadata: {
        name: 'efs',
        annotations: {
          'volume.beta.kubernetes.io/storage-class': storageClassName
        }
      },
      spec: {
        accessModes: [ 'ReadWriteMany' ],
        resources: {
          requests: {
            storage: '10Gi'
          }
        }
      }
    };
    const deployment = {
      apiVersion: 'extensions/v1beta1',
      kind: 'Deployment',
      metadata: {
        name: 'fileupload'
      },
      spec: {
        replicas: 3,
        template: {
          metadata: {
            labels: {
              app: 'fileupload'
            }
          }, 
          spec: {
            terminationGracePeriodSeconds: 10,
            containers: [
              {
                name: 'fileupload',
                image: 'mayth/simple-upload-server',
                args: ["app", "-token", secureToken, "/file-upload"],
                ports: [
                  {
                    containerPort: 25478,
                    name: 'web'
                  }
                ],
                volumeMounts: [
                  { 
                    name: 'efs-share',
                    mountPath: '/file-upload'
                  }
                ]
              }
            ],
            volumes: [
              {
                name: 'efs-share',
                persistentVolumeClaim: {
                  claimName: 'efs'
                }
              }
            ]
          }
        }
      }
    };
    const service = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: 'fileupload',
        labels: {
          app: 'fileupload'
        },
        annotations: {
          'service.beta.kubernetes.io/aws-load-balancer-type': "nlb"
        }
      },
      spec: {
        type: 'LoadBalancer',
        ports: [
          {
            port: 80,
            targetPort: 25478
          }
        ],
        selector: {
          app: 'fileupload'
        }
      }
    };
    // cluster.addResource('efs-pvc', claim);
    cluster.addResource('simple-upload', claim, deployment, service);
  }
}
