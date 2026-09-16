import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Express, type Response } from 'express';
import type { Logger } from '../log.js';

const noCache = (res: Response) => res.setHeader('Cache-Control', 'no-cache');

/** Serves the built web app (dist/web) with an SPA fallback. Returns false when it has not been built. */
export function mountStatic(app: Express, dir: string, log: Logger): boolean {
  const index = join(dir, 'index.html');
  if (!existsSync(index)) {
    log.info('web app not built; static routes disabled', { dir });
    return false;
  }
  // Hashed assets may be cached for a long time; HTML must always be revalidated or a deploy ships stale asset links.
  app.use(
    express.static(dir, {
      index: false,
      maxAge: '30d',
      immutable: true,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) noCache(res);
      },
    })
  );
  // Express 5 has no '*' routes: a plain middleware handles history-API fallback for page navigations.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/mcp') || !req.accepts('html')) {
      next();
      return;
    }
    noCache(res);
    res.sendFile(index);
  });
  return true;
}
