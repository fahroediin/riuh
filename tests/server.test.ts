import { test, expect, afterAll, beforeAll } from 'bun:test';
import { io as connect, type Socket } from 'socket.io-client';
import { startServer } from '../server';

let srv: { port: number; close(): Promise<void> };
const sockets: Socket[] = [];

beforeAll(async () => {
  srv = await startServer({ port: 0, host: '127.0.0.1', publicUrl: 'https://riuh.test', disconnectGraceMs: 1500 });
});
afterAll(async () => {
  sockets.forEach(s => s.close());
  await srv.close();
});

let ipSeq = 0;
function client(): Socket {
  // setiap klien tes punya IP sendiri agar tidak kena batas 3 ruang per IP
  const s = connect(`http://127.0.0.1:${srv.port}`, {
    transports: ['websocket'], forceNew: true, extraHeaders: { 'x-forwarded-for': `10.0.0.${++ipSeq}` },
  });
  sockets.push(s);
  return s;
}
const call = (s: Socket, ev: string, payload?: unknown): Promise<any> =>
  new Promise(res => (payload === undefined ? s.emit(ev, res) : s.emit(ev, payload, res)));
const next = (s: Socket, ev: string, pred: (v: any) => boolean = () => true): Promise<any> =>
  new Promise(res => {
    const h = (v: any) => { if (pred(v)) { s.off(ev, h); res(v); } };
    s.on(ev, h);
  });

test('serves host and player pages', async () => {
  const base = `http://127.0.0.1:${srv.port}`;
  for (const path of ['/', '/host', '/p', '/p/ABCD']) {
    const r = await fetch(base + path);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
  }
  expect((await fetch(base + '/../package.json')).status).toBe(404);
  expect((await fetch(base + '/nothing.css')).status).toBe(404);
});

test('qr endpoint returns svg', async () => {
  const r = await fetch(`http://127.0.0.1:${srv.port}/qr/ABCD.svg`);
  expect(r.status).toBe(200);
  expect(r.headers.get('content-type')).toContain('image/svg+xml');
  expect(await r.text()).toContain('<svg');
});

test('unknown room code', async () => {
  const p = client();
  expect(await call(p, 'player:join', { code: 'ZZZZ', name: 'A' })).toEqual({ ok: false, error: 'NO_ROOM' });
});

test('player cannot drive the host', async () => {
  const host = client();
  const created = await call(host, 'host:create');
  const p = client();
  await call(p, 'player:join', { code: created.code, name: 'A' });
  expect(await call(p, 'host:start')).toEqual({ ok: false, error: 'NOT_HOST' });
});

test('full round over sockets', async () => {
  const host = client();
  const setsP = next(host, 'sets');
  const created = await call(host, 'host:create');
  expect(created.ok).toBe(true);
  expect(created.code).toMatch(/^[A-Z]{4}$/);
  const sets = await setsP;
  expect(sets.length).toBeGreaterThan(0);

  const p1 = client();
  const p2 = client();
  const j1 = await call(p1, 'player:join', { code: created.code.toLowerCase(), name: 'Ani' });
  const j2 = await call(p2, 'player:join', { code: created.code, name: 'Budi' });
  expect(j1.ok && j2.ok).toBe(true);
  expect(JSON.stringify(j1)).not.toContain(created.hostToken);

  expect((await call(host, 'host:selectSet', { setId: sets[0].id })).ok).toBe(true);
  const opened = next(p1, 'player:view', v => v.phase === 'answering');
  expect((await call(host, 'host:start')).ok).toBe(true);
  await opened;

  const result = next(host, 'host:view', v => v.phase === 'result');
  p1.emit('player:answer', { choice: 'a' });
  p2.emit('player:answer', { choice: 'b' });
  const v = await result;
  expect(v.answeredCount).toBe(2);

  // host reconnect keeps the room
  const host2 = client();
  const resumed = await call(host2, 'host:resume', { hostToken: created.hostToken });
  expect(resumed).toEqual({ ok: true, code: created.code });

  // player reconnect with token keeps identity
  const p1b = client();
  const again = await call(p1b, 'player:join', { code: created.code, name: '', token: j1.token });
  expect(again.ok).toBe(true);
  expect(again.playerId).toBe(j1.playerId);
}, 15000);

