import { test, expect } from 'bun:test';
import { addCustomSet, nextUploadId } from '../src/game';
import { room, SET } from './helpers';

const set = (title: string, id = 'x') => ({ ...SET, id, title });

test('adds uploaded set and gives ids', () => {
  const r = room();
  expect(nextUploadId(r)).toBe('upload-1');
  expect(addCustomSet(r, set('A', nextUploadId(r)))).toEqual({ ok: true, id: 'upload-1' });
  expect(nextUploadId(r)).toBe('upload-2');
  expect(r.customSets.map(s => s.title)).toEqual(['A']);
});

test('same title replaces previous upload and keeps its id', () => {
  const r = room();
  addCustomSet(r, set('Rapat', 'upload-1'));
  const res = addCustomSet(r, set(' rapat ', 'upload-2'));
  expect(res).toEqual({ ok: true, id: 'upload-1' });
  expect(r.customSets.length).toBe(1);
  expect(r.customSets[0].title).toBe(' rapat ');
});

test('replacing the selected set refreshes the selection', () => {
  const r = room();
  addCustomSet(r, set('Rapat', 'upload-1'));
  r.set = r.customSets[0];
  addCustomSet(r, { ...set('Rapat', 'upload-2'), questions: [SET.questions[1]] });
  expect(r.set.questions.length).toBe(1);
});

test('sixth upload is refused', () => {
  const r = room();
  for (let i = 0; i < 5; i++) addCustomSet(r, set(`S${i}`, nextUploadId(r)));
  expect(addCustomSet(r, set('S5', nextUploadId(r)))).toEqual({ ok: false, error: 'TOO_MANY' });
});
