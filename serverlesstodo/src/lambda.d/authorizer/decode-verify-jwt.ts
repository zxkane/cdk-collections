import { Logger } from '@aws-lambda-powertools/logger';
import { JwtRsaVerifier } from 'aws-jwt-verify';
import jwt_decode, { JwtPayload } from 'jwt-decode';

const logger = new Logger({
  logLevel: 'INFO',
});

const issuersStr = process.env.ISSUERS as string;
if (!issuersStr) {
  throw new Error('env var required: ISSUERS');
}
const issuers = issuersStr.split(',');

export const verifyJWT = async (
  request: ClaimVerifyRequest,
): Promise<ClaimVerifyResult> => {
  let result: ClaimVerifyResult;
  try {
    logger.debug(`user claim verify invoked for ${JSON.stringify(request)}`);
    const decodedPayload = jwt_decode<JwtPayload>(request.token as string, { header: false });
    if (issuers.includes(decodedPayload.iss)) {
      const verifier = JwtRsaVerifier.create({
        issuer: decodedPayload.iss!, // set this to the expected "iss" claim on your JWTs
        audience: null,
      });
      const payload = await verifier.verify(request.token as string);
      console.log(`payload confirmed for ${payload.username}`);
      result = {
        userName: payload.username ?? payload.email,
        clientId: payload.client_id,
        isValid: true,
      };
    } else {
      result = { userName: '', clientId: '', error: 'unknown iss', isValid: false };
      logger.error(`the iss '${decodedPayload.iss}' in token is unknown!`);
    }
  } catch (error) {
    result = { userName: '', clientId: '', error, isValid: false };
    logger.error(error);
  }
  return result;
};

// Helper types:
export interface ClaimVerifyRequest {
  readonly token?: string;
}

export interface ClaimVerifyResult {
  readonly userName: string;
  readonly groups?: string[];
  readonly clientId: string;
  readonly isValid: boolean;
  readonly error?: any;
}