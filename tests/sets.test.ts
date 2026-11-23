import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateSet, loadSets } from '../src/sets';

const valid = {
  title: 'Contoh',
  questions: [
    { type: 'pick', text: 'Kopi atau teh?', a: 'Kopi', b: 'Teh' },
    { type: 'tf', text: 'Bumi bulat.', answer: true, time: 15 },
  ],
};

function bad(mut: (s: any) => void) {
  const s = structuredClone(valid) as any;
  mut(s);
  const r = validateSet(s, 'x');
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.errors.length).toBeGreaterThan(0);
}

test('valid mixed set', () => {
  const r = validateSet(valid, 'contoh');
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.set.id).toBe('contoh');
  expect(r.set.questions[0].timeSec).toBe(10);
  expect(r.set.questions[0].answer).toBe(null);
  expect(r.set.questions[1].answer).toBe('a');
  expect(r.set.questions[1].a).toBe('Benar');
  expect(r.set.questions[1].b).toBe('Salah');
  expect(r.set.questions[1].timeSec).toBe(15);
});
test('tf false answer maps to b', () => {
  const s = structuredClone(valid) as any; s.questions[1].answer = false;
  const r = validateSet(s, 'x');
  expect(r.ok && r.set.questions[1].answer).toBe('b');
});
test('tf without answer is invalid', () => bad(s => delete s.questions[1].answer));
test('pick without b is invalid', () => bad(s => delete s.questions[0].b));
test('time 4 is invalid', () => bad(s => (s.questions[1].time = 4)));
test('time 31 is invalid', () => bad(s => (s.questions[1].time = 31)));
test('empty questions is invalid', () => bad(s => (s.questions = [])));
test('missing title is invalid', () => bad(s => delete s.title));
test('unknown type is invalid', () => bad(s => (s.questions[0].type = 'multi')));
test('empty text is invalid', () => bad(s => (s.questions[0].text = '  ')));
test('non-object is invalid', () => {
  expect(validateSet(null, 'x').ok).toBe(false);
  expect(validateSet('abc', 'x').ok).toBe(false);
});

test('loadSets skips invalid files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'riuh-'));
  writeFileSync(join(dir, 'ok.json'), JSON.stringify(valid));
  writeFileSync(join(dir, 'rusak.json'), '{ not json');
  writeFileSync(join(dir, 'salah.json'), JSON.stringify({ title: 'x', questions: [] }));
  const sets = loadSets(dir);
  expect(sets.length).toBe(1);
  expect(sets[0].id).toBe('ok');
});

test('loadSets accepts a UTF-8 BOM', () => {
  const dir = mkdtempSync(join(tmpdir(), 'riuh-'));
  writeFileSync(join(dir, 'bom.json'), '﻿' + JSON.stringify(valid));
  expect(loadSets(dir).length).toBe(1);
});

test('loadSets returns empty list when folder is missing', () => {
  expect(loadSets(join(tmpdir(), 'riuh-tidak-ada-' + Date.now()))).toEqual([]);
});

test('built-in sets: all sets have 10 questions each', () => {
  const sets = loadSets(join(import.meta.dir, '..', 'sets', 'id'));
  expect(sets.map(s => [s.title, s.questions.length])).toEqual([
    ['DevOps & Server', 10],
    ['Dunia Kerja', 10],
    ['Fakta Unik', 10],
    ['Keseharian Developer', 10],
    ['Klien & Requirement', 10],
    ['Pemanasan', 10],
    ['Proyek & Produk', 10],
    ['Teknologi & IT', 10],
  ]);
  const fakta = sets.find(s => s.title === 'Fakta Unik')!;
  expect(fakta.questions.every(q => q.type === 'tf')).toBe(true);
  expect(fakta.questions.filter(q => q.answer === 'a').length).toBe(6);
});

test('english built-in sets mirror the indonesian ones', () => {
  const id = loadSets(join(import.meta.dir, '..', 'sets', 'id'));
  const en = loadSets(join(import.meta.dir, '..', 'sets', 'en'));
  expect(en.map(s => s.title).sort()).toEqual([
    'Clients & Requirements',
    'DevOps & Cloud',
    'Developer Life',
    'Fun Facts',
    'Project & Product',
    'Tech & IT',
    'Warm-up',
    'Work Life',
  ]);
  for (const s of id) {
    const twin = en.find(e => e.id === s.id)!;
    expect(twin.questions.length).toBe(s.questions.length);
    expect(twin.questions.map(q => [q.type, q.answer])).toEqual(s.questions.map(q => [q.type, q.answer]));
  }
});
