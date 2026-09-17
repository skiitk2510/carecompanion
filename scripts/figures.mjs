#!/usr/bin/env node
// Captures the README / Devpost figures from a running server and the ext-apps basic-host with the local Chrome.
// Usage: node scripts/figures.mjs   (env: WEB_URL, HOST_URL, DEMO_RESET_TOKEN, CHROME)
/* global document */ // the evaluate()/waitForFunction() callbacks below run inside the browser page
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:3100';
const HOST = process.env.HOST_URL ?? 'http://localhost:8080';
const TOKEN = process.env.DEMO_RESET_TOKEN ?? 'demo';
const OUT = 'docs/figures';

const clickText = (target, text) =>
  target.evaluate((t) => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t);
    if (!button) throw new Error(`button "${t}" not found`);
    button.click();
  }, text);

async function reset(scenario, targetLocalTime) {
  const res = await fetch(`${WEB}/api/demo/reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-demo-token': TOKEN },
    body: JSON.stringify({ scenario, targetLocalTime }),
  });
  if (!res.ok) throw new Error(`demo reset failed: ${res.status}`);
}

await mkdir(OUT, { recursive: true });
await reset('mid-morning', '10:30');

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
});
try {
  // 1. The simulated Alexa+ web app, full dashboard.
  const web = await browser.newPage();
  await web.goto(`${WEB}/`, { waitUntil: 'networkidle0' });
  await web.waitForSelector('.cc-tiles', { timeout: 15_000 });
  await web.screenshot({ path: `${OUT}/web-app.png` });
  console.log('wrote web-app.png');

  // 2. The duplicate-dose guard, through the conversation.
  await web.type('input[placeholder^="Or type"]', 'I took my blood pressure pill, the lisinopril');
  await clickText(web, 'Send');
  await web.waitForFunction(() => document.body.innerText.includes('You already took Lisinopril'), { timeout: 15_000 });
  await new Promise((r) => setTimeout(r, 500));
  await web.screenshot({ path: `${OUT}/web-app-guard.png` });
  console.log('wrote web-app-guard.png');

  // 3. The Alexa+ inline-mode preview of the dashboard.
  await clickText(web, 'Alexa+ inline preview');
  await web.waitForSelector('.cc-dashboard--inline', { timeout: 5_000 });
  await new Promise((r) => setTimeout(r, 300));
  await web.screenshot({ path: `${OUT}/web-app-inline.png` });
  console.log('wrote web-app-inline.png');

  // 4. The dashboard as an MCP App inside the ext-apps basic-host (inline, then fullscreen).
  const host = await browser.newPage();
  // basic-host keeps the MCP SSE stream open, so "network idle" never happens; wait for the tool picker instead.
  await host.goto(HOST, { waitUntil: 'domcontentloaded' });
  await host.waitForFunction(
    () => [...document.querySelectorAll('select option')].some((o) => o.value === 'caregiver_summary'),
    { timeout: 20_000 }
  );
  await host.evaluate(() => {
    const select = [...document.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => o.value === 'caregiver_summary')
    );
    if (!select) throw new Error('tool select not found');
    select.value = 'caregiver_summary';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('form')?.requestSubmit();
  });
  // The sandbox proxy nests the app HTML in a second iframe, so look for the dashboard in any frame.
  const frameWith = async (selector, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const f of host.frames()) {
        try {
          if (await f.$(selector)) return f;
        } catch {
          // frame navigated away; try the next one
        }
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error(`no frame with ${selector} within ${timeoutMs} ms`);
  };
  const frame = await frameWith('.cc-tiles', 25_000);
  await new Promise((r) => setTimeout(r, 800));
  await host.screenshot({ path: `${OUT}/mcp-app-inline.png` });
  console.log('wrote mcp-app-inline.png');

  await clickText(frame, 'Full dashboard');
  await frameWith('.cc-columns', 10_000);
  await new Promise((r) => setTimeout(r, 800));
  await host.screenshot({ path: `${OUT}/mcp-app-fullscreen.png` });
  console.log('wrote mcp-app-fullscreen.png');
} finally {
  await browser.close();
}
