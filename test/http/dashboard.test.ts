import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DemoStatus } from '../../src/domain/actions.js';
import type { DashboardData } from '../../src/shared/dashboard.js';
import { postJson, startTestServer, type TestServer } from '../helpers/testServer.js';

describe('REST routes for the web app (dashboard + demo controls)', () => {
  let srv: TestServer;

  beforeAll(async () => {
    srv = await startTestServer();
  });

  afterAll(async () => {
    await srv.close();
  });

  it('GET /api/dashboard returns the DashboardData payload (7 or 30 days)', async () => {
    const seven = (await (await fetch(`${srv.baseUrl}/api/dashboard`)).json()) as DashboardData & { spoken: string };
    expect(seven.adherence.days).toBe(7);
    expect(seven.todaysDoses).toHaveLength(6);
    expect(seven.openAlerts.length).toBeGreaterThan(0);
    expect(seven.spoken).toMatch(/adherence is \d+ percent/);

    const thirty = (await (await fetch(`${srv.baseUrl}/api/dashboard?days=30`)).json()) as DashboardData;
    expect(thirty.adherence.days).toBe(30);
    expect(thirty.adherence.due).toBeGreaterThan(seven.adherence.due);
  });

  it('POST /api/dashboard/alerts/:id acknowledges and resolves; unknown ids are 404', async () => {
    const data = (await (await fetch(`${srv.baseUrl}/api/dashboard`)).json()) as DashboardData;
    const alert = data.openAlerts[0]!;
    const ack = await postJson<{ changed: boolean; alert: { acknowledgedBy: string | null } }>(
      `${srv.baseUrl}/api/dashboard/alerts/${alert.id}`,
      { caregiverId: 'cg_daniel', action: 'acknowledge' }
    );
    expect(ack.status).toBe(200);
    const resolved = await postJson<{ changed: boolean; alert: { resolvedBy: string | null } }>(
      `${srv.baseUrl}/api/dashboard/alerts/${alert.id}`,
      { caregiverId: 'cg_daniel', action: 'resolve', resolution: 'Spoke to Mom, all good.' }
    );
    expect(resolved.json).toMatchObject({ changed: true, alert: { resolvedBy: 'Daniel Whitfield' } });

    const missing = await postJson<{ error: string }>(`${srv.baseUrl}/api/dashboard/alerts/alert_nope`, {
      caregiverId: 'cg_daniel',
      action: 'resolve',
    });
    expect(missing.status).toBe(404);
    expect(missing.json.error).toBe('alert_not_found');

    const bad = await postJson<{ error: string }>(`${srv.baseUrl}/api/dashboard/alerts/${alert.id}`, {
      action: 'nope',
    });
    expect(bad.status).toBe(400);
  });

  it('POST /api/dashboard/doses records a caregiver-sourced dose through the same guard', async () => {
    const ok = await postJson<{ recorded: boolean; verdict: string }>(`${srv.baseUrl}/api/dashboard/doses`, {
      medication: 'warfarin',
    });
    expect(ok.json).toMatchObject({ recorded: true, verdict: 'allow' });
    const event = srv.store.get().doses.find((d) => d.medicationId === 'med_warfarin' && d.localDate === '2026-09-16');
    expect(event?.source).toBe('caregiver');

    const dup = await postJson<{ recorded: boolean; requiresConfirmation: boolean }>(
      `${srv.baseUrl}/api/dashboard/doses`,
      {
        medication: 'warfarin',
      }
    );
    expect(dup.json).toMatchObject({ recorded: false, requiresConfirmation: true });
  });

  it('POST /api/dashboard/medications adds and returns interaction warnings', async () => {
    const res = await postJson<{ medication: { name: string }; warnings: Array<{ withName: string }> }>(
      `${srv.baseUrl}/api/dashboard/medications`,
      { name: 'ibuprofen', dose: '200 mg', scheduleTimes: ['08:00', '20:00'], purpose: 'knee pain' }
    );
    expect(res.status).toBe(200);
    expect(res.json.medication.name).toBe('Ibuprofen');
    expect(res.json.warnings.map((w) => w.withName)).toEqual(['Warfarin', 'Lisinopril']);
  });

  it('demo reset needs the token, re-seeds a scenario and can shift the clock', async () => {
    const denied = await postJson<{ error: string }>(`${srv.baseUrl}/api/demo/reset`, { scenario: 'evening' });
    expect(denied.status).toBe(401);

    const res = await fetch(`${srv.baseUrl}/api/demo/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-demo-token': 'test-token' },
      body: JSON.stringify({ scenario: 'evening', clockOffsetMin: 540 }), // 10:30 + 9 h = 19:30 local
    });
    expect(res.status).toBe(200);
    const status = (await res.json()) as DemoStatus;
    expect(status).toMatchObject({ scenario: 'evening', clockOffsetMin: 540, localTime: '19:30', today: '2026-09-16' });

    const data = (await (await fetch(`${srv.baseUrl}/api/dashboard`)).json()) as DashboardData;
    expect(data.localTime).toBe('19:30');
    expect(data.todaysDoses.filter((d) => d.status === 'taken')).toHaveLength(5);
    expect(data.nextUp?.name).toBe('Simvastatin');
    expect(srv.store.get().medications.map((m) => m.name)).not.toContain('Ibuprofen'); // re-seeded

    const bad = await fetch(`${srv.baseUrl}/api/demo/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-demo-token': 'test-token' },
      body: JSON.stringify({ scenario: 'midnight-snack' }),
    });
    expect(bad.status).toBe(400);

    const demo = (await (await fetch(`${srv.baseUrl}/api/demo/status`)).json()) as DemoStatus;
    expect(demo.clockOffsetMin).toBe(540);

    // A target wall-clock time computes the offset from the real clock (10:30 base → 08:15 = -135 min).
    const target = await fetch(`${srv.baseUrl}/api/demo/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-demo-token': 'test-token' },
      body: JSON.stringify({ scenario: 'default', targetLocalTime: '08:15' }),
    });
    expect((await target.json()) as DemoStatus).toMatchObject({
      localTime: '08:15',
      clockOffsetMin: -135,
      scenario: 'default',
    });
  });
});
