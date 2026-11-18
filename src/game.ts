import type { Choice, Question, QuestionSet } from './types';
import { MAX_PLAYERS, MAX_UPLOADS_PER_ROOM, NAME_MAX, READING_MS } from './constants';

export type Phase = 'lobby' | 'reading' | 'answering' | 'result' | 'board' | 'end';

export interface Player {
  id: string;
  token: string;
  name: string;
  score: number;
  /** jumlah waktu jawab (ms) pada soal tf yang dijawab benar, untuk memecah skor seri */
  correctMs: number;
  joinOrder: number;
  connected: boolean;
  kicked: boolean;
  lastGain: number;
  /** qIndex soal yang terlewat karena gabung di tengah soal */
  lateFor: number | null;
}

export interface Answer { choice: Choice; ms: number }

export interface Room {
  code: string;
  hostToken: string;
  hostIp: string;
  createdAt: number;
  hostLeftAt: number | null;
  set: QuestionSet | null;
  phase: Phase;
  qIndex: number;
  phaseEndsAt: number | null;
  openedAt: number | null;
  players: Player[];
  answers: Map<string, Answer>;
  joinCounter: number;
  /** set hasil upload presenter, hanya hidup di ruang ini */
  customSets: QuestionSet[];
  uploadCounter: number;
}

export function createRoom(code: string, hostToken: string, hostIp: string, now: number): Room {
  return {
    code, hostToken, hostIp, createdAt: now, hostLeftAt: null,
    set: null, phase: 'lobby', qIndex: -1, phaseEndsAt: null, openedAt: null,
    players: [], answers: new Map(), joinCounter: 0, customSets: [], uploadCounter: 0,
  };
}

export const activePlayers = (room: Room) => room.players.filter(p => !p.kicked);

export type JoinResult =
  | { ok: true; player: Player; rejoined: boolean }
  | { ok: false; error: 'NAME_EMPTY' | 'FULL' | 'KICKED' };

