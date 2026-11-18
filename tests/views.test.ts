import { test, expect } from 'bun:test';
import { selectSet, startGame, tick, submitAnswer, endQuestion, advance, joinRoom, type Room } from '../src/game';
import { hostView, playerView } from '../src/views';
import { withPlayers, room, SET } from './helpers';

const T0 = 1_000_000;
const URL = 'https://riuh.test/p/ABCD';

function opened(n = 2, qIndex = 0): Room {
  const r = withPlayers(n);
  selectSet(r, SET);
  startGame(r, T0);
  r.qIndex = qIndex;
  tick(r, T0 + 3000);
  return r;
}

test('host view never contains tokens', () => {
  const r = opened();
  const json = JSON.stringify(hostView(r, T0 + 4000, URL));
  expect(json).not.toContain('host-token');
  for (const p of r.players) expect(json).not.toContain(p.token);
  for (const p of r.players) expect(JSON.stringify(playerView(r, p.id, T0))).not.toContain(p.token);
});

test('lobby host view lists players', () => {
  const r = withPlayers(2);
  r.players[1].connected = false;
  const v = hostView(r, T0, URL);
  expect(v.phase).toBe('lobby');
  expect(v.code).toBe('ABCD');
  expect(v.joinUrl).toBe(URL);
  expect(v.question).toBe(null);
  expect(v.players).toEqual([
    { id: r.players[0].id, name: 'P1', connected: true },
    { id: r.players[1].id, name: 'P2', connected: false },
  ]);
});

test('kicked players hidden from host list', () => {
  const r = withPlayers(2);
  r.players[0].kicked = true;
  expect(hostView(r, T0, URL).players.length).toBe(1);
});

test('correct answer hidden while answering', () => {
  const r = opened();
  const v = hostView(r, T0 + 4000, URL);
  expect(v.correct).toBe(null);
  expect(v.question).toEqual({ type: 'tf', text: 'T1', a: 'Benar', b: 'Salah' });
  expect(v.qNumber).toBe(1);
  expect(v.qTotal).toBe(3);
  expect(v.remainingMs).toBe(9000);
  endQuestion(r, T0 + 5000);
  expect(hostView(r, T0 + 5000, URL).correct).toBe('a');
});

test('answered and active counts', () => {
  const r = opened(3);
  r.players[2].connected = false;
  submitAnswer(r, r.players[0].id, 'a', T0 + 4000);
  const v = hostView(r, T0 + 4000, URL);
  expect(v.answeredCount).toBe(1);
  expect(v.activeCount).toBe(2);
});

test('split caps names at 12', () => {
  const r = opened(15, 1); // soal pick
  r.players.forEach((p, i) => submitAnswer(r, p.id, i < 14 ? 'a' : 'b', T0 + 4000));
  const v = hostView(r, T0 + 4000, URL);
  expect(r.phase).toBe('result');
  expect(v.split?.a).toBe(14);
  expect(v.split?.b).toBe(1);
  expect(v.split?.aNames.length).toBe(12);
  expect(v.split?.aMore).toBe(2);
  expect(v.split?.bNames).toEqual(['P15']);
  expect(v.split?.bMore).toBe(0);
});

test('board shows top 5', () => {
  const r = opened(7);
  r.players.forEach((p, i) => (p.score = i * 100));
  endQuestion(r, T0 + 5000);
  advance(r, T0 + 5000);
  const v = hostView(r, T0 + 5000, URL);
  expect(v.phase).toBe('board');
  expect(v.top.map(t => t.name)).toEqual(['P7', 'P6', 'P5', 'P4', 'P3']);
});

test('end shows full ranking and scored flag', () => {
  const r = opened(4);
  r.phase = 'end';
  const v = hostView(r, T0, URL);
  expect(v.ranking.length).toBe(4);
  expect(v.scored).toBe(true);
  r.set = { id: 'p', title: 'P', questions: [SET.questions[1]] };
  expect(hostView(r, T0, URL).scored).toBe(false);
});

test('player locked during reading', () => {
  const r = withPlayers(1);
  selectSet(r, SET);
  startGame(r, T0);
  const v = playerView(r, r.players[0].id, T0 + 100);
  expect(v.phase).toBe('reading');
  expect(v.locked).toBe(true);
  expect(v.qType).toBe('tf');
  expect(v.labels).toEqual({ a: 'Benar', b: 'Salah' });
});

test('player unlocked when answering, locked after answer', () => {
  const r = opened(2);
  const id = r.players[0].id;
  expect(playerView(r, id, T0 + 3100).locked).toBe(false);
  submitAnswer(r, id, 'b', T0 + 3500);
  const v = playerView(r, id, T0 + 3500);
  expect(v.locked).toBe(true);
  expect(v.myChoice).toBe('b');
});

test('late joiner is locked for current question', () => {
  const r = opened(1);
  const j = joinRoom(r, 'Telat');
  if (!j.ok) throw new Error();
  expect(playerView(r, j.player.id, T0 + 3100).locked).toBe(true);
});

test('player result correct shows gain', () => {
  const r = opened(2);
  submitAnswer(r, r.players[0].id, 'a', T0 + 3000 + 5000);
  submitAnswer(r, r.players[1].id, 'b', T0 + 3000 + 5000);
  const a = playerView(r, r.players[0].id, T0 + 9000);
  expect(a.result).toEqual({ kind: 'correct', gain: 750 });
  expect(a.rank).toBe(1);
  expect(a.total).toBe(2);
  expect(a.score).toBe(750);
  expect(playerView(r, r.players[1].id, T0 + 9000).result).toEqual({ kind: 'wrong' });
});

test('player missed when no answer', () => {
  const r = opened(2);
  submitAnswer(r, r.players[0].id, 'a', T0 + 4000);
  tick(r, T0 + 13000);
  expect(playerView(r, r.players[1].id, T0 + 13000).result).toEqual({ kind: 'missed' });
});

test('pick result percent', () => {
  const r = opened(5, 1);
  r.players.forEach((p, i) => submitAnswer(r, p.id, i < 3 ? 'a' : 'b', T0 + 4000));
  expect(playerView(r, r.players[0].id, T0 + 4000).result).toEqual({ kind: 'pick', percent: 60 });
  expect(playerView(r, r.players[4].id, T0 + 4000).result).toEqual({ kind: 'pick', percent: 40 });
});

test('pick-only set has no rank', () => {
  const r = room();
  joinRoom(r, 'A');
  selectSet(r, { id: 'p', title: 'P', questions: [SET.questions[1]] });
  startGame(r, T0);
  tick(r, T0 + 3000);
  submitAnswer(r, r.players[0].id, 'a', T0 + 3500);
  expect(playerView(r, r.players[0].id, T0 + 3500).rank).toBe(null);
});

test('answered count never exceeds active count after a drop', () => {
  const r = opened(3);
  submitAnswer(r, r.players[0].id, 'a', T0 + 4000);
  submitAnswer(r, r.players[1].id, 'a', T0 + 4000);
  r.players[1].connected = false;
  const v = hostView(r, T0 + 4000, URL);
  expect(v.answeredCount).toBeLessThanOrEqual(v.activeCount);
  expect(v.answeredCount).toBe(1);
  expect(v.activeCount).toBe(2);
});
