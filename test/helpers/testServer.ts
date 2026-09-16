import { request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadConfig } from '../../src/config.js';
import { createApp, type CareCompanionApp } from '../../src/http/app.js';
import { silentLogger } from '../../src/log.js';
import { buildServer } from '../../src/mcp/server.js';

export interface TestServer {
  app: CareCompanionApp;
  baseUrl: string;
  close(): Promise<void>;
}

/** Boots the real Express wiring (CORS, host validation, MCP routes) on an ephemeral 127.0.0.1 port. */
export async function startTestServer(env: NodeJS.ProcessEnv = {}): Promise<TestServer> {
  const config = loadConfig({ ...env, PORT: '0', HOST: '127.0.0.1' });
  const log = silentLogger;
  const app = createApp({ config, log, serverFactory: () => buildServer({ log }) });

  const server = await new Promise<Server>((resolve) => {
    const s = app.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;

  return {
    app,
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await app.close();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}

export interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

/** Plain node:http request — unlike fetch() it lets a test send an arbitrary Host header. */
export function rawRequest(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: opts.method ?? 'GET',
        headers: opts.headers,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }));
      }
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** Polls `predicate` until it holds or `timeoutMs` elapses. */
export async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}
