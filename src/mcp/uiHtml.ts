import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { packageRoot } from '../paths.js';

const VIEW_FILE = join(packageRoot, 'dist', 'ui', 'mcp-app.html');

const PLACEHOLDER = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>CareCompanion dashboard</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:24px;color:#1f2937}h1{font-size:18px;margin:0 0 8px}p{margin:0;color:#4b5563}code{background:#f3f4f6;padding:1px 4px;border-radius:3px}</style>
</head><body><h1>CareCompanion dashboard</h1>
<p>The dashboard view has not been built in this deployment (<code>npm run build:ui</code>). The caregiver summary is still available as spoken text in the tool result.</p>
</body></html>`;

let cache: { mtimeMs: number; html: string } | undefined;

/** The single-file MCP App view, re-read when the built file changes; a text-only placeholder until it exists. */
export function uiHtml(): string {
  try {
    const { mtimeMs } = statSync(VIEW_FILE);
    if (!cache || cache.mtimeMs !== mtimeMs) cache = { mtimeMs, html: readFileSync(VIEW_FILE, 'utf8') };
    return cache.html;
  } catch {
    return PLACEHOLDER;
  }
}
