# Riuh: penghitung pengunjung, tombol donasi, bahasa EN/ID

Tanggal: 2026-11-18
Author: Fahrudin
Status: disetujui lewat jawaban pilihan (penghitung unik per hari publik, bahasa mengikuti presenter, email kerja)

## Penghitung pengunjung

- Penyimpanan: SQLite via `bun:sqlite` (bawaan Bun), file `data/riuh.db` (env `DB_PATH`), tidak masuk git.
- Satu pengunjung = satu perangkat per hari. Kunci: SHA-256 dari `salt + tanggal UTC + IP + User-Agent`, dipotong 32 karakter. IP mentah tidak disimpan. Salt acak dibuat sekali dan disimpan di tabel `meta`.
- Dicatat hanya di server saat halaman HTML (`/`, `/host`, `/p`, `/p/KODE`) disajikan lewat GET. Tidak ada endpoint publik untuk menambah angka. User-Agent bot/crawler/kosong tidak dihitung.
- Dibaca lewat `GET /api/visits` -> `{ "total": n }`: hanya GET/HEAD (lainnya 405), tanpa parameter, query dengan prepared statement, hasil di-cache 30 detik, dibatasi 30 permintaan per menit per IP (429).
- Ditampilkan di layar presenter (layar awal dan lobi): "1.234 pengunjung" / "1,234 visitors".
- Semua respons HTTP diberi header: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Content-Security-Policy` (script hanya dari situs sendiri; style dan font dari Google Fonts).

## Tombol donasi

- Tombol "Donasi" / "Donate" di bar atas layar presenter, tampil di layar awal, lobi, dan akhir (disembunyikan saat soal berjalan agar layar fokus).
- Membuka panel kecil dengan dua tautan: GitHub Sponsors `https://github.com/sponsors/fahroediin` dan email `mailto:` dengan subjek "Donasi Riuh". Alamat email dirakit di JavaScript, tidak tertulis utuh di HTML.

## Bahasa EN/ID

- Presenter memilih ID/EN di bar atas (layar awal dan lobi). Pilihan diingat di browser. Default: bahasa browser (`id*` -> ID, selain itu EN).
- Bahasa disimpan di ruang (`Room.lang`); seluruh HP peserta mengikuti. Layar gabung di HP menanyakan bahasa ruang ke server berdasarkan kode; tanpa kode memakai bahasa browser.
- Set bawaan tersedia dalam dua bahasa: `sets/id/*.json` dan `sets/en/*.json` dengan id file yang sama. Mengganti bahasa di lobi menukar set bawaan yang terpilih ke versi bahasa lain. Set upload tidak diterjemahkan.
- Label Benar/Salah (True/False) diambil dari bahasa ruang.
- Template Excel per bahasa (`/template.xlsx?lang=en`). Pembaca upload menerima kedua bahasa (Pilih Satu/Pick One, Benar/Salah/True/False). Pesan error upload mengikuti bahasa ruang.
