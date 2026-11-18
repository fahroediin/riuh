import ExcelJS from 'exceljs';
import type { QuestionSet } from './types';
import { validateSet } from './sets';
import { DEFAULT_TIME_SEC, MAX_TIME_SEC, MIN_TIME_SEC } from './constants';
import { T, type Lang } from './i18n';

export const MAX_UPLOAD_QUESTIONS = 50;
const FIRST_DATA_ROW = 4; // nomor baris Excel

type Cell = string | number | null;
type Result = { ok: true; set: QuestionSet } | { ok: false; errors: string[] };

const text = (v: unknown) => (v == null ? '' : String(v).trim());
const key = (v: unknown) => text(v).toLowerCase().replace(/[\s/]+/g, '');

function kindOf(v: unknown): 'pick' | 'tf' | null {
  const k = key(v);
  // kedua bahasa diterima, apa pun bahasa ruangnya
  if (k === 'pilihsatu' || k === 'pickone') return 'pick';
  if (k === 'benarsalah' || k === 'truefalse') return 'tf';
  return null;
}

function timeOf(v: unknown): number | null | 'bad' {
  if (text(v) === '') return null;
  const n = typeof v === 'number' ? v : Number(text(v).replace(',', '.'));
  return Number.isInteger(n) && n >= MIN_TIME_SEC && n <= MAX_TIME_SEC ? n : 'bad';
}

/** rows[i] = baris Excel ke-(i+1), kolom A = indeks 0. */
export function rowsToSet(rows: unknown[][], fileName: string, id: string, lang: Lang = 'id'): Result {
  const t = T[lang];
  const data: { line: number; cells: unknown[] }[] = [];
  for (let i = FIRST_DATA_ROW - 1; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    if (cells.slice(0, 6).some(c => text(c) !== '')) data.push({ line: i + 1, cells });
  }
  if (data.length === 0) return { ok: false, errors: [t.errEmpty(FIRST_DATA_ROW)] };
  if (data.length > MAX_UPLOAD_QUESTIONS) return { ok: false, errors: [t.errMax(MAX_UPLOAD_QUESTIONS)] };

  const errors: string[] = [];
  const questions: Record<string, unknown>[] = [];
  for (const { line, cells } of data) {
    const [kindCell, qCell, aCell, bCell, ansCell, timeCell] = cells;
    const at = t.row(line);
    const kind = kindOf(kindCell);
    if (!kind) { errors.push(`${at}: ${t.errKind}`); continue; }
    if (!text(qCell)) errors.push(`${at}: ${t.errText}`);
    const q: Record<string, unknown> = { type: kind, text: text(qCell) };
    if (kind === 'pick') {
      if (!text(aCell) || !text(bCell)) errors.push(`${at}: ${t.errPick}`);
      q.a = text(aCell);
      q.b = text(bCell);
    } else {
      const ans = key(ansCell);
      const yes = ans === 'benar' || ans === 'true';
      if (!yes && ans !== 'salah' && ans !== 'false') errors.push(`${at}: ${t.errAnswer}`);
      q.answer = yes;
    }
    const tm = timeOf(timeCell);
    if (tm === 'bad') errors.push(`${at}: ${t.errTime(MIN_TIME_SEC, MAX_TIME_SEC)}`);
    else if (tm !== null) q.time = tm;
    questions.push(q);
  }
  if (errors.length) return { ok: false, errors };

  const title = text(rows[0]?.[1]) || fileName.replace(/\.xlsx$/i, '').trim() || t.fallbackTitle;
  const r = validateSet({ title, questions }, id);
  return r.ok ? r : { ok: false, errors: r.errors };
}

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v == null) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'Benar' : 'Salah';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map(t => t.text).join('');
    if ('result' in v) return cellValue(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text);
  }
  return String(v);
}

export async function readXlsxRows(buf: Buffer | ArrayBuffer): Promise<Cell[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: Cell[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    rows.push(Array.from({ length: 6 }, (_, c) => cellValue(row.getCell(c + 1).value)));
  }
  return rows;
}

export async function xlsxToSet(buf: Buffer | ArrayBuffer, fileName: string, id: string, lang: Lang = 'id'): Promise<Result> {
  let rows: Cell[][];
  try {
    rows = await readXlsxRows(buf);
  } catch {
    return { ok: false, errors: [T[lang].errFile] };
  }
  return rowsToSet(rows, fileName, id, lang);
}

export async function buildTemplate(lang: Lang = 'id'): Promise<Buffer> {
  const t = T[lang];
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(t.sheetQuestions, { views: [{ state: 'frozen', ySplit: 3 }] });
  ws.columns = [{ width: 16 }, { width: 52 }, { width: 22 }, { width: 22 }, { width: 12 }, { width: 15 }];
  ws.getCell('A1').value = t.titleLabel;
  ws.getCell('A1').font = { bold: true };
  ws.getCell('B1').value = t.exampleTitle;
  ws.getRow(3).values = [...t.headers];
  ws.getRow(3).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(3).eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF141414' } }; });
  ws.getRow(4).values = [t.kindPick, ...t.examplePick, '', ''];
  ws.getRow(5).values = [t.kindTf, t.exampleTf, '', '', t.yes, 12];

  const last = FIRST_DATA_ROW + 199;
  for (let r = FIRST_DATA_ROW; r <= last; r++) {
    ws.getCell(`A${r}`).dataValidation = {
      type: 'list', allowBlank: true, formulae: [`"${t.kindPick},${t.kindTf}"`],
      showErrorMessage: true, errorTitle: t.headers[0], error: t.validKind,
    };
    ws.getCell(`E${r}`).dataValidation = {
      type: 'list', allowBlank: true, formulae: [`"${t.yes},${t.no}"`],
      showErrorMessage: true, errorTitle: t.headers[4], error: t.validAnswer,
    };
    ws.getCell(`F${r}`).dataValidation = {
      type: 'whole', operator: 'between', allowBlank: true, formulae: [MIN_TIME_SEC, MAX_TIME_SEC],
      showErrorMessage: true, errorTitle: t.headers[5], error: t.validTime(MIN_TIME_SEC, MAX_TIME_SEC),
    };
  }

  const help = wb.addWorksheet(t.sheetGuide);
  help.getColumn(1).width = 110;
  t.guide(FIRST_DATA_ROW, DEFAULT_TIME_SEC, MIN_TIME_SEC, MAX_TIME_SEC, MAX_UPLOAD_QUESTIONS).forEach((line, i) => {
    help.getCell(`A${i + 1}`).value = line;
    if (i === 0) help.getCell('A1').font = { bold: true, size: 14 };
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
