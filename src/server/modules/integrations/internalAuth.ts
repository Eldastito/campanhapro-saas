// Service-to-service internal authentication.
// Other modules must call getInternalToken() to authenticate requests between microservices.

const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;

export interface InternalTokenPayload {
  service: string;
  campaignId?: string;
  issuedAt: number;
}

export function getInternalToken(service: string, campaignId?: string): string {
  if (!INTERNAL_SERVICE_KEY) {
    throw new Error('[internalAuth] INTERNAL_SERVICE_KEY is not set — cannot issue service token');
  }
  const payload: InternalTokenPayload = {
    service,
    campaignId,
    issuedAt: Date.now(),
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64') + '.' + INTERNAL_SERVICE_KEY;
}

export function validateInternalToken(token: string): InternalTokenPayload {
  if (!INTERNAL_SERVICE_KEY) {
    throw new Error('[internalAuth] INTERNAL_SERVICE_KEY is not set');
  }
  const [payloadB64, key] = token.split('.');
  if (key !== INTERNAL_SERVICE_KEY) {
    throw new Error('[internalAuth] Invalid internal token');
  }
  return JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf-8')) as InternalTokenPayload;
}
