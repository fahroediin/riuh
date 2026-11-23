import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname, sep } from 'node:path';
import { Server, type Socket } from 'socket.io';
import QRCode from 'qrcode';
import { RoomRegistry } from './src/rooms';
import { loadSets } from './src/sets';
import {
  joinRoom, kickPlayer, setConnected, selectSet, startGame, tick, submitAnswer, advance,
  resetForReplay, activePlayers, addCustomSet, nextUploadId, type Room,
} from './src/game';
import { hostView, playerView } from './src/views';
import { buildTemplate, xlsxToSet } from './src/xlsx-set';
import { MAX_UPLOAD_BYTES } from './src/constants';
import { VisitCounter } from './src/visits';
import { AnalyticsStore } from './src/analytics';
import { T, isLang, type Lang } from './src/i18n';
import type { QuestionSet } from './src/types';

const ROOT = import.meta.dir;
const PUBLIC = join(ROOT, 'public');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export interface ServerOptions {
  port: number;
  host?: string;
  publicUrl?: string;
  setsDir?: string;
  /** pemain yang terputus tetap dianggap hadir selama ini, agar HP yang tidur sebentar tidak mengakhiri soal */
  disconnectGraceMs?: number;
  /** lokasi database SQLite penghitung pengunjung; ':memory:' untuk tes */
  dbPath?: string;
  visitsCacheMs?: number;
  adminKey?: string;
}

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
};
const VISITS_LIMIT = 30; // permintaan per menit per IP
const PAGE_ROUTES = /^\/(host|admin|p(\/[A-Za-z]{4})?)?$/;

type SocketData =
  | { role: 'host'; code: string }
  | { role: 'player'; code: string; playerId: string }
  | { role?: undefined };

type Ack = (res: unknown) => void;
const noop: Ack = () => {};
const ackOf = (...args: unknown[]): Ack => {
  const last = args[args.length - 1];
  return typeof last === 'function' ? (last as Ack) : noop;
};
const payloadOf = (args: unknown[]): Record<string, unknown> => {
  const first = args[0];
  return first && typeof first === 'object' ? (first as Record<string, unknown>) : {};
};

