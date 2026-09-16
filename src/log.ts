export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  readonly level: LogLevel;
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(name: string): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** The stdio MCP binary must keep stdout clean for JSON-RPC, so it logs to 'stderr'. */
  stream?: 'stdout' | 'stderr';
  name?: string;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const out = options.stream === 'stderr' ? process.stderr : process.stdout;
  const name = options.name ?? 'carecompanion';
  const threshold = LEVELS[level];

  const write = (lvl: LogLevel, message: string, meta?: Record<string, unknown>) => {
    if (LEVELS[lvl] < threshold) return;
    const suffix = meta && Object.keys(meta).length > 0 ? ` ${safeJson(meta)}` : '';
    out.write(`${new Date().toISOString()} ${lvl.toUpperCase().padEnd(5)} [${name}] ${message}${suffix}\n`);
  };

  return {
    level,
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
    child: (childName) => createLogger({ ...options, level, name: `${name}:${childName}` }),
  };
}

export function parseLogLevel(value: string | undefined, fallback: LogLevel = 'info'): LogLevel {
  return value && value in LEVELS ? (value as LogLevel) : fallback;
}

/** A logger that drops everything — handy in tests. */
export const silentLogger: Logger = {
  level: 'error',
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, v) => (v instanceof Error ? { name: v.name, message: v.message } : v));
  } catch {
    return '[unserializable]';
  }
}
