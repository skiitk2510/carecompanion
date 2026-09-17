import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { issueToken, verifyToken, type ClientCredentialsConfig } from '../../src/auth/clientCredentials.js';
import type { AgentResponse } from '../../src/shared/agent.js';
import { postJson, startTestServer, type TestServer } from '../helpers/testServer.js';

const PUBLIC_URL = 'http://carecompanion.test';
const CLIENT_ID = 'alexa-addon';
const CLIENT_SECRET = 's3cret-s3cret-s3cret';
const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

async function token(baseUrl: string, body: Record<string, string>, authorization = `Basic ${basic}`) {
  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization },
    body: new URLSearchParams(body).toString(),
  });
  return { status: res.status, headers: res.headers, json: (await res.json()) as Record<string, unknown> };
}

describe('Tier-1 service-level auth (client credentials, as the Alexa+ MCP Toolkit documents it)', () => {
  let srv: TestServer;

  beforeAll(async () => {
    srv = await startTestServer({
      env: { MCP_AUTH: 'client_credentials', MCP_CLIENT_ID: CLIENT_ID, MCP_CLIENT_SECRET: CLIENT_SECRET, PUBLIC_URL },
    });
  });

  afterAll(async () => {
    await srv.close();
  });

  it('serves RFC 8414 and RFC 9728 discovery documents', async () => {
    const as = (await (await fetch(`${srv.baseUrl}/.well-known/oauth-authorization-server`)).json()) as Record<
      string,
      unknown
    >;
    expect(as.issuer).toBe(PUBLIC_URL);
    expect(as.token_endpoint).toBe(`${PUBLIC_URL}/oauth/token`);
    expect(as.grant_types_supported).toContain('client_credentials');
    expect(as.token_endpoint_auth_methods_supported).toContain('client_secret_basic');

    const prm = (await (await fetch(`${srv.baseUrl}/.well-known/oauth-protected-resource/mcp`)).json()) as Record<
      string,
      unknown
    >;
    expect(prm.resource).toBe(`${PUBLIC_URL}/mcp`);
    expect(prm.authorization_servers).toEqual([PUBLIC_URL]);
  });

  it('issues short-lived Bearer tokens only to the registered client with the right grant and resource', async () => {
    const bad = await token(
      srv.baseUrl,
      { grant_type: 'client_credentials' },
      `Basic ${Buffer.from('x:y').toString('base64')}`
    );
    expect(bad.status).toBe(401);
    expect(bad.json.error).toBe('invalid_client');
    expect(bad.headers.get('www-authenticate')).toContain('Basic');

    const wrongGrant = await token(srv.baseUrl, { grant_type: 'authorization_code' });
    expect(wrongGrant.status).toBe(400);
    expect(wrongGrant.json.error).toBe('unsupported_grant_type');

    const wrongResource = await token(srv.baseUrl, {
      grant_type: 'client_credentials',
      resource: 'https://other.example/mcp',
    });
    expect(wrongResource.status).toBe(400);
    expect(wrongResource.json.error).toBe('invalid_target');

    const ok = await token(srv.baseUrl, { grant_type: 'client_credentials', resource: `${PUBLIC_URL}/mcp` });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(ok.json).toMatchObject({ token_type: 'Bearer', expires_in: 3600 });
    expect(String(ok.json.access_token)).toMatch(/^cc1\./);

    const viaPost = await token(
      srv.baseUrl,
      { grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET },
      ''
    );
    expect(viaPost.status).toBe(200);
  });

  it('refuses /mcp without a valid token — 401 JSON with no WWW-Authenticate header — and admits a valid one', async () => {
    const initialize = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'x', version: '1' } },
    });
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

    const anonymous = await fetch(`${srv.baseUrl}/mcp`, { method: 'POST', headers, body: initialize });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('www-authenticate')).toBeNull();
    expect(((await anonymous.json()) as { error: string }).error).toBe('invalid_token');

    const forged = await fetch(`${srv.baseUrl}/mcp`, {
      method: 'POST',
      headers: { ...headers, authorization: 'Bearer cc1.eyJzdWIiOiJ4In0.deadbeef' },
      body: initialize,
    });
    expect(forged.status).toBe(401);

    const { json } = await token(srv.baseUrl, { grant_type: 'client_credentials' });
    const transport = new StreamableHTTPClientTransport(new URL(`${srv.baseUrl}/mcp`), {
      authProvider: { token: async () => String(json.access_token) },
    });
    const client = new Client({ name: 'alexa-like', version: '1.0.0' });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(8);
    await transport.terminateSession();
    await client.close();

    // Other routes stay open: the web app, health and REST do not carry the MCP bearer requirement.
    expect((await fetch(`${srv.baseUrl}/healthz`)).status).toBe(200);
    expect((await fetch(`${srv.baseUrl}/api/dashboard`)).status).toBe(200);
  });

  it('rejects expired and cross-audience tokens', () => {
    const cfg: ClientCredentialsConfig = {
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      resource: `${PUBLIC_URL}/mcp`,
      ttlSec: 60,
    };
    const fresh = issueToken(cfg);
    expect(verifyToken(cfg, fresh)?.sub).toBe(CLIENT_ID);
    expect(verifyToken(cfg, issueToken(cfg, CLIENT_ID, -1))).toBeNull();
    expect(verifyToken({ ...cfg, resource: 'https://other.example/mcp' }, fresh)).toBeNull();
    expect(verifyToken({ ...cfg, clientSecret: 'different' }, fresh)).toBeNull();
    expect(verifyToken(cfg, 'not-a-token')).toBeNull();
  });

  it('the agent still reaches the tools over loopback by minting its own token', async () => {
    const { status, json } = await postJson<AgentResponse>(`${srv.baseUrl}/api/agent`, {
      utterance: 'what is my plan today',
    });
    expect(status).toBe(200);
    expect(json.toolCalls[0]).toMatchObject({ name: 'get_todays_plan', isError: false });
  });
});
