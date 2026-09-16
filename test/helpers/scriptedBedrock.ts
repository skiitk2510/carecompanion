import type { ConverseCommandInput, ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import type { ConverseFn } from '../../src/agent/bedrockBrain.js';

const usage = { inputTokens: 100, outputTokens: 20, totalTokens: 120 };
const metrics = { latencyMs: 5 };

/** A Bedrock reply that asks for tools. */
export function toolUseOutput(
  calls: Array<{ id: string; name: string; input?: Record<string, unknown> }>
): ConverseCommandOutput {
  return {
    $metadata: {},
    stopReason: 'tool_use',
    usage,
    metrics,
    output: {
      message: {
        role: 'assistant',
        content: calls.map((c) => ({
          toolUse: { toolUseId: c.id, name: c.name, input: JSON.parse(JSON.stringify(c.input ?? {})) },
        })),
      },
    },
  };
}

/** A final Bedrock reply. */
export function textOutput(text: string): ConverseCommandOutput {
  return {
    $metadata: {},
    stopReason: 'end_turn',
    usage,
    metrics,
    output: { message: { role: 'assistant', content: [{ text }] } },
  };
}

export interface ScriptedBedrock {
  converse: ConverseFn;
  /** Every request the brain sent, in order (each a snapshot of that call's input). */
  calls: ConverseCommandInput[];
}

/** Replays `outputs` in order; throws if the brain asks for more than scripted. */
export function scriptedBedrock(outputs: Array<ConverseCommandOutput | Error>): ScriptedBedrock {
  const queue = [...outputs];
  const calls: ConverseCommandInput[] = [];
  return {
    calls,
    converse: async (input) => {
      calls.push(input);
      const next = queue.shift();
      if (!next) throw new Error('scriptedBedrock: no more scripted outputs');
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

export function awsError(name: string): Error {
  const err = new Error(name);
  err.name = name;
  return err;
}
