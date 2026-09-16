import { parseLogLevel, type LogLevel } from './log.js';

export type SeedMode = 'always' | 'if-empty' | 'never';
export type AgentBrain = 'bedrock' | 'rules';

export interface Config {
  port: number;
  host: string;
  nodeEnv: string;
  logLevel: LogLevel;
  /** Host headers accepted by the MCP endpoint (DNS-rebinding protection). */
  allowedHosts: string[];
  corsOrigins: '*' | string[];
  householdTz: string;
  seedOnBoot: SeedMode;
  dataFile: string;
  bedrockRegion: string;
  bedrockModelId: string;
  agentBrain: AgentBrain;
  agentMaxToolRounds: number;
  agentMaxTokens: number;
  agentDailyTurnCap: number;
  agentRatePerMin: number;
  demoResetToken: string | undefined;
  demoClockOffsetMin: number;
  ringEnabled: boolean;
}

export const DEFAULT_BEDROCK_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const allowedHosts = list(env.ALLOWED_HOSTS, ['localhost', '127.0.0.1']);
  // Render injects its public hostname; accept it without a manual env edit.
  if (env.RENDER_EXTERNAL_HOSTNAME && !allowedHosts.includes(env.RENDER_EXTERNAL_HOSTNAME)) {
    allowedHosts.push(env.RENDER_EXTERNAL_HOSTNAME);
  }
  const corsRaw = list(env.CORS_ORIGINS, ['*']);

  return {
    port: int(env.PORT, 3000),
    host: env.HOST ?? '0.0.0.0',
    nodeEnv: env.NODE_ENV ?? 'development',
    logLevel: parseLogLevel(env.LOG_LEVEL),
    allowedHosts,
    corsOrigins: corsRaw.includes('*') ? '*' : corsRaw,
    householdTz: env.HOUSEHOLD_TZ ?? 'America/Los_Angeles',
    seedOnBoot: oneOf(env.SEED_ON_BOOT, ['always', 'if-empty', 'never'], 'if-empty'),
    dataFile: env.DATA_FILE ?? './data/state.json',
    // The local ~/.aws default profile is ap-south-1, where Bedrock model access is not enabled — pin explicitly.
    bedrockRegion: env.BEDROCK_REGION ?? env.AWS_REGION ?? 'us-east-1',
    bedrockModelId: env.BEDROCK_MODEL_ID ?? DEFAULT_BEDROCK_MODEL_ID,
    agentBrain: oneOf(env.AGENT_BRAIN, ['bedrock', 'rules'], 'bedrock'),
    agentMaxToolRounds: int(env.AGENT_MAX_TOOL_ROUNDS, 5),
    agentMaxTokens: int(env.AGENT_MAX_TOKENS, 768),
    agentDailyTurnCap: int(env.AGENT_DAILY_TURN_CAP, 400),
    agentRatePerMin: int(env.AGENT_RATE_PER_MIN, 10),
    demoResetToken: env.DEMO_RESET_TOKEN || undefined,
    demoClockOffsetMin: int(env.DEMO_CLOCK_OFFSET_MIN, 0),
    ringEnabled: bool(env.RING_ENABLED, false),
  };
}

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function list(value: string | undefined, fallback: readonly string[]): string[] {
  if (!value) return [...fallback];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value ?? '') ? (value as T) : fallback;
}
