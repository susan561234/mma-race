import { DatabaseSync } from 'node:sqlite';

export const INTERVAL = 5 * 60 * 1000;
export const API_URL = 'https://m2.melon.com/m6/mma/2026/vote/category.json';
const types = new Set(['artist', 'album', 'song']);

export function validatePayload(payload) {
  if (payload?.response?.status !== 'ok' || !Array.isArray(payload.response.categories) || !payload.response.categories.length) {
    throw new Error('API 回傳狀態或分類格式不正確');
  }
  const categoryIds = new Set();
  return payload.response.categories.map(category => {
    if (typeof category.categoryId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(category.categoryId) ||
        categoryIds.has(category.categoryId) || !types.has(category.nomineeType) ||
        !Array.isArray(category.nominees) || !category.nominees.length) {
      throw new Error('API 分類內容不完整或重複');
    }
    categoryIds.add(category.categoryId);
    const nomineeIds = new Set();
    const nominees = category.nominees.map(nominee => {
      const { content, voteCount, votePercent } = nominee;
      if (nominee.type !== category.nomineeType || !content ||
          typeof content.id !== 'string' || !content.id || content.id.length > 128 ||
          nomineeIds.has(content.id) || typeof content.name !== 'string' || !content.name.trim() ||
          !Number.isSafeInteger(voteCount) || voteCount < 0 ||
          typeof votePercent !== 'number' || !Number.isFinite(votePercent) || votePercent < 0 || votePercent > 100 ||
          (content.artistName !== undefined && typeof content.artistName !== 'string')) {
        throw new Error('API 候選項目或票數格式不正確');
      }
      nomineeIds.add(content.id);
      let imageUrl;
      if (content.imageUrl) {
        const url = new URL(content.imageUrl);
        if (url.protocol === 'https:' && ['cdnimg.melon.co.kr', 'snsimg.melon.co.kr'].includes(url.hostname)) imageUrl = url.href;
      }
      return {
        type: nominee.type,
        content: { id: content.id, name: content.name, ...(content.artistName ? { artistName: content.artistName } : {}), ...(imageUrl ? { imageUrl } : {}) },
        voteCount, votePercent
      };
    });
    return { categoryId: category.categoryId, nomineeType: category.nomineeType, nominees };
  });
}

export class VoteStore {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY,
        captured_at INTEGER NOT NULL,
        categories TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS snapshots_time ON snapshots(captured_at);
      CREATE TABLE IF NOT EXISTS votes (
        snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
        category_id TEXT NOT NULL,
        nominee_id TEXT NOT NULL,
        vote_count INTEGER NOT NULL,
        vote_percent REAL NOT NULL,
        PRIMARY KEY(snapshot_id, category_id, nominee_id)
      );
      CREATE INDEX IF NOT EXISTS votes_category ON votes(category_id, snapshot_id);
    `);
  }

  save(categories, capturedAt) {
    const insert = this.db.prepare('INSERT INTO votes VALUES (?, ?, ?, ?, ?)');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.db.prepare('INSERT INTO snapshots(captured_at, categories) VALUES (?, ?)').run(capturedAt, JSON.stringify(categories));
      for (const category of categories) {
        for (const nominee of category.nominees) {
          insert.run(result.lastInsertRowid, category.categoryId, nominee.content.id, nominee.voteCount, nominee.votePercent);
        }
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  latest() {
    const row = this.db.prepare('SELECT * FROM snapshots ORDER BY id DESC LIMIT 1').get();
    return row ? { capturedAt: row.captured_at, categories: JSON.parse(row.categories) } : null;
  }

  history(categoryId, since) {
    return this.db.prepare(`
      SELECT s.captured_at AS capturedAt, v.nominee_id AS nomineeId,
             v.vote_count AS voteCount, v.vote_percent AS votePercent
      FROM votes v JOIN snapshots s ON s.id = v.snapshot_id
      WHERE v.category_id = ? AND s.captured_at >= ?
      ORDER BY s.captured_at, s.id, v.nominee_id
    `).all(categoryId, since);
  }

  close() { this.db.close(); }
}

export class Collector {
  constructor(store, { fetchFn = fetch, now = Date.now, logger = console } = {}) {
    this.store = store;
    this.fetchFn = fetchFn;
    this.now = now;
    this.logger = logger;
    this.lastError = null;
    this.lastAttemptAt = null;
    this.nextAttemptAt = null;
    this.pending = null;
    this.timer = null;
    this.stopped = true;
  }

  collect() {
    if (this.pending) return this.pending;
    this.pending = this.perform().finally(() => { this.pending = null; });
    return this.pending;
  }

  async perform() {
    this.lastAttemptAt = this.now();
    try {
      const url = new URL(API_URL);
      url.searchParams.set('lang', 'ko');
      url.searchParams.set('t', String(Math.floor(this.now() / 1000)));
      const response = await this.fetchFn(url, {
        signal: AbortSignal.timeout(20000),
        headers: { Accept: 'application/json', 'User-Agent': 'MMA-Race/1.0 (public vote viewer)' }
      });
      if (!response.ok) throw new Error(`Melon API HTTP ${response.status}`);
      const categories = validatePayload(await response.json());
      this.store.save(categories, this.now());
      this.lastError = null;
      return true;
    } catch (error) {
      this.lastError = `抓取失敗：${error.message}${error.cause?.code ? ` (${error.cause.code})` : ''}`;
      this.logger.error('[collector]', error);
      return false;
    }
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    const tick = async () => {
      this.nextAttemptAt = null;
      await this.collect();
      if (this.stopped) return;
      const delay = Math.max(0, INTERVAL - (this.now() - this.lastAttemptAt));
      this.nextAttemptAt = this.now() + delay;
      this.timer = setTimeout(tick, delay);
    };
    void tick();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.pending;
  }
}
