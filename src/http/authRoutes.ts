/**
 * Optional Tier-1 (service-level) authentication for /mcp — the client-credentials flow the Alexa+ MCP Toolkit
 * documents. Off by default (`MCP_AUTH=none`) so the open demo stays open; when on:
 *
 *   GET  /.well-known/oauth-authorization-server   RFC 8414 metadata (client_credentials, client_secret_basic)
 *   GET  /.well-known/oauth-protected-resource/mcp RFC 9728 metadata (resource = <PUBLIC_URL>/mcp)
 *   POST /oauth/token                              grant_type=client_credentials → short-lived Bearer token
 *   *    /mcp                                      requires `Authorization: Bearer <token>`; 401 JSON otherwise
 *                                                  (no WWW-Authenticate header, per the Alexa+ checklist)
 */
import express, { type Express, type RequestHandler } from 'express';
import { mcpAuthMetadataRouter } from '@modelcontextprotocol/express';
import { verifyBearerToken, type OAuthMetadata } from '@modelcontextprotocol/server';
import {
  authenticateClient,
  issueToken,
  tokenVerifier,
  type ClientCredentialsConfig,
} from '../auth/clientCredentials.js';
import type { Config } from '../config.js';
import type { Logger } from '../log.js';

export function clientCredentialsConfig(config: Config): ClientCredentialsConfig | null {
  if (config.mcpAuth !== 'client_credentials') return null;
  if (!config.mcpClientId || !config.mcpClientSecret) {
    throw new Error('MCP_AUTH=client_credentials requires MCP_CLIENT_ID and MCP_CLIENT_SECRET');
  }
  return {
    clientId: config.mcpClientId,
    clientSecret: config.mcpClientSecret,
    resource: `${config.publicUrl}/mcp`,
    ttlSec: config.mcpTokenTtlSec,
  };
}

/** Mounts the discovery documents and the token endpoint. Returns the bearer guard to put in front of /mcp. */
export function mountAuthRoutes(
  app: Express,
  config: Config,
  cfg: ClientCredentialsConfig,
  log: Logger
): RequestHandler {
  const issuer = config.publicUrl;
  const oauthMetadata: OAuthMetadata = {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    response_types_supported: [],
    grant_types_supported: ['client_credentials'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    scopes_supported: [],
  };
  app.use(
    mcpAuthMetadataRouter({
      oauthMetadata,
      resourceServerUrl: new URL(cfg.resource),
      resourceName: 'CareCompanion MCP server',
      dangerouslyAllowInsecureIssuerUrl: issuer.startsWith('http://'),
    })
  );

  // Only the machine-to-machine grant exists; interactive authorization is not offered.
  app.get('/oauth/authorize', (_req, res) => {
    res.status(400).json({
      error: 'unsupported_response_type',
      error_description: 'This server only issues client-credentials tokens.',
    });
  });

  app.post('/oauth/token', express.urlencoded({ extended: false }), (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const form = (req.body ?? {}) as Record<string, unknown>;
    const clientId = authenticateClient(cfg, req.headers.authorization, form);
    if (!clientId) {
      res.setHeader('WWW-Authenticate', 'Basic realm="carecompanion"');
      res.status(401).json({ error: 'invalid_client', error_description: 'Client authentication failed.' });
      return;
    }
    if (form.grant_type !== 'client_credentials') {
      res
        .status(400)
        .json({ error: 'unsupported_grant_type', error_description: 'Use grant_type=client_credentials.' });
      return;
    }
    if (form.resource !== undefined && form.resource !== cfg.resource) {
      res.status(400).json({ error: 'invalid_target', error_description: `resource must be ${cfg.resource}.` });
      return;
    }
    const access_token = issueToken(cfg, clientId);
    log.info('token issued', { clientId, ttlSec: cfg.ttlSec });
    res.json({ access_token, token_type: 'Bearer', expires_in: cfg.ttlSec });
  });

  const verifier = tokenVerifier(cfg);
  return (req, res, next) => {
    verifyBearerToken(req.headers.authorization, { verifier })
      .then((auth) => {
        req.auth = auth;
        next();
      })
      .catch((err: unknown) => {
        const description = err instanceof Error ? err.message : 'Bearer token required.';
        // Alexa+'s checklist: 401 without a WWW-Authenticate header for unauthenticated requests.
        res.status(401).json({ error: 'invalid_token', error_description: description });
      });
  };
}
