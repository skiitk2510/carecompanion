import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { Logger } from '../log.js';
import { APP_VERSION } from '../version.js';

export interface ServerDeps {
  log: Logger;
}

export const SERVER_NAME = 'carecompanion';

export const SERVER_INSTRUCTIONS = [
  'CareCompanion coordinates medication reminders, daily check-ins, and caregiver alerts for one elder household.',
  'Tool text is written to be spoken aloud — read it as-is.',
  'CareCompanion is a coordination and reminder tool, not medical advice.',
].join(' ');

/**
 * Builds a fresh McpServer. Cheap and side-effect free: the HTTP transport creates one per session,
 * the stdio binary creates exactly one. Shared state (the store) lives in `deps`, never in here.
 */
export function buildServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: APP_VERSION }, { instructions: SERVER_INSTRUCTIONS });

  server.registerTool(
    'ping',
    {
      title: 'Ping',
      description: 'Health check. Returns "pong" with the server time.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      deps.log.debug('tool ping');
      return { content: [{ type: 'text', text: `pong — server time ${new Date().toISOString()}` }] };
    }
  );

  return server;
}
