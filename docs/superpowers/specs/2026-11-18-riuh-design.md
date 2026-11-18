# Riuh: kuis ice breaking dengan HP sebagai kontroler

Tanggal: 2026-11-18
Author: Fahrudin
Status: draf desain, menunggu persetujuan

## 1. Maksud

Game pembuka rapat (5 sampai 10 menit) untuk tim yang hadir di ruangan maupun online (Zoom/Meet, presenter share screen). Layar presenter menampilkan soal; HP atau laptop peserta hanya menjadi kontroler dua tombol besar. Perhatian peserta harus tetap di layar presenter, bukan di HP.

Inspirasi mekanik: rekaman kuis "Benar Salah" dengan HP miring terbelah dua warna. Riuh memakai mekanik umum itu dengan tampilan dan nama sendiri, tidak meniru visual atau merek produk di rekaman.

Ukuran berhasil: peserta bisa ikut dalam kurang dari 30 detik sejak QR tampil, dan sesi memancing obrolan. Siapa yang paling pintar bukan tujuan.

## 2. Sasaran, bukan sasaran, anti-sasaran

Sasaran:
- Gabung tanpa install, tanpa akun: pindai QR atau buka link, isi nama, masuk.
- Kontroler: dua blok besar, bisa dipakai tanpa membaca.
- Dua jenis soal, keduanya dua tombol: Benar/Salah (berskor) dan Pilih Satu (tanpa jawaban benar, menampilkan pembagian pilihan).
- Jalan untuk peserta di ruangan dan online sekaligus dalam satu sesi.

Bukan sasaran (tidak dibuat di versi ini):
- Akun, login, riwayat sesi, ekspor hasil.
- Editor soal di UI. Konten dibahas terpisah; versi ini membaca file JSON.
- Soal dengan lebih dari dua pilihan, jawaban teks, gambar/video di soal.
- Suara dan musik.
- Mode tanpa internet (server lokal di laptop presenter).

Anti-sasaran (gagal walau secara teknis jalan):
- Peserta harus menunduk membaca HP untuk tahu harus menekan apa.
- Gabung butuh lebih dari satu layar isian atau ada yang tertinggal karena HP-nya lama.
- HP layar mati sebentar lalu peserta terlempar keluar dan skornya hilang.
- Tampilan meniru produk di rekaman.

## 3. Batasan

- Server: VPS pribadi di Chicago (1 vCPU, ~1 GB RAM, sisa ~380 MB). RTT dari Indonesia sekitar 240 ms. Jeda tombol ke layar host sekitar 0,25 detik; dapat diterima untuk kuis.
- Runtime di VPS: Bun 1.3.x, PM2, nginx + certbot (langkah sudo dijalankan pemilik server).
- Semua state di memori. Restart server menghapus sesi yang berjalan; dapat diterima.
- Kapasitas: maksimal 60 peserta per ruang, maksimal 20 ruang aktif bersamaan.
- Kontroler harus jalan di browser HP lama (Android Chrome 2020 ke atas, iOS Safari 15 ke atas).

## 4. Pendekatan yang dipertimbangkan

| Pendekatan | Untung | Rugi |
|---|---|---|
| A. Server Node/Bun + Socket.IO di VPS sendiri (DIPILIH) | Tanpa pihak ketiga, tanpa database, server pemegang aturan dan skor (anti-curang), deploy sama seperti Gangsal | Restart server = sesi hilang |
| B. Supabase Realtime + halaman statis | Tanpa server untuk dirawat | Bergantung kuota gratis, aturan game di klien host, lebih rumit tanpa untung untuk kasus ini |
| C. Spec saja untuk AI Studio | Hemat token | AI Studio cenderung memalsukan backend di localStorage; game lintas perangkat butuh server sungguhan |

WebRTC peer-to-peer dibuang: tetap butuh server signaling dan sering gagal di jaringan kantor.

Fahrudin memilih A.

## 5. Keputusan teknis (keputusan desain, boleh dikoreksi)

- Runtime Bun, server `server.ts`, Socket.IO (dipilih karena reconnect otomatis dan fallback polling untuk jaringan kantor yang memblokir WebSocket).
- Frontend: HTML + CSS + JavaScript biasa tanpa framework dan tanpa build step. Dua halaman: `host.html` dan `play.html`, disajikan oleh server yang sama.
- Logika game di modul murni `src/game.ts` (tanpa I/O), diuji dengan `bun test`. `server.ts` hanya meneruskan event socket ke modul itu.
- QR dibuat di server (paket `qrcode`) sebagai SVG, agar host tidak bergantung CDN.
- Nama proyek dan folder: `GAME/riuh`. Subdomain usulan: `riuh.learning.my.id`.

## 6. Peran dan alur

