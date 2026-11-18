import { test, expect } from 'bun:test';
import {
  selectSet, startGame, tick, submitAnswer, endQuestion, advance, currentQuestion,
  scoreFor, leaderboard, resetForReplay, joinRoom, setConnected, type Room,
} from '../src/game';
import { withPlayers, room, SET } from './helpers';

const T0 = 1_000_000;

function started(n = 2): Room {
  const r = withPlayers(n);
  selectSet(r, SET);
  expect(startGame(r, T0)).toBe(true);
  return r;
}
function opened(n = 2): Room {
  const r = started(n);
  tick(r, T0 + 3000);
  return r;
}
const pid = (r: Room, i: number) => r.players[i].id;

test('start needs a set and a player', () => {
  const r = room();
  expect(startGame(r, T0)).toBe(false);
  selectSet(r, SET);
  expect(startGame(r, T0)).toBe(false);
  joinRoom(r, 'A');
  expect(startGame(r, T0)).toBe(true);
  expect(r.phase).toBe('reading');
  expect(r.qIndex).toBe(0);
  expect(currentQuestion(r)?.text).toBe('T1');
});

test('selectSet only in lobby', () => {
  const r = started();
  selectSet(r, { ...SET, id: 'lain' });
  expect(r.set?.id).toBe('s');
});

test('answers rejected during reading', () => {
  const r = started();
  expect(submitAnswer(r, pid(r, 0), 'a', T0 + 1000)).toEqual({ ok: false, error: 'NOT_OPEN' });
});

test('reading opens after 3000 ms', () => {
  const r = started();
  expect(tick(r, T0 + 2999)).toBe(false);
  expect(r.phase).toBe('reading');
  expect(tick(r, T0 + 3000)).toBe(true);
  expect(r.phase).toBe('answering');
  expect(r.openedAt).toBe(T0 + 3000);
  expect(r.phaseEndsAt).toBe(T0 + 3000 + 10000);
});

test('second answer rejected', () => {
  const r = opened();
  expect(submitAnswer(r, pid(r, 0), 'a', T0 + 4000)).toEqual({ ok: true });
  expect(submitAnswer(r, pid(r, 0), 'b', T0 + 4500)).toEqual({ ok: false, error: 'ALREADY' });
  expect(r.answers.get(pid(r, 0))).toEqual({ choice: 'a', ms: 1000 });
});

test('unknown player rejected', () => {
  const r = opened();
  expect(submitAnswer(r, 'nope', 'a', T0 + 4000)).toEqual({ ok: false, error: 'UNKNOWN_PLAYER' });
});

test('ends early when all connected answered', () => {
  const r = opened();
  submitAnswer(r, pid(r, 0), 'a', T0 + 4000);
  expect(r.phase).toBe('answering');
  submitAnswer(r, pid(r, 1), 'b', T0 + 5000);
  expect(r.phase).toBe('result');
});

test('disconnected players do not block early end', () => {
  const r = opened(3);
  setConnected(r, pid(r, 2), false);
  submitAnswer(r, pid(r, 0), 'a', T0 + 4000);
  submitAnswer(r, pid(r, 1), 'a', T0 + 4000);
  expect(r.phase).toBe('result');
});

test('tick ends question when everyone still connected has answered', () => {
  const r = opened(2);
  submitAnswer(r, pid(r, 0), 'a', T0 + 4000);
  setConnected(r, pid(r, 1), false);
  expect(tick(r, T0 + 4100)).toBe(true);
  expect(r.phase).toBe('result');
});

test('nobody connected does not end question early', () => {
  const r = opened(1);
  setConnected(r, pid(r, 0), false);
  expect(tick(r, T0 + 4000)).toBe(false);
  expect(r.phase).toBe('answering');
});

test('ends when time runs out', () => {
  const r = opened();
  expect(tick(r, T0 + 12999)).toBe(false);
  expect(tick(r, T0 + 13000)).toBe(true);
  expect(r.phase).toBe('result');
});

test('scoreFor', () => {
  expect(scoreFor(0, 10000)).toBe(1000);
  expect(scoreFor(5000, 10000)).toBe(750);
  expect(scoreFor(10000, 10000)).toBe(500);
  expect(scoreFor(12000, 10000)).toBe(500);
});

