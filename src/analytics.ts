import { Database } from 'bun:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const HOUR_MS = 60 * 60 * 1000;
/** Satu kantor sering berbagi satu IP (NAT), jadi batas per IP cukup longgar; pemain sudah dibatasi sekali per ruang di server. */
export const REVIEWS_PER_IP_PER_HOUR = 20;
/** Rem darurat terhadap banjir review dari banyak IP. */
export const REVIEWS_PER_HOUR = 300;

export interface ReviewInput {
  rating: number; // 1..5
  comment?: string;
  roomCode?: string;
  setTitle?: string;
  lang?: string;
}

export interface SessionInput {
  roomCode: string;
  setId: string;
  setTitle: string;
  participants: number;
  lang: string;
}

export interface ReviewRow {
  id: number;
  createdAt: number;
  rating: number;
  comment: string;
  roomCode: string;
  setTitle: string;
  lang: string;
}

export interface SessionRow {
  id: number;
  createdAt: number;
  roomCode: string;
  setId: string;
  setTitle: string;
  participants: number;
  lang: string;
}

export interface QuizHeatmapItem {
  setId: string;
  setTitle: string;
  sessionCount: number;
  totalParticipants: number;
  avgParticipants: number;
  lastPlayed: number;
  langBreakdown: Record<string, number>;
}

export interface AdminMetrics {
  reviews: {
    total: number;
    averageRating: number;
    distribution: Record<number, number>;
    recent: ReviewRow[];
  };
  heatmap: QuizHeatmapItem[];
  sessions: SessionRow[];
}

