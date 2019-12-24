#!/usr/local/bin/python
import argparse
import logging
import boto3
import sys
import random
import time
import os

logger = logging.getLogger()
logger.setLevel(logging.INFO)
handler = logging.StreamHandler(sys.stdout)
handler.setLevel(logging.INFO)
formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
handler.setFormatter(formatter)
logger.addHandler(handler)

# initiate the parser
parser = argparse.ArgumentParser()

# add arguments
parser.add_argument("--jobid", help="set job id", required=True)
group = parser.add_mutually_exclusive_group()
group.add_argument("--subtask", action="store_true", help="indicate whether it's a subtask")
group.add_argument("--consolidation", action="store_true", help="indicate whether it's a consolidation task")

# read arguments from the command line
args = parser.parse_args()

TABLE_NAME = os.environ.get('TABLE_NAME') or 'BatchJobs'
jobTable = boto3.resource('dynamodb').Table(TABLE_NAME)

if args.subtask:
    taskid = os.environ.get('AWS_BATCH_JOB_ARRAY_INDEX')
    logger.info(f"Computing sub task '{args.jobid}', task '{taskid}'.")

    itemResponse = jobTable.get_item(
        Key={
            'job_id': args.jobid
        }
    )
    
    taskargs = itemResponse['Item']['sub_tasks'][f"task_{taskid}"]
    logger.info(f"Got the sub task with arguments {taskargs}.")

    # compute based on the task args
    result = random.randint(100,600)
    time.sleep(result)

    putItemResponse = jobTable.update_item(
        Key={
            'job_id': args.jobid
        },
        UpdateExpression="SET #subtasks.#task.#result = :value",
        ConditionExpression='#state = :oldstate',
        ExpressionAttributeNames={
            "#subtasks": 'sub_tasks',
            '#task': f"task_{taskid}",
            '#result': 'result',
            "#state": 'state'
        },
        ExpressionAttributeValues={
            ':oldstate': 'SCHEDULED',
            ':value': result
        },
        ReturnValues="UPDATED_NEW",
        ReturnConsumedCapacity='TOTAL',
    )

    logger.info(f"The result '{result}' of job '{args.jobid}' - task '{taskid}' was recorded. ")
    logger.info(f"Finished sub task '{args.jobid}', task '{taskid}'.")
elif args.consolidation:
    logger.info(f"Consolidating task results of job '{args.jobid}'.")

    itemResponse = jobTable.get_item(
        Key={
            'job_id': args.jobid
        }
    )

    # TODO consolidate the result of sub tasks
    sum = 0
    for task in itemResponse['Item']['sub_tasks']:
        sum += int(itemResponse['Item']['sub_tasks'][task]['result'])

    putItemResponse = jobTable.update_item(
        Key={
            'job_id': args.jobid
        },
        UpdateExpression="SET #result = :value, #state = :newstate",
        ConditionExpression='#state = :oldstate',
        ExpressionAttributeNames={
            "#state": 'state',
            '#result': 'final_data'
        },
        ExpressionAttributeValues={
            ':oldstate': 'SCHEDULED',
            ':value': sum,
            ':newstate': 'COMPLETED'
        },
        ReturnValues="UPDATED_NEW",
        ReturnConsumedCapacity='TOTAL',
    ) 

    logger.info(f"The result '{sum}' of job '{args.jobid}' was updated, job is finished. ")