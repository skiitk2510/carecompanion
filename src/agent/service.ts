import type { Config } from '../config.js';
import type { CareActions } from '../domain/actions.js';
import { toClockTime, toLocalDate } from '../domain/time.js';
import type { Logger } from '../log.js';
import type { AgentRequest, AgentResponse, AgentStatus, AgentTurn } from '../shared/agent.js';
import { isBedrockUnavailable } from './bedrockClient.js';
import { toolsFor, type Brain, type ConversationContext, type ToolExecutor } from './brain.js';
import { openMcpExecutor } from './mcpExecutor.js';

export interface AgentServiceDeps {
  config: Config;
  log: Logger;
  actions: CareActions;
  /** Loopback URL of this process's own /mcp endpoint (known only after listen()). */
  mcpUrl: () => string;
  bedrock: Brain | null;
  rules: Brain;
  /** Test seam; defaults to a real MCP client over loopback HTTP. */
  openExecutor?: (
    mcpUrl: string,
    allow: readonly string[],
    log: Logger,
    authToken?: () => string
  ) => Promise<ToolExecutor>;
  /** Mints a Bearer token for the loopback client when /mcp requires Tier-1 auth. */
  mcpAuthToken?: () => string;
}

const MAX_HISTORY_TURNS = 6;
const BEDROCK_PAUSE_MS = 5 * 60_000;

/** Orchestrates one agent turn: rate/cap checks → open the MCP executor → pick a brain → respond → close. */
export class AgentService {
  private readonly deps: AgentServiceDeps;
  private readonly log: Logger;
  private turns = { day: '', count: 0 };
  private bedrockPausedUntil = 0;
  private readonly usage = { inputTokens: 0, outputTokens: 0, bedrockTurns: 0, ruleTurns: 0 };

  constructor(deps: AgentServiceDeps) {
    this.deps = deps;
    this.log = deps.log.child('agent');
  }

  status(): AgentStatus {
    this.rollDay();
    return {
      brain: this.deps.bedrock && this.deps.config.agentBrain === 'bedrock' ? 'bedrock' : 'rules',
      model: this.deps.config.bedrockModelId,
      region: this.deps.config.bedrockRegion,
      turnsToday: this.turns.count,
      dailyTurnCap: this.deps.config.agentDailyTurnCap,
      bedrockPaused: Date.now() < this.bedrockPausedUntil,
      usage: { ...this.usage },
    };
  }

  async respond(request: AgentRequest): Promise<AgentResponse> {
    const speaker = request.speaker ?? 'elder';
    const history = (request.history ?? [])
      .slice(-MAX_HISTORY_TURNS)
      .map(cleanTurn)
      .filter((t) => t.text.length > 0);
    const context = this.context(request.elderId, speaker);
    const open = this.deps.openExecutor ?? openMcpExecutor;
    const tools = await open(this.deps.mcpUrl(), toolsFor(speaker), this.log, this.deps.mcpAuthToken);
    try {
      const brain = this.pickBrain();
      const input = { request: { ...request, speaker }, history, context, tools };
      if (brain.kind === 'bedrock') {
        try {
          const response = await brain.respond(input);
          this.count(response);
          return response;
        } catch (err) {
          // Any Bedrock failure still gets the person an answer; access/credential failures also pause Bedrock
          // for a while so every turn doesn't pay for a doomed round trip.
          if (isBedrockUnavailable(err)) {
            this.bedrockPausedUntil = Date.now() + BEDROCK_PAUSE_MS;
            this.log.warn('bedrock unavailable — pausing it and using the rule brain', {
              err,
              pauseMs: BEDROCK_PAUSE_MS,
            });
          } else {
            this.log.error('bedrock turn failed — using the rule brain for this turn', { err });
          }
        }
      }
      const response = await this.deps.rules.respond(input);
      this.count(response);
      return response;
    } finally {
      await tools.close();
    }
  }

  private pickBrain(): Brain {
    this.rollDay();
    const { bedrock, rules, config } = this.deps;
    if (!bedrock || config.agentBrain !== 'bedrock') return rules;
    if (Date.now() < this.bedrockPausedUntil) return rules;
    if (this.turns.count >= config.agentDailyTurnCap) {
      this.log.warn('daily turn cap reached; using the rule brain', { cap: config.agentDailyTurnCap });
      return rules;
    }
    return bedrock;
  }

  private count(response: AgentResponse): void {
    this.rollDay();
    this.turns.count += 1;
    this.usage.inputTokens += response.usage.inputTokens;
    this.usage.outputTokens += response.usage.outputTokens;
    if (response.brain === 'bedrock') this.usage.bedrockTurns += 1;
    else this.usage.ruleTurns += 1;
  }

  private rollDay(): void {
    const day = new Date().toISOString().slice(0, 10);
    if (this.turns.day !== day) this.turns = { day, count: 0 };
  }

  private context(elderId: string | undefined, speaker: 'elder' | 'caregiver'): ConversationContext {
    const snapshot = this.deps.actions.household(elderId);
    const now = snapshot.now;
    return {
      speaker,
      elderName: snapshot.elder.name,
      preferredName: snapshot.elder.prefs.preferredName,
      age: snapshot.elder.age,
      emergencyNumber: snapshot.household.emergencyNumber,
      localDate: toLocalDate(now, snapshot.household.timezone),
      localTime: toClockTime(now, snapshot.household.timezone),
      tz: snapshot.household.timezone,
      caregiverNames: snapshot.caregivers.map((c) => c.name),
    };
  }
}

function cleanTurn(turn: AgentTurn): AgentTurn {
  return {
    role: turn.role === 'assistant' ? 'assistant' : 'user',
    text: String(turn.text ?? '')
      .trim()
      .slice(0, 2000),
  };
}
