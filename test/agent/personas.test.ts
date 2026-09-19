/**
 * Runs the persona evaluation suite (test/agent/personas.ts) end to end: one in-process server per persona, the rule
 * brain, a clock frozen at the persona's local time, every turn through POST /api/agent with the conversation history
 * carried along. Besides the personas' own expectations it proves the runtime hook: every tool the server executed
 * during a turn is logged in the response's `toolCalls`, in order, and the per-turn MCP session is closed afterwards.
 *
 * It also keeps docs/evals/personas.json — the JSON mirror scripts/persona-eval.mjs reads — equal to the TypeScript
 * definitions; `UPDATE_PERSONAS=1 npx vitest run test/agent/personas.test.ts` regenerates it.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CareActions } from '../../src/domain/actions.js';
import { fixedClock, zonedToUtc } from '../../src/domain/time.js';
import type { AgentResponse, AgentTurn } from '../../src/shared/agent.js';
import type { DashboardData } from '../../src/shared/dashboard.js';
import { postJson, startTestServer } from '../helpers/testServer.js';
import {
  EVAL_DATE,
  EVAL_TZ,
  PERSONAS,
  PERSONAS_MIRROR_PATH,
  evaluateTurn,
  personasMirror,
  type CheckResult,
  type ExpectedWarning,
  type PersonaTurn,
  type ToolName,
  type TurnObservation,
} from './personas.js';

/** The domain action behind each MCP tool (and its REST twin), for the runtime-hook proof. */
const ACTION_TOOLS: Record<string, ToolName> = {
  todaysPlan: 'get_todays_plan',
  logDose: 'log_dose',
  skipDose: 'skip_dose',
  dailyCheckIn: 'daily_checkin',
  callForHelp: 'call_for_help',
  addMedication: 'add_medication',
  caregiverSummary: 'caregiver_summary',
  resolveAlert: 'resolve_alert',
};

/** Wraps the actions the tools call so the test sees, in order, every tool the server really executed. */
function recordExecutedTools(actions: CareActions): string[] {
  const executed: string[] = [];
  const target = actions as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const [method, tool] of Object.entries(ACTION_TOOLS)) {
    const original = target[method];
    if (typeof original !== 'function') throw new Error(`CareActions.${method} is not a method`);
    target[method] = (...args: unknown[]) => {
      executed.push(tool);
      return original.apply(actions, args);
    };
  }
  return executed;
}

type PostedTurn = Omit<TurnObservation, 'alerts'>;

/** Plays one turn — POST /api/agent (carrying the history) or the turn's REST route — without reading anything back. */
async function postTurn(baseUrl: string, turn: PersonaTurn, history: AgentTurn[]): Promise<PostedTurn> {
  if (turn.rest) {
    const { status, json } = await postJson<Record<string, unknown>>(`${baseUrl}${turn.rest.path}`, turn.rest.body);
    const spoken = typeof json.spoken === 'string' ? json.spoken : JSON.stringify(json);
    return {
      brain: 'rest',
      reply: spoken,
      toolCalls: [{ name: turn.rest.tool, args: turn.rest.body, resultText: spoken, isError: status >= 400, ms: 0 }],
      alertIds: typeof json.alertId === 'string' ? [json.alertId] : [],
      ...(Array.isArray(json.warnings) ? { warnings: json.warnings as ExpectedWarning[] } : {}),
    };
  }
  const { status, json } = await postJson<AgentResponse>(`${baseUrl}/api/agent`, {
    utterance: turn.utterance,
    speaker: turn.speaker,
    history,
  });
  expect(status, `POST /api/agent → ${status}: ${JSON.stringify(json)}`).toBe(200);
  history.push({ role: 'user', text: turn.utterance }, { role: 'assistant', text: json.reply });
  return {
    brain: json.brain,
    reply: json.reply,
    toolCalls: json.toolCalls,
    alertIds: json.alertIds,
    ...(json.emergencyGuidance ? { emergencyGuidance: json.emergencyGuidance } : {}),
  };
}

/** Reads the alerts the turn created back through the dashboard route (names of notified caregivers included). */
async function withAlerts(baseUrl: string, posted: PostedTurn): Promise<TurnObservation> {
  const dashboard = (await (await fetch(`${baseUrl}/api/dashboard`)).json()) as DashboardData;
  const alerts = [...dashboard.openAlerts, ...dashboard.recentlyResolved].filter((a) => posted.alertIds.includes(a.id));
  return { ...posted, alerts };
}

function describeFailures(failed: CheckResult[], observed: TurnObservation): string {
  const lines = failed.map((r) => `  FAIL ${r.check} — ${r.detail}`);
  const tools = observed.toolCalls.map((t) => `${t.name} ${JSON.stringify(t.args)}`).join('; ') || 'none';
  return [...lines, `  brain: ${observed.brain}`, `  tools: ${tools}`, `  reply: ${observed.reply}`].join('\n');
}

describe('persona evaluation suite — safety guardrails through POST /api/agent (rule brain, frozen clock)', () => {
  for (const persona of PERSONAS) {
    it(`${persona.id}: ${persona.name}`, async () => {
      const at = zonedToUtc(EVAL_DATE, persona.localTime, EVAL_TZ).toISOString();
      const srv = await startTestServer({ scenario: persona.scenario, clock: fixedClock(at) });
      try {
        const executed = recordExecutedTools(srv.actions);
        const history: AgentTurn[] = [];
        for (const [index, turn] of persona.turns.entries()) {
          const label = `${persona.id} turn ${index + 1} (${turn.speaker}: "${turn.utterance}")`;
          const before = executed.length;
          const posted = await postTurn(srv.baseUrl, turn, history);
          const executedThisTurn = executed.slice(before);
          const observed = await withAlerts(srv.baseUrl, posted);

          // The runtime-hook proof: the response logs every tool the server executed for the turn, in order.
          expect(
            observed.toolCalls.map((t) => t.name),
            `${label}: toolCalls must log every tool the server executed`
          ).toEqual(executedThisTurn);
          expect(srv.app.mcp.sessions.size, `${label}: the per-turn MCP session must be closed`).toBe(0);

          const failed = evaluateTurn(turn.expect, observed).filter((r) => !r.pass);
          expect(failed.length, `${label}\n${describeFailures(failed, observed)}`).toBe(0);
        }
      } finally {
        await srv.close();
      }
    });
  }

  it(`${PERSONAS_MIRROR_PATH} mirrors the TypeScript definitions (UPDATE_PERSONAS=1 regenerates it)`, async () => {
    const file = resolve(dirname(fileURLToPath(import.meta.url)), '../..', PERSONAS_MIRROR_PATH);
    const expected = JSON.parse(JSON.stringify(personasMirror())) as unknown;
    if (process.env.UPDATE_PERSONAS === '1') {
      const prettier = await import('prettier');
      const options = (await prettier.resolveConfig(file)) ?? {};
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, await prettier.format(JSON.stringify(expected, null, 2), { ...options, filepath: file }));
    }
    let actual: unknown = null;
    try {
      actual = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      actual = null; // missing or unparsable — reported by the assertion below
    }
    expect(
      actual,
      `${PERSONAS_MIRROR_PATH} is missing or stale — run: UPDATE_PERSONAS=1 npx vitest run test/agent/personas.test.ts`
    ).toEqual(expected);
  });
});
