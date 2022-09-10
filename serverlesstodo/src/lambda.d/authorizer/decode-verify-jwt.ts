import { Logger } from '@aws-lambda-powertools/logger';
import { JwtRsaVerifier } from 'aws-jwt-verify';

const logger = new Logger({
  logLevel: 'INFO',
});

const issuer = process.env.ISSUER as string;
if (!issuer) {
  throw new Error('env var required: ISSUER');
}

const verifier = JwtRsaVerifier.create({
  issuer: issuer, // set this to the expected "iss" claim on your JWTs
  audience: null,
});

export const verifyJWT = async (
  request: ClaimVerifyRequest,
): Promise<ClaimVerifyResult> => {
  let result: ClaimVerifyResult;
  try {
    logger.debug(`user claim verify invoked for ${JSON.stringify(request)}`);
    const payload = await verifier.verify(request.token as string);
    console.log(`payload confirmed for ${payload.username}`);
    result = {
      userName: payload.username ?? payload.email,
      clientId: payload.client_id,
      isValid: true,
    };
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