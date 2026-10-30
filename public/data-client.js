export const ranges = { '1h': 3600000, '6h': 21600000, '24h': 86400000, '7d': 604800000 };

export async function getJson(url, signal) {
  const response = await fetch(url, { signal: signal ?? AbortSignal.timeout(15000), cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export function staticDashboard(data, now = Date.now()) {
  return {
    ...data, scheduling: 'github-actions', collecting: false, nextAttemptAt: null,
    serverTime: now,
    stale: !data.capturedAt || now - data.capturedAt > 450000 || Boolean(data.error)
  };
}

export async function dashboard(pages) {
  const data = await getJson(new URL(pages ? './data/dashboard.json' : './api/dashboard', import.meta.url));
  return pages ? staticDashboard(data) : data;
}

export async function history(pages, category, range, signal) {
  if (!Object.hasOwn(ranges, range)) throw new Error('無效的時間範圍');
  if (!pages) return getJson(new URL(`./api/history?category=${encodeURIComponent(category)}&range=${range}`, import.meta.url), signal);
  const data = await getJson(new URL(`./data/history/${encodeURIComponent(category)}.json`, import.meta.url), signal);
  const since = Date.now() - ranges[range];
  return { points: data.filter(point => point[0] >= since).map(([capturedAt, nomineeId, voteCount, votePercent]) => ({
    capturedAt, nomineeId, voteCount, votePercent
  })) };
}
