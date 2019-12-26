import base64
import json
import logging
import boto3
import os

logger = logging.getLogger()
logger.setLevel(logging.INFO)

queueName = os.environ.get('QUEUE_NAME') or 'SurfingJobQueue'


def receiver(event, context):
    statusCode = 400
    body = {
        "message": "",
    }

    JOB_KEY = 'job_id'

    requestBody = event
    processable = True
    if 'path' in event and 'httpMethod' in event:
        logger.info('path: %s, methos: %s', event['path'], event['httpMethod'])

        if 'PUT' != event['httpMethod']:
            body['message'] = 'Only http method "PUT" is allowed.'
            processable = False
        else:
            try:
                requestBody = None
                if (event['isBase64Encoded']):
                    requestBody = json.loads(base64.b64decode(event['body']))
                else:
                    requestBody = json.loads(event['body'])
            except json.JSONDecodeError:
                body['message'] = 'Invaid request body, not json object.'
                processable = False
    
    logger.info(f'Body: {requestBody}')

    # send request to sqs queue for next processing
    if processable:
        try:
            sqs = boto3.client('sqs')
            urlResponse = sqs.get_queue_url(QueueName=queueName)
            response = sqs.send_message(
                QueueUrl=urlResponse['QueueUrl'],
                MessageBody=json.dumps(requestBody)
            )
            body['message'] = 'Job "{}" is submitted with message id "{}".'.format(
                requestBody[JOB_KEY], response['MessageId'])
            statusCode = 200
        except Exception as e:
            statusCode = 500
            body['message'] = e.message
        except KeyError:
            body['message'] = f'Required "{JOB_KEY}" is not specified in request body.'

    response = {
        "statusCode": statusCode,
        "body": json.dumps(body)
    }

    return response
