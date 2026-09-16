import type { CallToolResult } from '@modelcontextprotocol/server';
import { DomainError } from '../domain/actions.js';
import type { Logger } from '../log.js';

/** Splits an action result into the spoken text (content) and the structured payload. */
export function speak<T extends { spoken: string }>(result: T): CallToolResult {
  const { spoken, ...rest } = result;
  return { content: [{ type: 'text', text: spoken }], structuredContent: rest as Record<string, unknown> };
}

/** Runs an action inside a tool handler; domain errors become `isError` results the host can read aloud. */
export function run<T extends { spoken: string }>(log: Logger, tool: string, fn: () => T): CallToolResult {
  const started = performance.now();
  try {
    const outcome = speak(fn());
    log.debug('tool ok', { tool, ms: Math.round(performance.now() - started) });
    return outcome;
  } catch (err) {
    if (err instanceof DomainError) {
      log.warn('tool refused', { tool, code: err.code, message: err.message });
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
    log.error('tool failed', { tool, err });
    return {
      isError: true,
      content: [{ type: 'text', text: 'Sorry — something went wrong on the CareCompanion server.' }],
    };
  }
}
