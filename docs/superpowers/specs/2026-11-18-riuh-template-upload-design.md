# Riuh: template Excel, upload soal, dan set bawaan

Tanggal: 2026-11-18
Author: Fahrudin
Status: draf, menunggu persetujuan
Melengkapi: `2026-11-18-riuh-design.md` (bagian "Bukan sasaran: editor soal di UI" kini diganti oleh upload template).

## 1. Maksud

Soal dibuat umum (tidak perlu saling kenal) dan bisa disesuaikan per audiens oleh presenter non-teknis, tanpa akses server. Caranya: unduh template Excel, isi, upload di lobi.

## 2. Pendekatan

| Pendekatan | Untung | Rugi |
|---|---|---|
| A. Template .xlsx (DIPILIH) | Paling akrab untuk non-teknis; dropdown mencegah salah ketik | Server butuh library pembaca xlsx |
| B. Template CSV | Tanpa library | Excel locale Indonesia menyimpan dengan `;` dan encoding berbeda; tanpa dropdown |
| C. Form soal di layar host | Paling gampang sekali pakai | Soal sulit disimpan untuk dipakai lagi tanpa fitur penyimpanan |

Fahrudin memilih A, beserta dua usulan: set upload hanya untuk ruang itu, dan error per baris.

## 3. Template

File `riuh-template.xlsx`, diunduh dari tautan "Unduh template Excel" di lobi host (dan di `/template.xlsx`).

Sheet "Soal" (sheet pertama, yang dibaca):

| | A | B | C | D | E | F |
|---|---|---|---|---|---|---|
| 1 | Judul set | (diisi presenter) | | | | |
| 3 | Jenis | Pertanyaan | Pilihan A | Pilihan B | Jawaban | Waktu (detik) |
| 4+ | soal pertama dst. | | | | | |

- Baris 4 dan 5 berisi dua contoh terisi (satu Pilih Satu, satu Benar/Salah) yang boleh ditimpa.
- Kolom Jenis: dropdown `Pilih Satu` / `Benar/Salah`.
- Kolom Jawaban: dropdown `Benar` / `Salah`, hanya untuk Benar/Salah; dikosongkan untuk Pilih Satu.
- Pilihan A/B: wajib untuk Pilih Satu, diabaikan untuk Benar/Salah.
- Waktu: opsional, 5 sampai 30, kosong = 10.
- Sheet "Petunjuk": cara mengisi dalam 6 sampai 8 baris kalimat pendek.

## 4. Upload

- Di lobi host: tombol "Upload soal (.xlsx)". Hanya ada di fase lobi.
- Browser mengirim isi file lewat socket (`host:uploadSet`), maks 1 MB, maks 50 soal.
- Server membaca sheet pertama, baris 4 ke bawah; baris yang semua kolomnya kosong dilewati.
- Pencocokan teks longgar: huruf besar/kecil dan spasi di tepi diabaikan (`benar `, `BENAR` diterima). Jenis menerima juga `pilih satu`, `pilihsatu`, `benar/salah`, `benar salah`.
- Judul: sel B1; bila kosong, nama file tanpa `.xlsx`.
- Validasi memakai aturan set yang sudah ada. Bila ada satu saja error, seluruh file ditolak dan host melihat daftar error per baris, contoh:
  - "Baris 5: kolom Jawaban harus Benar atau Salah"
  - "Baris 7: Pilihan A dan Pilihan B wajib diisi untuk Pilih Satu"
  - "Baris 9: Waktu harus angka 5 sampai 30"
  - "File bukan Excel (.xlsx) atau rusak"
  - "Belum ada soal. Isi mulai baris 4."
  - Maks 10 error ditampilkan, sisanya "dan N kesalahan lain".
- Berhasil: set muncul di dropdown ruang itu dengan tanda "(upload)" dan langsung terpilih. Upload ulang file dengan judul sama menggantikan set upload sebelumnya.
- Cakupan: set upload hanya hidup di ruang itu, hilang saat ruang ditutup. Tidak disimpan di server, tidak terlihat presenter lain.
- Maks 5 set upload per ruang.

## 5. Set bawaan

Mengganti `sets/contoh.json` dengan tiga set, masing-masing 10 soal. Fakta di Fakta Unik dipilih yang mudah diverifikasi.

### Pemanasan (Pilih Satu)
1. Bubur ayam: Diaduk / Tidak diaduk
2. Mie instan: Kuah / Goreng
3. Liburan: Pantai / Gunung
4. Martabak: Manis / Telor
5. Akhir pekan ideal: Rebahan di rumah / Jalan-jalan keluar
6. Kekuatan super: Bisa terbang / Bisa teleportasi
7. Pagi-pagi: Kopi / Teh
8. Nonton film: Di bioskop / Di rumah
9. Sarapan: Nasi uduk / Roti
10. Kerja sambil: Dengar musik / Hening

### Fakta Unik (Benar/Salah)
1. Gurita punya tiga jantung. (Benar)
2. Madu yang disimpan rapat bisa awet ribuan tahun. (Benar)
3. Tembok Besar China terlihat dengan mata telanjang dari Bulan. (Salah)
4. Secara botani, pisang termasuk buah beri. (Benar)
5. Petir tidak pernah menyambar tempat yang sama dua kali. (Salah)
6. Komodo hidup liar hanya di Indonesia. (Benar)
7. Ikan mas koki hanya bisa mengingat selama 3 detik. (Salah)
8. Venus adalah planet terpanas di tata surya. (Benar)
9. Manusia hanya memakai 10% otaknya. (Salah)
10. Indonesia adalah negara kepulauan terbesar di dunia. (Benar)

### Dunia Kerja (Pilih Satu)
1. Notifikasi HP saat kerja: Dibisukan / Dibiarkan
2. Rapat paling enak: Pagi / Siang
3. Paling fokus kerja: Pagi hari / Malam hari
4. Catatan rapat: Tulis tangan / Ketik
5. Meja kerja: Rapi / Berantakan tapi hafal
6. Balas chat kerja: Langsung / Dikumpulkan dulu
7. Koordinasi: Telepon / Chat
8. Kerja: Dari rumah / Dari kantor
9. Daftar tugas: Aplikasi / Kertas
10. Makan siang: Bareng tim / Sendiri santai

## 6. Keputusan teknis (keputusan desain)

- Library `exceljs`: dipakai untuk membuat template (dengan dropdown/data validation) saat server start, dan membaca file upload. Dipilih karena paket `xlsx` di npm sudah tidak diperbarui dan punya celah keamanan yang diketahui.
- Konversi baris ke objek set dilakukan di modul murni `src/xlsx-set.ts`, divalidasi dengan `validateSet` yang ada, diuji `bun test` (termasuk file uji hasil exceljs).
- Set upload diberi id `upload-<n>` dan disimpan di `Room.customSets`.

## 7. Bukan sasaran

Menyimpan set upload antar sesi, berbagi set antar presenter, mengedit soal di browser, gambar di soal.