Dua peran:
- Host: layar presenter, dibuka di `/` (atau `/host`). Membuat ruang, memilih set soal, mengendalikan alur.
- Pemain: kontroler, dibuka di `/p/KODE` (dari QR) atau `/p` lalu mengetik kode.

Alur sesi:

```
LOBI -> SOAL (hitung mundur) -> HASIL SOAL -> [PAPAN SKOR, hanya setelah soal Benar/Salah] -> SOAL berikutnya ... -> AKHIR (podium)
```

### 6.1 Lobi
- Host membuka halaman lalu menekan tombol "Buat ruang" (ruang tidak dibuat otomatis saat halaman dibuka, agar crawler atau bot tidak menghabiskan slot). Server membuat ruang dengan kode 4 huruf (huruf kapital tanpa I, O, L agar tidak tertukar dengan angka), mis. `KTWB`.
- Layar host menampilkan: QR besar, link pendek (`riuh.learning.my.id/p/KTWB`), kode ruang, daftar nama yang sudah masuk (muncul satu per satu), jumlah peserta, pilihan set soal (dropdown dari folder `sets/`), tombol Mulai (aktif bila minimal 1 peserta).
- Host bisa mengeluarkan peserta dari lobi dengan klik nama (untuk nama iseng).

### 6.2 Gabung (pemain)
- Satu layar: kotak nama (maks 16 karakter, wajib, dipangkas spasinya) dan tombol Masuk. Bila datang dari `/p` tanpa kode, layar yang sama punya kotak kode di atasnya.
- Nama kembar dalam satu ruang diberi akhiran angka otomatis (`Budi`, `Budi 2`).
- Server mengembalikan `playerToken` yang disimpan di `localStorage` per kode ruang. Bila HP tidur atau halaman dimuat ulang, kontroler menyambung lagi dengan token itu dan skor tetap.
- Peserta boleh gabung kapan saja; yang datang saat soal berjalan ikut mulai soal berikutnya.
- Setelah gabung, kontroler menampilkan: nama sendiri dan teks "Lihat layar presenter".

### 6.3 Soal
- Setiap soal diawali waktu baca 3 detik (keputusan Fahrudin). Alasannya: screen share Zoom/Meet tertinggal 1 sampai 3 detik, sehingga tanpa waktu baca peserta online selalu kalah cepat dan soal bisa berakhir sebelum mereka melihatnya.
  - Selama waktu baca: host menampilkan soal dan pilihan dengan hitung mundur baca kecil; kontroler terkunci, abu-abu, bertuliskan "Baca soal di layar".
  - Setelah 3 detik: server membuka jawaban serentak; semua kontroler berubah menjadi dua blok berwarna dengan getar singkat. Sinyal ini langsung dari server, tidak tertunda screen share.
  - Hitung mundur jawaban dan bonus kecepatan mulai saat jawaban dibuka, bukan saat soal tampil.
  - Jawaban yang tiba sebelum dibuka ditolak.
- Host menampilkan: nomor soal (`3/8`), jenis soal, teks soal besar, dua pilihan dengan simbol, hitung mundur, dan "12 dari 15 sudah menjawab".
- Kontroler menampilkan dua blok penuh layar:
  - Benar/Salah: kiri hijau `O Benar`, kanan merah `X Salah`.
  - Pilih Satu: kiri biru `A <label a>`, kanan oranye `B <label b>`. Label diambil dari soal, dipotong bila lebih dari 20 karakter.
  - HP tegak: blok atas dan bawah. HP miring dan laptop: kiri dan kanan.
  - Laptop: tombol panah kiri / kanan atau huruf A / L juga berfungsi.
  - Simbol selalu ada, jadi tidak bergantung warna saja.
- Sekali tekan, jawaban terkunci (tidak bisa diganti). Kontroler berubah satu warna sesuai pilihan dengan teks "Menunggu yang lain". Getar singkat bila browser mendukung.
- Soal berakhir saat waktu habis atau semua peserta yang terhubung sudah menjawab, mana yang lebih dulu.
- Waktu default 10 detik; soal boleh menetapkan sendiri (5 sampai 30 detik).

### 6.4 Hasil soal
- Benar/Salah: host menyorot jawaban benar, jumlah penjawab tiap sisi. Kontroler: hijau "Benar! +732" atau merah "Belum tepat", plus peringkat sementara.
- Pilih Satu: host menampilkan dua batang persentase dan nama-nama peserta di bawah masing-masing sisi (maks 12 nama per sisi, sisanya "+5 lainnya"). Ini sengaja, agar memancing obrolan. Kontroler: "Kamu bersama 60% peserta". Tanpa skor.
- Yang tidak menjawab: kontroler "Tidak sempat menjawab", 0 poin.

