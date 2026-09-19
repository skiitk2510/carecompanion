#!/usr/bin/env node
/**
 * Live conformance probe for the CareCompanion MCP server: Streamable HTTP (MCP 2025-11-25) with a sessionful
 * lifecycle, the MCP Apps dashboard resource, and the Alexa+ MCP Toolkit notes (500 ms round-trip budget, the
 * 2025-03-26 example handshake, 401 without WWW-Authenticate when Tier-1 auth is on). Every rule is an isolated
 * async check with its own 10 s timeout; one failure never aborts the run. Supersedes scripts/mcp-lifecycle.sh.
 *
 * Usage: node scripts/verify-live.mjs <base-url> [--out docs/conformance/verdict.json] [--token <bearer>] [--strict]
 *
 * Exit code 0 = PASS, 1 = a MUST rule failed (or a SHOULD rule with --strict), 2 = usage or I/O error.
 * Node 22+ built-ins only. This is our own probe, modelled on the idea of Amazon's Local Inspector (which is not
 * available to participants) — not an official certification.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

const PRIMARY_VERSION = '2025-11-25';
/** The Client and App Lifecycle page of the Alexa+ docs shows this version in its example handshake. */
const ALEXA_EXAMPLE_VERSION = '2025-03-26';
const RULE_TIMEOUT_MS = 10_000;
const WARMUP_TIMEOUT_MS = 60_000;
const LATENCY_BUDGET_MS = 500;
const LATENCY_SAMPLES = 3;
const MCP_APP_MIME = 'text/html;profile=mcp-app';
const PREFLIGHT_ORIGIN = 'http://localhost:8080';
const DEFAULT_OUT = 'docs/conformance/verdict.json';
const CLIENT_INFO = { name: 'carecompanion-verify-live', version: '1.0.0' };
const EXPECTED_TOOLS = [
  'add_medication',
  'call_for_help',
  'caregiver_summary',
  'daily_checkin',
  'get_todays_plan',
  'log_dose',
  'resolve_alert',
  'skip_dose',
];

const MUST = 'MUST';
const SHOULD = 'SHOULD';
const pass = (detail) => ({ status: 'PASS', detail });
const fail = (detail) => ({ status: 'FAIL', detail });
const skip = (detail) => ({ status: 'SKIP', detail });

class UsageError extends Error {}

// ---------------------------------------------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------------------------------------------

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Collapses whitespace and truncates, for one-line details. */
function short(text, max = 120) {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** Decodes a JSON or SSE-encoded JSON-RPC reply; for SSE, prefers the message answering `id`. */
function parseBody(contentType, text, id) {
  if (!contentType.includes('text/event-stream')) return parseJson(text);
  const messages = [];
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    const json = parseJson(data);
    if (json) messages.push(json);
  }
  return messages.find((m) => id !== undefined && m.id === id) ?? messages.at(-1) ?? null;
}

function describeError(err) {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause instanceof Error ? ` (${err.cause.message})` : '';
  const name = err.name && err.name !== 'Error' ? `${err.name}: ` : '';
  return `${name}${err.message}${cause}`;
}

function mcpHeaders(ctx, { session, version, anonymous = false, extra = {} } = {}) {
  const headers = { ...extra };
  if (ctx.token && !anonymous) headers.authorization = `Bearer ${ctx.token}`;
  if (session) headers['mcp-session-id'] = session;
  if (version) headers['mcp-protocol-version'] = version;
  return headers;
}

const request = (ctx, method, params) => ({
  jsonrpc: '2.0',
  id: ctx.nextId++,
  method,
  ...(params === undefined ? {} : { params }),
});
const notification = (method) => ({ jsonrpc: '2.0', method });
const initializeRequest = (ctx, protocolVersion) =>
  request(ctx, 'initialize', { protocolVersion, capabilities: {}, clientInfo: CLIENT_INFO });

/** One JSON-RPC POST to /mcp. `ms` is the full round trip including reading the body. */
async function rpc(ctx, message, opts = {}) {
  const headers = mcpHeaders(ctx, {
    ...opts,
    extra: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
  });
  const started = performance.now();
  const res = await fetch(ctx.mcpUrl, { method: 'POST', headers, body: JSON.stringify(message), signal: opts.signal });
  const text = await res.text();
  const ms = performance.now() - started;
  const contentType = res.headers.get('content-type') ?? '';
  return {
    status: res.status,
    headers: res.headers,
    contentType,
    text,
    json: parseBody(contentType, text, message.id),
    ms,
  };
}

