# Latihan Mingguan Ken

Website latihan Codeforces untuk persiapan OSN Informatika. Formatnya mirip program Infinity Castle:

- Setiap **Senin 00:05 WIB** otomatis muncul **8 soal baru** dari Codeforces, dengan rating tersebar dari batas bawah sampai batas atas level (awal: 800–1400).
- Soal yang pernah dicoba Ken atau pernah muncul di minggu sebelumnya tidak akan dipilih lagi.
- Ken mengerjakan dan submit **langsung di Codeforces**. Website membaca statusnya otomatis: **Selesai** (AC sebelum minggu berakhir), **Susulan** (AC setelah minggu berakhir), **Dicoba**, atau **Belum**.
- **Bonus 2 soal OSN asli** setiap minggu dari arsip **TLX TOKI** (mulai dari OSN-P, soal termudah dulu, lalu OSN nasional). Soal yang sudah Ken selesaikan dengan skor 100 dilewati. Status dan skor subtask dibaca otomatis setiap 2 jam.
- **Naik level otomatis:** jika Ken menyelesaikan ≥ 7 dari 8 soal selama 2 minggu berturut-turut, level berikutnya naik 100 (misalnya 800–1400 menjadi 900–1500).
- Tab **Riwayat** dan **Statistik** menyimpan progres semua minggu.
- Tab **Kontes** menampilkan jadwal kontes terdekat dari **Codeforces, AtCoder, dan TLX TOKI** (diperbarui otomatis setiap hari pukul 05:30 WIB), lengkap dengan tombol **Daftar** dan **+ Kalender** (Google Calendar) supaya tidak lupa. Tiga kontes "Cocok" terdekat juga tampil di halaman Minggu ini.
- **Pembahasan:** tulis catatan di `data/notes/minggu-01.md`, `minggu-02.md`, dan seterusnya.

## Cara memasang (sekali saja)

1. Buat akun di <https://github.com> jika belum punya.
2. Buat repository baru, misalnya `latihan-ken`, dengan visibilitas **Public**. GitHub Pages gratis hanya untuk repo publik. Isinya hanya username Codeforces dan daftar soal, tidak ada data pribadi lain.
3. Unggah semua isi folder ini ke repository tersebut. Bisa lewat tombol **Add file → Upload files**, atau dengan git:
   ```bash
   git init -b main
   git add .
   git commit -m "Website latihan Ken"
   git remote add origin https://github.com/USERNAME/latihan-ken.git
   git push -u origin main
   ```
4. Buka **Settings → Pages**, lalu di bagian **Source** pilih **GitHub Actions**.
5. Buka **Settings → Actions → General → Workflow permissions**, pilih **Read and write permissions**, lalu klik Save.
6. Edit `config.json` di GitHub dengan mengganti `GANTI_DENGAN_HANDLE_KEN` dengan username Codeforces Ken, lalu Commit.
7. Buka tab **Actions → Soal Mingguan → Run workflow** untuk membuat paket pertama sekarang (tidak perlu menunggu Senin).
8. Website bisa dibuka di `https://USERNAME.github.io/latihan-ken/`.

## Pemakaian sehari-hari

| Ingin… | Caranya |
|---|---|
| Mengubah level secara manual | **Actions → Soal Mingguan → Run workflow**, isi rating minimum/maksimum baru. Paket minggu ini langsung diganti sesuai level baru. |
| Mengganti soal minggu ini | **Run workflow** dengan mencentang "Ganti soal minggu ini". |
| Mematikan naik level otomatis | Ubah `"enabled": true` menjadi `false` di bagian `autoPromote` pada `config.json`. |
| Mengubah syarat naik level | Ubah `minSolved` (jumlah soal minimal), `consecutiveWeeks` (berapa minggu berturut-turut), dan `step` (besar kenaikan) di `config.json`. |
| Memperbarui status TLX/AtCoder sekarang | **Actions → Progres TLX & AtCoder → Run workflow**. |
| Mengubah jumlah soal bonus | Ubah `perWeek` di bagian `tlxBonus` pada `config.json` (atau `"enabled": false` untuk mematikan). |
| Memperbarui jadwal kontes sekarang | **Actions → Jadwal Kontes → Run workflow**. |
| Menulis pembahasan | Buat file `data/notes/minggu-NN.md` (contoh: `minggu-03.md`) lewat **Add file → Create new file**. Format Markdown, bisa memuat potongan kode. |

Catatan: GitHub kadang terlambat beberapa menit sampai satu jam menjalankan jadwal otomatis. Jika paket hari Senin belum muncul, jalankan **Run workflow** secara manual.

## Menjalankan di komputer sendiri (opsional)

```bash
node scripts/generate-week.mjs
node scripts/update-contests.mjs
node scripts/update-progress.mjs
python -m http.server 4377
```
Lalu buka <http://localhost:4377>.
