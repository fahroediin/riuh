# Audience Review & Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambahkan fitur review audiens (rating 1-5 bintang & pesan opsional, pop-up bilingual, 1x per 30 hari per perangkat/IP, non-mandatory) setelah kuis selesai, serta halaman admin (`/admin`) untuk memantau ulasan audiens dan heatmap kuis paling sering dipilih presenter beserta jumlah pesertanya.

**Architecture:**
- **Penyimpanan:** Modul `src/analytics.ts` menggunakan database SQLite yang sama (`bun:sqlite`, file `data/riuh.db` atau `:memory:` untuk tes). Tabel `reviews` untuk menyimpan review audiens dengan hash salted (30 hari throttle) dan tabel `quiz_sessions` untuk mencatat pemilihan set soal dan jumlah peserta saat kuis dimulai.
- **Client (HP Peserta):** Pop-up review modal di `public/play.js` saat `phase === 'end'`, diperiksa dengan `localStorage` (maksimal 1x per 30 hari). Teks multibahasa (ID/EN) mengikuti bahasa ruang presenter.
- **Admin Dashboard (`/admin`):** Halaman `public/admin.html` + `public/admin.js` yang menyajikan metrik ringkasan, breakdown rating 1-5 bintang, daftar feedback ulasan, dan heatmap visual frekuensi pemilihan set kuis beserta total peserta. Dilindungi token admin (`ADMIN_KEY`).

**Tech Stack:** Bun, TypeScript, SQLite (`bun:sqlite`), Socket.IO, HTML5, CSS3, Vanilla JS.

---

## Global Constraints
- Bahasa antarmuka modal review mengikuti `room.lang` (ID / EN).
- Rating wajib skala 1 s.d. 5 bintang, pesan ulasan bersifat opsional (maksimal 500 karakter).
- Tidak mandatory: peserta dapat menutup pop-up atau memilih "Lain kali" ("Maybe later").
- Frekuensi permintaan review: 1x per 30 hari per perangkat/IP.
- Gaya visual konsisten dengan tema Riuh (warna paper, ink `#141414`, font Archivo, border 3px solid, tanpa emoji, tanpa em dash).
- IP mentah pengunjung tidak disimpan mentah di database (menggunakan salted hash).

---

## Review Focus
1. Pop-up tidak boleh muncul berulang kali jika user refresh halaman setelah menyelesaikan kuis atau memilih "Lain kali" (diuji dengan pemeriksaan timestamp 30 hari).
2. Jawaban atau review tidak boleh crash jika komentar kosong atau hanya spasi.
3. Socket payload `player:review` divalidasi ketat (rating integer 1-5, comment string ter-sanitize, roomCode valid).
4. Sesi kuis tercatat secara akurat saat host memulai kuis (`host:start`), mencatat judul set, kode ruang, bahasa, dan jumlah peserta aktif.
5. Endpoint admin `/api/admin/metrics` dilindungi otentikasi sederhana (key/token) dan mengembalikan format JSON yang valid.

---

### Task 1: Modul Database Analytics (`src/analytics.ts`)

**Files:**
- Create: `src/analytics.ts`
- Test: `tests/analytics.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ReviewInput {
    rating: number; // 1..5
    comment?: string;
    roomCode?: string;
    setTitle?: string;
    lang: string;
  }
  export interface SessionInput {
    roomCode: string;
    setId: string;
    setTitle: string;
    participants: number;
    lang: string;
  }
  export class AnalyticsStore {
    constructor(dbPath: string);
    canReview(ip: string, ua: string, now: number): boolean;
    recordReview(ip: string, ua: string, input: ReviewInput, now: number): { ok: boolean; error?: string };
    recordSession(input: SessionInput, now: number): void;
    getMetrics(): AdminMetrics;
    close(): void;
  }
  ```

