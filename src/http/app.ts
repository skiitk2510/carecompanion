import cors from 'cors';
import type { Express } from 'express';
import { createMcpExpressApp, hostHeaderValidation, originValidation } from '@modelcontextprotocol/express';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Config } from '../config.js';
import type { Logger } from '../log.js';
import { APP_VERSION } from '../version.js';
import { mountMcpRoutes, type McpRoutes } from './mcpRoutes.js';

export interface AppDeps {
  config: Config;
  log: Logger;
  serverFactory: () => McpServer;
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

  app.get('/healthz', (_req, res) => {
    res.json({
      ok: true,
      version: APP_VERSION,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      mcpSessions: mcp.sessions.size,
    });
  });

  return { app, mcp, close: () => mcp.close() };
}

function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}