/** Options for a request on the session opened by rule 1. */
const live = (ctx, signal) => ({ session: ctx.state.session, version: ctx.state.negotiated, signal });

const callTool = (ctx, name, args, signal) =>
  rpc(ctx, request(ctx, 'tools/call', { name, arguments: args }), live(ctx, signal));

/** Best-effort DELETE of a session the probe opened itself; returns the status (0 on a network error). */
async function deleteSession(ctx, session, version, signal, anonymous = false) {
  try {
    const res = await fetch(ctx.mcpUrl, {
      method: 'DELETE',
      headers: mcpHeaders(ctx, { session, version, anonymous }),
      signal,
    });
    await res.text();
    return res.status;
  } catch {
    return 0;
  }
}

const blocked = (ctx) => (ctx.state.session ? null : skip('blocked: no live session (initialize did not succeed)'));
const noTools = (ctx) => (ctx.state.tools ? null : skip('blocked: tools/list did not succeed'));

const jsonRpcError = (res) => (isObject(res.json?.error) ? res.json.error : null);
const errorText = (error) => `JSON-RPC error ${error.code ?? '?'}: ${short(error.message, 80)}`;
const contentText = (result) => {
  const first = Array.isArray(result?.content) ? result.content[0] : undefined;
  return first?.type === 'text' && typeof first.text === 'string' ? first.text : '';
};

// ---------------------------------------------------------------------------------------------------------------
// Rules. Each `run(ctx, signal)` returns pass/fail/skip (optionally with an `ms` override) or throws → FAIL.
// ---------------------------------------------------------------------------------------------------------------

