import ExcelJS from 'exceljs';
import type { QuestionSet } from './types';
import { validateSet } from './sets';
import { DEFAULT_TIME_SEC, MAX_TIME_SEC, MIN_TIME_SEC } from './constants';

export const MAX_UPLOAD_QUESTIONS = 50;
const FIRST_DATA_ROW = 4; // nomor baris Excel
const HEADERS = ['Jenis', 'Pertanyaan', 'Pilihan A', 'Pilihan B', 'Jawaban', 'Waktu (detik)'];
const KIND_PICK = 'Pilih Satu';
const KIND_TF = 'Benar/Salah';

type Cell = string | number | null;
type Result = { ok: true; set: QuestionSet } | { ok: false; errors: string[] };

const text = (v: unknown) => (v == null ? '' : String(v).trim());
const key = (v: unknown) => text(v).toLowerCase().replace(/[\s/]+/g, '');

function kindOf(v: unknown): 'pick' | 'tf' | null {
  const k = key(v);
  if (k === 'pilihsatu') return 'pick';
  if (k === 'benarsalah') return 'tf';
  return null;
}

function timeOf(v: unknown): number | null | 'bad' {
  if (text(v) === '') return null;
  const n = typeof v === 'number' ? v : Number(text(v).replace(',', '.'));
  return Number.isInteger(n) && n >= MIN_TIME_SEC && n <= MAX_TIME_SEC ? n : 'bad';
}

/** rows[i] = baris Excel ke-(i+1), kolom A = indeks 0. */
export function rowsToSet(rows: unknown[][], fileName: string, id: string): Result {
  const data: { line: number; cells: unknown[] }[] = [];
  for (let i = FIRST_DATA_ROW - 1; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    if (cells.slice(0, 6).some(c => text(c) !== '')) data.push({ line: i + 1, cells });
  }
  if (data.length === 0) return { ok: false, errors: [`Belum ada soal. Isi mulai baris ${FIRST_DATA_ROW}.`] };
  if (data.length > MAX_UPLOAD_QUESTIONS) return { ok: false, errors: [`Maksimal ${MAX_UPLOAD_QUESTIONS} soal per file`] };

  const errors: string[] = [];
  const questions: Record<string, unknown>[] = [];
  for (const { line, cells } of data) {
    const [kindCell, qCell, aCell, bCell, ansCell, timeCell] = cells;
    const at = `Baris ${line}`;
    const kind = kindOf(kindCell);
    if (!kind) { errors.push(`${at}: kolom Jenis harus ${KIND_PICK} atau ${KIND_TF}`); continue; }
    if (!text(qCell)) errors.push(`${at}: Pertanyaan wajib diisi`);
    const q: Record<string, unknown> = { type: kind, text: text(qCell) };
    if (kind === 'pick') {
      if (!text(aCell) || !text(bCell)) errors.push(`${at}: Pilihan A dan Pilihan B wajib diisi untuk ${KIND_PICK}`);
      q.a = text(aCell);
      q.b = text(bCell);
    } else {
      const ans = key(ansCell);
      if (ans !== 'benar' && ans !== 'salah') errors.push(`${at}: kolom Jawaban harus Benar atau Salah`);
      q.answer = ans === 'benar';
    }
    const t = timeOf(timeCell);
    if (t === 'bad') errors.push(`${at}: Waktu harus angka ${MIN_TIME_SEC} sampai ${MAX_TIME_SEC}`);
    else if (t !== null) q.time = t;
    questions.push(q);
  }
  if (errors.length) return { ok: false, errors };

  const title = text(rows[0]?.[1]) || fileName.replace(/\.xlsx$/i, '').trim() || 'Soal upload';
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

export async function xlsxToSet(buf: Buffer | ArrayBuffer, fileName: string, id: string): Promise<Result> {
  let rows: Cell[][];
  try {
    rows = await readXlsxRows(buf);
  } catch {
    return { ok: false, errors: ['File bukan Excel (.xlsx) atau rusak'] };
  }
  return rowsToSet(rows, fileName, id);
}

export async function buildTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Soal', { views: [{ state: 'frozen', ySplit: 3 }] });
  ws.columns = [{ width: 16 }, { width: 52 }, { width: 22 }, { width: 22 }, { width: 12 }, { width: 15 }];
  ws.getCell('A1').value = 'Judul set';
  ws.getCell('A1').font = { bold: true };
  ws.getCell('B1').value = 'Pemanasan Rapat';
  ws.getRow(3).values = HEADERS;
  ws.getRow(3).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(3).eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF141414' } }; });
  ws.getRow(4).values = [KIND_PICK, 'Pagi-pagi lebih pilih yang mana?', 'Kopi', 'Teh', '', ''];
  ws.getRow(5).values = [KIND_TF, 'Gurita punya tiga jantung.', '', '', 'Benar', 12];

  const last = FIRST_DATA_ROW + 199;
  for (let r = FIRST_DATA_ROW; r <= last; r++) {
    ws.getCell(`A${r}`).dataValidation = {
      type: 'list', allowBlank: true, formulae: [`"${KIND_PICK},${KIND_TF}"`],
      showErrorMessage: true, errorTitle: 'Jenis', error: `Pilih ${KIND_PICK} atau ${KIND_TF}`,
    };
    ws.getCell(`E${r}`).dataValidation = {
      type: 'list', allowBlank: true, formulae: ['"Benar,Salah"'],
      showErrorMessage: true, errorTitle: 'Jawaban', error: 'Pilih Benar atau Salah (hanya untuk soal Benar/Salah)',
    };
    ws.getCell(`F${r}`).dataValidation = {
      type: 'whole', operator: 'between', allowBlank: true, formulae: [MIN_TIME_SEC, MAX_TIME_SEC],
      showErrorMessage: true, errorTitle: 'Waktu', error: `Isi angka ${MIN_TIME_SEC} sampai ${MAX_TIME_SEC}, atau kosongkan`,
    };
  }

  const help = wb.addWorksheet('Petunjuk');
  help.getColumn(1).width = 100;
  [
    'Cara mengisi soal Riuh',
    '',
    `1. Tulis judul set di sheet Soal, sel B1. Judul ini tampil di layar presenter.`,
    `2. Isi soal mulai baris ${FIRST_DATA_ROW}, satu baris satu soal. Dua baris contoh boleh ditimpa atau dihapus.`,
    `3. Jenis "${KIND_PICK}": soal tanpa jawaban benar, misalnya "Kopi atau teh?". Isi Pilihan A dan Pilihan B, kosongkan Jawaban.`,
    `4. Jenis "${KIND_TF}": pernyataan yang dinilai. Isi Jawaban dengan Benar atau Salah, Pilihan A dan B dikosongkan.`,
    `5. Waktu boleh dikosongkan (${DEFAULT_TIME_SEC} detik). Bila diisi, angka ${MIN_TIME_SEC} sampai ${MAX_TIME_SEC}.`,
    `6. Maksimal ${MAX_UPLOAD_QUESTIONS} soal. Simpan sebagai .xlsx (dari Google Sheets: File > Download > Microsoft Excel).`,
    '7. Di layar presenter, tekan "Upload soal (.xlsx)" saat masih di lobi.',
  ].forEach((line, i) => {
    help.getCell(`A${i + 1}`).value = line;
    if (i === 0) help.getCell('A1').font = { bold: true, size: 14 };
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
