import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VoteStore, Collector, validatePayload, INTERVAL, API_URL } from '../store.js';
import { seedCategories } from '../seed.js';
import { createApp } from '../server.js';
import { chartGeometry, makeSeries, toCsv } from '../public/chart.js';

const payload = () => ({ response: { status: 'ok', categories: structuredClone(seedCategories) } });
const silent = { error() {} };
const success = categories => ({ ok: true, json: async () => ({ response: { status: 'ok', categories } }) });

test('provided snapshot contains all 12 categories and 105 original nominees', () => {
  assert.equal(seedCategories.length, 12);
  assert.equal(seedCategories.reduce((sum, category) => sum + category.nominees.length, 0), 105);
  assert.equal(seedCategories[0].nominees[0].voteCount, 33477);
  assert.equal(seedCategories[3].nominees.length, 30);
  assert.equal(seedCategories[11].nominees.at(-1).voteCount, 968);
  assert.equal(validatePayload(payload()).length, 12);
});

test('rejects bad status, empty categories, duplicate IDs and invalid numeric values', () => {
  for (const change of [
    data => { data.response.status = 'fail'; },
    data => { data.response.categories = []; },
    data => { delete data.response.categories[0].categoryId; },
    data => { data.response.categories[0].categoryId = 123; },
    data => { data.response.categories.push(data.response.categories[0]); },
    data => { data.response.categories[0].nominees.push(data.response.categories[0].nominees[0]); },
    data => { data.response.categories[0].nominees[0].voteCount = -1; },
    data => { data.response.categories[0].nominees[0].voteCount = 1.5; },
    data => { data.response.categories[0].nominees[0].voteCount = Number.MAX_SAFE_INTEGER + 1; },
    data => { data.response.categories[0].nominees[0].votePercent = NaN; },
    data => { data.response.categories[0].nominees[0].votePercent = 101; },
    data => { data.response.categories[0].nominees[0].content.name = ''; },
    data => { data.response.categories[0].nominees[0].type = 'song'; },
    data => { data.response.categories[0].nominees[0].content.artistName = {}; }
  ]) {
    const data = payload();
    change(data);
    assert.throws(() => validatePayload(data));
  }
});

test('only permits official HTTPS image hosts and preserves names without HTML conversion', () => {
  const data = payload();
  data.response.categories[0].nominees[0].content.imageUrl = 'https://example.com/image.jpg';
  data.response.categories[0].nominees[0].content.name = '<script>alert(1)</script>';
  const candidate = validatePayload(data)[0].nominees[0];
  assert.equal(candidate.content.imageUrl, undefined);
  assert.equal(candidate.content.name, '<script>alert(1)</script>');
});

test('SQLite persists observations, isolates categories, and retains official downward corrections', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mma-race-test-'));
  let store;
  try {
    const path = join(directory, 'votes.sqlite');
    store = new VoteStore(path);
    assert.equal(store.latest(), null);
    assert.deepEqual(store.history('V26002', 0), []);
    store.save(seedCategories, 1000);
    const changed = structuredClone(seedCategories);
    changed[0].nominees[0].voteCount = 33000;
    store.save(changed, 301000);
    assert.equal(store.history('V26002', 0).length, 20);
    assert.equal(store.history('V26002', 2000).length, 10);
    assert.equal(store.history('V26005', 0).length, 60);
    assert.equal(store.latest().categories[0].nominees[0].voteCount, 33000);
    store.close();
    store = new VoteStore(path);
    assert.equal(store.latest().capturedAt, 301000);
    assert.equal(store.history('V26002', 0).length, 20);
    const duplicate = structuredClone(seedCategories);
    duplicate[0].nominees.push(duplicate[0].nominees[0]);
    assert.throws(() => store.save(duplicate, 999999));
    assert.equal(store.latest().capturedAt, 301000);
  } finally {
    store?.close();
    rmSync(directory, { recursive: true });
  }
});

test('collector uses fresh timestamp, serializes requests, and never records failed observations', async () => {
  const store = new VoteStore(':memory:');
  let mode = 'ok', requests = 0, timestamp = 1793342304000, fetchedUrl;
  const collector = new Collector(store, {
    now: () => timestamp, logger: silent,
    fetchFn: async (url, options) => {
      requests++;
      fetchedUrl = new URL(url);
      assert.equal(options.headers.Accept, 'application/json');
      assert.ok(options.signal);
      await new Promise(resolve => setImmediate(resolve));
      if (mode === 'http') return { ok: false, status: 503 };
      if (mode === 'network') throw new Error('DNS unavailable');
      if (mode === 'bad') return { ok: true, json: async () => ({ response: { status: 'fail' } }) };
      return success(seedCategories);
    }
  });
  try {
    const first = collector.collect();
    assert.equal(first, collector.collect());
    assert.equal(await first, true);
    assert.equal(requests, 1);
    assert.equal(`${fetchedUrl.origin}${fetchedUrl.pathname}`, API_URL);
    assert.equal(fetchedUrl.searchParams.get('t'), '1793342304');
    assert.equal(fetchedUrl.searchParams.get('lang'), 'ko');
    for (mode of ['http', 'network', 'bad']) {
      timestamp += INTERVAL;
      assert.equal(await collector.collect(), false);
      assert.ok(collector.lastError);
      assert.equal(store.history('V26002', 0).length, 10);
      assert.equal(store.latest().capturedAt, 1793342304000);
    }
    mode = 'ok';
    assert.equal(await collector.collect(), true);
    assert.equal(collector.lastError, null);
    assert.equal(store.history('V26002', 0).length, 20);
  } finally { store.close(); }
});

