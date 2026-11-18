import { createRoom, type Room } from './game';
import { HOST_GRACE_MS, MAX_ROOMS, MAX_ROOMS_PER_IP, ROOM_TTL_MS } from './constants';

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';

export class RoomRegistry {
  private rooms = new Map<string, Room>();

  constructor(private rand: () => number = Math.random) {}

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(this.rand() * CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  create(ip: string, now: number): Room | 'SERVER_FULL' | 'IP_LIMIT' {
    if (this.rooms.size >= MAX_ROOMS) return 'SERVER_FULL';
    if (this.all().filter(r => r.hostIp === ip).length >= MAX_ROOMS_PER_IP) return 'IP_LIMIT';
    const room = createRoom(this.newCode(), crypto.randomUUID(), ip, now);
    this.rooms.set(room.code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.trim().toUpperCase());
  }

  findByHostToken(token: string): Room | undefined {
    return this.all().find(r => r.hostToken === token);
  }

  hostLeft(room: Room, now: number): void {
    room.hostLeftAt = now;
  }

  hostBack(room: Room): void {
    room.hostLeftAt = null;
  }

  sweep(now: number): string[] {
    const removed: string[] = [];
    for (const r of this.rooms.values()) {
      const graceOver = r.hostLeftAt !== null && now - r.hostLeftAt >= HOST_GRACE_MS;
      if (graceOver || now - r.createdAt >= ROOM_TTL_MS) {
        this.rooms.delete(r.code);
        removed.push(r.code);
      }
    }
    return removed;
  }

  all(): Room[] {
    return [...this.rooms.values()];
  }
}
