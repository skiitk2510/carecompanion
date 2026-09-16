import { createBedrockBrain } from './agent/bedrockBrain.js';
import { createConverse } from './agent/bedrockClient.js';
import { createRuleBrain } from './agent/ruleBrain.js';
import { AgentService } from './agent/service.js';
import { loadConfig } from './config.js';
import { CareActions } from './domain/actions.js';
import { createStore } from './domain/bootstrap.js';
import { createApp } from './http/app.js';
import { createLogger } from './log.js';
import { buildServer } from './mcp/server.js';
import { APP_VERSION } from './version.js';

const config = loadConfig();
const log = createLogger({ level: config.logLevel });
const store = createStore(config, log);
const actions = new CareActions({ store, log });

// The agent reaches this process's own MCP endpoint over loopback HTTP; the port is final only after listen().
let boundPort = config.port;
const rules = createRuleBrain();
const bedrock =
  config.agentBrain === 'bedrock'
    ? createBedrockBrain({
        converse: createConverse(config.bedrockRegion, log),
        modelId: config.bedrockModelId,
        maxToolRounds: config.agentMaxToolRounds,
        maxTokens: config.agentMaxTokens,
        log,
      })
    : null;
const agent = new AgentService({
  config,
  log,
  actions,
  mcpUrl: () => `http://127.0.0.1:${boundPort}/mcp`,
  bedrock,
  rules,
});

const { app, close } = createApp({
  config,
  log,
  serverFactory: () => buildServer({ log, actions }),
  agent,
  actions,
});

const httpServer = app.listen(config.port, config.host, () => {
  const address = httpServer.address();
  if (address && typeof address === 'object') boundPort = address.port;
  log.info(`CareCompanion ${APP_VERSION} listening`, {
    url: `http://${config.host}:${boundPort}`,
    mcp: '/mcp',
    agent: '/api/agent',
    allowedHosts: config.allowedHosts,
    env: config.nodeEnv,
    bedrock: { region: config.bedrockRegion, model: config.bedrockModelId, brain: config.agentBrain },
  });
});

let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('shutting down', { signal });
  store.flush();
  const forceExit = setTimeout(() => process.exit(1), 5_000);
  forceExit.unref();
  httpServer.close(() => {
    void close().finally(() => process.exit(0));
  });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