function uniqueName(room: Room, base: string): string {
  const taken = new Set(activePlayers(room).map(p => p.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export function joinRoom(room: Room, name: string, token?: string): JoinResult {
  if (token) {
    const existing = room.players.find(p => p.token === token);
    if (existing) {
      if (existing.kicked) return { ok: false, error: 'KICKED' };
      existing.connected = true;
      return { ok: true, player: existing, rejoined: true };
    }
  }
  const clean = name.trim().slice(0, NAME_MAX).trim();
  if (!clean) return { ok: false, error: 'NAME_EMPTY' };
  if (activePlayers(room).length >= MAX_PLAYERS) return { ok: false, error: 'FULL' };
  const midQuestion = room.phase === 'reading' || room.phase === 'answering';
  const player: Player = {
    id: crypto.randomUUID(),
    token: crypto.randomUUID(),
    name: uniqueName(room, clean),
    score: 0, correctMs: 0,
    joinOrder: ++room.joinCounter,
    connected: true, kicked: false, lastGain: 0,
    lateFor: midQuestion ? room.qIndex : null,
  };
  room.players.push(player);
  return { ok: true, player, rejoined: false };
}

export function kickPlayer(room: Room, playerId: string): void {
  if (room.phase !== 'lobby') return;
  const p = room.players.find(x => x.id === playerId);
  if (p) { p.kicked = true; p.connected = false; }
}

export function setConnected(room: Room, playerId: string, connected: boolean): void {
  const p = room.players.find(x => x.id === playerId);
  if (p && !p.kicked) p.connected = connected;
}

// ---------- alur soal ----------

export function currentQuestion(room: Room): Question | null {
  if (!room.set || room.qIndex < 0) return null;
  return room.set.questions[room.qIndex] ?? null;
}

export function selectSet(room: Room, set: QuestionSet): void {
  if (room.phase === 'lobby') room.set = set;
}

const canAnswer = (room: Room, p: Player) => !p.kicked && p.lateFor !== room.qIndex;

function openQuestion(room: Room, index: number, now: number): void {
  room.qIndex = index;
  room.phase = 'reading';
  room.phaseEndsAt = now + READING_MS;
  room.openedAt = null;
  room.answers.clear();
  for (const p of room.players) p.lastGain = 0;
}

export function startGame(room: Room, now: number): boolean {
  if (room.phase !== 'lobby' || !room.set || activePlayers(room).length === 0) return false;
  openQuestion(room, 0, now);
  return true;
}

function everyoneAnswered(room: Room): boolean {
  const eligible = room.players.filter(p => p.connected && canAnswer(room, p));
  return eligible.length > 0 && eligible.every(p => room.answers.has(p.id));
}

export function tick(room: Room, now: number): boolean {
  if (room.phase === 'reading' && room.phaseEndsAt !== null && now >= room.phaseEndsAt) {
    const q = currentQuestion(room)!;
    room.phase = 'answering';
    room.openedAt = now;
    room.phaseEndsAt = now + q.timeSec * 1000;
    return true;
  }
  if (room.phase === 'answering') {
    if ((room.phaseEndsAt !== null && now >= room.phaseEndsAt) || everyoneAnswered(room)) {
      endQuestion(room, now);
      return true;
    }
  }
  return false;
}

export type AnswerResult = { ok: true } | { ok: false; error: 'NOT_OPEN' | 'ALREADY' | 'UNKNOWN_PLAYER' };

export function submitAnswer(room: Room, playerId: string, choice: Choice, now: number): AnswerResult {
  const p = room.players.find(x => x.id === playerId && !x.kicked);
  if (!p) return { ok: false, error: 'UNKNOWN_PLAYER' };
  if (room.phase !== 'answering' || room.openedAt === null || !canAnswer(room, p)) return { ok: false, error: 'NOT_OPEN' };
  if (room.answers.has(p.id)) return { ok: false, error: 'ALREADY' };
  room.answers.set(p.id, { choice, ms: Math.max(0, now - room.openedAt) });
  if (everyoneAnswered(room)) endQuestion(room, now);
  return { ok: true };
}

export function scoreFor(elapsedMs: number, limitMs: number): number {
  const ratio = Math.min(1, Math.max(0, elapsedMs / limitMs));
  return 500 + Math.round(500 * (1 - ratio));
}

export function endQuestion(room: Room, _now: number): void {
  if (room.phase !== 'answering') return;
  const q = currentQuestion(room)!;
  if (q.type === 'tf') {
    for (const [id, a] of room.answers) {
      const p = room.players.find(x => x.id === id);
      if (!p || a.choice !== q.answer) continue;
      const gain = scoreFor(a.ms, q.timeSec * 1000);
      p.score += gain;
      p.lastGain = gain;
      p.correctMs += a.ms;
    }
  }
  room.phase = 'result';
  room.phaseEndsAt = null;
}

function nextOrEnd(room: Room, now: number): void {
  const next = room.qIndex + 1;
  if (room.set && next < room.set.questions.length) openQuestion(room, next, now);
  else { room.phase = 'end'; room.phaseEndsAt = null; }
}

export function advance(room: Room, now: number): boolean {
  switch (room.phase) {
    case 'answering':
      endQuestion(room, now);
      return true;
    case 'result':
      if (currentQuestion(room)?.type === 'tf') room.phase = 'board';
      else nextOrEnd(room, now);
      return true;
    case 'board':
      nextOrEnd(room, now);
      return true;
    default:
      return false;
  }
}

export function leaderboard(room: Room): Player[] {
  return activePlayers(room).sort((x, y) =>
    y.score - x.score || x.correctMs - y.correctMs || x.joinOrder - y.joinOrder);
}

export function resetForReplay(room: Room): void {
  room.phase = 'lobby';
  room.qIndex = -1;
  room.phaseEndsAt = null;
  room.openedAt = null;
  room.answers.clear();
  for (const p of room.players) {
    p.score = 0; p.correctMs = 0; p.lastGain = 0; p.lateFor = null;
  }
}

// ---------- set upload ----------

export function nextUploadId(room: Room): string {
  return `upload-${room.uploadCounter + 1}`;
}

export function addCustomSet(room: Room, set: QuestionSet): { ok: true; id: string } | { ok: false; error: 'TOO_MANY' } {
  const norm = (t: string) => t.trim().toLowerCase();
  const idx = room.customSets.findIndex(s => norm(s.title) === norm(set.title));
  if (idx >= 0) {
    const replaced = { ...set, id: room.customSets[idx].id };
    if (room.set?.id === replaced.id) room.set = replaced;
    room.customSets[idx] = replaced;
    return { ok: true, id: replaced.id };
  }
  if (room.customSets.length >= MAX_UPLOADS_PER_ROOM) return { ok: false, error: 'TOO_MANY' };
  room.uploadCounter++;
  room.customSets.push(set);
  return { ok: true, id: set.id };
}