test('brief disconnect does not end the question for everyone', async () => {
  const host = client();
  const created = await call(host, 'host:create');
  const p1 = client();
  const p2 = client();
  await call(p1, 'player:join', { code: created.code, name: 'Ani' });
  const j2 = await call(p2, 'player:join', { code: created.code, name: 'Budi' });
  const opened = next(p1, 'player:view', v => v.phase === 'answering');
  await call(host, 'host:start');
  await opened;

  p2.close(); // HP tidur / halaman dimuat ulang
  await new Promise(r => setTimeout(r, 200));
  await call(p1, 'player:answer', { choice: 'a' });
  await new Promise(r => setTimeout(r, 500));
  const p2b = client();
  const back = await call(p2b, 'player:join', { code: created.code, name: '', token: j2.token });
  expect(back.ok).toBe(true);
  expect(await call(p2b, 'player:answer', { choice: 'b' })).toEqual({ ok: true });
}, 15000);

test('player gone longer than grace no longer blocks early end', async () => {
  const host = client();
  const created = await call(host, 'host:create');
  const p1 = client();
  const p2 = client();
  await call(p1, 'player:join', { code: created.code, name: 'Ani' });
  await call(p2, 'player:join', { code: created.code, name: 'Budi' });
  const opened = next(p1, 'player:view', v => v.phase === 'answering');
  await call(host, 'host:start');
  await opened;
  await call(p1, 'player:answer', { choice: 'a' });
  const ended = next(host, 'host:view', v => v.phase === 'result');
  p2.close();
  const v = await ended;
  expect(v.phase).toBe('result');
}, 15000);

test('fourth room from one ip is refused', async () => {
  const headers = { 'x-forwarded-for': '10.9.9.9' };
  const make = () => {
    const s = connect(`http://127.0.0.1:${srv.port}`, { transports: ['websocket'], forceNew: true, extraHeaders: headers });
    sockets.push(s);
    return call(s, 'host:create');
  };
  for (let i = 0; i < 3; i++) expect((await make()).ok).toBe(true);
  expect(await make()).toEqual({ ok: false, error: 'IP_LIMIT' });
});

test('stale advance does not skip the result screen', async () => {
  const host = client();
  const created = await call(host, 'host:create');
  const p1 = client();
  await call(p1, 'player:join', { code: created.code, name: 'Ani' });
  const opened = next(host, 'host:view', v => v.phase === 'answering');
  await call(host, 'host:start');
  const v = await opened;
  await call(p1, 'player:answer', { choice: 'a' }); // soal berakhir otomatis -> result
  // host menekan "Akhiri soal sekarang" berdasarkan tampilan lama (answering)
  expect(await call(host, 'host:advance', { phase: 'answering', qNumber: v.qNumber })).toEqual({ ok: false });
  expect(await call(host, 'host:advance', { phase: 'result', qNumber: v.qNumber })).toEqual({ ok: true });
}, 15000);

test('answer carrying token is accepted before the rejoin arrives', async () => {
  const host = client();
  const created = await call(host, 'host:create');
  const p1 = client();
  const p2 = client();
  const j1 = await call(p1, 'player:join', { code: created.code, name: 'Ani' });
  await call(p2, 'player:join', { code: created.code, name: 'Budi' });
  const opened = next(p1, 'player:view', v => v.phase === 'answering');
  await call(host, 'host:start');
  await opened;
  const fresh = client(); // socket baru, belum player:join (tekan saat menyambung ulang)
  expect(await call(fresh, 'player:answer', { choice: 'b', code: created.code, token: j1.token })).toEqual({ ok: true });
  expect(await call(fresh, 'player:answer', { choice: 'a' })).toEqual({ ok: false, error: 'ALREADY' });
}, 15000);
