#!/usr/bin/env node
// Replays the persona evaluation suite (docs/evals/personas.json — the JSON mirror of test/agent/personas.ts) against
// a RUNNING CareCompanion server, rule brain or Bedrock, and writes a Markdown transcript with PASS/FAIL per
// expectation and the brain that answered every turn. The rule brain is deterministic; Bedrock runs are recorded for
// the judges. See docs/evals/README.md.
//
// Usage: node scripts/persona-eval.mjs <base-url> [--token <demo reset token>] [--out docs/evals/latest.md]
//   --token  The server's DEMO_RESET_TOKEN. Each persona then starts from its scenario at its local time through
//            POST /api/demo/reset. Without it the script warns and runs against whatever state the server is in.
//   --out    Report path, relative to the current directory (default docs/evals/latest.md).
// Exits 1 when any expectation failed. The expectation semantics below are a check-for-check port of
// `evaluateTurn` in test/agent/personas.ts — keep the two in step.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = resolve(ROOT, 'docs/evals/personas.json');
const MAX_HISTORY = 20; // POST /api/agent accepts at most 20 prior turns
const RATE_LIMIT_RETRIES = 6;

// --- CLI ---------------------------------------------------------------------------------------------------------

function usage(code, message) {
  if (message) console.error(`persona-eval: ${message}\n`);
  console.error(
    'Usage: node scripts/persona-eval.mjs <base-url> [--token <demo reset token>] [--out docs/evals/latest.md]'
  );
  process.exit(code);
}

function parseArgs(argv) {
  const args = { baseUrl: undefined, token: undefined, out: 'docs/evals/latest.md' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') usage(0);
    else if (arg === '--token') args.token = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg.startsWith('--')) usage(1, `unknown option ${arg}`);
    else if (args.baseUrl === undefined) args.baseUrl = arg;
    else usage(1, `unexpected argument ${arg}`);
  }
  if (!args.baseUrl) usage(1, 'the server base URL is required, e.g. http://127.0.0.1:3100');
  if (args.token === undefined && argv.includes('--token')) usage(1, '--token needs a value');
  if (!args.out) usage(1, '--out needs a value');
  return { ...args, baseUrl: args.baseUrl.replace(/\/+$/, '') };
}

// --- HTTP --------------------------------------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

/** POST JSON; waits out the agent's per-minute rate limit (429 + Retry-After) instead of failing the turn. */
async function postJson(url, body, headers = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 429 && attempt < RATE_LIMIT_RETRIES) {
      const wait = Math.max(1, Number(res.headers.get('retry-after') ?? json.retryAfterSec ?? 10));
      console.warn(
        `  rate limited by ${url}; waiting ${wait}s (start the server with AGENT_RATE_PER_MIN=0 to avoid this)`
      );
      await sleep(wait * 1000 + 250);
      continue;
    }
    return { status: res.status, json };
  }
}

// --- expectation semantics (mirror of test/agent/personas.ts) ---------------------------------------------------

