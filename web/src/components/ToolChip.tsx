/**
 * One MCP tool call the agent made during a turn — the visible proof that the brain drove the server's tools.
 * Rendered under the assistant bubble in the transcript.
 */
import type { AgentToolCall } from '@shared/agent';
import { summarizeArgs } from '../lib/text';
import { WrenchIcon } from './icons';

export function ToolChip({ call }: { call: AgentToolCall }) {
  const args = summarizeArgs(call.args);
  const tone = call.isError
    ? 'border-rose-300 bg-rose-50 text-rose-900'
    : 'border-emerald-200 bg-emerald-50 text-emerald-950';
  return (
    <li className={`rounded-lg border px-2.5 py-1.5 text-xs leading-snug ${tone}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="inline-flex items-center gap-1 font-semibold">
          <WrenchIcon className="h-3.5 w-3.5" />
          <code className="font-mono">{call.name}</code>
        </span>
        {args && <span className="text-slate-600">{args}</span>}
        {call.isError && (
          <span className="rounded bg-rose-600 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-white">
            error
          </span>
        )}
        <span className="ml-auto tabular-nums text-slate-500">{call.ms}ms</span>
      </div>
      {call.resultText && (
        <p className="mt-0.5 text-slate-700" title={call.resultText}>
          {call.resultText}
        </p>
      )}
    </li>
  );
}
