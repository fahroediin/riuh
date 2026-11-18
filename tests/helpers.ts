import { createRoom, joinRoom, type Room } from '../src/game';
import type { QuestionSet } from '../src/types';

export function room(now = 0): Room {
  return createRoom('ABCD', 'host-token', '1.1.1.1', now);
}

export function withPlayers(n: number, now = 0): Room {
  const r = room(now);
  for (let i = 0; i < n; i++) joinRoom(r, `P${i + 1}`);
  return r;
}

export const SET: QuestionSet = {
  id: 's', title: 'S',
  questions: [
    { type: 'tf', text: 'T1', a: 'Benar', b: 'Salah', answer: 'a', timeSec: 10 },
    { type: 'pick', text: 'P1', a: 'Kopi', b: 'Teh', answer: null, timeSec: 10 },
    { type: 'tf', text: 'T2', a: 'Benar', b: 'Salah', answer: 'b', timeSec: 10 },
  ],
};
