import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { DashboardData } from '../../src/shared/dashboard.js';
import { startTestServer, type TestServer } from '../helpers/testServer.js';

type ToolResult = Awaited<ReturnType<Client['callTool']>>;

const text = (res: ToolResult): string => (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
const data = <T>(res: ToolResult): T => res.structuredContent as T;
const resourceText = (contents: Array<{ uri: string; text?: string; blob?: string }>): string =>
  contents[0]?.text ?? '';

interface LogDoseOut {
  recorded: boolean;
  verdict: string;
  status: string | null;
  requiresConfirmation: boolean;
  reason: string | null;
  alertId: string | null;
  candidates?: string[];
}

describe('MCP tool surface (8 tools · 1 resource · 1 prompt) over the SDK client', () => {
  let srv: TestServer;
  let client: Client;
  let transport: StreamableHTTPClientTransport;

  beforeAll(async () => {
    srv = await startTestServer(); // 10:30 a.m. in Los Angeles, "mid-morning" scenario: the 8 a.m. doses are taken
    transport = new StreamableHTTPClientTransport(new URL(`${srv.baseUrl}/mcp`));
    client = new Client({ name: 'tools-test', version: '0.0.0' });
    await client.connect(transport);
  });

  afterAll(async () => {
    await transport.terminateSession().catch(() => undefined);
    await client.close();
    await srv.close();
  });

  it('caregiver_summary is the MCP App tool: ui:// resource, text fallback and the DashboardData payload', async () => {
    const { tools } = await client.listTools();
    const summary = tools.find((t) => t.name === 'caregiver_summary');
    expect((summary?._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri).toBe(
      'ui://carecompanion/dashboard.html'
    );

    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain('ui://carecompanion/dashboard.html');
    const view = await client.readResource({ uri: 'ui://carecompanion/dashboard.html' });
    expect(view.contents[0]?.mimeType).toBe('text/html;profile=mcp-app');
    expect(resourceText(view.contents)).toMatch(/^<!doctype html>/i);

    const res = await client.callTool({ name: 'caregiver_summary', arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toMatch(/Margaret's 7-day adherence is \d+ percent/);
    const dashboard = data<DashboardData>(res);
    expect(dashboard.todaysDoses).toHaveLength(6);
    expect(dashboard.todaysDoses.filter((d) => d.status === 'taken')).toHaveLength(3);
    expect(dashboard.nextUp?.name).toBe('Metformin');
    expect(dashboard.openAlerts.map((a) => a.type)).toContain('symptom'); // yesterday's dizziness, acknowledged, still open
    expect(dashboard.recentlyResolved.length).toBeGreaterThan(0);
    expect(dashboard.upcomingAppointments[0]?.when).toBe('tomorrow at 2 p.m.');
    expect(dashboard.checkedInToday).toBe(false);
  });

  it('get_todays_plan speaks the day and points at the next dose', async () => {
    const res = await client.callTool({ name: 'get_todays_plan', arguments: {} });
    expect(text(res)).toContain('Good morning, Margaret.');
    expect(text(res)).toContain('Next up is Metformin at 6 p.m.');
    expect(text(res)).toContain('Physical therapy is tomorrow at 2 p.m.');
    expect(text(res)).not.toContain('..');
    expect(text(res)).toContain('How are you feeling today?');
  });

  it('log_dose: the duplicate guard refuses, asks for confirmation, and an override is recorded with a caregiver alert', async () => {
    const dup = await client.callTool({ name: 'log_dose', arguments: { medication: 'lisinopril' } });
    const d1 = data<LogDoseOut>(dup);
    expect(d1).toMatchObject({ recorded: false, verdict: 'refuse', requiresConfirmation: true, reason: 'max_daily' });
    expect(text(dup)).toContain('You already took Lisinopril at 8:05 a.m. today.');
    expect(text(dup)).toContain('say "yes, record it anyway"');

    const noReason = await client.callTool({
      name: 'log_dose',
      arguments: { medication: 'lisinopril', confirmOverride: true },
    });
    expect(data<LogDoseOut>(noReason).recorded).toBe(false);

    const override = await client.callTool({
      name: 'log_dose',
      arguments: {
        medication: 'lisinopril',
        confirmOverride: true,
        overrideReason: 'Dr. Chen told me to take a second one today',
      },
    });
    const d2 = data<LogDoseOut>(override);
    expect(d2).toMatchObject({ recorded: true, verdict: 'allow_override', status: 'taken' });
    expect(d2.alertId).toBeTruthy();
    expect(srv.store.get().alerts.find((a) => a.id === d2.alertId)?.type).toBe('dose_override');

    const ambiguous = await client.callTool({ name: 'log_dose', arguments: { medication: 'my blood pressure pill' } });
    expect(data<LogDoseOut>(ambiguous).verdict).toBe('ambiguous');
    expect(text(ambiguous)).toBe('Do you mean Lisinopril or Amlodipine?');

    const early = await client.callTool({ name: 'log_dose', arguments: { medication: 'Coumadin' } });
    expect(data<LogDoseOut>(early)).toMatchObject({ recorded: true, verdict: 'allow', status: 'taken' });
    expect(text(early)).toContain('Warfarin');
  });

  it('skip_dose marks the next open slot and alerts for critical medications only', async () => {
    const res = await client.callTool({
      name: 'skip_dose',
      arguments: { medication: 'simvastatin', reason: 'out of tablets' },
    });
    const out = data<{ recorded: boolean; verdict: string; scheduledTime: string | null; alertId: string | null }>(res);
    expect(out).toMatchObject({ recorded: true, verdict: 'skipped', scheduledTime: '21:00' });
    expect(text(res)).toContain("I've marked your 9 p.m. Simvastatin as skipped");
    expect(srv.store.get().alerts.find((a) => a.id === out.alertId)?.notified).toEqual([]); // not critical → dashboard only

    const nothing = await client.callTool({ name: 'skip_dose', arguments: { medication: 'simvastatin' } });
    expect(data<{ verdict: string }>(nothing).verdict).toBe('nothing_due');
  });

  it('daily_checkin escalates by band and call_for_help alerts every caregiver', async () => {
    const watch = await client.callTool({
      name: 'daily_checkin',
      arguments: { mood: 'okay', symptoms: ['a little tired'] },
    });
    expect(data<{ severity: string; notified: string[] }>(watch)).toMatchObject({ severity: 'watch', notified: [] });

    const emergency = await client.callTool({
      name: 'daily_checkin',
      arguments: { mood: 'bad', symptoms: ["I can't breathe properly"] },
    });
    const e = data<{ severity: string; notified: string[]; emergencyGuidance?: string; alertIds: string[] }>(emergency);
    expect(e.severity).toBe('emergency');
    expect(e.emergencyGuidance).toMatch(/^This could be an emergency\. Please call 911 right now\./);
    expect(e.notified).toEqual(['Priya Hart-Singh', 'Daniel Hart']);
    expect(text(emergency)).toBe(e.emergencyGuidance);

    const help = await client.callTool({ name: 'call_for_help', arguments: { message: 'I fell in the kitchen' } });
    const h = data<{ alertId: string; notified: string[]; emergencyGuidance: string }>(help);
    expect(h.notified).toHaveLength(2);
    expect(h.emergencyGuidance).toContain('911');
    expect(srv.store.get().alerts.find((a) => a.id === h.alertId)?.severity).toBe('critical');
  });

  it('add_medication always adds, returns ordered interaction warnings, and resolve_alert is idempotent', async () => {
    const add = await client.callTool({
      name: 'add_medication',
      arguments: { name: 'ibuprofen', dose: '200 mg', scheduleTimes: ['20:00', '08:00'], purpose: 'knee pain' },
    });
    const a = data<{
      medication: { name: string; scheduleTimes: string[] };
      warnings: Array<{ withName: string; severity: string; kind: string }>;
      alertId: string | null;
    }>(add);
    expect(a.medication).toMatchObject({ name: 'Ibuprofen', scheduleTimes: ['08:00', '20:00'] });
    expect(a.warnings.map((w) => `${w.withName}:${w.severity}`)).toEqual(['Warfarin:major', 'Lisinopril:moderate']);
    expect(text(add)).toContain('Added Ibuprofen 200 mg at 8 a.m. and 8 p.m.');
    expect(text(add)).toContain('informational only');
    expect(a.alertId).toBeTruthy();

    const ack = await client.callTool({
      name: 'resolve_alert',
      arguments: { alertId: a.alertId, caregiverId: 'cg_priya', action: 'acknowledge' },
    });
    expect(data<{ changed: boolean }>(ack).changed).toBe(true);
    const again = await client.callTool({
      name: 'resolve_alert',
      arguments: { alertId: a.alertId, caregiverId: 'cg_priya', action: 'acknowledge' },
    });
    expect(data<{ changed: boolean }>(again).changed).toBe(false);
    const resolved = await client.callTool({
      name: 'resolve_alert',
      arguments: {
        alertId: a.alertId,
        caregiverId: 'cg_priya',
        action: 'resolve',
        resolution: 'Pharmacist said fine short-term',
      },
    });
    expect(data<{ changed: boolean; alert: { resolvedBy: string | null } }>(resolved)).toMatchObject({
      changed: true,
      alert: { resolvedBy: 'Priya Hart-Singh' },
    });

    const missing = await client.callTool({
      name: 'resolve_alert',
      arguments: { alertId: 'alert_nope', caregiverId: 'cg_priya', action: 'resolve' },
    });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toContain('not found');
  });

  it('rejects invalid arguments without invoking the handler', async () => {
    const before = srv.store.get().doses.length;
    const bad = await client
      .callTool({ name: 'log_dose', arguments: { medication: 123 } })
      .catch((err: unknown) => ({ isError: true, content: [{ type: 'text', text: String(err) }] }) as ToolResult);
    expect(bad.isError).toBe(true);
    expect(srv.store.get().doses.length).toBe(before);
  });

  it('serves the adherence resource template and the morning_briefing prompt', async () => {
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate)).toContain('carecompanion://elder/{elderId}/adherence');
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain('carecompanion://elder/elder_margaret/adherence');

    const read = await client.readResource({ uri: 'carecompanion://elder/elder_margaret/adherence' });
    const report = JSON.parse(resourceText(read.contents)) as {
      windows: Record<'7' | '30', { due: number; rate: number | null }>;
    };
    expect(report.windows['7'].due).toBeGreaterThan(0);
    expect(report.windows['30'].due).toBeGreaterThanOrEqual(report.windows['7'].due);

    const prompt = await client.getPrompt({ name: 'morning_briefing', arguments: {} });
    const content = prompt.messages[0]?.content as { type: string; text: string };
    expect(content.type).toBe('text');
    expect(content.text).toContain('get_todays_plan');
  });

  it('answers the read tools in well under the Alexa+ budget', async () => {
    for (const name of ['get_todays_plan', 'caregiver_summary']) {
      const started = performance.now();
      await client.callTool({ name, arguments: {} });
      expect(performance.now() - started).toBeLessThan(100); // full loopback round trip; the handler itself is a few ms
    }
  });
});
