import { test, expect } from 'bun:test';
import { AnalyticsStore } from '../src/analytics';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

test('records reviews and enforces 30-day throttle per ip/ua', () => {
  const store = new AnalyticsStore(':memory:');
  const now = Date.now();
  const ip = '192.168.1.100';
  const ua = 'Mozilla/5.0 Mobile';

  expect(store.canReview(ip, ua, now)).toBe(true);

  const res1 = store.recordReview(ip, ua, {
    rating: 5,
    comment: 'Sangat seru untuk ice breaking!',
    roomCode: 'ABCD',
    setTitle: 'Teknologi & IT',
    lang: 'id',
  }, now);
  expect(res1.ok).toBe(true);

  // Immediately checking again should be throttled
  expect(store.canReview(ip, ua, now + 1000)).toBe(false);
  const resDuplicate = store.recordReview(ip, ua, { rating: 4 }, now + 1000);
  expect(resDuplicate.ok).toBe(false);
  expect(resDuplicate.error).toBe('RATE_LIMIT');

  // Different IP on same device can review
  expect(store.canReview('192.168.1.101', ua, now + 1000)).toBe(true);

  // Same IP after 30 days can review again
  const future = now + THIRTY_DAYS_MS + 1000;
  expect(store.canReview(ip, ua, future)).toBe(true);
  const resFuture = store.recordReview(ip, ua, { rating: 4, comment: 'Main lagi bulan depan' }, future);
  expect(resFuture.ok).toBe(true);

  store.close();
});

test('validates rating 1 to 5', () => {
  const store = new AnalyticsStore(':memory:');
  const now = Date.now();
  const ip = '10.0.0.1';
  const ua = 'Chrome';

  expect(store.recordReview(ip, ua, { rating: 0 }, now).ok).toBe(false);
  expect(store.recordReview(ip, ua, { rating: 6 }, now).ok).toBe(false);
  expect(store.recordReview(ip, ua, { rating: 3.5 }, now).ok).toBe(false);

  expect(store.recordReview(ip, ua, { rating: 3 }, now).ok).toBe(true);

  store.close();
});

test('records quiz sessions and generates heatmap and metrics', () => {
  const store = new AnalyticsStore(':memory:');
  const now = Date.now();

  // Record some reviews
  store.recordReview('1.1.1.1', 'UA1', { rating: 5, comment: 'Bagus', setTitle: 'Pemanasan', lang: 'id' }, now);
  store.recordReview('1.1.1.2', 'UA2', { rating: 4, setTitle: 'Pemanasan', lang: 'id' }, now + 100);
  store.recordReview('1.1.1.3', 'UA3', { rating: 5, setTitle: 'Teknologi & IT', lang: 'en' }, now + 200);

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
