import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VoteStore, Collector, INTERVAL } from './store.js';
import { seedCategories } from './seed.js';

const root = dirname(fileURLToPath(import.meta.url));
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/chart.js', ['chart.js', 'text/javascript; charset=utf-8']],
  ['/race3d.js', ['race3d.js', 'text/javascript; charset=utf-8']],
  ['/characters.js', ['characters.js', 'text/javascript; charset=utf-8']],
  ['/categories.js', ['categories.js', 'text/javascript; charset=utf-8']],
  ['/data-client.js', ['data-client.js', 'text/javascript; charset=utf-8']],
  ['/race3d.css', ['race3d.css', 'text/css; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]
]);
const ranges = { '1h': 3600000, '6h': 21600000, '24h': 86400000, '7d': 604800000 };

export function createApp({ store, collector, now = Date.now }) {
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://cdnimg.melon.co.kr https://snsimg.melon.co.kr; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const json = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(405, { error: '只支援 GET 與 HEAD' });
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/dashboard') {
        const latest = store.latest();
        return json(200, {
          categories: latest?.categories ?? seedCategories,
          source: latest ? 'live' : 'provided',
          capturedAt: latest?.capturedAt ?? null,
          serverTime: now(),
          intervalMs: INTERVAL,
          nextAttemptAt: collector.nextAttemptAt,
          lastAttemptAt: collector.lastAttemptAt,
          collecting: Boolean(collector.pending),
          error: collector.lastError,
          stale: !latest || now() - latest.capturedAt > INTERVAL * 1.5 || Boolean(collector.lastError)
        });
      }
      if (url.pathname === '/api/history') {
        const category = url.searchParams.get('category');
        const range = url.searchParams.get('range') ?? '24h';
        const categories = store.latest()?.categories ?? seedCategories;
        if (!Object.hasOwn(ranges, range) || !categories.some(item => item.categoryId === category)) {
          return json(400, { error: '無效的分類或時間範圍' });
        }
        return json(200, { category, range, points: store.history(category, now() - ranges[range]) });
      }
      if (url.pathname === '/healthz') return json(200, { status: 'ok', collectorError: collector.lastError });
      if (['/vendor/three.module.js', '/vendor/three.core.js'].includes(url.pathname)) {
        const name = url.pathname.endsWith('three.module.js') ? 'three.module.js' : 'three.core.js';
        const body = await readFile(resolve(root, 'node_modules/three/build', name));
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
        return res.end(req.method === 'HEAD' ? undefined : body);
      }
      const asset = assets.get(url.pathname);
      if (!asset) return json(404, { error: '找不到頁面' });
      const body = await readFile(resolve(root, 'public', asset[0]));
      res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      console.error('[server]', error);
      if (!res.headersSent) json(500, { error: '伺服器暫時無法處理請求' });
      else res.end();
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dataDir = resolve(process.env.DATA_DIR ?? resolve(root, 'data'));
  mkdirSync(dataDir, { recursive: true });
  const store = new VoteStore(resolve(dataDir, 'votes.sqlite'));
  const collector = new Collector(store);
  const app = createApp({ store, collector });
  app.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '0.0.0.0', () => {
    console.log(`MMA Race listening on port ${process.env.PORT ?? 3000}`);
    collector.start();
  });
  const shutdown = async () => {
    app.close();
    await collector.stop();
    store.close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
