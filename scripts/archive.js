import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export function writeJson(path, value) {
  writeFileSync(`${path}.tmp`, JSON.stringify(value));
  renameSync(`${path}.tmp`, path);
}

export class Archive {
  constructor(directory) {
    this.directory = directory;
    mkdirSync(resolve(directory, 'daily'), { recursive: true });
  }
  latest() { return readJson(resolve(this.directory, 'latest.json'), null); }
  save(categories, capturedAt) {
    const date = new Date(capturedAt).toISOString().slice(0, 10);
    const votes = categories.flatMap(category => category.nominees.map(nominee => [
      category.categoryId, nominee.content.id, nominee.voteCount, nominee.votePercent
    ]));
    appendFileSync(resolve(this.directory, 'daily', `${date}.jsonl`), `${JSON.stringify({ capturedAt, votes })}\n`);
    writeJson(resolve(this.directory, 'latest.json'), { capturedAt, categories });
  }
}
