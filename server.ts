import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname, sep } from 'node:path';
import { Server, type Socket } from 'socket.io';
import QRCode from 'qrcode';
import { RoomRegistry } from './src/rooms';
import { loadSets } from './src/sets';
import {
  joinRoom, kickPlayer, setConnected, selectSet, startGame, tick, submitAnswer, advance,
  resetForReplay, activePlayers, type Room,
} from './src/game';
import { hostView, playerView } from './src/views';
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
}

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
  const sets: QuestionSet[] = loadSets(opts.setsDir ?? join(ROOT, 'sets'));
  const setList = sets.map(s => ({ id: s.id, title: s.title, count: s.questions.length }));
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
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (path === '/' || path === '/host') return sendFile(res, join(PUBLIC, 'host.html'));
    if (path === '/p' || /^\/p\/[A-Za-z]{4}$/.test(path)) return sendFile(res, join(PUBLIC, 'play.html'));
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
  const io = new Server(http, { cors: { origin: false } });

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
      socket.emit('sets', setList);
      broadcast(room);
    }

    socket.on('host:create', (...args: unknown[]) => {
      const ack = ackOf(...args);
      const room = registry.create(clientIp(socket), Date.now());
      if (typeof room === 'string') return ack({ ok: false, error: room });
      if (sets[0]) selectSet(room, sets[0]);
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

    hostAction('host:selectSet', (room, p) => {
      const set = sets.find(s => s.id === p.setId);
      if (!set || room.phase !== 'lobby') return false;
      selectSet(room, set);
      return true;
    });
    hostAction('host:start', room => startGame(room, Date.now()));
    hostAction('host:advance', room => advance(room, Date.now()));
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

    socket.on('player:join', (...args: unknown[]) => {
      const ack = ackOf(...args);
      const p = payloadOf(args);
      const room = typeof p.code === 'string' ? registry.get(p.code) : undefined;
      if (!room) return ack({ ok: false, error: 'NO_ROOM' });
      const name = typeof p.name === 'string' ? p.name : '';
      const token = typeof p.token === 'string' ? p.token : undefined;
      const res = joinRoom(room, name, token);
      if (!res.ok) return ack(res);
      socket.join(`player:${res.player.id}`);
      socket.data = { role: 'player', code: room.code, playerId: res.player.id } satisfies SocketData;
      ack({ ok: true, token: res.player.token, playerId: res.player.id, code: room.code });
      broadcast(room);
    });

    socket.on('player:answer', (...args: unknown[]) => {
      const ack = ackOf(...args);
      const d = data();
      if (d.role !== 'player') return ack({ ok: false, error: 'NOT_PLAYER' });
      const choice = payloadOf(args).choice;
      const room = registry.get(d.code);
      if (!room || (choice !== 'a' && choice !== 'b')) return ack({ ok: false, error: 'BAD_REQUEST' });
      const res = submitAnswer(room, d.playerId, choice, Date.now());
      ack(res);
      if (res.ok) broadcast(room);
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
    for (const code of registry.sweep(Date.now())) io.to(`host:${code}`).emit('room:closed');
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
