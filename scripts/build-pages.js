import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from './archive.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function buildPages(directory, output, now = Date.now()) {
  const dashboard = readJson(resolve(directory, 'dashboard.json'), null);
  if (!dashboard) throw new Error('Missing dashboard.json: run collection before building.');
  mkdirSync(resolve(output, 'data/history'), { recursive: true });
  cpSync(resolve(root, 'public'), output, { recursive: true });
  mkdirSync(resolve(output, 'vendor'), { recursive: true });
  for (const name of ['three.module.js', 'three.core.js']) {
    cpSync(resolve(root, 'node_modules/three/build', name), resolve(output, 'vendor', name));
  }
  cpSync(resolve(root, 'node_modules/three/LICENSE'), resolve(output, 'vendor/THREE-LICENSE.txt'));
  const html = readFileSync(resolve(output, 'index.html'), 'utf8')
    .replace('name="data-mode" content="server"', 'name="data-mode" content="pages"')
    .replace('↻ 每 5 分鐘收集一次', '↻ Actions 約每 5 分鐘排程 · 可能延遲')
    .replace('下次資料收集', 'GitHub Actions 收集');
  writeFileSync(resolve(output, 'index.html'), html);
  writeFileSync(resolve(output, '.nojekyll'), '');
  writeJson(resolve(output, 'data/dashboard.json'), dashboard);
  const since = now - 7 * 86400000;
  const histories = new Map(dashboard.categories.map(category => [category.categoryId, []]));
  for (const file of readdirSync(resolve(directory, 'daily')).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file) || file.slice(0, 10) < new Date(since).toISOString().slice(0, 10)) continue;
    for (const line of readFileSync(resolve(directory, 'daily', file), 'utf8').trim().split('\n').filter(Boolean)) {
      const sample = JSON.parse(line);
      if (sample.capturedAt < since) continue;
      for (const [category, id, count, percent] of sample.votes) {
        histories.get(category)?.push([sample.capturedAt, id, count, percent]);
      }
    }
  }
  for (const [category, points] of histories) {
    writeJson(resolve(output, 'data/history', `${category}.json`), points.sort((a, b) => a[0] - b[0]));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildPages(resolve(process.env.STATE_DIR ?? 'vote-state'), resolve(process.env.OUTPUT_DIR ?? 'dist'));
}
