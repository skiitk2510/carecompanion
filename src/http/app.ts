import cors from 'cors';
import type { Express } from 'express';
import { createMcpExpressApp, hostHeaderValidation, originValidation } from '@modelcontextprotocol/express';
import type { McpServer } from '@modelcontextprotocol/server';
import { join } from 'node:path';
import type { AgentService } from '../agent/service.js';
import type { Config } from '../config.js';
import type { CareActions } from '../domain/actions.js';
import type { Logger } from '../log.js';
import { packageRoot } from '../paths.js';
import { APP_VERSION } from '../version.js';
import { mountAgentRoutes } from './agentRoutes.js';
import { mountDashboardRoutes } from './dashboardRoutes.js';
import { mountDemoRoutes } from './demoRoutes.js';
import { mountMcpRoutes, type McpRoutes } from './mcpRoutes.js';
import { mountStatic } from './static.js';

export interface AppDeps {
  config: Config;
  log: Logger;
  serverFactory: () => McpServer;
  /** The simulated-Alexa+ brain behind POST /api/agent; omitted = MCP server only. */
  agent?: AgentService;
  /** Enables the REST routes for the web app's caregiver pane and the demo controls. */
  actions?: CareActions;
  /** Directory of the built web app; defaults to dist/web. */
  webDir?: string;
}

export interface CareCompanionApp {
  app: Express;
  mcp: McpRoutes;
  close(): Promise<void>;
}

export function createApp(deps: AppDeps): CareCompanionApp {
  const { config, log } = deps;
  const startedAt = Date.now();

  // host '0.0.0.0' switches off the SDK's automatic (app-wide) localhost guard; we scope DNS-rebinding
  // protection to /mcp below so /healthz, /api and static assets stay reachable from Render's health checker.
  const app = createMcpExpressApp({ host: '0.0.0.0', jsonLimit: '4mb' });
  // Render terminates TLS in front of us; trust one hop so req.ip is the client (rate limiting).
  app.set('trust proxy', 1);

  // Browser-based MCP hosts (basic-host, Inspector UI, Alexa+ web surfaces) must be able to read these headers.
  app.use(
    cors({
      origin: config.corsOrigins === '*' ? '*' : config.corsOrigins,
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Accept',
        'Authorization',
        'Mcp-Session-Id',
        'Mcp-Protocol-Version',
        'Last-Event-Id',
        'X-Demo-Token',
      ],
      exposedHeaders: ['Mcp-Session-Id', 'WWW-Authenticate', 'Last-Event-Id', 'Mcp-Protocol-Version'],
    })
  );

  // Hostname-only (port-agnostic) checks, so 'localhost' / '127.0.0.1' cover dev servers and tests on any port.
  if (config.allowedHosts.length > 0) {
    app.use('/mcp', hostHeaderValidation(config.allowedHosts));
  }
  if (config.corsOrigins !== '*') {
    app.use('/mcp', originValidation(config.corsOrigins.map(hostnameOf)));
  }

  const mcp = mountMcpRoutes(app, { log, serverFactory: deps.serverFactory });
  if (deps.agent) mountAgentRoutes(app, deps.agent, log, config.agentRatePerMin);
  if (deps.actions) {
    mountDashboardRoutes(app, deps.actions, log);
    mountDemoRoutes(app, deps.actions, config, log);
  }

  app.get('/healthz', (_req, res) => {
    res.json({
      ok: true,
      version: APP_VERSION,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      mcpSessions: mcp.sessions.size,
      agent: deps.agent ? deps.agent.status() : null,
      demo: deps.actions ? deps.actions.demoStatus() : null,
    });
  });

  // Last: the built web app (if present) with its SPA fallback.
  mountStatic(app, deps.webDir ?? join(packageRoot, 'dist', 'web'), log);

  return { app, mcp, close: () => mcp.close() };
}

function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}
