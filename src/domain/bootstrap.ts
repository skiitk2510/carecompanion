import { resolve } from 'node:path';
import type { Config } from '../config.js';
import type { Logger } from '../log.js';
import { packageRoot } from '../paths.js';
import { emptyState, type State } from './model.js';
import { buildSeedState, type SeedScenario } from './seed.js';
import { Store } from './store.js';
import { offsetClock, systemClock, type Clock } from './time.js';

export interface BootstrapOptions {
  clock?: Clock;
  scenario?: SeedScenario;
}

/** Snapshot-or-seed on boot, per `SEED_ON_BOOT`, with the demo clock offset applied. */
export function createStore(config: Config, log: Logger, opts: BootstrapOptions = {}): Store {
  const base = opts.clock ?? systemClock;
  const clock = config.demoClockOffsetMin ? offsetClock(base, config.demoClockOffsetMin) : base;
  const dataFile = config.dataFile ? resolve(packageRoot, config.dataFile) : undefined;

  let state: State | null = null;
  if (config.seedOnBoot !== 'always' && dataFile) state = Store.load(dataFile, log);

  if (state) {
    log.info('loaded snapshot', { dataFile, elders: state.elders.length, alerts: state.alerts.length });
  } else if (config.seedOnBoot === 'never') {
    state = emptyState();
    log.info('starting with an empty state (SEED_ON_BOOT=never)');
  } else {
    const scenario = opts.scenario ?? 'default';
    state = buildSeedState({ now: clock.now(), tz: config.householdTz, scenario });
    log.info('seeded the demo household', {
      tz: config.householdTz,
      scenario,
      clockOffsetMin: config.demoClockOffsetMin,
    });
  }

  const store = new Store(state, { clock, log, ...(dataFile ? { dataFile } : {}) });
  return store;
}
