/** Request/response contract of POST /api/agent — shared, type-only, with the web app. */

export type Speaker = 'elder' | 'caregiver';

export interface AgentTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AgentRequest {
  utterance: string;
  speaker?: Speaker;
  elderId?: string;
  /** Prior turns, oldest first. The server keeps the last few. */
  history?: AgentTurn[];
}

export interface AgentToolCall {
  name: string;
  args: Record<string, unknown>;
  /** First lines of the tool's spoken text. */
  resultText: string;
  isError: boolean;
  ms: number;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  rounds: number;
}

export interface AgentResponse {
  reply: string;
  brain: 'bedrock' | 'rules';
  toolCalls: AgentToolCall[];
  usage: AgentUsage;
  /** Alert ids created during this turn (from tool results). */
  alertIds: string[];
  /** Present when a tool returned emergency guidance this turn. */
  emergencyGuidance?: string;
}

export interface AgentStatus {
  brain: 'bedrock' | 'rules';
  model: string;
  region: string;
  turnsToday: number;
  dailyTurnCap: number;
  /** True while Bedrock is paused after an access/credential failure (the rule brain answers meanwhile). */
  bedrockPaused: boolean;
  usage: { inputTokens: number; outputTokens: number; bedrockTurns: number; ruleTurns: number };
}
