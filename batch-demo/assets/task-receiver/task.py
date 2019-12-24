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

    logger.info('path: %s, methos: %s', event['path'], event['httpMethod'])

    if 'PUT' != event['httpMethod']:
        body['message'] = 'Only http method "PUT" is allowed.'
    else:
        try:
            requestBody = None
            if (event['isBase64Encoded']):
                requestBody = json.loads(base64.b64decode(event['body']))
            else:
                requestBody = json.loads(event['body'])
            logger.info(f'Body: {requestBody}')
            
            # send request to sqs queue for next processing
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
        except json.JSONDecodeError:
            body['message'] = 'Invaid request body, not json object.'
        except KeyError:
            body['message'] = f'Required "{JOB_KEY}" is not specified in request body.'

    response = {
        "statusCode": statusCode,
        "body": json.dumps(body)
    }

    return response

    # Use this code if you don't use the http event with the LAMBDA-PROXY
    # integration
    """
    return {
        "message": "Go Serverless v1.0! Your function executed successfully!",
        "event": event
    }
    """