const RULES = [
  {
    id: 1,
    level: MUST,
    title: 'initialize 2025-11-25 → 200 + result',
    async run(ctx, signal) {
      const res = await rpc(ctx, initializeRequest(ctx, PRIMARY_VERSION), { signal });
      ctx.state.init = res;
      if (res.status === 401) {
        return fail(`401 ${short(res.text, 80)} — the server requires a bearer token; re-run with --token`);
      }
      if (res.status !== 200) return fail(`expected 200, got ${res.status} ${short(res.text, 80)}`);
      const result = res.json?.result;
      if (!isObject(result)) {
        const error = jsonRpcError(res);
        return fail(error ? errorText(error) : `no JSON-RPC result in a ${res.contentType || 'untyped'} body`);
      }
      const problems = [];
      if (typeof result.protocolVersion !== 'string') problems.push('result.protocolVersion missing');
      if (!isObject(result.serverInfo) || typeof result.serverInfo.name !== 'string') {
        problems.push('result.serverInfo missing');
      }
      if (!isObject(result.capabilities) || !isObject(result.capabilities.tools)) {
        problems.push('result.capabilities.tools missing');
      }
      if (problems.length > 0) return fail(problems.join('; '));
      const session = res.headers.get('mcp-session-id');
      ctx.state.session = session ?? undefined;
      ctx.state.firstSession = session ?? undefined;
      ctx.state.negotiated = result.protocolVersion;
      ctx.protocolVersions[PRIMARY_VERSION] = result.protocolVersion;
      const server = `${result.serverInfo.name} ${result.serverInfo.version ?? ''}`.trim();
      return pass(`200 ${res.contentType.split(';')[0]}; negotiated ${result.protocolVersion}; server ${server}`);
    },
  },
  {
    id: 2,
    level: MUST,
    title: 'Mcp-Session-Id on the initialize response',
    async run(ctx) {
      const init = ctx.state.init;
      if (!init || init.status !== 200) return skip(`blocked: initialize answered ${init?.status ?? 'nothing'}`);
      const session = init.headers.get('mcp-session-id');
      return session ? pass(`Mcp-Session-Id: ${session}`) : fail('initialize response carries no Mcp-Session-Id');
    },
  },
  {
    id: 3,
    level: MUST,
    title: 'notifications/initialized → 202',
    async run(ctx, signal) {
      const b = blocked(ctx);
      if (b) return b;
      const res = await rpc(ctx, notification('notifications/initialized'), live(ctx, signal));
      return res.status === 202 ? pass('202 Accepted') : fail(`expected 202, got ${res.status} ${short(res.text, 80)}`);
    },
  },
  {
    id: 4,
    level: MUST,
    title: 'tools/list: well-formed tools',
    async run(ctx, signal) {
      const b = blocked(ctx);
      if (b) return b;
      const res = await rpc(ctx, request(ctx, 'tools/list'), live(ctx, signal));
      if (res.status !== 200) return fail(`expected 200, got ${res.status} ${short(res.text, 80)}`);
      const tools = res.json?.result?.tools;
      if (!Array.isArray(tools) || tools.length === 0) {
        const error = jsonRpcError(res);
        return fail(error ? errorText(error) : 'no tools listed');
      }
      const malformed = tools
        .filter(
          (t) =>
            !isObject(t) ||
            typeof t.name !== 'string' ||
            typeof t.description !== 'string' ||
            t.description.trim() === '' ||
            !isObject(t.inputSchema)
        )
        .map((t) => (isObject(t) && typeof t.name === 'string' ? t.name : '<unnamed>'));
      if (malformed.length > 0) return fail(`tools missing name/description/inputSchema: ${malformed.join(', ')}`);
      ctx.state.tools = tools;
      const names = tools.map((t) => t.name);
      const missing = EXPECTED_TOOLS.filter((n) => !names.includes(n));
      const extra = names.filter((n) => !EXPECTED_TOOLS.includes(n));
      const notes = [
        missing.length === 0
          ? `all ${EXPECTED_TOOLS.length} CareCompanion tools present`
          : `missing CareCompanion tools: ${missing.join(', ')}`,
        ...(extra.length > 0 ? [`unexpected: ${extra.join(', ')}`] : []),
      ];
      return pass(`${tools.length} tools, all with name/description/inputSchema; ${notes.join('; ')}`);
    },
  },
  {
    id: 5,
    level: MUST,
    title: 'MCP Apps tool + readable ui:// resource',
    async run(ctx, signal) {
      const b = noTools(ctx);
      if (b) return b;
      const appTools = ctx.state.tools
        .map((t) => ({ name: t.name, uri: t._meta?.ui?.resourceUri ?? t._meta?.['ui/resourceUri'] }))
        .filter((t) => typeof t.uri === 'string' && t.uri.startsWith('ui://'));
      if (appTools.length === 0) return fail('no tool carries _meta.ui.resourceUri starting with ui://');

      const list = await rpc(ctx, request(ctx, 'resources/list'), live(ctx, signal));
      const resources = list.json?.result?.resources;
      if (list.status !== 200 || !Array.isArray(resources)) {
        return fail(`resources/list → ${list.status} ${short(list.text, 80)}`);
      }
      const listed = new Set(resources.filter(isObject).map((r) => r.uri));

      // Every distinct view is checked; the dashboard tool (and its view) is named first when present.
      const primary = appTools.find((t) => t.name === 'caregiver_summary') ?? appTools[0];
      const ordered = [primary, ...appTools.filter((t) => t !== primary)];
      const views = [];
      for (const uri of new Set(ordered.map((t) => t.uri))) {
        const names = ordered.filter((t) => t.uri === uri).map((t) => t.name);
        if (!listed.has(uri)) return fail(`${uri} (from ${names.join(', ')}) is not listed under resources/list`);
        const read = await rpc(ctx, request(ctx, 'resources/read', { uri }), live(ctx, signal));
        const contents = read.json?.result?.contents;
        if (read.status !== 200 || !Array.isArray(contents) || contents.length === 0) {
          return fail(`resources/read ${uri} → ${read.status} ${short(read.text, 80)}`);
        }
        const first = contents[0];
        if (first?.mimeType !== MCP_APP_MIME) {
          return fail(`${uri} is served as ${first?.mimeType ?? 'no mimeType'}, expected ${MCP_APP_MIME}`);
        }
        const bytes = typeof first.text === 'string' ? first.text.length : String(first.blob ?? '').length;
        views.push(`${names.join(', ')} → ${uri} (listed; ${MCP_APP_MIME}, ${Math.round(bytes / 1024)} KB)`);
      }
      return pass(views.join('; '));
    },
  },
  {
    id: 6,
    level: MUST,
    title: 'tools/call of a read-only tool',
    async run(ctx, signal) {
      const b = noTools(ctx);
      if (b) return b;
      const tool =
        ctx.state.tools.find((t) => t.name === 'get_todays_plan') ??
        ctx.state.tools.find((t) => t.annotations?.readOnlyHint === true);
      if (!tool) return fail('no get_todays_plan and no tool with annotations.readOnlyHint');
      const res = await callTool(ctx, tool.name, {}, signal);
      if (res.status !== 200) return fail(`${tool.name} → ${res.status} ${short(res.text, 80)}`);
      const error = jsonRpcError(res);
      if (error) return fail(`${tool.name}: ${errorText(error)}`);
      const result = res.json?.result;
      if (!isObject(result)) return fail(`${tool.name}: no result in the body`);
      if (result.isError) return fail(`${tool.name} answered isError: ${short(contentText(result), 80)}`);
      const text = contentText(result);
      if (text.trim() === '') return fail(`${tool.name}: content[0] is not non-empty text`);
      if (!isObject(result.structuredContent)) return fail(`${tool.name}: structuredContent missing or not an object`);
      ctx.state.readOnlyTool = tool.name;
      const keys = Object.keys(result.structuredContent);
      return pass(
        `${tool.name}: "${short(text, 60)}" + structuredContent {${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ', …' : ''}}`
      );
    },
  },
  {
    id: 7,
    level: MUST,
    title: `tools/call round trip < ${LATENCY_BUDGET_MS} ms (median of ${LATENCY_SAMPLES})`,
    async run(ctx, signal) {
      const name = ctx.state.readOnlyTool;
      if (!name) return skip('blocked: no read-only tool call succeeded (rule 6)');
      const samples = [];
      for (let i = 0; i < LATENCY_SAMPLES; i++) {
        const res = await callTool(ctx, name, {}, signal);
        if (res.status !== 200 || jsonRpcError(res))
          return fail(`call ${i + 1} → ${res.status} ${short(res.text, 80)}`);
        samples.push(res.ms);
      }
      const median = [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)];
      const detail = `${name}: median ${median.toFixed(1)} ms of [${samples.map((s) => s.toFixed(1)).join(', ')}] (budget < ${LATENCY_BUDGET_MS} ms)`;
      return { ...(median < LATENCY_BUDGET_MS ? pass(detail) : fail(detail)), ms: Math.round(median) };
    },
  },
  {
    id: 8,
    level: MUST,
    title: 'GET /mcp opens a text/event-stream',
    async run(ctx, signal) {
      const b = blocked(ctx);
      if (b) return b;
      const res = await fetch(ctx.mcpUrl, {
        headers: mcpHeaders(ctx, { ...live(ctx), extra: { accept: 'text/event-stream' } }),
        signal,
      });
      const contentType = res.headers.get('content-type') ?? '';
      if (res.status !== 200) {
        const text = await res.text();
        return fail(`expected 200, got ${res.status} ${short(text, 80)}`);
      }
      // Headers are all we need; the stream would otherwise stay open (keep-alives) until the session ends.
      await res.body?.cancel().catch(() => undefined);
      if (!contentType.includes('text/event-stream'))
        return fail(`200 but content-type is ${contentType || 'missing'}`);
      return pass(`200 ${contentType} (headers only; body aborted)`);
    },
  },
  {
    id: 9,
    level: MUST,
    title: 'DELETE /mcp ends the session',
    async run(ctx, signal) {
      const b = blocked(ctx);
      if (b) return b;
      const session = ctx.state.session;
      const res = await fetch(ctx.mcpUrl, {
        method: 'DELETE',
        headers: mcpHeaders(ctx, live(ctx)),
        signal,
      });
      const text = await res.text();
      if (res.status < 200 || res.status >= 300) return fail(`expected 2xx, got ${res.status} ${short(text, 80)}`);
      ctx.state.deadSession = session;
      ctx.state.session = undefined;
      return pass(`${res.status} for session ${session}`);
    },
  },
  {
    id: 10,
    level: MUST,
    title: 'dead session id → 404 / -32001',
    async run(ctx, signal) {
      const session = ctx.state.deadSession;
      if (!session) return skip('blocked: no session was terminated (rule 9)');
      const res = await rpc(ctx, request(ctx, 'tools/list'), { session, version: ctx.state.negotiated, signal });
      if (res.status !== 404) return fail(`expected 404, got ${res.status} ${short(res.text, 80)}`);
      const error = jsonRpcError(res);
      if (error?.code !== -32001)
        return fail(`404 but JSON-RPC error code is ${error?.code ?? 'missing'} (expected -32001)`);
      return pass(`404, error -32001 "${short(error.message, 60)}"`);
    },
  },
  {
    id: 11,
    level: MUST,
    title: 'no session id → 400 / -32000',
    async run(ctx, signal) {
      const res = await rpc(ctx, request(ctx, 'tools/list'), { version: ctx.state.negotiated, signal });
      if (res.status !== 400) return fail(`expected 400, got ${res.status} ${short(res.text, 80)}`);
      const error = jsonRpcError(res);
      if (error?.code !== -32000)
        return fail(`400 but JSON-RPC error code is ${error?.code ?? 'missing'} (expected -32000)`);
      return pass(`400, error -32000 "${short(error.message, 60)}"`);
    },
  },
  {
    id: 12,
    level: MUST,
    title: 'CORS preflight exposes Mcp-Session-Id',
    async run(ctx, signal) {
      const res = await fetch(ctx.mcpUrl, {
        method: 'OPTIONS',
        headers: {
          origin: PREFLIGHT_ORIGIN,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type,mcp-session-id,mcp-protocol-version',
        },
        signal,
      });
      await res.text();
      const expose = res.headers.get('access-control-expose-headers') ?? '';
      const allowOrigin = res.headers.get('access-control-allow-origin') ?? 'missing';
      const exposed = expose.split(',').map((h) => h.trim().toLowerCase());
      if (!exposed.includes('mcp-session-id')) {
        return fail(
          `${res.status}; Access-Control-Expose-Headers: ${expose || 'missing'}; Allow-Origin: ${allowOrigin}`
        );
      }
      return pass(`${res.status}; Access-Control-Expose-Headers: ${expose}; Allow-Origin: ${allowOrigin}`);
    },
  },
  {
    id: 13,
    level: SHOULD,
    title: `initialize ${ALEXA_EXAMPLE_VERSION} (Alexa+ docs example handshake)`,
    async run(ctx, signal) {
      const res = await rpc(ctx, initializeRequest(ctx, ALEXA_EXAMPLE_VERSION), { signal });
      if (res.status !== 200) return fail(`expected 200, got ${res.status} ${short(res.text, 80)}`);
      const negotiated = res.json?.result?.protocolVersion;
      const session = res.headers.get('mcp-session-id');
      if (session) await deleteSession(ctx, session, typeof negotiated === 'string' ? negotiated : undefined, signal);
      if (typeof negotiated !== 'string') return fail('200 but result.protocolVersion is missing');
      ctx.protocolVersions[ALEXA_EXAMPLE_VERSION] = negotiated;
      return negotiated === ALEXA_EXAMPLE_VERSION
        ? pass(`200; negotiated ${negotiated} (echoed)`)
        : pass(
            `200; server answered ${negotiated} to a ${ALEXA_EXAMPLE_VERSION} client (fallback the client must accept)`
          );
    },
  },
  {
    id: 14,
    level: SHOULD,
    title: 'invalid tool arguments → isError or JSON-RPC error, never 500',
    async run(ctx, signal) {
      const b = blocked(ctx) ?? noTools(ctx);
      if (b) return b;
      let name;
      let args;
      if (ctx.state.tools.some((t) => t.name === 'log_dose')) {
        name = 'log_dose';
        args = { medication: 123 };
      } else {
        const tool = ctx.state.tools.find(
          (t) => Array.isArray(t.inputSchema.required) && typeof t.inputSchema.required[0] === 'string'
        );
        if (!tool) return skip('no log_dose and no tool with a required argument to violate');
        name = tool.name;
        args = { [tool.inputSchema.required[0]]: { unexpected: true } };
      }
      const res = await callTool(ctx, name, args, signal);
      if (res.status >= 500) return fail(`${name} ${JSON.stringify(args)} → ${res.status} ${short(res.text, 80)}`);
      const error = jsonRpcError(res);
      if (error) return pass(`${name} ${JSON.stringify(args)} → ${res.status}, ${errorText(error)}`);
      if (res.json?.result?.isError === true) {
        return pass(`${name} ${JSON.stringify(args)} → isError: ${short(contentText(res.json.result), 80)}`);
      }
      return fail(`${name} ${JSON.stringify(args)} → ${res.status} without isError or a JSON-RPC error`);
    },
  },
  {
    id: 15,
    level: SHOULD,
    title: 'prompts/list ≥ 1 and prompts/get of the first',
    async run(ctx, signal) {
      const b = blocked(ctx);
      if (b) return b;
      const list = await rpc(ctx, request(ctx, 'prompts/list'), live(ctx, signal));
      const prompts = list.json?.result?.prompts;
      if (list.status !== 200 || !Array.isArray(prompts))
        return fail(`prompts/list → ${list.status} ${short(list.text, 80)}`);
      if (prompts.length === 0) return fail('prompts/list returned no prompts');
      const prompt = prompts[0];
      const args = {};
      for (const a of Array.isArray(prompt.arguments) ? prompt.arguments : []) if (a?.required) args[a.name] = 'x';
      const get = await rpc(
        ctx,
        request(ctx, 'prompts/get', { name: prompt.name, arguments: args }),
        live(ctx, signal)
      );
      const messages = get.json?.result?.messages;
      if (get.status !== 200 || !Array.isArray(messages) || messages.length === 0) {
        return fail(`prompts/get ${prompt.name} → ${get.status} ${short(get.text, 80)}`);
      }
      return pass(`${prompts.length} prompt(s); prompts/get ${prompt.name} → ${messages.length} message(s)`);
    },
  },
  {
    id: 16,
    level: SHOULD,
    title: 'resources/templates/list ≥ 1',
    async run(ctx, signal) {
      const b = blocked(ctx);
      if (b) return b;
      const res = await rpc(ctx, request(ctx, 'resources/templates/list'), live(ctx, signal));
      const templates = res.json?.result?.resourceTemplates;
      if (res.status !== 200 || !Array.isArray(templates)) return fail(`→ ${res.status} ${short(res.text, 80)}`);
      if (templates.length === 0) return fail('no resource templates');
      return pass(`${templates.length} template(s): ${templates.map((t) => t.uriTemplate).join(', ')}`);
    },
  },
  {
    id: 17,
    level: SHOULD,
    title: 'every tool declares annotations.openWorldHint === false',
    async run(ctx) {
      const b = noTools(ctx);
      if (b) return b;
      const bad = ctx.state.tools.filter((t) => t.annotations?.openWorldHint !== false).map((t) => t.name);
      return bad.length === 0
        ? pass(`all ${ctx.state.tools.length} tools are closed-world`)
        : fail(`openWorldHint is not false on: ${bad.join(', ')}`);
    },
  },
  {
    id: 18,
    level: SHOULD,
    title: 'GET /healthz → 200 {ok:true}',
    async run(ctx, signal) {
      const res = await fetch(`${ctx.base}/healthz`, { headers: { accept: 'application/json' }, signal });
      const text = await res.text();
      const json = parseJson(text);
      if (res.status !== 200) return fail(`${res.status} ${short(text, 80)}`);
      if (!isObject(json) || json.ok !== true) return fail(`200 but the body is not {ok:true}: ${short(text, 80)}`);
      const extras = ['version', 'auth', 'mcpSessions'].filter((k) => k in json).map((k) => `${k} ${json[k]}`);
      return pass(`200 {ok:true${extras.length > 0 ? `, ${extras.join(', ')}` : ''}}`);
    },
  },
  {
    id: 19,
    level: SHOULD,
    title: 'auth: 401 JSON without WWW-Authenticate + protected-resource metadata',
    async run(ctx, signal) {
      const anon = await rpc(ctx, initializeRequest(ctx, PRIMARY_VERSION), { signal, anonymous: true });
      if (anon.status === 200) {
        const session = anon.headers.get('mcp-session-id');
        if (session) await deleteSession(ctx, session, anon.json?.result?.protocolVersion, signal, true);
        return ctx.token
          ? fail('--token given, but an anonymous initialize → 200: the server does not require a bearer')
          : skip('server is open (anonymous initialize → 200) and no --token given');
      }
      if (anon.status !== 401)
        return fail(`anonymous initialize → ${anon.status} (expected 401) ${short(anon.text, 60)}`);
      const problems = [];
      const challenge = anon.headers.get('www-authenticate');
      if (challenge)
        problems.push(`401 carries WWW-Authenticate: ${short(challenge, 60)} (the Alexa+ checklist wants none)`);
      if (!anon.contentType.includes('application/json') || !isObject(anon.json)) problems.push('401 body is not JSON');

      const prm = await fetch(`${ctx.base}/.well-known/oauth-protected-resource/mcp`, {
        headers: { accept: 'application/json' },
        signal,
      });
      const prmText = await prm.text();
      const prmJson = parseJson(prmText);
      if (prm.status !== 200) {
        problems.push(`/.well-known/oauth-protected-resource/mcp → ${prm.status}`);
      } else if (!isObject(prmJson) || typeof prmJson.resource !== 'string' || !prmJson.resource.endsWith('/mcp')) {
        problems.push(`protected-resource metadata has resource ${JSON.stringify(prmJson?.resource)} (expected …/mcp)`);
      }
      if (problems.length > 0) return fail(problems.join('; '));

      const detail = `anonymous initialize → 401 JSON without WWW-Authenticate; PRM resource ${prmJson.resource}`;
      if (!ctx.token) return pass(`${detail}; no --token given, so the bearer lifecycle was not exercised`);
      const failedMust = ctx.results.filter((r) => r.level === MUST && r.status !== 'PASS').map((r) => r.id);
      return failedMust.length === 0
        ? pass(`${detail}; bearer lifecycle (rules 1–12) passed`)
        : fail(`${detail}; but the bearer lifecycle did not pass (rules ${failedMust.join(', ')})`);
    },
  },
  {
    id: 20,
    level: SHOULD,
    title: 'a second initialize opens a different session id',
    async run(ctx, signal) {
      const first = ctx.state.firstSession;
      if (!first) return skip('blocked: no first session (initialize did not succeed)');
      const res = await rpc(ctx, initializeRequest(ctx, PRIMARY_VERSION), { signal });
      if (res.status !== 200) return fail(`second initialize → ${res.status} ${short(res.text, 80)}`);
      const session = res.headers.get('mcp-session-id');
      if (!session) return fail('second initialize carries no Mcp-Session-Id');
      await deleteSession(ctx, session, res.json?.result?.protocolVersion, signal);
      return session === first
        ? fail(`second initialize reused session ${session}`)
        : pass(`second session ${session} ≠ first ${first}; closed again`);
    },
  },
];

