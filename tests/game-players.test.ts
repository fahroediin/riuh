import { test, expect } from 'bun:test';
import { joinRoom, kickPlayer, setConnected } from '../src/game';
import { room } from './helpers';

test('trims and caps name at 16', () => {
  const r = room();
  const j = joinRoom(r, '   Abcdefghijklmnopqrstu  ');
  expect(j.ok && j.player.name).toBe('Abcdefghijklmnop');
});

test('empty name rejected', () => {
  const j = joinRoom(room(), '   ');
  expect(j).toEqual({ ok: false, error: 'NAME_EMPTY' });
});

test('duplicate names get suffix', () => {
  const r = room();
  const names = ['Budi', 'budi', 'Budi'].map(n => { const j = joinRoom(r, n); return j.ok ? j.player.name : ''; });
  expect(names).toEqual(['Budi', 'budi 2', 'Budi 3']);
});

test('join order increments', () => {
  const r = room();
  joinRoom(r, 'A'); joinRoom(r, 'B');
  expect(r.players.map(p => p.joinOrder)).toEqual([1, 2]);
});

test('61st player gets FULL', () => {
  const r = room();
  for (let i = 0; i < 60; i++) expect(joinRoom(r, `P${i}`).ok).toBe(true);
  expect(joinRoom(r, 'X')).toEqual({ ok: false, error: 'FULL' });
});

test('rejoin keeps score and current answer', () => {
  const r = room();
  const j = joinRoom(r, 'Ani');
  if (!j.ok) throw new Error();
  j.player.score = 700;
  r.answers.set(j.player.id, { choice: 'a', ms: 1200 });
  setConnected(r, j.player.id, false);
  const again = joinRoom(r, 'Nama Lain', j.player.token);
  expect(again.ok).toBe(true);
  if (!again.ok) return;
  expect(again.rejoined).toBe(true);
  expect(again.player).toBe(j.player);
  expect(again.player.name).toBe('Ani');
  expect(again.player.score).toBe(700);
  expect(again.player.connected).toBe(true);
  expect(r.answers.get(j.player.id)).toEqual({ choice: 'a', ms: 1200 });
  expect(r.players.length).toBe(1);
});

test('rejoin allowed even when room is full', () => {
  const r = room();
  const first = joinRoom(r, 'Ani');
  for (let i = 0; i < 59; i++) joinRoom(r, `P${i}`);
  expect(first.ok && joinRoom(r, 'x', first.player.token).ok).toBe(true);
});

test('unknown token joins as new player', () => {
  const r = room();
  const j = joinRoom(r, 'Ani', 'tidak-ada');
  expect(j.ok && j.rejoined).toBe(false);
});

test('kicked token rejected', () => {
  const r = room();
  const j = joinRoom(r, 'Iseng');
  if (!j.ok) throw new Error();
  kickPlayer(r, j.player.id);
  expect(j.player.kicked).toBe(true);
  expect(joinRoom(r, 'Iseng', j.player.token)).toEqual({ ok: false, error: 'KICKED' });
});

test('kicked players free up a slot', () => {
  const r = room();
  const first = joinRoom(r, 'A');
  for (let i = 0; i < 59; i++) joinRoom(r, `P${i}`);
  if (!first.ok) throw new Error();
  kickPlayer(r, first.player.id);
  expect(joinRoom(r, 'Baru').ok).toBe(true);
});

test('kick ignored outside lobby', () => {
  const r = room();
  const j = joinRoom(r, 'A');
  if (!j.ok) throw new Error();
  r.phase = 'answering';
  kickPlayer(r, j.player.id);
  expect(j.player.kicked).toBe(false);
});
