/**
 * Tier-1 (service-level) authentication as the Alexa+ MCP Toolkit documents it: the add-on obtains a short-lived
 * Bearer token from OUR token endpoint with the OAuth 2.0 client-credentials grant (HTTP Basic client auth,
 * `resource` bound to the MCP URI) and sends it on every MCP request.
 *
 * Tokens are stateless HMAC-signed envelopes, so a restart (or several instances) can verify them without shared
 * storage. Format: `cc1.<base64url(payload)>.<base64url(hmac-sha256)>`.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AuthInfo, OAuthTokenVerifier } from '@modelcontextprotocol/server';

export interface ClientCredentialsConfig {
  clientId: string;
  clientSecret: string;
  /** The MCP endpoint this token is for, e.g. https://host/mcp — becomes the token audience and the `resource`. */
  resource: string;
  ttlSec: number;
}

interface TokenPayload {
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
}

const PREFIX = 'cc1';

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');

function sign(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function issueToken(cfg: ClientCredentialsConfig, clientId = cfg.clientId, ttlSec = cfg.ttlSec): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = { sub: clientId, aud: cfg.resource, iat: now, exp: now + ttlSec, jti: randomUUID() };
  const body = b64url(JSON.stringify(payload));
  return `${PREFIX}.${body}.${sign(cfg.clientSecret, `${PREFIX}.${body}`)}`;
}

/** Returns the verified payload, or null for anything malformed, forged or expired. */
export function verifyToken(cfg: ClientCredentialsConfig, token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const [prefix, body, mac] = parts as [string, string, string];
  if (!safeEqual(mac, sign(cfg.clientSecret, `${prefix}.${body}`))) return null;
  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
  } catch {
    return null;
  }
  if (payload.aud !== cfg.resource) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}

/** The SDK's verifier contract; `expiresAt` must be set or the bearer helpers reject the token. */
export function tokenVerifier(cfg: ClientCredentialsConfig): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const payload = verifyToken(cfg, token);
      if (!payload) throw new InvalidTokenError('The access token is invalid or expired.');
      return { token, clientId: payload.sub, scopes: [], expiresAt: payload.exp, resource: new URL(payload.aud) };
    },
  };
}

export class InvalidTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTokenError';
  }
}

/**
 * Validates the client on the token endpoint: HTTP Basic (what the Alexa+ docs specify) or, for robustness,
 * `client_id`/`client_secret` form fields. Returns the client id or null.
 */
export function authenticateClient(
  cfg: ClientCredentialsConfig,
  authorizationHeader: string | undefined,
  form: Record<string, unknown>
): string | null {
  let id: string | undefined;
  let secret: string | undefined;
  if (authorizationHeader?.startsWith('Basic ')) {
    const decoded = Buffer.from(authorizationHeader.slice(6).trim(), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx > 0) {
      id = decodeURIComponent(decoded.slice(0, idx));
      secret = decodeURIComponent(decoded.slice(idx + 1));
    }
  } else if (typeof form.client_id === 'string' && typeof form.client_secret === 'string') {
    id = form.client_id;
    secret = form.client_secret;
  }
  if (!id || !secret) return null;
  return safeEqual(id, cfg.clientId) && safeEqual(secret, cfg.clientSecret) ? id : null;
}
