import { test, expect } from 'bun:test';
import { RoomRegistry, CODE_ALPHABET } from '../src/rooms';
import type { Room } from '../src/game';

const MIN = 60_000;

function mk(reg: RoomRegistry, ip = '1.1.1.1', now = 0): Room {
  const r = reg.create(ip, now);
  if (typeof r === 'string') throw new Error(r);
  return r;
}

test('code uses alphabet without I O L', () => {
  expect(CODE_ALPHABET).not.toMatch(/[IOL]/);
  const reg = new RoomRegistry();
  for (let i = 0; i < 20; i++) {
    const r = mk(reg, `ip${i}`);
    expect(r.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
  }
});

test('codes are unique even when random repeats', () => {
  const seq = [0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5];
  let i = 0;
  const reg = new RoomRegistry(() => seq[i++ % seq.length]);
  const a = mk(reg, 'a');
  const b = mk(reg, 'b');
  expect(a.code).not.toBe(b.code);
});

test('get is case-insensitive', () => {
  const reg = new RoomRegistry();
  const r = mk(reg);
  expect(reg.get(r.code.toLowerCase())).toBe(r);
  expect(reg.get('ZZZZ9')).toBe(undefined);
});

test('host token is unique per room', () => {
  const reg = new RoomRegistry();
  expect(mk(reg, 'a').hostToken).not.toBe(mk(reg, 'b').hostToken);
});

test('21st room gets SERVER_FULL', () => {
  const reg = new RoomRegistry();
  for (let i = 0; i < 20; i++) mk(reg, `ip${i}`);
  expect(reg.create('baru', 0)).toBe('SERVER_FULL');
});

test('4th room from same ip gets IP_LIMIT', () => {
  const reg = new RoomRegistry();
  for (let i = 0; i < 3; i++) mk(reg, 'sama');
  expect(reg.create('sama', 0)).toBe('IP_LIMIT');
  expect(typeof reg.create('lain', 0)).toBe('object');
});

test('findByHostToken', () => {
  const reg = new RoomRegistry();
  const r = mk(reg);
  expect(reg.findByHostToken(r.hostToken)).toBe(r);
  expect(reg.findByHostToken('x')).toBe(undefined);
});

test('sweep removes after host grace', () => {
  const reg = new RoomRegistry();
  const r = mk(reg);
  reg.hostLeft(r, 0);
  expect(reg.sweep(10 * MIN - 1)).toEqual([]);
  expect(reg.sweep(10 * MIN)).toEqual([r.code]);
  expect(reg.get(r.code)).toBe(undefined);
});

test('hostBack cancels grace', () => {
  const reg = new RoomRegistry();
  const r = mk(reg);
  reg.hostLeft(r, 0);
  reg.hostBack(r);
  expect(reg.sweep(30 * MIN)).toEqual([]);
});

test('sweep removes after ttl', () => {
  const reg = new RoomRegistry();
  const r = mk(reg, 'x', 0);
  expect(reg.sweep(180 * MIN - 1)).toEqual([]);
  expect(reg.sweep(180 * MIN)).toEqual([r.code]);
});

test('removed rooms free ip quota', () => {
  const reg = new RoomRegistry();
  const rooms = [mk(reg, 'sama'), mk(reg, 'sama'), mk(reg, 'sama')];
  reg.hostLeft(rooms[0], 0);
  reg.sweep(10 * MIN);
  expect(typeof reg.create('sama', 10 * MIN)).toBe('object');
});
