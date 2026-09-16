import type { Tool } from '@aws-sdk/client-bedrock-runtime';
import type { AgentRequest, AgentResponse, AgentTurn, Speaker } from '../shared/agent.js';

/** What a brain needs to know about the person it is talking to. */
export interface ConversationContext {
  speaker: Speaker;
  elderName: string;
  preferredName: string;
  age: number;
  emergencyNumber: string;
  localDate: string;
  localTime: string;
  tz: string;
  caregiverNames: string[];
}

export interface ToolCallOutcome {
  text: string;
  isError: boolean;
  structured: Record<string, unknown> | undefined;
  ms: number;
}

/** A per-turn handle on the MCP server's tools (opened over loopback Streamable HTTP, closed after the turn). */
export interface ToolExecutor {
  /** Tool specs in Bedrock Converse format, already filtered for the speaker. */
  specs: Tool[];
  call(name: string, args: Record<string, unknown>): Promise<ToolCallOutcome>;
  close(): Promise<void>;
}

export interface BrainInput {
  request: AgentRequest;
  history: AgentTurn[];
  context: ConversationContext;
  tools: ToolExecutor;
}

export interface Brain {
  readonly kind: 'bedrock' | 'rules';
  respond(input: BrainInput): Promise<AgentResponse>;
}

export const ELDER_TOOLS = ['get_todays_plan', 'log_dose', 'skip_dose', 'daily_checkin', 'call_for_help'] as const;
export const CAREGIVER_TOOLS = [...ELDER_TOOLS, 'add_medication', 'caregiver_summary', 'resolve_alert'] as const;

export function toolsFor(speaker: Speaker): readonly string[] {
  return speaker === 'caregiver' ? CAREGIVER_TOOLS : ELDER_TOOLS;
}

/** Pulls alert ids and emergency guidance out of a tool's structured result. */
export function harvest(structured: Record<string, unknown> | undefined): {
  alertIds: string[];
  emergencyGuidance?: string;
} {
  const alertIds: string[] = [];
  if (structured) {
    if (typeof structured.alertId === 'string') alertIds.push(structured.alertId);
    if (Array.isArray(structured.alertIds))
      alertIds.push(...structured.alertIds.filter((x): x is string => typeof x === 'string'));
  }
  const guidance =
    structured && typeof structured.emergencyGuidance === 'string' ? structured.emergencyGuidance : undefined;
  return guidance ? { alertIds, emergencyGuidance: guidance } : { alertIds };
}

export function firstLines(text: string, max = 160): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
