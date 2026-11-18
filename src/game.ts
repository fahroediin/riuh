import type { Choice, Question, QuestionSet } from './types';
import { MAX_PLAYERS, NAME_MAX } from './constants';

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
}

export function createRoom(code: string, hostToken: string, hostIp: string, now: number): Room {
  return {
    code, hostToken, hostIp, createdAt: now, hostLeftAt: null,
    set: null, phase: 'lobby', qIndex: -1, phaseEndsAt: null, openedAt: null,
    players: [], answers: new Map(), joinCounter: 0,
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
