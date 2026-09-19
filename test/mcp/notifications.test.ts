import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { AlertEvent } from '../../src/domain/actions.js';
import { postJson, startTestServer, type TestServer } from '../helpers/testServer.js';

describe('server-initiated alert notifications over the session stream', () => {
  let srv: TestServer;
  let client: Client;
  let transport: StreamableHTTPClientTransport;
  const received: AlertEvent[] = [];

  beforeAll(async () => {
    srv = await startTestServer();
    transport = new StreamableHTTPClientTransport(new URL(`${srv.baseUrl}/mcp`));
    client = new Client({ name: 'dashboard-host', version: '0.0.0' });
    // v2 client API: spec notifications are addressed by method name, not by zod schema.
    client.setNotificationHandler('notifications/message', (notification) => {
      if (notification.params.logger === 'carecompanion.alerts') received.push(notification.params.data as AlertEvent);
    });
    await client.connect(transport);
  });

  afterAll(async () => {
    await transport.terminateSession().catch(() => undefined);
    await client.close();
    await srv.close();
  });

  it('advertises the logging capability', () => {
    expect(client.getServerCapabilities()?.logging).toBeDefined();
  });

  it('pushes an alert created by another surface (the voice agent) to a host holding an open session', async () => {
    // Give the client a moment to open its standalone GET stream after initialize.
    await new Promise((r) => setTimeout(r, 300));

    const { json } = await postJson<{ alertIds: string[] }>(`${srv.baseUrl}/api/agent`, {
      utterance: 'help, I fell in the kitchen',
    });
    expect(json.alertIds).toHaveLength(1);

    const deadline = Date.now() + 5_000;
    while (received.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));

    expect(received.length).toBeGreaterThanOrEqual(1);
    const event = received.find((e) => e.alertId === json.alertIds[0]);
    expect(event).toBeDefined();
    expect(event).toMatchObject({
      type: 'help',
      severity: 'critical',
      notified: ['Priya Whitfield-Singh', 'Daniel Whitfield'],
    });
  });

  it('also pushes alerts raised by tool calls on a different session and by the REST routes', async () => {
    const before = received.length;
    await postJson(`${srv.baseUrl}/api/dashboard/medications`, {
      name: 'ibuprofen',
      dose: '200 mg',
      scheduleTimes: ['08:00', '20:00'],
    });
    const deadline = Date.now() + 5_000;
    while (received.length === before && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    const event = received.slice(before).find((e) => e.type === 'interaction');
    expect(event?.title).toContain('Ibuprofen');
  });
});
