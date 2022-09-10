import { Logger } from '@aws-lambda-powertools/logger';
import { APIGatewayTokenAuthorizerHandler, APIGatewayAuthorizerResult } from 'aws-lambda';
import { verifyJWT } from './decode-verify-jwt';

export type AuthorizerHandler = APIGatewayTokenAuthorizerHandler;

const logger = new Logger({
  logLevel: 'INFO',
});

const TOKEN_PATTERN = new RegExp('^Bearer\\s(.*)');

const resourcePrefix = process.env.RESOURCE_PREFIX as string;
if (!resourcePrefix) {
  throw new Error('env var required: RESOURCE_PREFIX');
}

export const handler: AuthorizerHandler = async (para)=> {
  logger.debug(`Receiving lambda authorizer event ${JSON.stringify(para, null, 2)}.`);

  var result: APIGatewayAuthorizerResult = {
    principalId: 'anonymous',
    policyDocument: {
      Version: '2012-10-17',
      Id: 'deny-all',
      Statement: [
        {
          Effect: 'Deny',
          Action: 'execute-api:Invoke',
          Resource: [
            '*',
          ],
        },
      ],
    },
  };

  const matches = para.authorizationToken.match(TOKEN_PATTERN);
  const claimVerifyRt = await verifyJWT({
    token: matches ? matches[1] : para.authorizationToken,
  });
  if (claimVerifyRt.isValid) {
    if (!process.env.REQUIRED_GROUP ||
        (process.env.REQUIRED_GROUP && claimVerifyRt.groups?.includes(process.env.REQUIRED_GROUP))) {
      result = {
        principalId: claimVerifyRt.userName,
        policyDocument: {
          Version: '2012-10-17',
          Id: 'deny-all',
          Statement: [
            {
              Effect: 'Allow',
              Action: 'execute-api:Invoke',
              Resource: [
                `${resourcePrefix}/*`,
              ],
            },
          ],
        },
      };
    }
  } else {
    logger.info(`The request with token ${para.authorizationToken} on method ${para.methodArn} is not valid JWT.`);
  }

  logger.debug(`response result is ${JSON.stringify(result, null, 2)}`);

  return result;
};