const GUARD_SIGNATURES = [
  ['ambiguous', /^Do you mean /],
  ['allow_override', /I've recorded the extra/],
  ['allow', /^Got it — /],
  ['refuse', /won't record another dose|I need a reason first|isn't on your active list/],
];

function guardVerdictOf(toolCalls) {
  const call = toolCalls.filter((t) => t.name === 'log_dose').at(-1);
  if (!call) return 'not_called';
  return GUARD_SIGNATURES.find(([, re]) => re.test(call.resultText))?.[0] ?? 'unknown';
}

function severityOf(observed) {
  if (observed.emergencyGuidance) return 'emergency';
  const alert = observed.alerts.find((a) => a.type === 'symptom' || a.type === 'help');
  if (!alert) return 'none';
  return alert.severity === 'info' ? 'watch' : 'urgent';
}

function notifiedNamesOf(observed) {
  return [...new Set(observed.alerts.flatMap((a) => a.notified))];
}

const WARNING_RE = /([A-Z][\w-]*(?: [A-Z][\w-]*)*) — (minor|moderate|major):/g;

function warningsOf(observed) {
  if (observed.warnings) return observed.warnings.map((w) => ({ withName: w.withName, severity: w.severity }));
  const alert = observed.alerts.find((a) => a.type === 'interaction');
  if (!alert) return [];
  return [...alert.detail.matchAll(WARNING_RE)].map((m) => ({ withName: m[1] ?? '', severity: m[2] ?? 'minor' }));
}

const includesText = (haystack, needle) => haystack.toLowerCase().includes(needle.toLowerCase());
const formatWarnings = (warnings) => warnings.map((w) => `${w.withName} (${w.severity})`).join(', ');

function evaluateTurn(expectation, observed) {
  const results = [];
  const wanted = Array.isArray(expectation.tool) ? expectation.tool : [expectation.tool];
  const called = observed.toolCalls.map((t) => `${t.name}${t.isError ? ' (error)' : ''}`);
  results.push({
    check: wanted.length === 1 ? `tool = ${wanted[0]}` : `tool in [${wanted.join(', ')}]`,
    pass: observed.toolCalls.some((t) => wanted.includes(t.name) && !t.isError),
    detail: `called: ${called.join(', ') || 'none'}`,
  });

  if (expectation.guard !== undefined) {
    const verdict = guardVerdictOf(observed.toolCalls);
    const said = observed.toolCalls.filter((t) => t.name === 'log_dose').at(-1)?.resultText;
    results.push({
      check: `guard = ${expectation.guard}`,
      pass: verdict === expectation.guard,
      detail: said === undefined ? 'log_dose was not called' : `log_dose said: ${verdict} — "${said}"`,
    });
  }

  if (expectation.severity !== undefined) {
    const severity = severityOf(observed);
    results.push({
      check: `severity = ${expectation.severity}`,
      pass: severity === expectation.severity,
      detail: `observed: ${severity}`,
    });
    if (expectation.severity === 'emergency') {
      const guidance = observed.emergencyGuidance ?? '';
      results.push({
        check: 'emergency guidance opens the reply, verbatim',
        pass: guidance !== '' && observed.reply.trimStart().startsWith(guidance),
        detail: guidance === '' ? 'no emergencyGuidance in the response' : `guidance: "${guidance}"`,
      });
    }
  }

  if (expectation.notifiedCount !== undefined) {
    const names = notifiedNamesOf(observed);
    results.push({
      check: `notified = ${expectation.notifiedCount}`,
      pass: names.length === expectation.notifiedCount,
      detail: names.length > 0 ? `notified: ${names.join(', ')}` : 'nobody notified',
    });
  }

  if (expectation.alertCreated !== undefined) {
    const created = observed.alertIds.length > 0;
    const kinds = observed.alerts.map((a) => `${a.type}/${a.severity}`);
    results.push({
      check: `alert created = ${expectation.alertCreated}`,
      pass: created === expectation.alertCreated,
      detail: created ? `alerts: ${kinds.join(', ') || observed.alertIds.join(', ')}` : 'no alert',
    });
  }

  for (const needle of expectation.replyIncludes ?? []) {
    const found = includesText(observed.reply, needle);
    results.push({ check: `reply includes "${needle}"`, pass: found, detail: found ? 'found' : 'missing' });
  }
  for (const needle of expectation.replyExcludes ?? []) {
    const found = includesText(observed.reply, needle);
    results.push({ check: `reply excludes "${needle}"`, pass: !found, detail: found ? 'present' : 'absent' });
  }

  if (expectation.warnings !== undefined) {
    const warnings = warningsOf(observed);
    results.push({
      check: `warnings = ${formatWarnings(expectation.warnings)}`,
      pass: JSON.stringify(warnings) === JSON.stringify(expectation.warnings),
      detail: `observed: ${formatWarnings(warnings) || 'none'}`,
    });
  }

  return results;
}

// --- running -----------------------------------------------------------------------------------------------------

async function resetScenario(baseUrl, token, persona) {
  const { status, json } = await postJson(
    `${baseUrl}/api/demo/reset`,
    { scenario: persona.scenario, targetLocalTime: persona.localTime },
    { 'x-demo-token': token }
  );
  if (status !== 200) return { ok: false, note: `reset failed — HTTP ${status} ${JSON.stringify(json)}` };
  return { ok: true, note: `reset to "${json.scenario}" at ${json.localTime} on ${json.today} (${json.timezone})` };
}

/** Plays one turn and reads the alerts it created back through GET /api/dashboard. */
async function runTurn(baseUrl, turn, history) {
  let observed;
  if (turn.rest) {
    const { status, json } = await postJson(`${baseUrl}${turn.rest.path}`, turn.rest.body);
    const spoken = typeof json.spoken === 'string' ? json.spoken : JSON.stringify(json);
    observed = {
      brain: 'rest',
      status,
      reply: spoken,
      toolCalls: [{ name: turn.rest.tool, args: turn.rest.body, resultText: spoken, isError: status >= 400, ms: 0 }],
      alertIds: typeof json.alertId === 'string' ? [json.alertId] : [],
      ...(Array.isArray(json.warnings) ? { warnings: json.warnings } : {}),
    };
  } else {
    const { status, json } = await postJson(`${baseUrl}/api/agent`, {
      utterance: turn.utterance,
      speaker: turn.speaker,
      history: history.slice(-MAX_HISTORY),
    });
    if (status !== 200) {
      observed = {
        brain: 'error',
        status,
        reply: `HTTP ${status}: ${JSON.stringify(json)}`,
        toolCalls: [],
        alertIds: [],
        alerts: [],
      };
      return observed;
    }
    history.push({ role: 'user', text: turn.utterance }, { role: 'assistant', text: json.reply });
    observed = {
      brain: json.brain,
      status,
      reply: json.reply,
      toolCalls: json.toolCalls ?? [],
      alertIds: json.alertIds ?? [],
      usage: json.usage,
      ...(json.emergencyGuidance ? { emergencyGuidance: json.emergencyGuidance } : {}),
    };
  }
  const dashboard = (await getJson(`${baseUrl}/api/dashboard`)).json;
  const known = [...(dashboard.openAlerts ?? []), ...(dashboard.recentlyResolved ?? [])];
  observed.alerts = known.filter((a) => observed.alertIds.includes(a.id));
  return observed;
}

async function runPersona(baseUrl, token, persona) {
  const reset = token ? await resetScenario(baseUrl, token, persona) : { ok: false, note: 'no --token: not reset' };
  const history = [];
  const turns = [];
  for (const turn of persona.turns) {
    const observed = await runTurn(baseUrl, turn, history);
    const results = evaluateTurn(turn.expect, observed);
    turns.push({ turn, observed, results });
  }
  const passed = turns.reduce((n, t) => n + t.results.filter((r) => r.pass).length, 0);
  const total = turns.reduce((n, t) => n + t.results.length, 0);
  const brains = [...new Set(turns.map((t) => t.observed.brain).filter((b) => b !== 'rest'))];
  return { persona, reset, turns, passed, total, brains: brains.length > 0 ? brains : ['rest'] };
}

// --- report ------------------------------------------------------------------------------------------------------

const cell = (text) => String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const quote = (text) => `"${String(text).replace(/\s+/g, ' ').trim()}"`;

function turnMarkdown(index, { turn, observed, results }) {
  const lines = [
    `### Turn ${index + 1} — ${turn.speaker}${turn.rest ? ` (REST ${turn.rest.method} ${turn.rest.path})` : ''}`,
    '',
  ];
  lines.push(`> ${turn.utterance}`, '');
  lines.push(`- Brain: **${observed.brain}**`);
  if (observed.toolCalls.length === 0) lines.push('- Tools: none');
  else {
    lines.push('- Tools:');
    for (const t of observed.toolCalls) {
      const flag = t.isError ? ' **error**' : '';
      lines.push(`  - \`${t.name}\` \`${JSON.stringify(t.args)}\` (${t.ms} ms)${flag} → ${quote(t.resultText)}`);
    }
  }
  lines.push(`- Reply: ${quote(observed.reply)}`);
  if (observed.emergencyGuidance) lines.push(`- Emergency guidance: ${quote(observed.emergencyGuidance)}`);
  if (observed.alertIds.length > 0) {
    const alerts = observed.alerts.map(
      (a) =>
        `\`${a.type}\` (${a.severity}) "${a.title}" → notified ${a.notified.length > 0 ? a.notified.join(', ') : 'nobody'}`
    );
    lines.push(`- Alerts created: ${alerts.join('; ') || observed.alertIds.join(', ')}`);
  } else lines.push('- Alerts created: none');
  if (observed.usage) {
    const u = observed.usage;
    lines.push(`- Usage: ${u.rounds} round(s), ${u.inputTokens} in / ${u.outputTokens} out tokens`);
  }
  lines.push('', '| Check | Result | Detail |', '| ----- | ------ | ------ |');
  for (const r of results) lines.push(`| ${cell(r.check)} | ${r.pass ? 'PASS' : '**FAIL**'} | ${cell(r.detail)} |`);
  lines.push('');
  return lines;
}

function summaryTable(runs) {
  const rows = ['| # | Persona | Scenario | Brain | Passed |', '| - | ------- | -------- | ----- | ------ |'];
  runs.forEach((run, i) => {
    const status = run.passed === run.total ? 'PASS' : 'FAIL';
    rows.push(
      `| ${i + 1} | ${cell(run.persona.name)} (\`${run.persona.id}\`) | ${run.persona.scenario} ${run.persona.localTime} | ${run.brains.join(', ')} | ${run.passed}/${run.total} ${status} |`
    );
  });
  return rows;
}

function reportMarkdown({ baseUrl, token, status, health, runs, startedAt }) {
  const personasPassed = runs.filter((r) => r.passed === r.total).length;
  const passed = runs.reduce((n, r) => n + r.passed, 0);
  const total = runs.reduce((n, r) => n + r.total, 0);
  const brainsUsed = [...new Set(runs.flatMap((r) => r.brains))].join(', ');
  const lines = ['# CareCompanion persona evaluation', ''];
  lines.push(`- Run: ${startedAt.toISOString()}`);
  lines.push(`- Server: ${baseUrl}${health?.version ? ` (version ${health.version})` : ''}`);
  if (status) {
    lines.push(`- Configured brain: **${status.brain}** — model \`${status.model}\`, region ${status.region}`);
    lines.push(
      `- Agent status before the run: ${status.turnsToday}/${status.dailyTurnCap} turns today, Bedrock paused: ${status.bedrockPaused ? 'yes' : 'no'}`
    );
  } else lines.push('- Configured brain: unknown (GET /api/agent/status failed)');
  lines.push(`- Brain(s) that answered: **${brainsUsed}**`);
  lines.push(
    `- Demo reset: ${token ? 'yes — each persona re-seeded via POST /api/demo/reset' : 'NO — run without --token, against the server state as found'}`
  );
  lines.push(`- Result: **${personasPassed}/${runs.length} personas passed, ${passed}/${total} expectations**`, '');
  lines.push('## Summary', '', ...summaryTable(runs), '');
  runs.forEach((run, i) => {
    lines.push(`## ${i + 1}. ${run.persona.name}`, '');
    lines.push(
      `\`${run.persona.id}\` · scenario \`${run.persona.scenario}\` at ${run.persona.localTime} · brain: **${run.brains.join(', ')}** · ${run.reset.note} · ${run.passed}/${run.total} passed`,
      ''
    );
    lines.push(run.persona.description, '');
    run.turns.forEach((t, j) => lines.push(...turnMarkdown(j, t)));
  });
  return `${lines.join('\n')}\n`;
}

// --- main --------------------------------------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const { personas } = JSON.parse(await readFile(MIRROR, 'utf8'));

  const health = (await getJson(`${args.baseUrl}/healthz`).catch(() => ({ json: null }))).json;
  const status = (await getJson(`${args.baseUrl}/api/agent/status`).catch(() => ({ json: null }))).json;
  if (!status?.brain) {
    console.error(`persona-eval: ${args.baseUrl}/api/agent/status did not answer — is the server running?`);
    process.exit(2);
  }
  console.log(`server ${args.baseUrl} · configured brain: ${status.brain} (${status.model}, ${status.region})`);
  if (!args.token) {
    console.warn('warning: no --token given — personas run without a demo reset, against the server state as found');
  }

  const runs = [];
  for (const persona of personas) {
    console.log(`\n${persona.id}: ${persona.name}`);
    const run = await runPersona(args.baseUrl, args.token, persona);
    if (!run.reset.ok && args.token) console.warn(`  ${run.reset.note}`);
    run.turns.forEach(({ turn, observed, results }, i) => {
      const failed = results.filter((r) => !r.pass);
      const tools = observed.toolCalls.map((t) => t.name).join(', ') || 'none';
      console.log(`  turn ${i + 1} [${observed.brain}] ${tools} — ${results.length - failed.length}/${results.length}`);
      console.log(`    > ${turn.utterance}`);
      console.log(`    ${observed.reply.replace(/\s+/g, ' ')}`);
      for (const r of failed) console.log(`    FAIL ${r.check} — ${r.detail}`);
    });
    runs.push(run);
  }

  const out = resolve(process.cwd(), args.out);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, reportMarkdown({ ...args, status, health, runs, startedAt }));

  const passed = runs.reduce((n, r) => n + r.passed, 0);
  const total = runs.reduce((n, r) => n + r.total, 0);
  console.log(`\n${summaryTable(runs).join('\n')}`);
  console.log(
    `\n${passed}/${total} expectations passed · brain(s): ${[...new Set(runs.flatMap((r) => r.brains))].join(', ')}`
  );
  console.log(`wrote ${out}`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error('persona-eval failed:', err);
  process.exit(2);
});
