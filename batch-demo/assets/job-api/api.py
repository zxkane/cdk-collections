import logging
import boto3
import json
import os
import re
import decimal

logger = logging.getLogger()
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ.get('TABLE_NAME') or 'BatchJobs'
jobTable = boto3.resource('dynamodb').Table(TABLE_NAME)

class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, decimal.Decimal):
            return float(o)
        return super(DecimalEncoder, self).default(o)

def handler(event, context):
    logger.info('path: %s, methos: %s', event['path'], event['httpMethod'])

    statusCode = 400
    body = {
        "message": "",
    }

    if 'GET' != event['httpMethod']:
        body['message'] = 'Only http method "GET" is allowed.'
    else:
        jobIdRegex = r"\/jobs\/(.+)$"
        matches = re.search(jobIdRegex, event['path'])

        if matches:
            jobId = matches.groups()[0]
            itemResponse = jobTable.get_item(
                Key={
                    'job_id': jobId
                }
            )
            if 'Item' in itemResponse:
                body = itemResponse['Item']
                status = 200
            else:
                statusCode = 404
                body = {
                    'message': 'Given job is not found.'
                }
        else:
            body['message'] = 'Request path is invalid or job id is not specified.'
            
    response = {
        "statusCode": statusCode,
        "body": json.dumps(body, cls=DecimalEncoder)
    }

    logger.info(f"Lambda response is {response}.")
    return response
