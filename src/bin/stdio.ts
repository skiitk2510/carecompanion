#!/usr/bin/env node
// CareCompanion over stdio, for local agent hosts (Claude Code, Inspector, etc.).
// stdout carries JSON-RPC, so every log line goes to stderr.
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createLogger, parseLogLevel } from '../log.js';
import { buildServer } from '../mcp/server.js';
import { APP_VERSION } from '../version.js';

const log = createLogger({ stream: 'stderr', level: parseLogLevel(process.env.LOG_LEVEL) });
const server = buildServer({ log });
await server.connect(new StdioServerTransport());
log.info(`CareCompanion ${APP_VERSION} ready on stdio`);
