import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from '../helpers/testServer.js';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = join(REPO_ROOT, 'scripts', 'verify-live.mjs');
const MUST_RULE_COUNT = 12;

interface RuleResult {
  id: number;
  level: 'MUST' | 'SHOULD';
  title: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  detail: string;
  ms: number;
}

interface Verdict {
  target: string;
  checkedAt: string;
  protocolVersions: Record<string, string | null>;
  summary: {
    must: { pass: number; fail: number; skip: number };
    should: { pass: number; fail: number; skip: number };
    verdict: 'PASS' | 'FAIL';
  };
  rules: RuleResult[];
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
  verdict: Verdict;
}

/** Spawns the checker exactly as an operator would (cwd = repo root) and parses the verdict it wrote. */
function runChecker(baseUrl: string, out: string, extraArgs: string[] = []): Promise<Run> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [SCRIPT, baseUrl, '--out', out, ...extraArgs],
      { cwd: REPO_ROOT, timeout: 60_000 },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
        try {
          resolve({ code, stdout, stderr, verdict: JSON.parse(readFileSync(out, 'utf8')) as Verdict });
        } catch (parseErr) {
          reject(new Error(`no verdict at ${out} (exit ${code}): ${String(parseErr)}\n${stdout}\n${stderr}`));
        }
      }
    );
  });
}

const byId = (verdict: Verdict, id: number): RuleResult => {
  const rule = verdict.rules.find((r) => r.id === id);
  if (!rule) throw new Error(`rule ${id} missing from the verdict`);
  return rule;
};

async function clientCredentialsToken(baseUrl: string, clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { access_token: string }).access_token;
}

describe('scripts/verify-live.mjs against the open server', () => {
  let srv: TestServer;
  let dir: string;

  beforeAll(async () => {
    srv = await startTestServer();
    dir = mkdtempSync(join(tmpdir(), 'verify-live-'));
  });

  afterAll(async () => {
    await srv.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('exits 0 with a PASS verdict, every MUST rule green and the round trip inside the Alexa+ budget', async () => {
    const out = join(dir, 'open.json');
    const run = await runChecker(srv.baseUrl, out);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);

    const { verdict } = run;
    expect(verdict.summary.verdict).toBe('PASS');
    expect(verdict.target).toBe(`${srv.baseUrl}/mcp`);
    expect(verdict.summary.must).toEqual({ pass: MUST_RULE_COUNT, fail: 0, skip: 0 });

    const must = verdict.rules.filter((r) => r.level === 'MUST');
    expect(must).toHaveLength(MUST_RULE_COUNT);
    expect(must.map((r) => `${r.id}:${r.status}`)).toEqual(must.map((r) => `${r.id}:PASS`));

    expect(byId(verdict, 7).ms).toBeLessThan(500);
    expect(byId(verdict, 7).detail).toMatch(/get_todays_plan: median \d+(\.\d+)? ms/);
    expect(byId(verdict, 4).detail).toContain('all 8 CareCompanion tools present');
    expect(byId(verdict, 5).detail).toMatch(/^caregiver_summary\b.* → ui:\/\/carecompanion\/dashboard\.html/);
    expect(byId(verdict, 19).status).toBe('SKIP'); // open server, no --token
    expect(verdict.summary.should.fail).toBe(0);
    expect(verdict.protocolVersions).toEqual({ '2025-11-25': '2025-11-25', '2025-03-26': '2025-03-26' });

    expect(run.stdout).toMatch(/^VERDICT: PASS \(must 12\/12, should \d+\/\d+\) → /m);
    // The probe closes every session it opens (rules 9, 13, 19, 20).
    expect(srv.app.mcp.sessions.size).toBe(0);
  }, 30_000);
});

describe('scripts/verify-live.mjs with Tier-1 client-credentials auth switched on', () => {
  const CLIENT_ID = 'x';
  const CLIENT_SECRET = 'y'.repeat(4);
  let srv: TestServer;
  let dir: string;

  beforeAll(async () => {
    srv = await startTestServer({
      env: {
        MCP_AUTH: 'client_credentials',
        MCP_CLIENT_ID: CLIENT_ID,
        MCP_CLIENT_SECRET: CLIENT_SECRET,
        PUBLIC_URL: 'http://carecompanion.test',
      },
    });
    dir = mkdtempSync(join(tmpdir(), 'verify-live-auth-'));
  });

  afterAll(async () => {
    await srv.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rule 19 passes with a token from POST /oauth/token and the bearer lifecycle passes', async () => {
    const token = await clientCredentialsToken(srv.baseUrl, CLIENT_ID, CLIENT_SECRET);
    const out = join(dir, 'auth.json');
    const run = await runChecker(srv.baseUrl, out, ['--token', token]);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);

    const { verdict } = run;
    const rule19 = byId(verdict, 19);
    expect(rule19.status).toBe('PASS');
    expect(rule19.detail).toContain('401 JSON without WWW-Authenticate');
    expect(rule19.detail).toContain('PRM resource http://carecompanion.test/mcp');
    expect(rule19.detail).toContain('bearer lifecycle (rules 1–12) passed');
    expect(verdict.summary.verdict).toBe('PASS');
    expect(verdict.summary.must).toEqual({ pass: MUST_RULE_COUNT, fail: 0, skip: 0 });
  }, 30_000);

  it('without a token the lifecycle is blocked at initialize and the exit code is 1', async () => {
    const out = join(dir, 'anonymous.json');
    const run = await runChecker(srv.baseUrl, out);
    expect(run.code).toBe(1);

    const { verdict } = run;
    expect(verdict.summary.verdict).toBe('FAIL');
    expect(byId(verdict, 1).status).toBe('FAIL');
    expect(byId(verdict, 1).detail).toContain('re-run with --token');
    expect(byId(verdict, 19).status).toBe('PASS'); // the 401 shape and the PRM document are still verifiable
    expect(run.stdout).toMatch(/^VERDICT: FAIL /m);
  }, 30_000);
});
