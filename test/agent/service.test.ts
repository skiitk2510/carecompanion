import { afterEach, describe, expect, it } from 'vitest';
import type { AgentResponse, AgentStatus } from '../../src/shared/agent.js';
import { awsError, scriptedBedrock, textOutput, toolUseOutput } from '../helpers/scriptedBedrock.js';
import { postJson, startTestServer, type TestServer } from '../helpers/testServer.js';

describe('POST /api/agent — the simulated Alexa+ brain over a real loopback MCP client', () => {
  let srv: TestServer;

  afterEach(async () => {
    await srv?.close();
  });

  it('rule brain: "what is my plan" calls get_todays_plan through MCP and closes its session', async () => {
    srv = await startTestServer();
    const { status, json } = await postJson<AgentResponse>(`${srv.baseUrl}/api/agent`, {
      utterance: 'what is my plan today',
    });
    expect(status).toBe(200);
    expect(json.brain).toBe('rules');
    expect(json.toolCalls.map((t) => t.name)).toEqual(['get_todays_plan']);
    expect(json.reply).toContain('Good morning, Margaret.');
    expect(srv.app.mcp.sessions.size).toBe(0); // the per-turn session was terminated
  });

  it('rule brain: the duplicate-dose guard round trip works purely through spoken turns', async () => {
    srv = await startTestServer();
    const first = await postJson<AgentResponse>(`${srv.baseUrl}/api/agent`, { utterance: 'I took my lisinopril' });
    expect(first.json.reply).toContain('You already took Lisinopril at 8:05 a.m. today.');
    expect(first.json.toolCalls[0]?.args).toEqual({ medication: 'lisinopril' });

    const second = await postJson<AgentResponse>(`${srv.baseUrl}/api/agent`, {
      utterance: 'yes, record it anyway because the doctor told me to double it today',
      history: [
        { role: 'user', text: 'I took my lisinopril' },
        { role: 'assistant', text: first.json.reply },
      ],
    });
    // The rule brain recovers the medication from the assistant's own refusal sentence ("You already took Lisinopril…").
    expect(String(second.json.toolCalls[0]?.args.medication).toLowerCase()).toBe('lisinopril');
    expect(second.json.toolCalls[0]?.args).toMatchObject({ confirmOverride: true });
    expect(second.json.reply).toContain("I've recorded the extra Lisinopril");
    expect(second.json.alertIds).toHaveLength(1);
  });

  it('rule brain: symptoms escalate and "help" alerts everyone with emergency guidance', async () => {
    srv = await startTestServer();
    const dizzy = await postJson<AgentResponse>(`${srv.baseUrl}/api/agent`, {
      utterance: "I'm feeling a bit dizzy today",
    });
    expect(dizzy.json.toolCalls[0]?.name).toBe('daily_checkin');
    expect(dizzy.json.reply).toContain("I've let Priya Hart-Singh know");

    const help = await postJson<AgentResponse>(`${srv.baseUrl}/api/agent`, {
      utterance: 'help, I fell in the bathroom',
    });
    expect(help.json.toolCalls[0]?.name).toBe('call_for_help');
    expect(help.json.emergencyGuidance).toMatch(/^This could be an emergency\. Please call 911 right now\./);
  });

  it('rule brain: a caregiver can ask for the weekly summary', async () => {
    srv = await startTestServer();
    const res = await postJson<AgentResponse>(`${srv.baseUrl}/api/agent`, {
      utterance: 'how is mom doing this week',
      speaker: 'caregiver',
    });
    expect(res.json.toolCalls[0]?.name).toBe('caregiver_summary');
    expect(res.json.reply).toMatch(/7-day adherence is \d+ percent/);
  });

  it('bedrock brain: the scripted model drives the real MCP tools over loopback HTTP', async () => {
    const bedrock = scriptedBedrock([
      toolUseOutput([{ id: 'tu-1', name: 'get_todays_plan' }]),
      textOutput('You have six doses today, Margaret. Next up is Metformin at 6 p.m.'),
    ]);
    srv = await startTestServer({ converse: bedrock.converse });
    const { json } = await postJson<AgentResponse>(`${srv.baseUrl}/api/agent`, { utterance: 'what do I take today' });
    expect(json.brain).toBe('bedrock');
    expect(json.toolCalls[0]).toMatchObject({ name: 'get_todays_plan', isError: false });
    expect(json.toolCalls[0]?.resultText).toContain('Good morning, Margaret.');
    expect(json.reply).toContain('Next up is Metformin');
    // The elder-facing tool list was offered to the model, and the tool schemas were sanitized for Bedrock.
    const offered = bedrock.calls[0]!.toolConfig!.tools!.map((t) => t.toolSpec!.name);
    expect(offered).toEqual(['get_todays_plan', 'log_dose', 'skip_dose', 'daily_checkin', 'call_for_help']);
    const schema = bedrock.calls[0]!.toolConfig!.tools![1]!.toolSpec!.inputSchema!.json as Record<string, unknown>;
    expect(schema.$schema).toBeUndefined();
    expect((schema.properties as Record<string, unknown>).medication).toBeDefined();
    expect(srv.app.mcp.sessions.size).toBe(0);
  });

  it('bedrock brain: an elder cannot reach caregiver tools even if the model asks', async () => {
    const bedrock = scriptedBedrock([
      toolUseOutput([
        { id: 'tu-1', name: 'add_medication', input: { name: 'x', dose: '1', scheduleTimes: ['08:00'] } },
      ]),
      textOutput('Please ask a caregiver to add that from the dashboard.'),
    ]);
    srv = await startTestServer({ converse: bedrock.converse });
    const { json } = await postJson<AgentResponse>(`${srv.baseUrl}/api/agent`, { utterance: 'add ibuprofen' });
    expect(json.toolCalls[0]).toMatchObject({ name: 'add_medication', isError: true });
    expect(srv.store.get().medications.map((m) => m.name)).not.toContain('X');
  });

  it('falls back to the rule brain when Bedrock is unavailable, and counts usage', async () => {
    const bedrock = scriptedBedrock([awsError('AccessDeniedException')]);
    srv = await startTestServer({ converse: bedrock.converse });
    const { json } = await postJson<AgentResponse>(`${srv.baseUrl}/api/agent`, { utterance: 'what is my plan today' });
    expect(json.brain).toBe('rules');
    expect(json.toolCalls[0]?.name).toBe('get_todays_plan');
    const status = (await (await fetch(`${srv.baseUrl}/api/agent/status`)).json()) as AgentStatus;
    expect(status.usage.ruleTurns).toBe(1);
    expect(status.turnsToday).toBe(1);
    expect(status.bedrockPaused).toBe(true); // access failures pause Bedrock; the next turn goes straight to rules
    const next = await postJson<AgentResponse>(`${srv.baseUrl}/api/agent`, { utterance: 'what is my plan today' });
    expect(next.json.brain).toBe('rules');
    expect(bedrock.calls).toHaveLength(1);
  });

  it('honours the daily turn cap by switching to the rule brain', async () => {
    const bedrock = scriptedBedrock([textOutput('Hello there.'), textOutput('never used')]);
    srv = await startTestServer({ converse: bedrock.converse, env: { AGENT_DAILY_TURN_CAP: '1' } });
    const first = await postJson<AgentResponse>(`${srv.baseUrl}/api/agent`, { utterance: 'hello' });
    expect(first.json.brain).toBe('bedrock');
    const second = await postJson<AgentResponse>(`${srv.baseUrl}/api/agent`, { utterance: 'what is my plan today' });
    expect(second.json.brain).toBe('rules');
    expect(bedrock.calls).toHaveLength(1);
  });

  it('rate-limits per client and rejects malformed requests', async () => {
    srv = await startTestServer({ env: { AGENT_RATE_PER_MIN: '3' } });
    const bad = await postJson<{ error: string }>(`${srv.baseUrl}/api/agent`, { utterance: '' });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe('invalid_request');

    const ok1 = await postJson(`${srv.baseUrl}/api/agent`, { utterance: 'hello' });
    const ok2 = await postJson(`${srv.baseUrl}/api/agent`, { utterance: 'hello' });
    const limited = await postJson<{ error: string }>(`${srv.baseUrl}/api/agent`, { utterance: 'hello' });
    expect([ok1.status, ok2.status, limited.status]).toEqual([200, 200, 429]); // the limiter counts the malformed request too
    expect(limited.json.error).toBe('rate_limited');
  });
});