export async function startServer(opts: ServerOptions): Promise<{ port: number; close(): Promise<void> }> {
  const setsDir = opts.setsDir ?? join(ROOT, 'sets');
  const builtin: Record<Lang, QuestionSet[]> = { id: loadSets(join(setsDir, 'id')), en: loadSets(join(setsDir, 'en')) };
  const setsFor = (room: Room) => [
    ...builtin[room.lang].map(s => ({ id: s.id, title: s.title, count: s.questions.length })),
    ...room.customSets.map(s => ({ id: s.id, title: s.title, count: s.questions.length, custom: true })),
  ];
  const findSet = (room: Room, id: unknown) => [...builtin[room.lang], ...room.customSets].find(s => s.id === id);
  const templates: Partial<Record<Lang, Promise<Buffer>>> = {};
  const visits = new VisitCounter(opts.dbPath ?? join(ROOT, 'data', 'riuh.db'));
  const analytics = new AnalyticsStore(opts.dbPath ?? join(ROOT, 'data', 'riuh.db'));
  const adminKey = opts.adminKey ?? process.env.ADMIN_KEY ?? 'riuh-admin';
  const visitsCacheMs = opts.visitsCacheMs ?? 30_000;
  let visitsCache = { total: 0, at: -Infinity };
  const rate = new Map<string, { n: number; reset: number }>();
  const httpIp = (req: IncomingMessage) => {
    const fwd = req.headers['x-forwarded-for'];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
    return first || req.socket.remoteAddress || '';
  };
  const json = (res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
    res.end(JSON.stringify(body));
  };
  const registry = new RoomRegistry();
  const graceMs = opts.disconnectGraceMs ?? 5000;
  const pendingDrops = new Set<ReturnType<typeof setTimeout>>();
  let publicUrl = opts.publicUrl ?? '';
  const joinUrl = (code: string) => `${publicUrl}/p/${code}`;

  async function sendFile(res: ServerResponse, file: string) {
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Tidak ditemukan');
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    let path: string;
    try {
      path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    } catch {
      res.writeHead(400);
      return res.end();
    }
    if (path === '/api/visits') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method' }, { allow: 'GET, HEAD' });
      const ip = httpIp(req);
      const now = Date.now();
      const slot = rate.get(ip);
      if (!slot || now >= slot.reset) rate.set(ip, { n: 1, reset: now + 60_000 });
      else if (++slot.n > VISITS_LIMIT) return json(res, 429, { error: 'rate' }, { 'retry-after': String(Math.ceil((slot.reset - now) / 1000)) });
      if (now - visitsCache.at >= visitsCacheMs) visitsCache = { total: visits.total(), at: now };
      return json(res, 200, { total: visitsCache.total });
    }
    if (path === '/api/admin/metrics') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method' }, { allow: 'GET, HEAD' });
      const qKey = new URL(req.url ?? '/', 'http://x').searchParams.get('key');
      const hKey = req.headers['x-admin-key'];
      const key = qKey || hKey;
      if (key !== adminKey) return json(res, 401, { ok: false, error: 'unauthorized' });
      return json(res, 200, { ok: true, metrics: analytics.getMetrics() });
    }
    if (req.method === 'GET' && PAGE_ROUTES.test(path)) {
      try { visits.record(httpIp(req), String(req.headers['user-agent'] ?? ''), Date.now()); } catch (e) { console.warn('[visits]', e); }
    }
    if (path === '/' || path === '/host') return sendFile(res, join(PUBLIC, 'host.html'));
    if (path === '/admin') return sendFile(res, join(PUBLIC, 'admin.html'));
    if (path === '/p' || /^\/p\/[A-Za-z]{4}$/.test(path)) return sendFile(res, join(PUBLIC, 'play.html'));
    if (path === '/template.xlsx') {
      const q = new URL(req.url ?? '/', 'http://x').searchParams.get('lang');
      const lang: Lang = isLang(q) ? q : 'id';
      const body = await (templates[lang] ??= buildTemplate(lang));
      res.writeHead(200, {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="riuh-template${lang === 'en' ? '-en' : ''}.xlsx"`,
      });
      return res.end(body);
    }
    const qr = path.match(/^\/qr\/([A-Za-z]{4})\.svg$/);
    if (qr) {
      const svg = await QRCode.toString(joinUrl(qr[1].toUpperCase()), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-cache' });
      return res.end(svg);
    }
    const file = normalize(join(PUBLIC, path));
    if (!file.startsWith(PUBLIC + sep)) {
      res.writeHead(404);
      return res.end();
    }
    return sendFile(res, file);
  }

  const http = createServer((req, res) => { handle(req, res).catch(() => { res.writeHead(500); res.end(); }); });
  // batas pesan sedikit di atas batas file agar file 1 MB tetap lolos
  const io = new Server(http, { cors: { origin: false }, maxHttpBufferSize: MAX_UPLOAD_BYTES + 64 * 1024 });

  function broadcast(room: Room) {
    const now = Date.now();
    io.to(`host:${room.code}`).emit('host:view', hostView(room, now, joinUrl(room.code)));
    for (const p of activePlayers(room)) io.to(`player:${p.id}`).emit('player:view', playerView(room, p.id, now));
  }

  const clientIp = (s: Socket) => {
    const fwd = s.handshake.headers['x-forwarded-for'];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
    return first || s.handshake.address;
  };

  io.on('connection', socket => {
    const data = (): SocketData => socket.data as SocketData;

    const hostRoom = (): Room | undefined =>
      { const d = data(); return d.role === 'host' ? registry.get(d.code) : undefined; };

    function attachHost(room: Room) {
      socket.join(`host:${room.code}`);
      socket.data = { role: 'host', code: room.code } satisfies SocketData;
      registry.hostBack(room);
      socket.emit('sets', setsFor(room));
      broadcast(room);
    }

    socket.on('host:create', (...args: unknown[]) => {
      const ack = ackOf(...args);
      const room = registry.create(clientIp(socket), Date.now());
      if (typeof room === 'string') return ack({ ok: false, error: room });
      const wanted = payloadOf(args.slice(0, -1)).lang;
      if (isLang(wanted)) room.lang = wanted;
      // Pemanasan paling cocok untuk membuka rapat; bila tidak ada, set pertama
      const list = builtin[room.lang];
      const first = list.find(x => x.id === 'pemanasan') ?? list[0];
      if (first) selectSet(room, first);
      ack({ ok: true, code: room.code, hostToken: room.hostToken });
      attachHost(room);
    });

    socket.on('host:resume', (...args: unknown[]) => {
      const ack = ackOf(...args);
      const token = payloadOf(args).hostToken;
      const room = typeof token === 'string' ? registry.findByHostToken(token) : undefined;
      if (!room) return ack({ ok: false, error: 'NO_ROOM' });
      ack({ ok: true, code: room.code });
      attachHost(room);
    });

    const hostAction = (event: string, fn: (room: Room, p: Record<string, unknown>) => boolean) => {
      socket.on(event, (...args: unknown[]) => {
        const ack = ackOf(...args);
        const room = hostRoom();
        if (!room) return ack({ ok: false, error: 'NOT_HOST' });
        const ok = fn(room, payloadOf(args));
        ack({ ok });
        if (ok) broadcast(room);
      });
    };

    // Bahasa hanya bisa diganti di lobi. Set bawaan yang terpilih ikut ditukar ke versi bahasa lain.
    hostAction('host:setLang', (room, p) => {
      if (!isLang(p.lang) || room.phase !== 'lobby') return false;
      const selected = room.set?.id;
      room.lang = p.lang;
      const twin = builtin[room.lang].find(s => s.id === selected);
      if (twin) selectSet(room, twin);
      io.to(`host:${room.code}`).emit('sets', setsFor(room));
      return true;
    });

    socket.on('room:info', (...args: unknown[]) => {
      const ack = ackOf(...args);
      const code = payloadOf(args).code;
      const room = typeof code === 'string' ? registry.get(code) : undefined;
      ack(room ? { ok: true, lang: room.lang } : { ok: false });
    });

    hostAction('host:selectSet', (room, p) => {
      const set = findSet(room, p.setId);
      if (!set || room.phase !== 'lobby') return false;
      selectSet(room, set);
      return true;
    });
    socket.on('host:uploadSet', async (...args: unknown[]) => {
      const ack = ackOf(...args);
      const room = hostRoom();
      if (!room) return ack({ ok: false, errors: [T.id.errHost] });
      const t = T[room.lang];
      if (room.phase !== 'lobby') return ack({ ok: false, errors: [t.errLobby] });
      const p = payloadOf(args);
      const raw = p.data;
      const buf = Buffer.isBuffer(raw) ? raw
        : raw instanceof ArrayBuffer ? Buffer.from(raw)
        : ArrayBuffer.isView(raw) ? Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength)
        : null;
      if (!buf) return ack({ ok: false, errors: [t.errFile] });
      if (buf.byteLength > MAX_UPLOAD_BYTES) return ack({ ok: false, errors: [t.errSize] });
      const name = typeof p.name === 'string' ? p.name.slice(0, 120) : t.fallbackTitle;
      const parsed = await xlsxToSet(buf, name, nextUploadId(room), room.lang);
      if (!parsed.ok) return ack({ ok: false, errors: parsed.errors });
      const added = addCustomSet(room, parsed.set);
      if (!added.ok) return ack({ ok: false, errors: [t.errTooMany] });
      const set = findSet(room, added.id)!;
      if (room.phase === 'lobby') selectSet(room, set);
      ack({ ok: true, id: set.id, title: set.title, count: set.questions.length });
      io.to(`host:${room.code}`).emit('sets', setsFor(room));
      broadcast(room);
    });

    hostAction('host:start', room => {
      const ok = startGame(room, Date.now());
      if (ok && room.set) {
        try {
          analytics.recordSession({
            roomCode: room.code,
            setId: room.set.id,
            setTitle: room.set.title,
            participants: activePlayers(room).length,
            lang: room.lang,
          }, Date.now());
        } catch (e) {
          console.warn('[analytics]', e);
        }
      }
      return ok;
    });
    // Klien mengirim fase dan nomor soal yang sedang dilihatnya; tombol yang ditekan berdasarkan
    // tampilan lama (soal sudah berakhir otomatis) tidak boleh melompati layar hasil.
    hostAction('host:advance', (room, p) => {
      if (p.phase !== undefined && p.phase !== room.phase) return false;
      if (p.qNumber !== undefined && p.qNumber !== room.qIndex + 1) return false;
      return advance(room, Date.now());
    });
    hostAction('host:replay', room => {
      if (room.phase !== 'end') return false;
      resetForReplay(room);
      return true;
    });
    hostAction('host:kick', (room, p) => {
      const target = room.players.find(x => x.id === p.playerId);
      if (!target || room.phase !== 'lobby') return false;
      kickPlayer(room, target.id);
      io.to(`player:${target.id}`).emit('player:kicked');
      io.in(`player:${target.id}`).socketsLeave(`player:${target.id}`);
      return true;
    });

    function attachPlayer(p: Record<string, unknown>) {
      const room = typeof p.code === 'string' ? registry.get(p.code) : undefined;
      if (!room) return { ok: false as const, error: 'NO_ROOM' as const };
      const name = typeof p.name === 'string' ? p.name : '';
      const token = typeof p.token === 'string' ? p.token : undefined;
      const res = joinRoom(room, name, token);
      if (!res.ok) return res;
      const prev = data();
      if (prev.role === 'player' && prev.playerId !== res.player.id) socket.leave(`player:${prev.playerId}`);
      socket.join(`player:${res.player.id}`);
      socket.data = { role: 'player', code: room.code, playerId: res.player.id } satisfies SocketData;
      return { ok: true as const, room, player: res.player };
    }

    socket.on('player:join', (...args: unknown[]) => {
      const ack = ackOf(...args);
      const res = attachPlayer(payloadOf(args));
      if (!res.ok) return ack(res);
      ack({ ok: true, token: res.player.token, playerId: res.player.id, code: res.room.code });
      broadcast(res.room);
    });

    socket.on('player:answer', (...args: unknown[]) => {
      const ack = ackOf(...args);
      const payload = payloadOf(args);
      // Jawaban yang ditekan saat menyambung ulang bisa tiba sebelum player:join; token ikut dikirim.
      if (data().role !== 'player' && typeof payload.token === 'string') attachPlayer({ ...payload, name: '' });
      const d = data();
      if (d.role !== 'player') return ack({ ok: false, error: 'NOT_PLAYER' });
      const choice = payload.choice;
      const room = registry.get(d.code);
      if (!room || (choice !== 'a' && choice !== 'b')) return ack({ ok: false, error: 'BAD_REQUEST' });
      const res = submitAnswer(room, d.playerId, choice, Date.now());
      ack(res);
      if (res.ok) broadcast(room);
    });

    socket.on('player:review', (...args: unknown[]) => {
      const ack = ackOf(...args);
      const payload = payloadOf(args);
      const rating = Number(payload.rating);
      const comment = typeof payload.comment === 'string' ? payload.comment : '';
      const code = typeof payload.code === 'string' ? payload.code.toUpperCase() : '';
      const room = registry.get(code);
      const setTitle = room?.set?.title ?? (typeof payload.setTitle === 'string' ? payload.setTitle : '');
      const lang = room?.lang ?? (typeof payload.lang === 'string' ? payload.lang : 'id');

      const res = analytics.recordReview(
        clientIp(socket),
        String(socket.handshake.headers['user-agent'] ?? ''),
        { rating, comment, roomCode: code, setTitle, lang },
        Date.now()
      );
      ack(res);
    });

    socket.on('disconnect', async () => {
      const d = data();
      if (!d.role) return;
      const room = registry.get(d.code);
      if (!room) return;
      if (d.role === 'host') {
        const left = await io.in(`host:${room.code}`).fetchSockets();
        if (left.length === 0) registry.hostLeft(room, Date.now());
        return;
      }
      const timer = setTimeout(async () => {
        pendingDrops.delete(timer);
        const left = await io.in(`player:${d.playerId}`).fetchSockets();
        if (left.length > 0) return;
        setConnected(room, d.playerId, false);
        tick(room, Date.now());
        broadcast(room);
      }, graceMs);
      pendingDrops.add(timer);
    });
  });

  let lastCountdown = 0;
  const ticker = setInterval(() => {
    const now = Date.now();
    const countdown = now - lastCountdown >= 1000;
    if (countdown) lastCountdown = now;
    for (const room of registry.all()) {
      if (tick(room, now)) broadcast(room);
      else if (countdown && (room.phase === 'reading' || room.phase === 'answering')) {
        io.to(`host:${room.code}`).emit('host:view', hostView(room, now, joinUrl(room.code)));
      }
    }
  }, 250);
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [ip, slot] of rate) if (now >= slot.reset) rate.delete(ip);
    for (const code of registry.sweep(now)) io.to(`host:${code}`).emit('room:closed');
  }, 60_000);

  await new Promise<void>(res => http.listen(opts.port, opts.host ?? '0.0.0.0', res));
  const addr = http.address();
  const port = typeof addr === 'object' && addr ? addr.port : opts.port;
  if (!publicUrl) publicUrl = `http://localhost:${port}`;

  return {
    port,
    close: () => new Promise<void>(res => {
      clearInterval(ticker);
      clearInterval(sweeper);
      pendingDrops.forEach(clearTimeout);
      visits.close();
      analytics.close();
      io.disconnectSockets(true);
      io.close();
      // Bun's node:http keeps idle keep-alive sockets open; do not wait on them forever.
      http.closeAllConnections?.();
      setTimeout(res, 200);
    }),
  };
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3030);
  const { port: actual } = await startServer({
    port,
    host: process.env.HOST ?? '0.0.0.0',
    publicUrl: process.env.PUBLIC_URL,
  });
  console.log(`Riuh berjalan di http://localhost:${actual}`);
}
