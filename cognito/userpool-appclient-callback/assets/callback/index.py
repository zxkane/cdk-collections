import base64
import logging
import sys

logger = logging.getLogger()
logger.setLevel(logging.INFO)

content = ''
with open('index.html') as f:
    content = f.read()

def lambda_handler(event, context):
    response = {
        "statusCode": 200,
        "headers": {
            "Content-Type": "text/html"
        },
        "isBase64Encoded": False,
        "body": content
    }
    logger.info(response)
    return response
        
# the following is useful to make this script executable in both
# AWS Lambda and any other local environments
if __name__ == '__main__':
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(logging.INFO)
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)

    event = {
        'isBase64Encoded': False,
        'body': ''
    }
    lambda_handler(event, None)
