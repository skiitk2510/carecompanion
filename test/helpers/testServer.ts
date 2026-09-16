import { request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createBedrockBrain, type ConverseFn } from '../../src/agent/bedrockBrain.js';
import { createRuleBrain } from '../../src/agent/ruleBrain.js';
import { AgentService } from '../../src/agent/service.js';
import { loadConfig } from '../../src/config.js';
import { CareActions } from '../../src/domain/actions.js';
import { createStore } from '../../src/domain/bootstrap.js';
import type { SeedScenario } from '../../src/domain/seed.js';
import type { Store } from '../../src/domain/store.js';
import { fixedClock, type Clock } from '../../src/domain/time.js';
import { createApp, type CareCompanionApp } from '../../src/http/app.js';
import { silentLogger } from '../../src/log.js';
import { buildServer } from '../../src/mcp/server.js';

export interface TestServer {
  app: CareCompanionApp;
  store: Store;
  actions: CareActions;
  agent: AgentService;
  baseUrl: string;
  close(): Promise<void>;
}

/** 10:30 in America/Los_Angeles on 2026-09-16 — the seed's "mid-morning" moment. */
export const TEST_NOW = '2026-09-16T17:30:00.000Z';

export interface TestServerOptions {
  env?: NodeJS.ProcessEnv;
  clock?: Clock;
  scenario?: SeedScenario;
  /** A scripted Bedrock; when omitted the agent uses the rule brain. */
  converse?: ConverseFn;
}

/** Boots the real Express wiring (CORS, host validation, MCP routes, agent routes) on an ephemeral 127.0.0.1 port. */
export async function startTestServer(opts: TestServerOptions = {}): Promise<TestServer> {
  const config = loadConfig({
    HOUSEHOLD_TZ: 'America/Los_Angeles',
    SEED_ON_BOOT: 'always',
    DATA_FILE: '',
    AGENT_BRAIN: opts.converse ? 'bedrock' : 'rules',
    AGENT_RATE_PER_MIN: '0',
    ...opts.env,
    PORT: '0',
    HOST: '127.0.0.1',
  });
  const log = silentLogger;
  const store = createStore(config, log, {
    clock: opts.clock ?? fixedClock(TEST_NOW),
    scenario: opts.scenario ?? 'mid-morning',
  });
  const actions = new CareActions({ store, log });

  let baseUrl = '';
  const bedrock = opts.converse
    ? createBedrockBrain({
        converse: opts.converse,
        modelId: config.bedrockModelId,
        maxToolRounds: config.agentMaxToolRounds,
        maxTokens: config.agentMaxTokens,
        log,
      })
    : null;
  const agent = new AgentService({
    config,
    log,
    actions,
    mcpUrl: () => `${baseUrl}/mcp`,
    bedrock,
    rules: createRuleBrain(),
  });

  const app = createApp({ config, log, serverFactory: () => buildServer({ log, actions }), agent });
  const server = await new Promise<Server>((resolve) => {
    const s = app.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  return {
    app,
    store,
    actions,
    agent,
    baseUrl,
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

/** POST JSON and parse the JSON reply. */
export async function postJson<T>(url: string, body: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as T };
}

/** Polls `predicate` until it holds or `timeoutMs` elapses. */
export async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}
