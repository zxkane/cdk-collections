# Real time analysis of RDS audit log

- Create a Aurora cluster with audit log that exports to CloudWatch
- Create a lambda function to simulate the Aurora query request every two minutes
- Create a Glue database and table for querying the log via Athena
- Create a kinesis firehose stream to delivery audit log to S3 which uses lambda function to transform the log message
- Create a log subscription filter to deliver audit log to kinesis firehost

## How to deploy this app
```shell
npm i --prefix assets/cloudwatch-processor
npm i --prefix assets/rds-sim-requests
npm i
cdk deploy RdsLogSinkStack
 ```
