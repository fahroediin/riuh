import { test, expect } from 'bun:test';
import { AnalyticsStore, REVIEWS_PER_IP_PER_HOUR, REVIEWS_PER_HOUR } from '../src/analytics';

test('limits reviews per ip per hour, ignoring user agent', () => {
  const store = new AnalyticsStore(':memory:');
  const now = 1_700_000_000_000;
  const ip = '192.168.1.100';
  for (let i = 0; i < REVIEWS_PER_IP_PER_HOUR; i++) {
    expect(store.recordReview(ip, { rating: 5, comment: `ok ${i}` }, now + i).ok).toBe(true);
  }
  expect(store.recordReview(ip, { rating: 1 }, now + 100)).toEqual({ ok: false, error: 'RATE_LIMIT' });
  // IP lain tetap bisa
  expect(store.recordReview('192.168.1.101', { rating: 4 }, now + 100).ok).toBe(true);
  // satu jam kemudian IP yang sama bisa lagi
  expect(store.recordReview(ip, { rating: 4 }, now + 3_600_001).ok).toBe(true);
  store.close();
});

test('caps total reviews per hour across all ips', () => {
  const store = new AnalyticsStore(':memory:');
  const now = 1_700_000_000_000;
  for (let i = 0; i < REVIEWS_PER_HOUR; i++) {
    expect(store.recordReview(`10.1.${i >> 8}.${i & 255}`, { rating: 3 }, now + i).ok).toBe(true);
  }
  expect(store.recordReview('10.9.9.9', { rating: 3 }, now + 1000)).toEqual({ ok: false, error: 'RATE_LIMIT' });
  store.close();
});

test('validates rating 1 to 5', () => {
  const store = new AnalyticsStore(':memory:');
  const now = Date.now();
  const ip = '10.0.0.1';

  expect(store.recordReview(ip, { rating: 0 }, now).ok).toBe(false);
  expect(store.recordReview(ip, { rating: 6 }, now).ok).toBe(false);
  expect(store.recordReview(ip, { rating: 3.5 }, now).ok).toBe(false);

  expect(store.recordReview(ip, { rating: 3 }, now).ok).toBe(true);

  store.close();
});

test('records quiz sessions and generates heatmap and metrics', () => {
  const store = new AnalyticsStore(':memory:');
  const now = Date.now();

  // Record some reviews
  store.recordReview('1.1.1.1', { rating: 5, comment: 'Bagus', setTitle: 'Pemanasan', lang: 'id' }, now);
  store.recordReview('1.1.1.2', { rating: 4, setTitle: 'Pemanasan', lang: 'id' }, now + 100);
  store.recordReview('1.1.1.3', { rating: 5, setTitle: 'Teknologi & IT', lang: 'en' }, now + 200);

  // Record quiz sessions
  store.recordSession({ roomCode: 'ROOM1', setId: 'pemanasan', setTitle: 'Pemanasan', participants: 15, lang: 'id' }, now);
  store.recordSession({ roomCode: 'ROOM2', setId: 'pemanasan', setTitle: 'Pemanasan', participants: 25, lang: 'id' }, now + 1000);
  store.recordSession({ roomCode: 'ROOM3', setId: 'teknologi-it', setTitle: 'Teknologi & IT', participants: 10, lang: 'en' }, now + 2000);

  const metrics = store.getMetrics();

  // Review stats
  expect(metrics.reviews.total).toBe(3);
  expect(metrics.reviews.averageRating).toBe(4.7);
  expect(metrics.reviews.distribution[5]).toBe(2);
  expect(metrics.reviews.distribution[4]).toBe(1);
  expect(metrics.reviews.distribution[1]).toBe(0);
  expect(metrics.reviews.recent.length).toBe(3);

  // Quiz Heatmap stats
  expect(metrics.heatmap.length).toBe(2);
  const firstHeat = metrics.heatmap[0];
  expect(firstHeat.setId).toBe('pemanasan');
  expect(firstHeat.sessionCount).toBe(2);
  expect(firstHeat.totalParticipants).toBe(40);
  expect(firstHeat.avgParticipants).toBe(20);

  const secondHeat = metrics.heatmap[1];
  expect(secondHeat.setId).toBe('teknologi-it');
  expect(secondHeat.sessionCount).toBe(1);
  expect(secondHeat.totalParticipants).toBe(10);

  // Sessions log
  expect(metrics.sessions.length).toBe(3);

  store.close();
});
