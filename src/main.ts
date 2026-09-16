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

const { app, close } = createApp({
  config,
  log,
  serverFactory: () => buildServer({ log, actions }),
});

const httpServer = app.listen(config.port, config.host, () => {
  log.info(`CareCompanion ${APP_VERSION} listening`, {
    url: `http://${config.host}:${config.port}`,
    mcp: '/mcp',
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
