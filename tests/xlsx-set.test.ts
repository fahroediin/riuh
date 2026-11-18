import { test, expect } from 'bun:test';
import ExcelJS from 'exceljs';
import { rowsToSet, readXlsxRows, buildTemplate, xlsxToSet } from '../src/xlsx-set';

const HEAD = ['Jenis', 'Pertanyaan', 'Pilihan A', 'Pilihan B', 'Jawaban', 'Waktu (detik)'];
// rows[0] = baris Excel 1, dst.
const sheet = (title: unknown, ...data: unknown[][]) => [['Judul set', title], [], HEAD, ...data];

test('maps pick and tf rows with loose text', () => {
  const r = rowsToSet(sheet('Rapat Senin',
    ['pilih satu', 'Kopi atau teh?', 'Kopi', 'Teh', '', ''],
    [' BENAR/SALAH ', 'Bumi bulat.', '', '', 'benar ', 15],
    ['Benar Salah', 'Bulan dari keju.', '', '', 'Salah', '']), 'file', 'upload-1');
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.set.id).toBe('upload-1');
  expect(r.set.title).toBe('Rapat Senin');
  expect(r.set.questions.map(q => [q.type, q.answer, q.timeSec])).toEqual([
    ['pick', null, 10], ['tf', 'a', 15], ['tf', 'b', 10],
  ]);
  expect(r.set.questions[0].a).toBe('Kopi');
});

test('title falls back to file name', () => {
  const r = rowsToSet(sheet('', ['Pilih Satu', 'A atau B?', 'A', 'B', '', '']), 'Soal Tim HR', 'upload-1');
  expect(r.ok && r.set.title).toBe('Soal Tim HR');
});

test('blank rows are skipped', () => {
  const r = rowsToSet(sheet('T', ['', '', '', '', '', ''], ['Pilih Satu', 'A atau B?', 'A', 'B', '', ''], [null, null]), 'f', 'u');
  expect(r.ok && r.set.questions.length).toBe(1);
});

test('reports errors per excel row', () => {
  const r = rowsToSet(sheet('T',
    ['Pilih Satu', 'Ok?', 'Ya', 'Tidak', '', ''],             // baris 4
    ['Benar/Salah', 'Langit biru.', '', '', 'Bnar', ''],      // baris 5
    ['Pilih Satu', 'Pilih', 'A', '', '', ''],                 // baris 6
    ['Benar/Salah', 'Cepat', '', '', 'Benar', 'dua'],         // baris 7
    ['Kuis', 'X', '', '', '', ''],                            // baris 8
    ['Pilih Satu', '', 'A', 'B', '', ''],                     // baris 9
    ['Benar/Salah', 'Lama', '', '', 'Benar', 40]), 'f', 'u'); // baris 10
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.errors).toEqual([
    'Baris 5: kolom Jawaban harus Benar atau Salah',
    'Baris 6: Pilihan A dan Pilihan B wajib diisi untuk Pilih Satu',
    'Baris 7: Waktu harus angka 5 sampai 30',
    'Baris 8: kolom Jenis harus Pilih Satu atau Benar/Salah',
    'Baris 9: Pertanyaan wajib diisi',
    'Baris 10: Waktu harus angka 5 sampai 30',
  ]);
});

test('empty sheet asks to fill from row 4', () => {
  const r = rowsToSet(sheet('T'), 'f', 'u');
  expect(r).toEqual({ ok: false, errors: ['Belum ada soal. Isi mulai baris 4.'] });
});

test('more than 50 questions rejected', () => {
  const many = Array.from({ length: 51 }, (_, i) => ['Pilih Satu', `Soal ${i}`, 'A', 'B', '', '']);
  const r = rowsToSet(sheet('T', ...many), 'f', 'u');
  expect(r).toEqual({ ok: false, errors: ['Maksimal 50 soal per file'] });
});

test('template round trip parses its two examples', async () => {
  const buf = await buildTemplate();
  const r = await xlsxToSet(buf, 'riuh-template.xlsx', 'upload-1');
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.set.questions.map(q => q.type)).toEqual(['pick', 'tf']);
});

test('template has dropdowns and instructions sheet', async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildTemplate());
  expect(wb.worksheets.map(w => w.name)).toEqual(['Soal', 'Petunjuk']);
  const ws = wb.getWorksheet('Soal')!;
  expect(ws.getCell('A4').dataValidation?.type).toBe('list');
  expect(ws.getCell('E20').dataValidation?.type).toBe('list');
});

test('rich text and formula cells are read as text', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Soal');
  ws.getCell('B1').value = 'Judul';
  ws.getRow(3).values = HEAD;
  ws.getCell('A4').value = { richText: [{ text: 'Pilih ' }, { text: 'Satu' }] };
  ws.getCell('B4').value = 'Teh atau kopi?';
  ws.getCell('C4').value = { formula: '"Teh"', result: 'Teh' };
  ws.getCell('D4').value = 'Kopi';
  const rows = await readXlsxRows(Buffer.from(await wb.xlsx.writeBuffer()));
  const r = rowsToSet(rows, 'f', 'u');
  expect(r.ok && r.set.questions[0].a).toBe('Teh');
});

test('non-xlsx file gives a friendly error', async () => {
  const r = await xlsxToSet(Buffer.from('bukan excel'), 'a.xlsx', 'u');
  expect(r).toEqual({ ok: false, errors: ['File bukan Excel (.xlsx) atau rusak'] });
});

test('english sheet is accepted and errors come in english', async () => {
  const ok = rowsToSet(sheet('Monday',
    ['Pick One', 'Coffee or tea?', 'Coffee', 'Tea', '', ''],
    ['True/False', 'Earth is round.', '', '', 'true', '']), 'f', 'u', 'en');
  expect(ok.ok && ok.set.questions.map(q => [q.type, q.answer])).toEqual([['pick', null], ['tf', 'a']]);
  const bad = rowsToSet(sheet('T', ['True/False', 'Sky', '', '', 'yes', ''], ['Quiz', 'X', '', '', '', '']), 'f', 'u', 'en');
  expect(bad).toEqual({ ok: false, errors: [
    'Row 4: Answer must be True or False',
    'Row 5: Type must be Pick One or True/False',
  ] });
  expect(await xlsxToSet(Buffer.from('x'), 'a.xlsx', 'u', 'en')).toEqual({ ok: false, errors: ['Not an Excel (.xlsx) file, or the file is damaged'] });
});

test('english template round trip', async () => {
  const wb = new ExcelJS.Workbook();
  const buf = await buildTemplate('en');
  await wb.xlsx.load(buf);
  expect(wb.worksheets.map(w => w.name)).toEqual(['Questions', 'Guide']);
  expect(wb.worksheets[0].getCell('A3').value).toBe('Type');
  const r = await xlsxToSet(buf, 'riuh-template.xlsx', 'u', 'en');
  expect(r.ok && r.set.questions.map(q => q.type)).toEqual(['pick', 'tf']);
});
