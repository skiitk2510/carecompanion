import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { isInitializeRequest, type McpServer } from '@modelcontextprotocol/server';
import type { AlertEvent } from '../domain/actions.js';
import type { Logger } from '../log.js';

export interface McpRouteDeps {
  log: Logger;
  serverFactory: () => McpServer;
  /** Sessions with no traffic for this long are closed. Default 30 min. */
  sessionIdleMs?: number;
  /** SSE keep-alive interval for open streams. Default 15 s. */
  keepAliveMs?: number;
  /** Alert source; every new alert is pushed to all open sessions as a `notifications/message`. */
  alerts?: { onAlert(listener: (event: AlertEvent) => void): () => void };
}

interface Session {
  transport: NodeStreamableHTTPServerTransport;
  server: McpServer;
  lastSeen: number;
}

export interface McpRoutes {
  readonly sessions: ReadonlyMap<string, Session>;
  close(): Promise<void>;
}

/**
 * Sessionful Streamable HTTP (spec 2025-11-25) on POST|GET|DELETE /mcp — the pattern from the SDK's
 * `examples/legacy-routing`. The stateless `createMcpHandler` default answers GET/DELETE with 405, which
 * MCP clients (and Alexa+) treat as a broken session lifecycle, so we keep a session map instead.
 */
export function mountMcpRoutes(app: Express, deps: McpRouteDeps): McpRoutes {
  const sessions = new Map<string, Session>();
  const idleMs = deps.sessionIdleMs ?? 30 * 60_000;
  const log = deps.log.child('mcp');

  const handle = async (req: Request, res: Response): Promise<void> => {
    const header = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(header) ? header[0] : header;

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      session.lastSeen = Date.now();
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
      const server = deps.serverFactory();
      const transport = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        keepAliveMs: deps.keepAliveMs ?? 15_000,
        onsessioninitialized: (id) => {
          sessions.set(id, { transport, server, lastSeen: Date.now() });
          log.info('session opened', { id, open: sessions.size });
        },
      });
      transport.onclose = () => {
        if (transport.sessionId && sessions.delete(transport.sessionId)) {
          log.info('session closed', { id: transport.sessionId, open: sessions.size });
        }
      };
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    if (sessionId) {
      // Unknown or expired session → 404 so the client knows to re-initialize.
      res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null });
      return;
    }
    res
      .status(400)
      .json({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: Session ID required' }, id: null });
  };

  const route = (req: Request, res: Response) => {
    handle(req, res).catch((err: unknown) => {
      log.error('request failed', { method: req.method, err });
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
      }
    });
  };
  app.post('/mcp', route);
  app.get('/mcp', route);
  app.delete('/mcp', route);

  // Server-initiated notifications: a host that keeps its session open (GET stream) hears about new alerts as
  // they happen — the family dashboard can refresh instead of polling, and a voice host can mention them.
  const unsubscribe = deps.alerts?.onAlert((event) => {
    if (sessions.size === 0) return;
    const level = event.severity === 'critical' ? 'error' : event.severity === 'warning' ? 'warning' : 'info';
    for (const [id, session] of sessions) {
      session.server
        .sendLoggingMessage({ level, logger: 'carecompanion.alerts', data: event })
        .catch((err: unknown) => log.debug('alert push skipped', { id, err }));
    }
    log.info('alert pushed to sessions', { alert: event.alertId, sessions: sessions.size });
  });

  const sweep = setInterval(() => {
    const cutoff = Date.now() - idleMs;
    for (const [id, session] of sessions) {
      if (session.lastSeen < cutoff) {
        log.info('session idle, closing', { id });
        void session.transport.close();
      }
    }
  }, 60_000);
  sweep.unref();

  return {
    sessions,
    close: async () => {
      clearInterval(sweep);
      unsubscribe?.();
      await Promise.all([...sessions.values()].map((s) => s.transport.close()));
    },
  };
}
