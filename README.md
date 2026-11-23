# Riuh

Kuis ice breaking untuk rapat. Layar presenter menampilkan soal di domain atau server Anda (misalnya `https://<domain-anda.com>`); HP atau laptop peserta memindai QR code dan menjadi kontroler dua tombol. Bisa dipakai di ruangan maupun online (presenter share screen di Zoom/Meet, peserta membuka link di HP). Tersedia dalam Bahasa Indonesia dan English.

## Jalan lokal

```bash
bun install
bun server.ts          # http://localhost:3030
bun test
```

Variabel lingkungan: `PORT` (default 3030), `HOST` (default 0.0.0.0), `PUBLIC_URL` (alamat yang dipakai di QR, default `http://localhost:PORT`), `DB_PATH` (SQLite penghitung pengunjung, default `data/riuh.db`).

Uji di jaringan kantor tanpa deploy: jalankan dengan `PUBLIC_URL=http://<IP-laptop>:3030`, lalu HP di Wi-Fi yang sama memindai QR.

## Alur

1. Presenter membuka `/`, menekan **Buat ruang**. Layar menampilkan QR dan kode 4 huruf.
2. Peserta memindai QR (atau membuka `/p` dan mengetik kode), mengisi nama, masuk.
3. Presenter memilih set soal, menekan **Mulai**.
4. Tiap soal: 3 detik waktu baca (tombol HP terkunci), lalu tombol terbuka serentak. Spasi atau panah kanan = Lanjut.

Jenis soal:
- `tf` Benar/Salah: berskor, 500 + bonus kecepatan sampai 500.
- `pick` Pilih Satu: tanpa jawaban benar, layar menampilkan pembagian pilihan dan nama peserta.

## Soal sendiri lewat Excel (untuk presenter non-teknis)

1. Di lobi layar presenter, klik **Unduh template Excel** (atau buka `/template.xlsx`).
2. Isi judul di sel B1 dan soal mulai baris 4. Kolom Jenis dan Jawaban memakai dropdown; sheet Petunjuk menjelaskan cara mengisi.
3. Klik **Upload soal (.xlsx)**. Bila ada kesalahan, layar menampilkan daftar per baris dan file ditolak seluruhnya.

Set upload hanya berlaku di ruang itu dan hilang saat ruang ditutup (tidak disimpan di server). Maks 1 MB, 50 soal per file, 5 set upload per ruang. Dari Google Sheets: File > Download > Microsoft Excel (.xlsx).

Set bawaan: Pemanasan (dipilih otomatis), Fakta Unik, Dunia Kerja, Teknologi & IT, Proyek & Produk, Klien & Requirement, Keseharian Developer, DevOps & Server; versi Inggris: Warm-up, Fun Facts, Work Life, Tech & IT, Project & Product, Clients & Requirements, Developer Life, DevOps & Cloud. Template Inggris di `/template.xlsx?lang=en`.

## Bahasa (ID/EN)

Presenter memilih ID atau EN di bar atas (layar awal dan lobi). Soal bawaan, label Benar/Salah (True/False), template Excel, pesan error, dan layar HP semua peserta mengikuti bahasa ruang. Set upload tampil apa adanya.

## Penghitung pengunjung

Pengunjung unik per hari (satu perangkat per hari), disimpan di SQLite sebagai hash bergaram dari tanggal, IP, dan User-Agent; IP mentah tidak disimpan. Angka hanya bertambah saat server menyajikan halaman; bot tidak dihitung. Dibaca lewat `GET /api/visits` (hanya baca, dibatasi 30 permintaan per menit per IP).

## Review audiens

Setelah kuis selesai (layar akhir), peserta di HP menerima pop-up review opsional (rating 1 sampai 5 bintang dan pesan saran opsional).
- Pop-up bilingual mengikuti bahasa ruang yang dipilih presenter.
- Dibatasi maksimal 1 kali per 30 hari untuk perangkat dan IP yang sama (tersimpan via localStorage dan hash server).
- Bersifat non-mandatory: peserta bebas menutup pop-up atau menekan "Lain kali".

## Halaman admin

Halaman admin tersedia di `/admin` untuk memantau performa aplikasi:
- Ringkasan rata-rata rating bintang dan total ulasan masuk.
- Breakdown distribusi rating (bintang 1 s.d. 5) dan feed komentar audiens terbaru.
- Heatmap popularitas kuis: set kuis mana yang paling sering dipilih presenter, total peserta yang mengikuti, dan rata-rata peserta per sesi.
- Riwayat sesi kuis terbaru.

Akses dashboard wajib menggunakan variabel lingkungan `ADMIN_KEY` minimal 24 karakter (atur di file `.env` atau environment server; buat dengan `openssl rand -hex 24`). Bila `ADMIN_KEY` kosong atau lebih pendek, akses admin dinonaktifkan. Masukkan kunci di form saat membuka `/admin`; kunci dikirim lewat header `x-admin-key`, tidak pernah lewat URL, dan hanya disimpan selama tab terbuka. Setelah 10 percobaan salah dari satu IP, akses diblokir 15 menit.

Review hanya diterima dari pemain yang sedang tergabung di ruang (sekali per pemain), dengan batas 20 review per IP dan 300 review total per jam. Sesi kuis dicatat di heatmap sekali per ruang dan set, dan hanya bila dimainkan minimal 2 pemain.

## Format set soal bawaan (JSON, untuk pengelola server)

Satu file JSON per set di folder `sets/`. Server membaca folder ini saat start; file yang tidak valid dilewati dan dicatat di log.

```json
{
  "title": "Kenalan Lebih Dekat",
  "questions": [
    { "type": "pick", "text": "Kopi atau teh?", "a": "Kopi", "b": "Teh" },
    { "type": "tf", "text": "Kantor kita berdiri tahun 2010.", "answer": true, "time": 15 }
  ]
}
```

`time` opsional (5 sampai 30 detik, default 10).

## Deploy (VPS, pola Gangsal)

```bash
ssh <user>@<server>
git clone <repo> ~/riuh && cd ~/riuh && ~/.bun/bin/bun install --production
PORT=3030 HOST=127.0.0.1 PUBLIC_URL=https://<domain-anda.com> pm2 start "$HOME/.bun/bin/bun" --name riuh --cwd ~/riuh -- server.ts
pm2 save
```

Cek port kosong dulu dengan `ss -ltn`. Nginx: `deploy/riuh.nginx.conf` (butuh sudo). Update: `cd ~/riuh && git pull && pm2 restart riuh`.

## Dukung Riuh

Riuh gratis dipakai. Kalau bermanfaat, dukung lewat [Saweria](https://saweria.co/ifahrudin) (QRIS, e-wallet).

## Batas

60 peserta per ruang, 20 ruang aktif, 3 ruang per IP. Semua data di memori: restart server menghapus sesi berjalan. Ruang dihapus 10 menit setelah host terputus, atau 3 jam sejak dibuat.
