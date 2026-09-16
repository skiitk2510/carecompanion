import type { NextFunction, Request, Response } from 'express';

/** Sliding one-minute window per client IP. Small and dependency-free; enough to keep the free demo from being farmed. */
export function rateLimit(perMinute: number): (req: Request, res: Response, next: NextFunction) => void {
  const hits = new Map<string, number[]>();
  return (req, res, next) => {
    if (perMinute <= 0) return next();
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= perMinute) {
      const retryAfterSec = Math.max(1, Math.ceil((60_000 - (now - recent[0]!)) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({ error: 'rate_limited', retryAfterSec });
      return;
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (v.every((t) => now - t >= 60_000)) hits.delete(k);
    }
    next();
  };
}
