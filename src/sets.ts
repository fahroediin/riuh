import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { Question, QuestionSet } from './types';
import { DEFAULT_TIME_SEC, MIN_TIME_SEC, MAX_TIME_SEC } from './constants';

type Result = { ok: true; set: QuestionSet } | { ok: false; errors: string[] };

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

export function validateSet(raw: unknown, id: string): Result {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['set harus berupa objek'] };
  const r = raw as Record<string, unknown>;
  if (!isText(r.title)) errors.push('title wajib diisi');
  if (!Array.isArray(r.questions) || r.questions.length === 0) {
    errors.push('questions wajib berisi minimal satu soal');
    return { ok: false, errors };
  }
  const questions: Question[] = [];
  r.questions.forEach((q: any, i: number) => {
    const at = `soal ${i + 1}`;
    if (!q || typeof q !== 'object') { errors.push(`${at}: harus objek`); return; }
    if (!isText(q.text)) errors.push(`${at}: text wajib`);
    let timeSec = DEFAULT_TIME_SEC;
    if (q.time !== undefined) {
      if (!Number.isInteger(q.time) || q.time < MIN_TIME_SEC || q.time > MAX_TIME_SEC) {
        errors.push(`${at}: time harus ${MIN_TIME_SEC} sampai ${MAX_TIME_SEC}`);
      } else timeSec = q.time;
    }
    if (q.type === 'tf') {
      if (typeof q.answer !== 'boolean') errors.push(`${at}: answer wajib true/false`);
      questions.push({ type: 'tf', text: String(q.text ?? '').trim(), a: 'Benar', b: 'Salah', answer: q.answer ? 'a' : 'b', timeSec });
    } else if (q.type === 'pick') {
      if (!isText(q.a) || !isText(q.b)) errors.push(`${at}: a dan b wajib`);
      questions.push({ type: 'pick', text: String(q.text ?? '').trim(), a: String(q.a ?? '').trim(), b: String(q.b ?? '').trim(), answer: null, timeSec });
    } else {
      errors.push(`${at}: type harus tf atau pick`);
    }
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, set: { id, title: (r.title as string).trim(), questions } };
}

export function loadSets(dir: string): QuestionSet[] {
  const sets: QuestionSet[] = [];
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const id = basename(file, '.json');
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch (e) {
      console.warn(`[sets] ${file}: JSON tidak valid`);
      continue;
    }
    const r = validateSet(raw, id);
    if (r.ok) sets.push(r.set);
    else console.warn(`[sets] ${file}: ${r.errors.join('; ')}`);
  }
  return sets.sort((x, y) => x.title.localeCompare(y.title));
}
