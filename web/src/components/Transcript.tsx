/**
 * The conversation so far: user bubbles on the right, assistant bubbles on the left, and under each assistant
 * bubble the brain badge plus a ToolChip per MCP tool call. Autoscrolls to the newest turn.
 */
import { useEffect, useRef } from 'react';
import type { AgentResponse } from '@shared/agent';
import { brainLabel, formatTokens } from '../lib/text';
import { ToolChip } from './ToolChip';

export interface TranscriptTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** ISO time the turn was added. */
  at: string;
  /** Who spoke a user turn ("Margaret", "Priya"). */
  speakerLabel?: string;
  /** The full agent response behind an assistant turn. */
  response?: AgentResponse;
  /** An assistant-side turn that reports a failed request (not sent as history). */
  failed?: boolean;
}

interface TranscriptProps {
  turns: TranscriptTurn[];
  /** Bedrock model id from /api/agent/status, for the brain badge. */
  modelId?: string;
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function AssistantMeta({ response, modelId }: { response: AgentResponse; modelId?: string }) {
  const bedrock = response.brain === 'bedrock';
  const tokens = response.usage.inputTokens + response.usage.outputTokens;
  return (
    <div className="mt-1.5 space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span
          className={`rounded-full border px-2 py-px font-medium ${
            bedrock ? 'border-indigo-200 bg-indigo-50 text-indigo-800' : 'border-slate-300 bg-slate-100 text-slate-700'
          }`}
        >
          {brainLabel(response.brain, modelId)}
        </span>
        {bedrock && tokens > 0 && (
          <span className="text-slate-500">
            {formatTokens(tokens)} tokens · {response.usage.rounds} {response.usage.rounds === 1 ? 'round' : 'rounds'}
          </span>
        )}
        {response.alertIds.length > 0 && (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-px font-medium text-amber-800">
            {response.alertIds.length === 1 ? '1 caregiver alert raised' : `${response.alertIds.length} alerts raised`}
          </span>
        )}
      </div>
      {response.toolCalls.length > 0 && (
        <ul className="space-y-1" aria-label="MCP tool calls">
          {response.toolCalls.map((call, index) => (
            <ToolChip key={`${call.name}-${index}`} call={call} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function Transcript({ turns, modelId }: TranscriptProps) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [turns]);

  return (
    <div
      ref={boxRef}
      role="log"
      aria-label="Conversation transcript"
      aria-live="polite"
      className="max-h-[32rem] overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-3"
    >
      {turns.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-slate-500">
          No conversation yet. Press the microphone or type a message to start.
        </p>
      ) : (
        <ol className="space-y-3">
          {turns.map((turn) =>
            turn.role === 'user' ? (
              <li key={turn.id} className="flex justify-end">
                <div className="max-w-[85%]">
                  <div className="rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2.5 text-base leading-relaxed text-white shadow-sm">
                    {turn.text}
                  </div>
                  <div className="mt-0.5 text-right text-[11px] text-slate-500">
                    {turn.speakerLabel ?? 'You'} · {timeOf(turn.at)}
                  </div>
                </div>
              </li>
            ) : (
              <li key={turn.id} className="flex justify-start">
                <div className="max-w-[92%]">
                  <div
                    className={`rounded-2xl rounded-bl-sm border px-4 py-2.5 text-base leading-relaxed shadow-sm ${
                      turn.failed
                        ? 'border-rose-200 bg-rose-50 text-rose-900'
                        : 'border-slate-200 bg-white text-slate-900'
                    }`}
                  >
                    {turn.text}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    Alexa · {timeOf(turn.at)}
                    {turn.response?.emergencyGuidance && (
                      <span className="ml-2 font-semibold text-rose-700">emergency guidance</span>
                    )}
                  </div>
                  {turn.response && <AssistantMeta response={turn.response} modelId={modelId} />}
                </div>
              </li>
            )
          )}
        </ol>
      )}
    </div>
  );
}
