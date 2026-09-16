import type { ContentBlock } from '@aws-sdk/client-bedrock-runtime';
import { describe, expect, it } from 'vitest';
import { createBedrockBrain } from '../../src/agent/bedrockBrain.js';
import type { ConversationContext, ToolCallOutcome, ToolExecutor } from '../../src/agent/brain.js';
import { silentLogger } from '../../src/log.js';
import { scriptedBedrock, textOutput, toolUseOutput } from '../helpers/scriptedBedrock.js';

const context: ConversationContext = {
  speaker: 'elder',
  elderName: 'Margaret Hart',
  preferredName: 'Margaret',
  age: 78,
  emergencyNumber: '911',
  localDate: '2026-09-16',
  localTime: '10:30',
  tz: 'America/Los_Angeles',
  caregiverNames: ['Priya Hart-Singh', 'Daniel Hart'],
};

function fakeTools(
  handlers: Record<string, (args: Record<string, unknown>) => Partial<ToolCallOutcome>>
): ToolExecutor & {
  calls: Array<{ name: string; args: Record<string, unknown> }>;
  closed: boolean;
} {
  const executor = {
    calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
    closed: false,
    specs: Object.keys(handlers).map((name) => ({ toolSpec: { name, inputSchema: { json: { type: 'object' } } } })),
    async call(name: string, args: Record<string, unknown>): Promise<ToolCallOutcome> {
      executor.calls.push({ name, args });
      const handler = handlers[name];
      if (!handler) return { text: `unknown tool ${name}`, isError: true, structured: undefined, ms: 1 };
      return { text: '', isError: false, structured: undefined, ms: 3, ...handler(args) };
    },
    async close() {
      executor.closed = true;
    },
  };
  return executor;
}

const brainWith = (converse: ReturnType<typeof scriptedBedrock>['converse'], maxToolRounds = 5) =>
  createBedrockBrain({ converse, modelId: 'test-model', maxToolRounds, maxTokens: 256, log: silentLogger });

describe('bedrock brain — Converse tool-use loop', () => {
  it('runs one tool round, feeds the result back in a user turn, and returns the final text', async () => {
    const bedrock = scriptedBedrock([
      toolUseOutput([{ id: 'tu-1', name: 'get_todays_plan' }]),
      textOutput('Good morning Margaret. Six doses today; next up is Metformin at 6 p.m.'),
    ]);
    const tools = fakeTools({ get_todays_plan: () => ({ text: 'Good morning, Margaret. You have 6 doses today.' }) });

    const res = await brainWith(bedrock.converse).respond({
      request: { utterance: 'what do I take today', speaker: 'elder' },
      history: [
        { role: 'user', text: 'hi' },
        { role: 'assistant', text: 'Hello Margaret.' },
      ],
      context,
      tools,
    });

    expect(res.brain).toBe('bedrock');
    expect(res.reply).toContain('Six doses today');
    expect(res.toolCalls.map((t) => t.name)).toEqual(['get_todays_plan']);
    expect(res.usage).toEqual({ inputTokens: 200, outputTokens: 40, rounds: 2 });

    expect(bedrock.calls).toHaveLength(2);
    const first = bedrock.calls[0]!;
    expect(first.modelId).toBe('test-model');
    expect(first.system?.[0]?.text).toContain('Margaret Hart');
    expect(first.system?.[0]?.text).toContain('requiresConfirmation=true');
    expect(first.toolConfig?.tools?.map((t) => t.toolSpec?.name)).toEqual(['get_todays_plan']);
    expect(first.messages?.map((m) => m.role)).toEqual(['user', 'assistant', 'user']); // history + utterance

    const second = bedrock.calls[1]!;
    const last = second.messages?.at(-1);
    expect(last?.role).toBe('user');
    const block = last?.content?.[0] as ContentBlock.ToolResultMember;
    expect(block.toolResult.toolUseId).toBe('tu-1');
    expect(block.toolResult.status).toBe('success');
    expect(block.toolResult.content?.[0]).toEqual({ text: 'Good morning, Margaret. You have 6 doses today.' });
  });

  it('executes parallel tool uses and returns ALL results in one user message, marking errors', async () => {
    const bedrock = scriptedBedrock([
      toolUseOutput([
        { id: 'a', name: 'get_todays_plan' },
        { id: 'b', name: 'log_dose', input: { medication: 'nonsense' } },
      ]),
      textOutput('Done.'),
    ]);
    const tools = fakeTools({
      get_todays_plan: () => ({ text: 'plan' }),
      log_dose: () => ({ text: "I couldn't find that medication.", isError: true }),
    });
    const res = await brainWith(bedrock.converse).respond({ request: { utterance: 'x' }, history: [], context, tools });
    expect(tools.calls.map((c) => c.name)).toEqual(['get_todays_plan', 'log_dose']);
    const results = bedrock.calls[1]!.messages!.at(-1)!.content as ContentBlock.ToolResultMember[];
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.toolResult.status)).toEqual(['success', 'error']);
    expect(res.toolCalls[1]?.isError).toBe(true);
  });

  it('harvests alert ids and emergency guidance from structured results', async () => {
    const bedrock = scriptedBedrock([
      toolUseOutput([{ id: 't', name: 'daily_checkin', input: { mood: 'bad', symptoms: ['chest pain'] } }]),
      textOutput('This could be an emergency. Please call 911 right now.'),
    ]);
    const tools = fakeTools({
      daily_checkin: () => ({
        text: 'This could be an emergency. Please call 911 right now.',
        structured: {
          alertIds: ['alert_1'],
          emergencyGuidance: 'This could be an emergency. Please call 911 right now.',
        },
      }),
    });
    const res = await brainWith(bedrock.converse).respond({
      request: { utterance: 'my chest hurts' },
      history: [],
      context,
      tools,
    });
    expect(res.alertIds).toEqual(['alert_1']);
    expect(res.emergencyGuidance).toContain('call 911');
  });

  it('stops at the round cap with a fallback reply instead of looping forever', async () => {
    const bedrock = scriptedBedrock(
      Array.from({ length: 6 }, (_, i) => toolUseOutput([{ id: `t${i}`, name: 'get_todays_plan' }]))
    );
    const tools = fakeTools({ get_todays_plan: () => ({ text: 'plan' }) });
    const res = await brainWith(bedrock.converse, 2).respond({
      request: { utterance: 'loop' },
      history: [],
      context,
      tools,
    });
    expect(bedrock.calls).toHaveLength(3); // rounds 0,1 execute tools; round 2 hits the cap
    expect(tools.calls).toHaveLength(2);
    expect(res.reply.length).toBeGreaterThan(0);
    expect(res.usage.rounds).toBe(3);
  });

  it('truncates long tool text before returning it to the model', async () => {
    const bedrock = scriptedBedrock([toolUseOutput([{ id: 't', name: 'get_todays_plan' }]), textOutput('ok')]);
    const tools = fakeTools({ get_todays_plan: () => ({ text: 'x'.repeat(5000) }) });
    await createBedrockBrain({
      converse: bedrock.converse,
      modelId: 'm',
      maxToolRounds: 3,
      maxTokens: 64,
      log: silentLogger,
      maxResultChars: 100,
    }).respond({
      request: { utterance: 'x' },
      history: [],
      context,
      tools,
    });
    const block = bedrock.calls[1]!.messages!.at(-1)!.content![0] as ContentBlock.ToolResultMember;
    expect((block.toolResult.content?.[0] as { text: string }).text).toHaveLength(100);
  });
});