test('tf scoring on end', () => {
  const r = opened(3);
  submitAnswer(r, pid(r, 0), 'a', T0 + 3000 + 5000);
  submitAnswer(r, pid(r, 1), 'b', T0 + 3000 + 1000);
  tick(r, T0 + 13000);
  expect(r.players.map(p => p.score)).toEqual([750, 0, 0]);
  expect(r.players.map(p => p.lastGain)).toEqual([750, 0, 0]);
  expect(r.players[0].correctMs).toBe(5000);
  expect(r.players[1].correctMs).toBe(0);
});

test('endQuestion only from answering', () => {
  const r = started();
  endQuestion(r, T0);
  expect(r.phase).toBe('reading');
});

test('advance from answering ends question now', () => {
  const r = opened();
  expect(advance(r, T0 + 4000)).toBe(true);
  expect(r.phase).toBe('result');
});

test('advance does nothing in reading or lobby', () => {
  expect(advance(started(), T0)).toBe(false);
  expect(advance(withPlayers(1), T0)).toBe(false);
});

test('tf result goes to board then next question', () => {
  const r = opened();
  endQuestion(r, T0 + 5000);
  advance(r, T0 + 6000);
  expect(r.phase).toBe('board');
  advance(r, T0 + 7000);
  expect(r.phase).toBe('reading');
  expect(r.qIndex).toBe(1);
  expect(r.phaseEndsAt).toBe(T0 + 7000 + 3000);
  expect(r.answers.size).toBe(0);
});

test('pick question gives no score and skips board', () => {
  const r = opened();
  endQuestion(r, T0 + 5000);
  advance(r, T0);
  advance(r, T0 + 10); // soal pick, reading
  tick(r, T0 + 3010);
  submitAnswer(r, pid(r, 0), 'a', T0 + 3100);
  submitAnswer(r, pid(r, 1), 'b', T0 + 3200);
  expect(r.phase).toBe('result');
  expect(r.players.every(p => p.score === 0 && p.lastGain === 0)).toBe(true);
  advance(r, T0 + 4000);
  expect(r.phase).toBe('reading');
  expect(r.qIndex).toBe(2);
});

test('last question advances to end', () => {
  const r = opened();
  r.qIndex = 2;
  endQuestion(r, T0 + 5000);
  advance(r, T0 + 6000); // board
  advance(r, T0 + 7000);
  expect(r.phase).toBe('end');
  expect(advance(r, T0 + 8000)).toBe(false);
});

test('late joiner waits for next question', () => {
  const r = opened(1);
  const j = joinRoom(r, 'Telat');
  if (!j.ok) throw new Error();
  expect(j.player.lateFor).toBe(0);
  expect(submitAnswer(r, j.player.id, 'a', T0 + 4000)).toEqual({ ok: false, error: 'NOT_OPEN' });
  submitAnswer(r, pid(r, 0), 'a', T0 + 4000);
  expect(r.phase).toBe('result'); // tidak menunggu yang telat
  advance(r, T0 + 5000);
  advance(r, T0 + 5000);
  tick(r, T0 + 8000);
  expect(submitAnswer(r, j.player.id, 'a', T0 + 8100)).toEqual({ ok: true });
});

test('rejoin mid-question is not marked late', () => {
  const r = withPlayers(1);
  const p = r.players[0];
  selectSet(r, SET);
  startGame(r, T0);
  setConnected(r, p.id, false);
  joinRoom(r, '', p.token);
  expect(p.lateFor).toBe(null);
});

test('leaderboard tie broken by correctMs then joinOrder', () => {
  const r = withPlayers(4);
  const [a, b, c, d] = r.players;
  a.score = 900; a.correctMs = 3000;
  b.score = 900; b.correctMs = 2000;
  c.score = 900; c.correctMs = 2000;
  d.score = 1200;
  expect(leaderboard(r).map(p => p.name)).toEqual(['P4', 'P2', 'P3', 'P1']);
});

test('leaderboard excludes kicked players', () => {
  const r = withPlayers(2);
  r.players[0].kicked = true;
  expect(leaderboard(r).length).toBe(1);
});

test('resetForReplay zeroes scores and returns to lobby', () => {
  const r = opened();
  submitAnswer(r, pid(r, 0), 'a', T0 + 4000);
  endQuestion(r, T0 + 5000);
  resetForReplay(r);
  expect(r.phase).toBe('lobby');
  expect(r.qIndex).toBe(-1);
  expect(r.answers.size).toBe(0);
  expect(r.players.length).toBe(2);
  expect(r.players.every(p => p.score === 0 && p.correctMs === 0 && p.lastGain === 0 && p.lateFor === null)).toBe(true);
  expect(r.set?.id).toBe('s');
});