- [ ] **Step 1: Buat file tes unit `tests/analytics.test.ts` yang menguji pencatatan review, pembatasan 30 hari, pencatatan sesi, dan metrik heatmap.**
- [ ] **Step 2: Jalankan tes unit untuk memastikan kegagalan awal (fail).**
- [ ] **Step 3: Implementasikan `src/analytics.ts` dengan schema tabel SQLite `reviews` dan `quiz_sessions`.**
- [ ] **Step 4: Jalankan tes unit untuk memastikan seluruh tes di `tests/analytics.test.ts` lulus (pass).**

---

### Task 2: Integrasi Server & API Admin di `server.ts`

**Files:**
- Modify: `server.ts`
- Test: `tests/server.test.ts`

**Interfaces:**
- Menambahkan penanganan event socket `player:review` di `server.ts`.
- Menambahkan pemanggilan `recordSession` saat event `host:start` dijalankan.
- Menambahkan route `GET /admin` dan `GET /api/admin/metrics` (dengan validasi token `ADMIN_KEY`).

- [ ] **Step 1: Tambahkan tes integrasi di `tests/server.test.ts` untuk pengiriman review via socket dan endpoint `/api/admin/metrics`.**
- [ ] **Step 2: Jalankan tes server untuk memverifikasi error pada rute baru.**
- [ ] **Step 3: Update `server.ts` untuk mengintegrasikan `AnalyticsStore`, rute admin, dan event socket review.**
- [ ] **Step 4: Jalankan tes server dan pastikan lulus.**

---

### Task 3: Antarmuka Pop-up Review Audiens (`public/play.js`, `public/i18n.js`, `public/style.css`)

**Files:**
- Modify: `public/i18n.js`
- Modify: `public/style.css`
- Modify: `public/play.js`

**Interfaces:**
- Menambahkan kamus string untuk review di `public/i18n.js` (ID & EN).
- Menambahkan styling modal dialog review di `public/style.css`.
- Menambahkan logika pengecekan 30 hari di `localStorage` dan perenderan modal pop-up saat `v.phase === 'end'` di `public/play.js`.

- [ ] **Step 1: Tambahkan teks terjemahan ulasan di `public/i18n.js` (judul modal, rating bintang, placeholder saran, tombol kirim, tombol lain kali, ucapan terima kasih).**
- [ ] **Step 2: Tambahkan style modal review pop-up di `public/style.css` dengan desain konsisten (paper background, ink borders, interaksi bintang).**
- [ ] **Step 3: Tambahkan logika pop-up review di `public/play.js` dengan listener submit dan dismiss.**

---

### Task 4: Halaman Dashboard Admin (`public/admin.html`, `public/admin.js`)

**Files:**
- Create: `public/admin.html`
- Create: `public/admin.js`
- Modify: `public/style.css`

**Interfaces:**
- Halaman admin menampilkan:
  - Kartu statistik ringkasan (Total review, Rating rata-rata, Total sesi kuis, Total peserta).
  - Distribusi bintang ulasan (5★ s.d. 1★).
  - Heatmap tabel frekuensi pemilihan kuis dan jumlah peserta per sesi.
  - Feed daftar ulasan dan komentar audiens terbaru.
  - Form input password/token admin jika belum tersimpan.

- [ ] **Step 1: Buat markup `public/admin.html`.**
- [ ] **Step 2: Buat skrip `public/admin.js` untuk fetch data dari `/api/admin/metrics` dan render data statistik, heatmap kuis, serta daftar ulasan.**
- [ ] **Step 3: Tambahkan styling tabel heatmap dan kartu metrik admin di `public/style.css`.**

---

### Task 5: Verifikasi Menyeluruh & Dokumentasi

**Files:**
- Modify: `README.md`
- Run: `bun test`

- [ ] **Step 1: Jalankan seluruh suite tes unit (`bun test`) untuk memastikan tidak ada regresi.**
- [ ] **Step 2: Perbarui `README.md` dengan dokumentasi rute `/admin` dan fitur review audiens.**
