# Copyright 2017-2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file
# except in compliance with the License. A copy of the License is located at
#
#     http://aws.amazon.com/apache2.0/
#
# or in the "license" file accompanying this file. This file is distributed on an "AS IS"
# BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
# License for the specific language governing permissions and limitations under the License.

import base64
import json
import logging
import os
import time
import urllib.request
from jose import jwk, jwt
from jose.utils import base64url_decode
import sys

logger = logging.getLogger()
logger.setLevel(logging.INFO)

region = os.environ.get('AWS_REGION')
if not region:
    raise Exception('Env "AWS_REGION" is missing')
userpool_id = os.environ.get('USERPOOL_ID')
if not userpool_id:
    raise Exception('Env "USERPOOL_ID" is missing')
app_client_id = os.environ.get('APP_CLIENT_ID')
if not app_client_id:
    raise Exception('Env "APP_CLIENT_ID" is missing')

keys_url = 'https://cognito-idp.{}.amazonaws.com/{}/.well-known/jwks.json'.format(
    region, userpool_id)
# instead of re-downloading the public keys every time
# we download them only on cold start
# https://aws.amazon.com/blogs/compute/container-reuse-in-lambda/
with urllib.request.urlopen(keys_url) as f:
  response = f.read()
keys = json.loads(response.decode('utf-8'))['keys']


def lambda_handler(event, context):
    statusCode = 500
    body = {
        'message': 'Server Error.'
    }

    try:
        requestBody = None
        if (event['isBase64Encoded']):
            requestBody = json.loads(str(base64.b64decode(event['body'].encode('utf-8')), 'utf-8'))
        else:
            requestBody = json.loads(event['body'])

        token = requestBody['token']
        # get the kid from the headers prior to verification
        headers = jwt.get_unverified_headers(token)
        kid = headers['kid']
        # search for the kid in the downloaded public keys
        key_index = -1
        for i in range(len(keys)):
            if kid == keys[i]['kid']:
                key_index = i
                break
        if key_index == -1:
            body = 'Public key not found in jwks.json'
        else:
            # construct the public key
            public_key = jwk.construct(keys[key_index])
            # get the last two sections of the token,
            # message and signature (encoded in base64)
            message, encoded_signature = str(token).rsplit('.', 1)
            # decode the signature
            decoded_signature = base64url_decode(encoded_signature.encode('utf-8'))
            # verify the signature
            if not public_key.verify(message.encode("utf8"), decoded_signature):
                body['message'] = 'Signature verification failed'
                statusCode = 401
            else:
                logger.info('Signature successfully verified')
                # since we passed the verification, we can now safely
                # use the unverified claims
                claims = jwt.get_unverified_claims(token)
                # additionally we can verify the token expiration
                if time.time() > claims['exp']:
                    body['message'] = 'Token is expired'
                    statusCode = 403
                # and the Audience  (use claims['client_id'] if verifying an access token)
                elif claims['aud'] != app_client_id:
                    body['message'] = 'Token was not issued for this audience'
                    statusCode = 403
                # now we can use the claims
                logger.info(claims)
                statusCode = 200
                body = claims
    except json.JSONDecodeError:
        body['message'] = 'Invaid request body, not json object.'

    response = {
        "statusCode": statusCode,
        "isBase64Encoded": False,
        "body": json.dumps(body)
    }
    if statusCode >= 400:
        logger.warn(response)
    else:
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

    # for testing locally you can enter the JWT ID Token here
    event = {
        'isBase64Encoded': True,
        'body': str(base64.b64encode(json.dumps({"token":"eyJraWQiOiJlNUUybHFrWXg2d0xcL0k1YnZkVmZxMkVJdTN3c1RuRE5FaFZHTTRjNmY2UT0iLCJhbGciOiJSUzI1NiJ9.eyJhdF9oYXNoIjoiQV9uWUp5WndfclZRRjZVRko3b2NUQSIsInN1YiI6ImZiYjZkNThjLTEzYTctNDAzNy05OThkLWE0ZjAwOTU3OTIyZiIsImF1ZCI6IjdrOW04MWV2b2gxbjNkdjI2cm03ZmZnNTRpIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsInRva2VuX3VzZSI6ImlkIiwiYXV0aF90aW1lIjoxNTc4NjM2MDgxLCJpc3MiOiJodHRwczpcL1wvY29nbml0by1pZHAuYXAtbm9ydGhlYXN0LTEuYW1hem9uYXdzLmNvbVwvYXAtbm9ydGhlYXN0LTFfTXhCdlRuTzFrIiwiY29nbml0bzp1c2VybmFtZSI6ImZiYjZkNThjLTEzYTctNDAzNy05OThkLWE0ZjAwOTU3OTIyZiIsImV4cCI6MTU3ODYzOTY4MSwiaWF0IjoxNTc4NjM2MDgxLCJlbWFpbCI6Im1lQGthbmUubXgifQ.BQeVhUDj4C1CTtakaleEZ7mDEo4AfsvmColn6DFCmXDWfCcz1lk63bSuWtYudJ8Ae8atGSyPk7YtYf-_6liKkWw1z1CveTsQ4ioaMZ8f8sdKYEUNWG72xmmqSwSMVf4gvwOVQiTxtTkBV9YFyL3kqFvkxlsHjOaqHkjV1IxfMmrIZh8bI7ZqgloxXUjWrYI1Noeeoh7slJjHZcSJzHdr9fb8V0cmQEonkitO8_F8ZqOhVoNDFtWDyJfsFq_Pi-4wtfYHh0RxxPWMMC0B-_u9XNUH_Q05JN8MPz3tGrQ-Qs0F16n_R5RK3R0Z4aWNrHGrx3f-9L5Xgbri2fbtS5d2SQ"}).encode('utf-8')), 'utf-8')
    }
    lambda_handler(event, None)