### 6.5 Papan skor dan akhir
- Setelah tiap soal Benar/Salah, host menampilkan 5 besar beserta skor. Setelah soal Pilih Satu, papan skor dilewati.
- Akhir: podium 3 besar di host, lalu daftar lengkap. Kontroler menampilkan peringkat dan skor akhir sendiri.
- Bila set hanya berisi soal Pilih Satu, layar akhir menampilkan "Terima kasih" tanpa podium.
- Host bisa menekan "Main lagi" (ruang dan peserta tetap, skor direset, kembali ke lobi).

### 6.6 Kendali host
- Tombol Lanjut di layar dan tombol keyboard Spasi / panah kanan untuk maju ke tahap berikutnya (hasil -> papan skor -> soal berikutnya). Perpindahan tidak otomatis, agar presenter bisa mengobrol dulu.
- Tombol "Akhiri soal sekarang" saat soal berjalan.
- Tombol layar penuh.

## 7. Skor (hanya Benar/Salah)

- Benar: 500 + bonus kecepatan sampai 500, menurun linear dari saat jawaban dibuka (setelah waktu baca) sampai waktu habis. Dibulatkan ke bilangan bulat.
- Salah atau tidak menjawab: 0.
- Waktu diukur di server saat jawaban diterima. Sisa ketidakadilan akibat beda latensi jaringan (sekitar 0,25 detik) diterima.
- Skor seri (keputusan desain): yang jumlah waktu jawabnya lebih kecil berada di atas, dihitung hanya dari soal Benar/Salah yang dijawab benar. Bila masih seri, urutan gabung lebih awal di atas.

## 8. Format set soal

File JSON di folder `sets/`, satu file satu set. Konten final dibahas terpisah; versi ini berisi satu set contoh campuran.

```json
{
  "title": "Kenalan Lebih Dekat",
  "questions": [
    { "type": "pick", "text": "Kopi atau teh?", "a": "Kopi", "b": "Teh" },
    { "type": "tf", "text": "Kantor kita berdiri tahun 2010.", "answer": true, "time": 15 }
  ]
}
```

- `type`: `tf` (Benar/Salah) atau `pick` (Pilih Satu).
- `tf` wajib `answer` (boolean). `pick` wajib `a` dan `b`.
- `time` opsional, 5 sampai 30.
- Server memvalidasi semua set saat start; set yang tidak valid tidak muncul di dropdown dan dicatat di log.

## 9. Koneksi dan ketahanan

- Host menyimpan `hostToken` di `sessionStorage`. Bila halaman host dimuat ulang atau koneksinya putus, ruang bertahan 10 menit dan host menyambung lagi ke ruang yang sama.
- Ruang dihapus 10 menit setelah host putus tanpa kembali, atau 3 jam sejak dibuat.
- Pemain yang putus tetap tercatat (nama abu-abu di lobi); tidak dihitung dalam "semua sudah menjawab".
- Setiap event dari klien divalidasi di server: hanya host ruang itu yang boleh mengendalikan alur; jawaban hanya diterima satu kali per soal, saat soal berjalan.
- Batas: 60 peserta per ruang (pemain ke-61 mendapat pesan "Ruang penuh"), 20 ruang aktif, maksimal 3 ruang aktif per alamat IP (keputusan desain; tanpa password host). Bila batas tercapai, host melihat "Server sedang penuh, coba beberapa menit lagi".
- Host yang memuat ulang halaman menyambung ke ruang lama lewat `hostToken`, bukan membuat ruang baru.

## 10. Teks dan bahasa

Seluruh UI berbahasa Indonesia. Tanpa emoji. Teks kontroler dibatasi pada: nama, satu kata pilihan, dan satu kalimat status.

## 11. Pengujian

- `src/game.ts` dikembangkan TDD dengan `bun test`: transisi state, kunci jawaban, akhir soal saat semua menjawab, skor dan bonus waktu, seri, nama kembar, reconnect dengan token, batas peserta, validasi set soal.
- Uji manual di browser: satu tab host + beberapa tab kontroler (ukuran HP tegak dan miring), lalu satu kali uji dengan HP sungguhan setelah deploy.

## 12. Deploy

Mengikuti pola Gangsal: git clone ke `~/riuh` di VPS, `bun install --production`, jalankan dengan PM2 pada port kosong (cek `ss -ltn`), nginx dengan dukungan upgrade WebSocket, certbot untuk `riuh.learning.my.id`. Langkah sudo dijalankan Fahrudin lewat terminal.

## 13. Diserahkan ke pembangun

- Tampilan visual (palet, tipografi, animasi transisi), selama: kontras tinggi untuk proyektor, teks soal terbaca dari belakang ruangan, simbol O/X/A/B selalu tampil, tidak meniru produk di rekaman.
- Struktur file di luar `server.ts`, `src/game.ts`, `public/`.
- Detail nama event socket.
