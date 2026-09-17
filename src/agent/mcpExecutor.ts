/**
 * The runtime hook into the MCP server: every agent turn opens a real MCP client over loopback Streamable HTTP,
 * lists the tools, calls them, and terminates the session. This is deliberately not an in-process shortcut — the
 * same wire protocol Alexa+ would use is exercised (and logged) on every turn.
 */
import type { Tool } from '@aws-sdk/client-bedrock-runtime';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { Logger } from '../log.js';
import { APP_VERSION } from '../version.js';
import type { ToolCallOutcome, ToolExecutor } from './brain.js';

const STRIP_KEYS = new Set(['$schema', '$id', 'title', 'default']);

/** Bedrock accepts JSON Schema for tool inputs but not every vocabulary keyword; drop the ones it rejects. */
export function sanitizeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeSchema);
  if (schema && typeof schema === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
      if (STRIP_KEYS.has(key)) continue;
      out[key] = sanitizeSchema(value);
    }
    return out;
  }
  return schema;
}

export async function openMcpExecutor(
  mcpUrl: string,
  allow: readonly string[],
  log: Logger,
  authToken?: () => string
): Promise<ToolExecutor> {
  // When the server requires Tier-1 auth, the agent presents the same kind of Bearer token an Alexa+ add-on would.
  const transport = new StreamableHTTPClientTransport(
    new URL(mcpUrl),
    authToken ? { authProvider: { token: async () => authToken() } } : {}
  );
  const client = new Client({ name: 'carecompanion-agent', version: APP_VERSION });
  await client.connect(transport);
  const { tools } = await client.listTools();
  const specs: Tool[] = tools
    .filter((t) => allow.includes(t.name))
    .map((t) => ({
      toolSpec: {
        name: t.name,
        description: t.description ?? t.name,
        inputSchema: { json: JSON.parse(JSON.stringify(sanitizeSchema(t.inputSchema))) },
      },
    }));
  log.debug('mcp executor ready', { session: transport.sessionId, tools: specs.map((s) => s.toolSpec?.name) });

  return {
    specs,
    async call(name, args): Promise<ToolCallOutcome> {
      const started = performance.now();
      if (!allow.includes(name)) {
        return {
          text: `The tool ${name} is not available to this speaker.`,
          isError: true,
          structured: undefined,
          ms: 0,
        };
      }
      try {
        const result = await client.callTool({ name, arguments: args });
        const text = (result.content as Array<{ type: string; text?: string }>)
          .filter((c) => c.type === 'text' && typeof c.text === 'string')
          .map((c) => c.text as string)
          .join('\n');
        const ms = Math.round(performance.now() - started);
        log.info('mcp tools/call', { tool: name, isError: result.isError === true, ms });
        return {
          text,
          isError: result.isError === true,
          structured: (result.structuredContent as Record<string, unknown> | undefined) ?? undefined,
          ms,
        };
      } catch (err) {
        const ms = Math.round(performance.now() - started);
        log.warn('mcp tools/call failed', { tool: name, err, ms });
        return { text: `The ${name} tool failed: ${(err as Error).message}`, isError: true, structured: undefined, ms };
      }
    },
    async close() {
      await transport.terminateSession().catch(() => undefined);
      await client.close().catch(() => undefined);
    },
  };
}
