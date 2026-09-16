import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The package root, found by walking up to package.json — works from src/ (tsx) and dist/server/ (node) alike. */
export const packageRoot = findRoot(dirname(fileURLToPath(import.meta.url)));

function findRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}
