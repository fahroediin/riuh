# Riuh

Kuis ice breaking untuk rapat. Layar presenter menampilkan soal; HP atau laptop peserta menjadi kontroler dua tombol. Bisa dipakai di ruangan maupun online (presenter share screen di Zoom/Meet, peserta membuka link di HP).

## Jalan lokal

```bash
bun install
bun server.ts          # http://localhost:3030
bun test
```

Variabel lingkungan: `PORT` (default 3030), `HOST` (default 0.0.0.0), `PUBLIC_URL` (alamat yang dipakai di QR, default `http://localhost:PORT`).

Uji di jaringan kantor tanpa deploy: jalankan dengan `PUBLIC_URL=http://<IP-laptop>:3030`, lalu HP di Wi-Fi yang sama memindai QR.

## Alur

1. Presenter membuka `/`, menekan **Buat ruang**. Layar menampilkan QR dan kode 4 huruf.
2. Peserta memindai QR (atau membuka `/p` dan mengetik kode), mengisi nama, masuk.
3. Presenter memilih set soal, menekan **Mulai**.
4. Tiap soal: 3 detik waktu baca (tombol HP terkunci), lalu tombol terbuka serentak. Spasi atau panah kanan = Lanjut.

Jenis soal:
- `tf` Benar/Salah: berskor, 500 + bonus kecepatan sampai 500.
- `pick` Pilih Satu: tanpa jawaban benar, layar menampilkan pembagian pilihan dan nama peserta.

## Format set soal

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
PORT=3030 HOST=127.0.0.1 PUBLIC_URL=https://riuh.learning.my.id pm2 start "$HOME/.bun/bin/bun" --name riuh --cwd ~/riuh -- server.ts
pm2 save
```

Cek port kosong dulu dengan `ss -ltn`. Nginx: `deploy/riuh.nginx.conf` (butuh sudo). Update: `cd ~/riuh && git pull && pm2 restart riuh`.

## Batas

60 peserta per ruang, 20 ruang aktif, 3 ruang per IP. Semua data di memori: restart server menghapus sesi berjalan. Ruang dihapus 10 menit setelah host terputus, atau 3 jam sejak dibuat.
