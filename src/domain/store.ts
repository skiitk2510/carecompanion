import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from '../log.js';
import { emptyState, type State } from './model.js';
import { systemClock, type Clock } from './time.js';

export interface StoreOptions {
  clock?: Clock;
  /** JSON snapshot path. Omit for a purely in-memory store (tests). */
  dataFile?: string;
  log: Logger;
  /** Snapshot debounce; defaults to 250 ms. */
  debounceMs?: number;
}

/**
 * In-memory state with a debounced, atomic JSON snapshot. Snapshot failures are logged and never thrown —
 * Render's disk is ephemeral, so persistence is a convenience for local development, not a source of truth.
 */
export class Store {
  private state: State;
  private readonly clock: Clock;
  private readonly dataFile: string | undefined;
  private readonly log: Logger;
  private readonly debounceMs: number;
  private timer: NodeJS.Timeout | undefined;
  private dirty = false;

  constructor(initial: State, options: StoreOptions) {
    this.state = initial;
    this.clock = options.clock ?? systemClock;
    this.dataFile = options.dataFile;
    this.log = options.log.child('store');
    this.debounceMs = options.debounceMs ?? 250;
  }

  /** Loads a snapshot; returns null when the file is missing or unreadable. */
  static load(dataFile: string, log: Logger): State | null {
    try {
      const parsed = JSON.parse(readFileSync(dataFile, 'utf8')) as Partial<State>;
      if (parsed.version !== 1 || !Array.isArray(parsed.elders)) return null;
      return { ...emptyState(), ...parsed, version: 1 };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
        log.warn('snapshot unreadable, ignoring', { dataFile, err });
      return null;
    }
  }

  now(): Date {
    return this.clock.now();
  }

  nowIso(): string {
    return this.clock.now().toISOString();
  }

  /** Read access. Treat the result as immutable — use `mutate` for changes so snapshots stay consistent. */
  get(): Readonly<State> {
    return this.state;
  }

  mutate<T>(fn: (state: State) => T): T {
    const result = fn(this.state);
    this.dirty = true;
    this.scheduleSnapshot();
    return result;
  }

  replace(state: State): void {
    this.state = state;
    this.dirty = true;
    this.scheduleSnapshot();
  }

  /** Writes immediately (used on shutdown and in tests). */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (!this.dirty || !this.dataFile) return;
    try {
      mkdirSync(dirname(this.dataFile), { recursive: true });
      const tmp = `${this.dataFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.state, null, 2));
      renameSync(tmp, this.dataFile);
      this.dirty = false;
    } catch (err) {
      this.log.warn('snapshot failed', { dataFile: this.dataFile, err });
    }
  }

  private scheduleSnapshot(): void {
    if (!this.dataFile || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, this.debounceMs);
    this.timer.unref();
  }
}
