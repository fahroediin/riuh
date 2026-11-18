import { Database } from 'bun:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const BOT = /bot|crawl|spider|slurp|curl|wget|python|httpclient|okhttp|java\/|go-http|facebookexternalhit|whatsapp|telegram|preview|headless|lighthouse|monitor|uptime/i;

export const isBot = (ua: string) => !ua.trim() || BOT.test(ua);

/**
 * Pengunjung unik per hari. Yang disimpan hanya tanggal dan hash (salt + tanggal + IP + User-Agent),
 * jadi IP mentah tidak pernah masuk database.
 */
export class VisitCounter {
  private db: Database;
  private salt: string;
  private insert;
  private count;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    this.db.exec('CREATE TABLE IF NOT EXISTS visits (day TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (day, hash))');
    const row = this.db.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'salt'").get();
    this.salt = row?.value ?? randomBytes(32).toString('hex');
    if (!row) this.db.query("INSERT INTO meta (key, value) VALUES ('salt', ?)").run(this.salt);
    this.insert = this.db.query('INSERT OR IGNORE INTO visits (day, hash) VALUES (?, ?)');
    this.count = this.db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM visits');
  }

  record(ip: string, ua: string, now: number): void {
    if (isBot(ua)) return;
    const day = new Date(now).toISOString().slice(0, 10);
    const hash = createHash('sha256').update(`${this.salt}|${day}|${ip}|${ua}`).digest('hex').slice(0, 32);
    this.insert.run(day, hash);
  }

  total(): number {
    return this.count.get()?.n ?? 0;
  }

  close(): void {
    this.db.close();
  }
}
