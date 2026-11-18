import type { Choice, QType } from './types';
import { activePlayers, currentQuestion, leaderboard, type Phase, type Room } from './game';
import { BOARD_SIZE, SPLIT_NAMES_MAX } from './constants';
import { T, type Lang } from './i18n';

export interface Split { a: number; b: number; aNames: string[]; bNames: string[]; aMore: number; bMore: number }
export interface NameScore { name: string; score: number }

export interface HostView {
  lang: Lang;
  code: string;
  joinUrl: string;
  phase: Phase;
  setId: string | null;
  setTitle: string | null;
  qNumber: number;
  qTotal: number;
  question: { type: QType; text: string; a: string; b: string } | null;
  correct: Choice | null;
  remainingMs: number | null;
  answeredCount: number;
  activeCount: number;
  players: { id: string; name: string; connected: boolean }[];
  split: Split | null;
  top: NameScore[];
  ranking: NameScore[];
  /** set berisi minimal satu soal Benar/Salah */
  scored: boolean;
}

export type PlayerResult =
  | null
  | { kind: 'correct'; gain: number }
  | { kind: 'wrong' }
  | { kind: 'missed' }
  | { kind: 'pick'; percent: number };

export interface PlayerView {
  lang: Lang;
  phase: Phase;
  name: string;
  qType: QType | null;
  labels: { a: string; b: string } | null;
  locked: boolean;
  myChoice: Choice | null;
  result: PlayerResult;
  rank: number | null;
  score: number;
  total: number;
}

/** label pilihan: Benar/Salah mengikuti bahasa ruang, Pilih Satu apa adanya */
function labelsOf(room: Room, q: { type: QType; a: string; b: string }) {
  return q.type === 'tf' ? { a: T[room.lang].yes, b: T[room.lang].no } : { a: q.a, b: q.b };
}

const showsResult = (phase: Phase) => phase === 'result' || phase === 'board';
const scoredSet = (room: Room) => !!room.set?.questions.some(q => q.type === 'tf');
const toNameScore = (room: Room, n?: number): NameScore[] =>
  leaderboard(room).slice(0, n).map(p => ({ name: p.name, score: p.score }));

function split(room: Room): Split {
  const names = (c: Choice) => activePlayers(room).filter(p => room.answers.get(p.id)?.choice === c).map(p => p.name);
  const a = names('a');
  const b = names('b');
  return {
    a: a.length, b: b.length,
    aNames: a.slice(0, SPLIT_NAMES_MAX), bNames: b.slice(0, SPLIT_NAMES_MAX),
    aMore: Math.max(0, a.length - SPLIT_NAMES_MAX), bMore: Math.max(0, b.length - SPLIT_NAMES_MAX),
  };
}

export function hostView(room: Room, now: number, joinUrl: string): HostView {
  const q = currentQuestion(room);
  const inQuestion = room.phase !== 'lobby' && room.phase !== 'end';
  const eligible = activePlayers(room).filter(p => p.connected && p.lateFor !== room.qIndex);
  return {
    lang: room.lang,
    code: room.code,
    joinUrl,
    phase: room.phase,
    setId: room.set?.id ?? null,
    setTitle: room.set?.title ?? null,
    qNumber: room.qIndex + 1,
    qTotal: room.set?.questions.length ?? 0,
    question: inQuestion && q ? { type: q.type, text: q.text, ...labelsOf(room, q) } : null,
    correct: showsResult(room.phase) && q ? q.answer : null,
    remainingMs: room.phaseEndsAt === null ? null : Math.max(0, room.phaseEndsAt - now),
    answeredCount: eligible.filter(p => room.answers.has(p.id)).length,
    activeCount: eligible.length,
    players: activePlayers(room).map(p => ({ id: p.id, name: p.name, connected: p.connected })),
    split: showsResult(room.phase) ? split(room) : null,
    top: room.phase === 'board' ? toNameScore(room, BOARD_SIZE) : [],
    ranking: room.phase === 'end' ? toNameScore(room) : [],
    scored: scoredSet(room),
  };
}

function playerResult(room: Room, playerId: string): PlayerResult {
  const q = currentQuestion(room);
  if (!q || !showsResult(room.phase)) return null;
  const mine = room.answers.get(playerId);
  if (!mine) return { kind: 'missed' };
  if (q.type === 'pick') {
    const same = [...room.answers.values()].filter(a => a.choice === mine.choice).length;
    return { kind: 'pick', percent: Math.round((same / room.answers.size) * 100) };
  }
  if (mine.choice === q.answer) {
    const p = room.players.find(x => x.id === playerId);
    return { kind: 'correct', gain: p?.lastGain ?? 0 };
  }
  return { kind: 'wrong' };
}

export function playerView(room: Room, playerId: string, _now: number): PlayerView {
  const p = room.players.find(x => x.id === playerId);
  const q = currentQuestion(room);
  const inQuestion = room.phase === 'reading' || room.phase === 'answering' || room.phase === 'result';
  const mine = room.answers.get(playerId);
  const ranked = scoredSet(room) && (showsResult(room.phase) || room.phase === 'end');
  const order = ranked ? leaderboard(room) : [];
  const idx = order.findIndex(x => x.id === playerId);
  return {
    lang: room.lang,
    phase: room.phase,
    name: p?.name ?? '',
    qType: inQuestion && q ? q.type : null,
    labels: inQuestion && q ? labelsOf(room, q) : null,
    locked: room.phase !== 'answering' || !!mine || p?.lateFor === room.qIndex,
    myChoice: mine?.choice ?? null,
    result: playerResult(room, playerId),
    rank: idx >= 0 ? idx + 1 : null,
    score: p?.score ?? 0,
    total: activePlayers(room).length,
  };
}
