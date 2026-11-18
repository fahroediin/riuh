import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { VisitCounter, isBot } from '../src/visits';

const UA = 'Mozilla/5.0 (Linux; Android 12) Chrome/120 Mobile';
const DAY = Date.UTC(2026, 10, 18, 9);
const NEXT_DAY = DAY + 24 * 3600 * 1000;

test('same device counts once per day', () => {
  const v = new VisitCounter(':memory:');
  v.record('1.1.1.1', UA, DAY);
  v.record('1.1.1.1', UA, DAY + 3600_000);
  expect(v.total()).toBe(1);
});

test('different device or next day counts again', () => {
  const v = new VisitCounter(':memory:');
  v.record('1.1.1.1', UA, DAY);
  v.record('2.2.2.2', UA, DAY);
  v.record('1.1.1.1', UA + ' X', DAY);
  v.record('1.1.1.1', UA, NEXT_DAY);
  expect(v.total()).toBe(4);
});

test('bots and empty user agents are not counted', () => {
  const v = new VisitCounter(':memory:');
  for (const ua of ['', 'Googlebot/2.1', 'curl/8.4.0', 'facebookexternalhit/1.1', 'python-requests/2.31', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'HeadlessChrome/120']) {
    v.record('1.1.1.1', ua, DAY);
  }
  expect(v.total()).toBe(0);
  expect(isBot(UA)).toBe(false);
});

test('raw ip is never stored', () => {
  const file = `${require('node:os').tmpdir()}/riuh-visits-${Date.now()}.db`;
  const v = new VisitCounter(file);
  v.record('203.0.113.77', UA, DAY);
  v.close();
  const db = new Database(file);
  const dump = JSON.stringify(db.query('SELECT * FROM visits').all());
  expect(dump).not.toContain('203.0.113.77');
  expect(dump).toContain('2026-11-18');
  db.close();
});

test('salt persists across restarts so counts stay unique', () => {
  const file = `${require('node:os').tmpdir()}/riuh-visits-salt-${Date.now()}.db`;
  const a = new VisitCounter(file);
  a.record('1.1.1.1', UA, DAY);
  a.close();
  const b = new VisitCounter(file);
  b.record('1.1.1.1', UA, DAY);
  expect(b.total()).toBe(1);
  b.close();
});

test('hostile input is stored safely', () => {
  const v = new VisitCounter(':memory:');
  v.record("1.1.1.1'); DROP TABLE visits;--", "x'); DELETE FROM visits;-- Mozilla", DAY);
  v.record('2.2.2.2', UA, DAY);
  expect(v.total()).toBe(2);
});
