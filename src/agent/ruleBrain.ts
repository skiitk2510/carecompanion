/**
 * Offline fallback brain: a small intent router that drives the same MCP tools without any LLM. It keeps the
 * public demo alive if Bedrock is unreachable or the daily turn cap is hit, and it makes the agent testable in CI.
 */
import type { AgentResponse, AgentToolCall, AgentTurn } from '../shared/agent.js';
import { firstLines, harvest, type Brain, type BrainInput, type ToolExecutor } from './brain.js';

const HELP = /\b(help|fell|fall(en)?|emergency|can'?t breathe|cannot breathe|chest pain|stroke|bleeding)\b/i;
const PLAN =
  /\b(plan|schedule|briefing|what('s| is| do) (my|i) (day|take|taking)|what do i take|my day|today'?s? (doses|pills|medications?))\b/i;
const OVERRIDE = /\b(record it anyway|yes,? record|go ahead and record|record it)\b/i;
const TOOK = /\b(took|taken|take|had|swallowed|just had)\b/i;
const SKIP = /\b(skip|skipping|not going to take|won'?t take)\b/i;
const FEEL =
  /\b(feel|feeling|felt|check.?in|mood|tired|dizzy|sick|pain|headache|nausea|sleep|great|good|okay|fine|bad|awful|terrible|low|sad)\b/i;
const SUMMARY = /\b(summary|dashboard|how (is|was|did)|adherence|report|week)\b/i;
const RESOLVE = /\b(acknowledge|resolve|clear) (the )?alert\b/i;

const MOODS = [
  'great',
  'good',
  'okay',
  'fine',
  'alright',
  'so-so',
  'low',
  'sad',
  'bad',
  'awful',
  'terrible',
  'tired',
  'unwell',
];

export function createRuleBrain(): Brain {
  return {
    kind: 'rules',
    async respond(input: BrainInput): Promise<AgentResponse> {
      const utterance = input.request.utterance.trim();
      const toolCalls: AgentToolCall[] = [];
      const call = async (name: string, args: Record<string, unknown>) => {
        const outcome = await input.tools.call(name, args);
        toolCalls.push({ name, args, resultText: firstLines(outcome.text), isError: outcome.isError, ms: outcome.ms });
        return outcome;
      };
      const finish = (reply: string, structured?: Record<string, unknown>): AgentResponse => {
        const harvested = harvest(structured);
        const response: AgentResponse = {
          reply: reply.trim(),
          brain: 'rules',
          toolCalls,
          usage: { inputTokens: 0, outputTokens: 0, rounds: toolCalls.length },
          alertIds: harvested.alertIds,
        };
        if (harvested.emergencyGuidance) response.emergencyGuidance = harvested.emergencyGuidance;
        return response;
      };
      const speaker = input.context.speaker;

      if (HELP.test(utterance) && !FEEL.test(utterance.replace(HELP, ''))) {
        const out = await call('call_for_help', { message: utterance });
        return finish(out.text, out.structured);
      }
      if (OVERRIDE.test(utterance)) {
        const medication = lastMedicationMention(input.history) ?? medicationPhrase(utterance);
        if (!medication)
          return finish('Which medication should I record? Tell me the name and why you need the extra dose.');
        const overrideReason = reasonOf(utterance) ?? utterance;
        const out = await call('log_dose', { medication, confirmOverride: true, overrideReason });
        return finish(out.text, out.structured);
      }
      if (SKIP.test(utterance)) {
        const medication = medicationPhrase(utterance);
        if (!medication) return finish('Which medication do you want to skip?');
        const out = await call('skip_dose', {
          medication,
          ...(reasonOf(utterance) ? { reason: reasonOf(utterance) } : {}),
        });
        return finish(out.text, out.structured);
      }
      if (TOOK.test(utterance)) {
        const medication = medicationPhrase(utterance);
        if (!medication) return finish('Which medication did you take?');
        const out = await call('log_dose', { medication });
        return finish(out.text, out.structured);
      }
      if (PLAN.test(utterance)) {
        const out = await call('get_todays_plan', {});
        return finish(out.text, out.structured);
      }
      if (speaker === 'caregiver' && RESOLVE.test(utterance)) {
        return finish(
          'Please acknowledge or resolve alerts from the dashboard, where you can add a note for the record.'
        );
      }
      if (speaker === 'caregiver' && SUMMARY.test(utterance)) {
        const out = await call('caregiver_summary', { days: /30|month/i.test(utterance) ? 30 : 7 });
        return finish(out.text, out.structured);
      }
      if (FEEL.test(utterance) || HELP.test(utterance)) {
        const mood = MOODS.find((m) => new RegExp(`\\b${m}\\b`, 'i').test(utterance)) ?? 'okay';
        const out = await call('daily_checkin', { mood, symptoms: [utterance] });
        return finish(out.text, out.structured);
      }
      return finish(
        speaker === 'caregiver'
          ? 'I can give you the weekly summary, or you can add medications and handle alerts from the dashboard. What would you like?'
          : "I can tell you today's plan, log a dose, do your daily check-in, or call for help. What would you like?"
      );
    },
  };
}

/** "I took my blood pressure pill this morning" → "blood pressure pill this morning" (resolveMedication strips filler). */
function medicationPhrase(utterance: string): string | undefined {
  const m =
    /\b(?:took|taken|take|had|swallowed|skip(?:ping)?|record)\b\s+(?:my\s+|the\s+|a\s+|an\s+)?(.+?)(?:\s+(?:this|at|around|because|since|,).*)?[.!?]?$/i.exec(
      utterance
    );
  const phrase = m?.[1]?.trim();
  return phrase && phrase.length > 1 ? phrase : undefined;
}

function reasonOf(utterance: string): string | undefined {
  const m = /\b(?:because|since|as|—|-)\s+(.+?)[.!?]?$/i.exec(utterance);
  return m?.[1]?.trim();
}

function lastMedicationMention(history: AgentTurn[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i]!;
    if (turn.role === 'assistant') {
      const m = /You (?:already )?took ([A-Z][a-zA-Z-]+)/.exec(turn.text);
      if (m?.[1]) return m[1];
    }
    if (turn.role === 'user') {
      const phrase = medicationPhrase(turn.text);
      if (phrase) return phrase;
    }
  }
  return undefined;
}

export type { ToolExecutor };
