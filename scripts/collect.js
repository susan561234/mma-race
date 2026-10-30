import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Collector, INTERVAL } from '../store.js';
import { Archive, writeJson } from './archive.js';
import { seedCategories } from '../seed.js';

export async function collect(directory, options = {}) {
  const archive = new Archive(directory);
  const collector = new Collector(archive, options);
  const success = await collector.collect();
  const latest = archive.latest();
  writeJson(resolve(directory, 'dashboard.json'), {
    categories: latest?.categories ?? seedCategories,
    source: latest ? 'live' : 'provided',
    capturedAt: latest?.capturedAt ?? null,
    intervalMs: INTERVAL, lastAttemptAt: collector.lastAttemptAt,
    nextAttemptAt: null, collecting: false, scheduling: 'github-actions',
    error: collector.lastError
  });
  return success;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const success = await collect(resolve(process.env.STATE_DIR ?? 'vote-state'));
  if (!success) {
    console.error('Collection failed; publishing the explicit error and retaining prior observations.');
    process.exitCode = 1;
  }
}