test('collector starts without visitors, schedules five minutes from request start, and stops cleanly', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let clock = 1000000;
  const store = new VoteStore(':memory:');
  const collector = new Collector(store, { now: () => clock, fetchFn: async () => {
    clock += 20000;
    return success(seedCategories);
  }, logger: silent });
  try {
    collector.start();
    collector.start();
    await collector.pending;
    await Promise.resolve();
    assert.equal(store.history('V26002', 0).length, 10);
    assert.equal(collector.nextAttemptAt, clock + 280000);
    clock += 279999;
    t.mock.timers.tick(279999);
    assert.equal(store.history('V26002', 0).length, 10);
    clock += 1;
    t.mock.timers.tick(1);
    await collector.pending;
    await Promise.resolve();
    assert.equal(store.history('V26002', 0).length, 20);
    await collector.stop();
    t.mock.timers.tick(600000);
    assert.equal(store.history('V26002', 0).length, 20);
  } finally {
    await collector.stop();
    store.close();
    t.mock.timers.reset();
  }
});

test('HTTP API labels provided snapshots honestly, serves persisted live data, and validates history requests', async () => {
  const store = new VoteStore(':memory:');
  let now = 1000000;
  const collector = new Collector(store);
  const app = createApp({ store, collector, now: () => now });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  try {
    let response = await fetch(`${base}/api/dashboard`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    let dashboard = await response.json();
    assert.equal(dashboard.source, 'provided');
    assert.equal(dashboard.capturedAt, null);
    assert.equal(dashboard.stale, true);
    assert.equal((await (await fetch(`${base}/api/history?category=V26002`)).json()).points.length, 0);
    store.save(seedCategories, now);
    dashboard = await (await fetch(`${base}/api/dashboard`)).json();
    assert.equal(dashboard.source, 'live');
    assert.equal(dashboard.stale, false);
    assert.equal((await (await fetch(`${base}/api/history?category=V26005&range=1h`)).json()).points.length, 30);
    now += 450001;
    assert.equal((await (await fetch(`${base}/api/dashboard`)).json()).stale, true);
    for (const query of ['category=bad', 'category=V26002&range=bad', 'category=V26002&range=toString', 'category=V26002&range=__proto__']) {
      assert.equal((await fetch(`${base}/api/history?${query}`)).status, 400);
    }
    collector.lastError = 'Upstream failed';
    dashboard = await (await fetch(`${base}/api/dashboard`)).json();
    assert.equal(dashboard.error, 'Upstream failed');
    assert.equal(dashboard.categories[0].nominees[0].voteCount, 33477);
    response = await fetch(base);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(await response.text(), /MMA RACE/);
    for (const asset of ['/app.js', '/chart.js', '/style.css', '/favicon.svg', '/characters.js', '/categories.js', '/race3d.js', '/race3d.css', '/vendor/three.module.js', '/vendor/three.core.js']) {
      assert.equal((await fetch(`${base}${asset}`)).status, 200);
    }
    assert.equal((await fetch(`${base}/seed.js`)).status, 404);
    assert.equal((await fetch(`${base}/data/votes.sqlite`)).status, 404);
    assert.equal((await fetch(`${base}/api/dashboard`, { method: 'POST' })).status, 405);
    assert.equal((await (await fetch(`${base}/healthz`)).json()).status, 'ok');
  } finally {
    await new Promise(resolve => app.close(resolve));
    store.close();
  }
});

test('chart renders honest single points, zero values and breaks at missing intervals', () => {
  assert.equal(chartGeometry([], 'voteCount'), null);
  const geometry = chartGeometry([{ points: [{ time: 1000000, value: 0 }] }], 'voteCount');
  assert.ok(Number.isFinite(geometry.x(1000000)));
  assert.ok(Number.isFinite(geometry.y(0)));
  const points = [{ time: 0, value: 10 }, { time: 300000, value: 20 }, { time: 900000, value: 30 }];
  const chart = chartGeometry([{ points }], 'voteCount');
  assert.equal((chart.path(points).match(/M/g) ?? []).length, 2);
  assert.equal((chart.path(points).match(/L/g) ?? []).length, 1);
  assert.equal(chartGeometry([{ points: [{ time: 0, value: 99 }] }], 'votePercent').ceiling, 100);
  assert.equal(makeSeries([{ nomineeId: 'x', capturedAt: 123, voteCount: 45, votePercent: 6 }], 'x', 'votePercent')[0].value, 6);
});

test('CSV exports real UTC observations, escapes quotes, and prevents spreadsheet formula execution', () => {
  const csv = toCsv([{ capturedAt: 0, nomineeId: 'x', voteCount: 42, votePercent: 3 }], 'V26002', [{ content: { id: 'x', name: '=HYPERLINK("test")' } }]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /1970-01-01T00:00:00.000Z/);
  assert.ok(csv.includes(`"'=HYPERLINK(""test"")"`));
  assert.match(csv, /"42","3"/);
  assert.equal(toCsv([], 'V26002', []).split('\r\n').length, 1);
});