/** Execution order respects dependencies (rules 14–17 need the live session that rule 9 terminates). */
const ORDER = [18, 1, 2, 3, 4, 5, 6, 7, 14, 15, 16, 17, 8, 20, 13, 9, 10, 11, 12, 19];

// ---------------------------------------------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------------------------------------------

async function runRule(ctx, rule) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`timed out after ${RULE_TIMEOUT_MS / 1000} s`)),
    RULE_TIMEOUT_MS
  );
  const started = performance.now();
  let outcome;
  try {
    outcome = await Promise.race([
      rule.run(ctx, controller.signal),
      new Promise((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
      }),
    ]);
  } catch (err) {
    outcome = fail(describeError(err));
  } finally {
    clearTimeout(timer);
  }
  const ms = outcome.ms ?? Math.round(performance.now() - started);
  return { id: rule.id, level: rule.level, title: rule.title, status: outcome.status, detail: outcome.detail, ms };
}

/** Wakes a sleeping deployment (Render free tier) so the graded rules measure the server, not a cold start. */
async function warmUp(ctx) {
  const started = performance.now();
  try {
    const res = await fetch(`${ctx.base}/healthz`, { signal: AbortSignal.timeout(WARMUP_TIMEOUT_MS) });
    await res.text();
    console.log(`warm-up GET /healthz → ${res.status} in ${Math.round(performance.now() - started)} ms`);
  } catch (err) {
    console.log(
      `warm-up GET /healthz failed after ${Math.round(performance.now() - started)} ms: ${describeError(err)}`
    );
  }
}

