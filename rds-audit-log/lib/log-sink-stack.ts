import cdk = require('@aws-cdk/core');
import logs = require("@aws-cdk/aws-logs");
import s3 = require("@aws-cdk/aws-s3");
import iam = require("@aws-cdk/aws-iam");
import firehose = require("@aws-cdk/aws-kinesisfirehose");
import lambda = require('@aws-cdk/aws-lambda');
import path = require('path');
import glue = require('@aws-cdk/aws-glue');

interface RDSLogSinkProps extends cdk.StackProps {
    readonly clusterid: string;
}
/**
 * Sink cloudwatch rds audit log to s3 via kinesis firehose
 * https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/SubscriptionFilters.html#FirehoseExample
 */
export class RdsLogSinkStack extends cdk.Stack {
    constructor(scope: cdk.Construct, id: string, props: RDSLogSinkProps) {
        super(scope, id, props);

        const stack = cdk.Stack.of(this);
        
        // s3 bucket
        const auditLogBucket = new s3.Bucket(this, 'RDSLogBucket', {
            removalPolicy: cdk.RemovalPolicy.DESTROY
        });
        const s3Prefix = 'audit-log/';

        // IAM role that allows firehose to put data to s3
        const s3Policy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
        });
        s3Policy.addActions("s3:AbortMultipartUpload",
            "s3:GetBucketLocation",
            "s3:GetObject",
            "s3:ListBucket",
            "s3:ListBucketMultipartUploads",
            "s3:PutObject"
        );
        s3Policy.addResources(
            auditLogBucket.bucketArn,
            `${auditLogBucket.bucketArn}/*`
        );
        const gluePolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
        });
        gluePolicy.addActions('glue:GetTableVersions');
        gluePolicy.addAllResources();
        const firehoseRole = new iam.Role(this, 'FirehosetoS3Role', {
            assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
            externalId: stack.account,
            inlinePolicies: {
                s3: new iam.PolicyDocument({
                    statements: [s3Policy]
                }),
                glue: new iam.PolicyDocument({
                    statements: [gluePolicy] 
                })
            }
        });

        // lambda function to process cloudwatch log
        const logProcessor = new lambda.Function(this, 'CloudWatchLogProcessor', {
            runtime: lambda.Runtime.NODEJS_10_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../assets/cloudwatch-processor')),
            deadLetterQueueEnabled: true,
            tracing: lambda.Tracing.ACTIVE,
            logRetention: logs.RetentionDays.ONE_WEEK,
            timeout: cdk.Duration.seconds(60),
        });
        const firehosePutPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
        });
        firehosePutPolicy.addActions('firehose:PutRecord', 'firehose:PutRecordBatch');
        firehosePutPolicy.addResources('*');
        logProcessor.addToRolePolicy(firehosePutPolicy);
        // IAM role to execute lambda function
        const lambdaPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
        });
        lambdaPolicy.addActions('lambda:InvokeFunction');
        lambdaPolicy.addResources(logProcessor.functionArn);
        const lambdaInvokeRole = new iam.Role(this, 'KinesisProcessorInvokeLambda', {
            assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
            inlinePolicies: {
                lambda: new iam.PolicyDocument({
                    statements: [lambdaPolicy]
                }),
            }
        });
        // glue database/table
        const logDatabase = new glue.Database(stack, 'RDSLogDB', {
            databaseName: 'rds_log'
        });
        const auditLogTable = new glue.Table(stack, 'AuditLog', {
            database: logDatabase,
            tableName: 'audit_log',
            columns: [{
              name: 'timestamp',
              type: glue.Schema.TIMESTAMP
            },
            {
                name: 'instanceid',
                type: glue.Schema.STRING
            },
            {
                name: 'user',
                type: glue.Schema.STRING
            },
            {
                name: 'sourceip',
                type: glue.Schema.STRING
            },
            {
                name: 'connectionid',
                type: glue.Schema.INTEGER
            },
            {
                name: 'queryid',
                type: glue.Schema.INTEGER
            },
            {
                name: 'operation',
                type: glue.Schema.STRING
            },
            {
                name: 'database',
                type: glue.Schema.STRING
            },
            {
                name: 'sqltext',
                type: glue.Schema.STRING
            },
            {
                name: 'retcode',
                type: glue.Schema.INTEGER
            },
            ],
            partitionKeys: [{
              name: 'year',
              type: glue.Schema.STRING
            }, {
              name: 'month',
              type: glue.Schema.STRING
            },
            {
                name: 'day',
                type: glue.Schema.STRING
            },
            {
                name: 'hour',
                type: glue.Schema.STRING
            }
            ],
            dataFormat: {
                inputFormat: new glue.InputFormat('org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat'),
                outputFormat: new glue.OutputFormat('org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat'),
                serializationLibrary: new glue.SerializationLibrary('org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe')
            },
            bucket: auditLogBucket,
            s3Prefix
          });
        // kinesis firehose stream
        const logFirehoseStream = new firehose.CfnDeliveryStream(this, 'LogDeliveryStream', {
            deliveryStreamName: 'RDSAuditLogStream',
            extendedS3DestinationConfiguration: {
                bucketArn: auditLogBucket.bucketArn,
                bufferingHints: {
                    intervalInSeconds: 60,
                    sizeInMBs: 64
                },
                processingConfiguration: {
                    enabled: true,
                    processors: [{ 
                        parameters: [{
                            parameterName: 'BufferIntervalInSeconds',
                            parameterValue: '60',
                        },
                        {
                            parameterName: 'BufferSizeInMBs',
                            parameterValue: '3',
                        },
                        {
                            parameterName: 'LambdaArn',
                            parameterValue: logProcessor.functionArn,
                        },
                        {
                            parameterName: 'NumberOfRetries',
                            parameterValue: '2',
                        },
                        {
                            parameterName: 'RoleArn',
                            parameterValue: lambdaInvokeRole.roleArn,
                        },
                        ],
                        type: 'Lambda'
                    }]
                },
                compressionFormat: 'UNCOMPRESSED',
                dataFormatConversionConfiguration: {
                    enabled: true,
                    inputFormatConfiguration: { 
                        deserializer: {
                            openXJsonSerDe: {}
                        }
                    },
                    outputFormatConfiguration: {
                        serializer: {
                            parquetSerDe: {}
                        }
                    },
                    schemaConfiguration: {
                        catalogId: stack.account,
                        databaseName: logDatabase.databaseName,
                        region: stack.region,
                        roleArn: firehoseRole.roleArn,
                        tableName: auditLogTable.tableName,
                        versionId: 'LATEST'
                    }
                },
                roleArn: firehoseRole.roleArn,
                prefix: `${s3Prefix}year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/hour=!{timestamp:HH}/`,
                errorOutputPrefix: 'audit-log-err/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/hour=!{timestamp:HH}/!{firehose:error-output-type}',
            }
        });

        // subscribe cloudwatch log group of rds audit log to kinesis firehose stream
        // IAM role that allows cloudwatch to put data to firehose
        const firehosePolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
        });
        firehosePolicy.addActions('firehose:*');
        firehosePolicy.addResources(logFirehoseStream.attrArn);
        const cloudwatchRole = new iam.Role(this, 'CloudWatchToKinesisFirehoseRole', {
            assumedBy: new iam.ServicePrincipal(`logs.${stack.region}.amazonaws.com`),
            inlinePolicies: {
                firehose: new iam.PolicyDocument({
                    statements: [firehosePolicy]
                }),
            }
        });
        const iamPassPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
        });
        iamPassPolicy.addActions("iam:PassRole");
        iamPassPolicy.addResources(cloudwatchRole.roleArn);
        cloudwatchRole.addToPolicy(iamPassPolicy);

        new logs.CfnSubscriptionFilter(this, 'AuditLogSubscription', {
            destinationArn: logFirehoseStream.attrArn,
            filterPattern: logs.FilterPattern.allEvents().logPatternString,
            logGroupName: `/aws/rds/cluster/${props.clusterid}/audit`,
            roleArn: cloudwatchRole.roleArn
        });
    }
}
