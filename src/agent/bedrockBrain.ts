import type {
  ContentBlock,
  ConverseCommandInput,
  ConverseCommandOutput,
  Message,
} from '@aws-sdk/client-bedrock-runtime';
import type { Logger } from '../log.js';
import type { AgentResponse, AgentToolCall } from '../shared/agent.js';
import { firstLines, harvest, type Brain, type BrainInput } from './brain.js';
import { buildSystemPrompt } from './systemPrompt.js';

/** The one seam to Bedrock: `ConverseCommand` in production, a scripted function in tests. */
export type ConverseFn = (input: ConverseCommandInput) => Promise<ConverseCommandOutput>;

export interface BedrockBrainOptions {
  converse: ConverseFn;
  modelId: string;
  maxToolRounds: number;
  maxTokens: number;
  log: Logger;
  /** Tool result text is truncated to this many characters before it goes back to the model. */
  maxResultChars?: number;
}

const FALLBACK_REPLY = "I'm having trouble finishing that. Could you say it again?";

export function createBedrockBrain(opts: BedrockBrainOptions): Brain {
  const log = opts.log.child('bedrock');
  const maxResultChars = opts.maxResultChars ?? 1500;

  return {
    kind: 'bedrock',
    async respond(input: BrainInput): Promise<AgentResponse> {
      const messages: Message[] = [
        ...input.history.map((t) => ({ role: t.role, content: [{ text: t.text }] }) as Message),
        { role: 'user', content: [{ text: input.request.utterance }] },
      ];
      const system = [{ text: buildSystemPrompt(input.context) }];
      const toolCalls: AgentToolCall[] = [];
      const alertIds: string[] = [];
      let emergencyGuidance: string | undefined;
      const usage = { inputTokens: 0, outputTokens: 0, rounds: 0 };
      let reply = '';

      for (let round = 0; round <= opts.maxToolRounds; round++) {
        const output = await opts.converse({
          modelId: opts.modelId,
          system,
          messages: messages.slice(), // a snapshot: the SDK (and tests) must not observe later pushes
          toolConfig: { tools: input.tools.specs, toolChoice: { auto: {} } },
          inferenceConfig: { maxTokens: opts.maxTokens, temperature: 0.2 },
        });
        usage.rounds += 1;
        usage.inputTokens += output.usage?.inputTokens ?? 0;
        usage.outputTokens += output.usage?.outputTokens ?? 0;

        const message = output.output?.message;
        if (!message) break;
        messages.push(message);
        const text = textOf(message.content ?? []);

        if (output.stopReason !== 'tool_use') {
          reply = text;
          break;
        }

        const uses = (message.content ?? []).filter(
          (b): b is ContentBlock.ToolUseMember => 'toolUse' in b && !!b.toolUse
        );
        if (uses.length === 0) {
          reply = text;
          break;
        }
        if (round === opts.maxToolRounds) {
          log.warn('tool round cap reached', { cap: opts.maxToolRounds });
          reply = text || FALLBACK_REPLY;
          break;
        }

        // Execute every requested tool, then hand ALL results back in ONE user turn (Converse requires it).
        const results: ContentBlock[] = [];
        for (const use of uses) {
          const name = use.toolUse.name ?? '';
          const args = (use.toolUse.input ?? {}) as Record<string, unknown>;
          const outcome = await input.tools.call(name, args);
          toolCalls.push({
            name,
            args,
            resultText: firstLines(outcome.text),
            isError: outcome.isError,
            ms: outcome.ms,
          });
          const harvested = harvest(outcome.structured);
          alertIds.push(...harvested.alertIds);
          emergencyGuidance = harvested.emergencyGuidance ?? emergencyGuidance;
          results.push({
            toolResult: {
              toolUseId: use.toolUse.toolUseId ?? '',
              content: [{ text: outcome.text.slice(0, maxResultChars) || '(no text)' }],
              status: outcome.isError ? 'error' : 'success',
            },
          });
        }
        messages.push({ role: 'user', content: results });
      }

      if (!reply.trim()) reply = toolCalls.at(-1)?.resultText || FALLBACK_REPLY;
      const response: AgentResponse = {
        reply: reply.trim(),
        brain: 'bedrock',
        toolCalls,
        usage,
        alertIds: [...new Set(alertIds)],
      };
      if (emergencyGuidance) response.emergencyGuidance = emergencyGuidance;
      return response;
    },
  };
}

function textOf(blocks: ContentBlock[]): string {
  return blocks
    .map((b) => ('text' in b && typeof b.text === 'string' ? b.text : ''))
    .filter(Boolean)
    .join(' ')
    .trim();
}
