import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collect } from '../scripts/collect.js';
import { buildPages } from '../scripts/build-pages.js';
import { Archive, readJson } from '../scripts/archive.js';
import { seedCategories } from '../seed.js';
import { staticDashboard } from '../public/data-client.js';

test('Pages collection persists real samples, preserves failures, and builds subpath-safe assets', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mma-pages-'));
  const now = 1793342304000;
  const options = { now: () => now, logger: { error() {} }, fetchFn: async () => ({
    ok: true, json: async () => ({ response: { status: 'ok', categories: seedCategories } })
  }) };
  try {
    const state = join(directory, 'state'), output = join(directory, 'site');
    assert.equal(await collect(state, options), true);
    const archive = new Archive(state);
    assert.equal(archive.latest().capturedAt, now);
    const daily = join(state, 'daily', new Date(now).toISOString().slice(0, 10) + '.jsonl');
    assert.equal(JSON.parse(readFileSync(daily, 'utf8')).votes.length, 105);
    assert.equal(await collect(state, { ...options, now: () => now + 300000, fetchFn: async () => { throw new Error('test network error'); } }), false);
    assert.equal(archive.latest().capturedAt, now);
    assert.equal(readFileSync(daily, 'utf8').trim().split('\n').length, 1);
    buildPages(state, output, now + 300000);
    const dashboard = readJson(join(output, 'data/dashboard.json'));
    assert.equal(dashboard.source, 'live');
    assert.match(dashboard.error, /test network error/);
    assert.equal(readJson(join(output, 'data/history/V26002.json')).length, 10);
    assert.equal(readJson(join(output, 'data/history/V26005.json')).length, 30);
    const html = readFileSync(join(output, 'index.html'), 'utf8');
    assert.match(html, /name="data-mode" content="pages"/);
    assert.doesNotMatch(html, /(?:src|href)="\/(?!\/)/);
    assert.match(readFileSync(join(output, 'race3d.js'), 'utf8'), /from '\.\/vendor\/three.module.js'/);
    assert.ok(readFileSync(join(output, 'vendor/three.core.js')).length > 1000);
    assert.ok(readFileSync(join(output, 'vendor/THREE-LICENSE.txt')).length > 100);
    assert.equal(staticDashboard({ capturedAt: now, error: null }, now + 450001).stale, true);
    assert.equal(staticDashboard({ capturedAt: now, error: null }, now + 100).stale, false);
    buildPages(state, output, now + 8 * 86400000);
    assert.deepEqual(readJson(join(output, 'data/history/V26002.json')), []);
    assert.equal(archive.latest().capturedAt, now);
  } finally { rmSync(directory, { recursive: true }); }
});

test('first failed collection never manufactures historical data; corrupted archives fail loudly', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mma-pages-failure-'));
  try {
    const state = join(directory, 'state');
    assert.equal(await collect(state, { logger: { error() {} }, fetchFn: async () => ({ ok: false, status: 503 }) }), false);
    const dashboard = readJson(join(state, 'dashboard.json'));
    assert.equal(dashboard.source, 'provided');
    assert.equal(dashboard.capturedAt, null);
    assert.match(dashboard.error, /503/);
    buildPages(state, join(directory, 'site'));
    assert.deepEqual(readJson(join(directory, 'site/data/history/V26002.json')), []);
    writeFileSync(join(state, 'latest.json'), 'broken');
    assert.throws(() => new Archive(state).latest(), SyntaxError);
  } finally { rmSync(directory, { recursive: true }); }
});
