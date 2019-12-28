# README
It's the infrastructure code of an AWS Batch application that will schedule the long-running computing tasks in a cost effective best effect.

## Prerequisites
- `Docker` is installed in deployment env and the `docker daemon` is running
- `Python3` is installed
- The default **VPC** in deployment AWS account is created with [private subnets and public subnets crossing at least two AZs][vpc-subnets-guide]

## How to deploy batch demo app
```shell
# install dependencies of lambda functions
pip3 install -r assets/job-splitter/requirements.txt --target ./assets/job-splitter/package
pip3 install -r assets/task-receiver/requirements.txt --target ./assets/task-receiver/package
pip3 install -r assets/job-api/requirements.txt --target ./assets/job-api/package

cdk deploy BatchAppStack
# or expose restful APIs via API Gateway
cdk deploy -cApiMode=restapi
# or secure the endpoints of API Gateway by all IAM users in current account
cdk deploy -cApiMode=restapi -c Auth=iam
```
Below resources would be created for this stack,
- Lambda Function **TaskReceiver** to receive the job request behind a public ALB or API gateway based on the given `ApiMode` option
- SQS queue will be created for receiving the job request messages
- A batch job definition, job queue and compute environments created for computing the tasks. The batch definition will prefer to launch the spot instances for the jobs
- Lambda Function **JobSplitter** will split the job requests to sub tasks, which submit the jobs to batch's job queue
- A DynamoDB table would be created for presisting the job info and result of computing
- A Lambda function **JobAPI** exposes the job data via restful API behind ALB

## Usage
### Schedule a long-running batch task behind ALB
```shell
curl -X PUT http://<alb hostname>:9999/v1/new-task  -H 'content-type:application/json' -d '{"job_id": "my-batch-job-id-xxsss22", "universe": ["000002.XSHE", "000004.XSHE"]}'
# Send request with AWS v4 signature
aws sts assume-role --role-arn arn:aws:iam::<accountid>:role/BatchAppStack-API-Execute-Role --role-session-name session1
# send request in Postman with AWS signature or generate v4 signature mannually per doc https://docs.aws.amazon.com/general/latest/gr/signature-version-4.html
```
### Fetch the job status or result behind ALB
```shell
curl http://<alb hostname>:9999/v1/tasks/<job_id>
```

[vpc-subnets-guide]: https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Scenario2.html