export class AnalyticsStore {
  private db: Database;
  private salt: string;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        hash TEXT NOT NULL,
        rating INTEGER NOT NULL,
        comment TEXT,
        room_code TEXT,
        set_title TEXT,
        lang TEXT
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS quiz_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        room_code TEXT NOT NULL,
        set_id TEXT NOT NULL,
        set_title TEXT NOT NULL,
        participants INTEGER NOT NULL,
        lang TEXT NOT NULL
      )
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_reviews_hash_time ON reviews(hash, created_at)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_quiz_sessions_set ON quiz_sessions(set_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_reviews_time ON reviews(created_at)');

    const row = this.db.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'salt'").get();
    this.salt = row?.value ?? randomBytes(32).toString('hex');
    if (!row) this.db.query("INSERT INTO meta (key, value) VALUES ('salt', ?)").run(this.salt);
  }

  private hashFor(ip: string): string {
    return createHash('sha256').update(`${this.salt}|${ip}`).digest('hex').slice(0, 32);
  }

  private countSince(since: number, hash?: string): number {
    const row = hash
      ? this.db.query<{ n: number }, [string, number]>('SELECT COUNT(*) AS n FROM reviews WHERE hash = ? AND created_at > ?').get(hash, since)
      : this.db.query<{ n: number }, [number]>('SELECT COUNT(*) AS n FROM reviews WHERE created_at > ?').get(since);
    return row?.n ?? 0;
  }

  recordReview(
    ip: string,
    input: ReviewInput,
    now: number
  ): { ok: true } | { ok: false; error: 'RATE_LIMIT' | 'INVALID' } {
    const rating = input.rating;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return { ok: false, error: 'INVALID' };
    }
    const hash = this.hashFor(ip);
    const since = now - HOUR_MS;
    if (this.countSince(since, hash) >= REVIEWS_PER_IP_PER_HOUR || this.countSince(since) >= REVIEWS_PER_HOUR) {
      return { ok: false, error: 'RATE_LIMIT' };
    }

    const comment = input.comment ? input.comment.trim().slice(0, 500) : '';
    const roomCode = input.roomCode ? input.roomCode.trim().slice(0, 8) : '';
    const setTitle = input.setTitle ? input.setTitle.trim().slice(0, 100) : '';
    const lang = input.lang === 'en' ? 'en' : 'id';

    this.db
      .query(
        'INSERT INTO reviews (created_at, hash, rating, comment, room_code, set_title, lang) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(now, hash, rating, comment, roomCode, setTitle, lang);

    return { ok: true };
  }

  recordSession(input: SessionInput, now: number): void {
    const roomCode = input.roomCode.trim().slice(0, 8);
    const setId = input.setId.trim().slice(0, 50);
    const setTitle = input.setTitle.trim().slice(0, 100);
    const participants = Math.max(0, Math.floor(input.participants));
    const lang = input.lang === 'en' ? 'en' : 'id';

    this.db
      .query(
        'INSERT INTO quiz_sessions (created_at, room_code, set_id, set_title, participants, lang) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(now, roomCode, setId, setTitle, participants, lang);
  }

  getMetrics(): AdminMetrics {
    const totalRow = this.db.query<{ count: number; avg_rating: number | null }, []>(
      'SELECT COUNT(*) as count, AVG(rating) as avg_rating FROM reviews'
    ).get();

    const total = totalRow?.count ?? 0;
    const rawAvg = totalRow?.avg_rating ?? 0;
    const averageRating = total > 0 ? Math.round(rawAvg * 10) / 10 : 0;

    const distRows = this.db.query<{ rating: number; count: number }, []>(
      'SELECT rating, COUNT(*) as count FROM reviews GROUP BY rating'
    ).all();

    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of distRows) {
      distribution[r.rating] = r.count;
    }

    const recentReviewRows = this.db.query<{
      id: number;
      created_at: number;
      rating: number;
      comment: string;
      room_code: string;
      set_title: string;
      lang: string;
    }, []>('SELECT id, created_at, rating, comment, room_code, set_title, lang FROM reviews ORDER BY created_at DESC LIMIT 50').all();

    const recent: ReviewRow[] = recentReviewRows.map(r => ({
      id: r.id,
      createdAt: r.created_at,
      rating: r.rating,
      comment: r.comment || '',
      roomCode: r.room_code || '',
      setTitle: r.set_title || '',
      lang: r.lang || 'id',
    }));

    const sessionRows = this.db.query<{
      id: number;
      created_at: number;
      room_code: string;
      set_id: string;
      set_title: string;
      participants: number;
      lang: string;
    }, []>('SELECT id, created_at, room_code, set_id, set_title, participants, lang FROM quiz_sessions ORDER BY created_at DESC LIMIT 100').all();

    const sessions: SessionRow[] = sessionRows.map(s => ({
      id: s.id,
      createdAt: s.created_at,
      roomCode: s.room_code,
      setId: s.set_id,
      setTitle: s.set_title,
      participants: s.participants,
      lang: s.lang,
    }));

    // Heatmap aggregation
    const heatRows = this.db.query<{
      set_id: string;
      set_title: string;
      session_count: number;
      total_participants: number;
      last_played: number;
    }, []>(`
      SELECT 
        set_id,
        set_title,
        COUNT(*) as session_count,
        SUM(participants) as total_participants,
        MAX(created_at) as last_played
      FROM quiz_sessions
      GROUP BY set_id
      ORDER BY session_count DESC, total_participants DESC
    `).all();

    // Language breakdown per set
    const langRows = this.db.query<{
      set_id: string;
      lang: string;
      count: number;
    }, []>(`
      SELECT set_id, lang, COUNT(*) as count
      FROM quiz_sessions
      GROUP BY set_id, lang
    `).all();

    const langMap = new Map<string, Record<string, number>>();
    for (const lr of langRows) {
      if (!langMap.has(lr.set_id)) langMap.set(lr.set_id, {});
      langMap.get(lr.set_id)![lr.lang] = lr.count;
    }

    const heatmap: QuizHeatmapItem[] = heatRows.map(hr => {
      const sCount = hr.session_count || 1;
      const tPart = hr.total_participants || 0;
      return {
        setId: hr.set_id,
        setTitle: hr.set_title,
        sessionCount: sCount,
        totalParticipants: tPart,
        avgParticipants: Math.round(tPart / sCount),
        lastPlayed: hr.last_played,
        langBreakdown: langMap.get(hr.set_id) || {},
      };
    });

    return {
      reviews: {
        total,
        averageRating,
        distribution,
        recent,
      },
      heatmap,
      sessions,
    };
  }

  close(): void {
    this.db.close();
  }
}