function summarize(results, level) {
  const of = (status) => results.filter((r) => r.level === level && r.status === status).length;
  return { pass: of('PASS'), fail: of('FAIL'), skip: of('SKIP') };
}

function buildVerdict(ctx, results, strict) {
  const must = summarize(results, MUST);
  const should = summarize(results, SHOULD);
  const verdict = must.fail === 0 && (!strict || should.fail === 0) ? 'PASS' : 'FAIL';
  return {
    target: ctx.mcpUrl,
    checkedAt: new Date().toISOString(),
    auth: ctx.token ? 'bearer' : 'anonymous',
    strict,
    protocolVersions: ctx.protocolVersions,
    summary: { must, should, verdict },
    rules: results.map(({ id, level, title, status, detail, ms }) => ({ id, level, title, status, detail, ms })),
  };
}

function printTable(results) {
  const header = ['id', 'level', 'status', 'ms', 'rule: detail'];
  const rows = results.map((r) => [String(r.id), r.level, r.status, String(r.ms), `${r.title}: ${r.detail}`]);
  const widths = header.slice(0, 4).map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const line = (c) =>
    `${c[0].padStart(widths[0])}  ${c[1].padEnd(widths[1])}  ${c[2].padEnd(widths[2])}  ${c[3].padStart(widths[3])}  ${c[4]}`;
  console.log('');
  console.log(line(header));
  console.log(line([...widths.map((w) => '-'.repeat(w)), '-'.repeat(60)]));
  for (const row of rows) console.log(line(row));
  console.log('');
}

