import json
import logging
import boto3
import os
from random import randrange
import datetime
from boto3.dynamodb.conditions import *

logger = logging.getLogger()
logger.setLevel(logging.INFO)

JOB_DEFINITION_NAME = os.environ.get(
    'JOB_DEFINITION_NAME') or 'SurfingComputing'
JOB_QUEUE = os.environ.get('JOB_QUEUE') or 'ComputeJobQueue'
TABLE_NAME = os.environ.get('TABLE_NAME') or 'BatchJobs'

batchClient = boto3.client('batch')
jobTable = boto3.resource('dynamodb').Table(TABLE_NAME)


def split(event, context):
    for record in event['Records']:
        logger.info(f"SQS message {record['messageId']}: {record['body']}.")

        data = json.loads(record['body'])
        # TODO split task
        numberTasks = randrange(5, 20)
        # put job with task records into dynamodb
        jobItem = {
            'job_id': data['job_id'],
            'state': 'INITIALIZED',
            'final_data': 'na',
            'created_at': int(datetime.datetime.now().timestamp())
        }
        subTasks = {}
        for i in range(numberTasks):
            subTasks.update({f"task_{i}": {
                'result': 'na',
                'start_time': 'na',
                'end_time': 'na',
                'universe': []
            }})
        jobItem['sub_tasks'] = subTasks
        putItemResponse = jobTable.put_item(
            Item=jobItem,
            ReturnConsumedCapacity='TOTAL',
            ConditionExpression='attribute_not_exists(job_id)'
        )
        logger.info(
            f"Job '{data['job_id']}' was persisted in dynamodb with consumed {putItemResponse['ConsumedCapacity']['CapacityUnits']} WCUs.")
        response = batchClient.submit_job(
            jobName=f"Job-{data['job_id']}",
            jobQueue=JOB_QUEUE,
            arrayProperties={
                'size': numberTasks
            },
            jobDefinition=JOB_DEFINITION_NAME,
            parameters={
                'JobID': data['job_id'],
                'TaskFlag': '--subtask'
            },
        )
        logger.info(
            f"Array job '{response['jobName']}' was submitted with trackid '{response['jobId']}'.")
        response = batchClient.submit_job(
            jobName=f"Job-{data['job_id']}-Consolidation",
            jobQueue=JOB_QUEUE,
            jobDefinition=JOB_DEFINITION_NAME,
            dependsOn=list(map(lambda id: {
                'jobId': id,
                'type': 'SEQUENTIAL'
            }, [response['jobId']])),
            parameters={
                'JobID': data['job_id'],
                'TaskFlag': '--consolidation'
            },
        )
        logger.info(
            f"Consolidation job '{response['jobName']}' was submitted with trackid '{response['jobId']}'.")
        putItemResponse = jobTable.update_item(
            Key={
                'job_id': data['job_id']
            },
            UpdateExpression="SET #state = :state",
            ConditionExpression='#state = :oldstate',
            ExpressionAttributeNames={
                "#state": 'state'
            },
            ExpressionAttributeValues={
                ':state': 'SCHEDULED',
                ':oldstate': 'INITIALIZED',
            },
            ReturnValues="UPDATED_NEW",
            ReturnConsumedCapacity='TOTAL',
        )
        logger.info(
            f"Job '{data['job_id']}' was updated in dynamodb with consumed {putItemResponse['ConsumedCapacity']['CapacityUnits']} WCUs.")
    return f"Successfully processed {len(event['Records'])} messages."
