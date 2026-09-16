import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { rawRequest, startTestServer, waitFor, type TestServer } from '../helpers/testServer.js';

const JSON_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

const initializeBody = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'lifecycle-test', version: '0.0.0' },
  },
});

describe('Streamable HTTP session lifecycle (spec 2025-11-25, sessionful)', () => {
  let srv: TestServer;

  beforeAll(async () => {
    srv = await startTestServer();
  });

  afterAll(async () => {
    await srv.close();
  });

  it('initializes a session with the SDK client, lists and calls ping, then terminates', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${srv.baseUrl}/mcp`));
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(transport);

    expect(transport.sessionId).toBeTruthy();
    expect(srv.app.mcp.sessions.size).toBe(1);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('ping');

    const result = await client.callTool({ name: 'ping', arguments: {} });
    const first = (result.content as Array<{ type: string; text?: string }>)[0];
    expect(first?.type).toBe('text');
    expect(first?.text).toMatch(/^pong/);

    await transport.terminateSession();
    await client.close();
    await waitFor(() => srv.app.mcp.sessions.size === 0);
  });

  it('answers a stale session id with 404 (-32001) and a session-less request with 400 (-32000)', async () => {
    const listBody = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' });

    const stale = await fetch(`${srv.baseUrl}/mcp`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'mcp-session-id': 'does-not-exist' },
      body: listBody,
    });
    expect(stale.status).toBe(404);
    expect(((await stale.json()) as { error: { code: number } }).error.code).toBe(-32001);

    const none = await fetch(`${srv.baseUrl}/mcp`, { method: 'POST', headers: JSON_HEADERS, body: listBody });
    expect(none.status).toBe(400);
    expect(((await none.json()) as { error: { code: number } }).error.code).toBe(-32000);
  });

  it('serves the standalone GET stream (not 405) and DELETE closes the session', async () => {
    const init = await fetch(`${srv.baseUrl}/mcp`, { method: 'POST', headers: JSON_HEADERS, body: initializeBody });
    expect(init.status).toBe(200);
    const sessionId = init.headers.get('mcp-session-id');
    expect(sessionId).toBeTruthy();
    await init.text();

    const stream = await fetch(`${srv.baseUrl}/mcp`, {
      headers: { accept: 'text/event-stream', 'mcp-session-id': sessionId!, 'mcp-protocol-version': '2025-11-25' },
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    await stream.body?.cancel();

    const del = await fetch(`${srv.baseUrl}/mcp`, {
      method: 'DELETE',
      headers: { 'mcp-session-id': sessionId!, 'mcp-protocol-version': '2025-11-25' },
    });
    expect(del.status).toBeGreaterThanOrEqual(200);
    expect(del.status).toBeLessThan(300);
    await waitFor(() => !srv.app.mcp.sessions.has(sessionId!));
  });

  it('rejects a foreign Host header on /mcp (DNS-rebinding guard) but keeps /healthz open', async () => {
    // fetch() silently drops a custom Host header, so this one goes through node:http.
    const forbidden = await rawRequest(`${srv.baseUrl}/mcp`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, host: 'evil.example' },
      body: initializeBody,
    });
    expect(forbidden.status).toBe(403);

    const health = await rawRequest(`${srv.baseUrl}/healthz`, { headers: { host: 'anything.internal' } });
    expect(health.status).toBe(200);
    expect((JSON.parse(health.body) as { ok: boolean }).ok).toBe(true);
  });
});