function printUsage(stream) {
  stream.write(
    [
      `Usage: node scripts/verify-live.mjs <base-url> [--out ${DEFAULT_OUT}] [--token <bearer>] [--strict]`,
      '',
      'Probes <base-url>/mcp (Streamable HTTP, MCP 2025-11-25, MCP Apps, Alexa+ notes), prints a graded table and',
      'writes a JSON verdict. Exit 0 = PASS, 1 = a MUST rule failed (or a SHOULD rule with --strict), 2 = usage error.',
      '',
      '  --out <file>      where to write the verdict JSON (default docs/conformance/verdict.json)',
      '  --token <bearer>  send Authorization: Bearer on every /mcp request (Tier-1 client-credentials servers)',
      '  --strict          also fail the verdict when a SHOULD rule fails',
      '',
    ].join('\n')
  );
}

function normalizeBase(raw) {
  let url;
  try {
    url = new URL(raw.includes('://') ? raw : `http://${raw}`);
  } catch {
    throw new UsageError(`not a URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new UsageError(`unsupported protocol: ${url.protocol}`);
  url.search = '';
  url.hash = '';
  let base = url.toString().replace(/\/+$/, '');
  if (base.endsWith('/mcp')) base = base.slice(0, -'/mcp'.length);
  return base;
}

function parseCli(argv) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: 'string', default: DEFAULT_OUT },
        token: { type: 'string' },
        strict: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err) {
    throw new UsageError(describeError(err));
  }
}

async function main(argv) {
  const { values, positionals } = parseCli(argv);
  if (values.help) {
    printUsage(process.stdout);
    return 0;
  }
  if (positionals.length !== 1) throw new UsageError('expected exactly one <base-url>');
  const base = normalizeBase(positionals[0]);
  const outPath = resolve(process.cwd(), values.out);
  const ctx = {
    base,
    mcpUrl: `${base}/mcp`,
    token: values.token,
    nextId: 1,
    state: {},
    results: [],
    protocolVersions: { [PRIMARY_VERSION]: null, [ALEXA_EXAMPLE_VERSION]: null },
  };

  console.log(
    `CareCompanion live conformance probe → ${ctx.mcpUrl} (${ctx.token ? 'Authorization: Bearer <token>' : 'anonymous'})`
  );
  await warmUp(ctx);
  for (const id of ORDER)
    ctx.results.push(
      await runRule(
        ctx,
        RULES.find((r) => r.id === id)
      )
    );

  const results = [...ctx.results].sort((a, b) => a.id - b.id);
  const verdict = buildVerdict(ctx, results, values.strict);
  printTable(results);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(verdict, null, 2)}\n`);
  const { must, should } = verdict.summary;
  console.log(
    `VERDICT: ${verdict.summary.verdict} (must ${must.pass}/${must.pass + must.fail}, should ${should.pass}/${should.pass + should.fail}) → ${values.out}`
  );
  return verdict.summary.verdict === 'PASS' ? 0 : 1;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    if (err instanceof UsageError) {
      console.error(`error: ${err.message}\n`);
      printUsage(process.stderr);
    } else {
      console.error(`error: ${describeError(err)}`);
    }
    process.exitCode = 2;
  }
);
