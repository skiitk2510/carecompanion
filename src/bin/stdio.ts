#!/usr/bin/env node
// CareCompanion over stdio, for local agent hosts (Claude Code, Inspector, etc.).
// stdout carries JSON-RPC, so every log line goes to stderr.
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { loadConfig } from '../config.js';
import { CareActions } from '../domain/actions.js';
import { createStore } from '../domain/bootstrap.js';
import { createLogger } from '../log.js';
import { buildServer } from '../mcp/server.js';
import { APP_VERSION } from '../version.js';

const config = loadConfig();
const log = createLogger({ stream: 'stderr', level: config.logLevel });
const store = createStore(config, log);
const actions = new CareActions({ store, log });
const server = buildServer({ log, actions });

await server.connect(new StdioServerTransport());
log.info(`CareCompanion ${APP_VERSION} ready on stdio`);

const flush = () => {
  store.flush();
  process.exit(0);
};
process.on('SIGINT', flush);
process.on('SIGTERM', flush);
