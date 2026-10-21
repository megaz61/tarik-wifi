# PROGRESS & PANDUAN KERJA PROYEK REKAP FREE WIFI

=== ATURAN PALING PENTING (TIDAK BOLEH DILANGGAR) ===
1. VENDOR HANYA BACA. Jangan mengubah data apa pun di sistem vendor Tachyon (lawson-api.tachyon.net.id) maupun Hypernet (portal.openwifi.id). Hanya GET/read-only. Dilarang POST/PUT/PATCH/DELETE, dilarang membuat, mengedit, menghapus, atau me-reset data/akun/sesi/pengaturan di sana. Saat menguji, pakai data yang sudah tersimpan di database lokal. Jika suatu langkah tampak butuh perubahan di sisi vendor, BERHENTI dan tanyakan ke user.
2. DATA LOKAL AMAN. Dilarang drop/delete/reset/migrate-reset pada database proyek. Dilarang menimpa nilai Master Toko yang sudah ada (status Tampil/Sembunyi, AM, AC, Kd Store, Tgl Aktivasi); mengisi yang masih kosong boleh, menimpa tidak. DIPERBOLEHKAN: menambah tabel/koleksi baru untuk riwayat AM/AC dan mengisinya lewat skrip idempoten (aman dijalankan berulang), setelah cadangan dibuat. Salin Gambar dan Ekspor Excel hanya MEMBACA data.
3. CADANGAN DULU. Cadangan manual telah dilakukan oleh user (database & kode sudah aman, tidak perlu backup otomatis lagi).

---

## 1. Ringkasan Proyek
Aplikasi Next.js (App Router, React 19, TypeScript, Tailwind CSS) untuk merekap data pengguna akses Free WiFi Lawson dari dua vendor (Hypernet & Tachyon) dengan basis zona waktu Asia/Jakarta (UTC+7). Data disimpan secara lokal di SQLite (`data/wifi_rekap.db` via `@libsql/client`) dengan opsi Supabase Postgres. Menampilkan dashboard rekap harian, kartu KPI unik, chart tren harian, fitur Salin Gambar (Ctrl+V ke WhatsApp), Unduh PNG, serta Ekspor Excel multi-sheet.

## 2. Peta File Penting
- [lib/db.ts](file:///d:/CODING/tarik_freewifi/lib/db.ts): Skema SQLite/Supabase, CRUD stores, daily_store_stats, kpi_cache, store_assignments, dan helpers query.
- [lib/constants.ts](file:///d:/CODING/tarik_freewifi/lib/constants.ts): Konstanta tanggal Jakarta, format header tanggal/bulan, helper rentang tanggal.
- [lib/excelExport.ts](file:///d:/CODING/tarik_freewifi/lib/excelExport.ts): Generator workbook ExcelJS (Sheet "Dashboard" & Multi-Sheet Data harian).
- [app/page.tsx](file:///d:/CODING/tarik_freewifi/app/page.tsx): Halaman Dashboard utama, filter tanggal/AM/AC, kartu KPI, tabel rekap, handler capture gambar off-screen & ekspor.
- [app/stores/page.tsx](file:///d:/CODING/tarik_freewifi/app/stores/page.tsx): Halaman Master Toko untuk edit Kd Store, display name, Tgl Aktivasi, status Tampil/Sembunyi, dan penugasan AM/AC per bulan.
- [app/api/data/stats/route.ts](file:///d:/CODING/tarik_freewifi/app/api/data/stats/route.ts): Endpoint GET statistik harian, stores, kpi, dan penugasan AM/AC gabungan.
- [app/api/stores/route.ts](file:///d:/CODING/tarik_freewifi/app/api/stores/route.ts): Endpoint GET/PATCH/POST master toko dan penugasan AM/AC.
- [components/DashboardCharts.tsx](file:///d:/CODING/tarik_freewifi/components/DashboardCharts.tsx): Visualisasi chart tren harian dan heatmap menggunakan Recharts.
- [referensi/am_ac_histori.tsv](file:///d:/CODING/tarik_freewifi/referensi/am_ac_histori.tsv): File referensi snapshot AM/AC historis (Juli, Agustus, September, Oktober 2026) & Tgl Aktivasi.

## 3. Alur Kerja Ringkas
1. Data vendor ditarik secara berkala via endpoint sync dan disimpan ke `daily_store_stats` & `kpi_cache`.
2. Dashboard (`/`) memanggil `/api/data/stats` dengan filter rentang tanggal, menggabungkan data toko (`stores`), stats harian, kpi unik, dan penugasan AM/AC.
3. Tabel dashboard menampilkan KD Store, Organisation, AM, AC, Tgl Aktivasi, kolom per tanggal, SUM, dan AVG dengan baris TOTAL di bagian bawah.
4. "Salin Gambar" / "Unduh PNG" membuat klon DOM off-screen, merender ulang komponen tabel + kartu, dan menghasilkan PNG via `html-to-image`.

## 4. Analisis Penyebab Tiap Masalah
1. **Target A (Kualitas Gambar / Buram di WhatsApp):**
   - WhatsApp mengompres gambar jika dimensi total (lebar x pixelRatio) terlalu besar (>2400px) atau jika tidak menggunakan integer scaling genap dan background solid.
   - Solusi: Format PNG solid putih (#ffffff), `await document.fonts.ready`, dimensi genap (`Math.ceil / 2 * 2`), font minimal 13px CSS, target lebar akhir terkontrol 1600–2400 px.
2. **Target B (Gambar Melebar & Terpotong):**
   - Gambar terpotong pada capture layar langsung karena batas container overflow/scroll.
   - Pada klon off-screen lama: `COL_AM` (50px) dan `COL_AC` (50px) terlalu sempit sehingga nama terbungkus 4 baris dan tinggi baris membengkak hingga 110px.
   - Empat kartu KPI bernilai 0: Terkonfirmasi juga bernilai 0 di website untuk rentang 01-16 Okt 2026 karena rentang tersebut belum memiliki data tarikan di `kpi_cache` vendor (bukan bug capture, melainkan data memang null dari kpi_cache).
   - Penataan klon off-screen: Rapatkan header tanggal ("01", "02", ...), kolom tanggal 48-56px, AC lebar ±230px rata kiri maks 2 baris, Tgl Aktivasi format `dd-Mmm-yy`, tinggi baris <= 40px.
   - Rentang > 14 hari: Memakai Opsi B (1 gambar berisi 2 blok ditumpuk: tanggal 1-8 lalu 9-16) agar lebar tetap < 2400 px dan font tetap tajam.
3. **Target D (Riwayat AM/AC per Bulan & Toko Belum Aktif):**
   - Tabel `store_assignments` saat ini menggunakan `(store_id, month)`. Sesuai D1, akan dibuat tabel baru `store_am_ac_history` dengan kunci unik `(kd_store, month)` dan kolom `am`, `ac`.
   - Aturan BACA (D2): Ambil snapshot terbaru dengan `month <= M`. Bulan sebelum Juli 2026 menggunakan Juli 2026. Rentang lintas bulan mengikuti bulan dari tanggal akhir rentang (D4).
   - Aturan TULIS (D3): Edit di Master Toko melakukan upsert ke bulan berjalan (Asia/Jakarta) tanpa mengubah bulan lain.
   - Toko Belum Aktif (D6): Cek pra-aktivasi membuktikan 0 toko yang memiliki users > 0 sebelum activation_date. Toko tampil jika rentang tanggal >= activation_date dan bulan >= bulan snapshot pertama toko. Sel sebelum aktivasi diisi "-".
   - Helper Tunggal (D7): Satu modul helper untuk AM/AC per bulan dan filter aktif toko, dipakai konsisten oleh dashboard, 5 kartu, TOTAL, SUM/AVG, capture gambar, dan kelak Excel.
4. **Target C (Ekspor Excel):**
   - Sheet "Dashboard": Hanya toko berstatus "Tampil" (27 toko), No. diulang dari 1. TOTAL, SUM, AVG, dan 5 kartu dihitung ulang hanya dari toko Tampil (contoh TOTAL 01-Okt = 309). AM/AC & filter aktif memakai helper Target D.
   - Sheet raw "Data dd-Mmm-yyyy": Mengikuti rentang tanggal terpilih, memuat SEMUA toko (baik Tampil maupun Sembunyi).

## 5. Rencana Langkah Kecil Bernomor

### Persiapan & Cadangan
- [x] 0.1 Cadangan manual database dan kode telah diselesaikan oleh user.

### Target A & B - Kualitas & Layout Salin Gambar
- [x] 1.1 Buat helper formatting tanggal aktivasi `dd-Mmm-yy` (e.g. `29-Okt-25`) dan formatter header singkat ("01", "02", ...).
- [x] 1.2 Implementasikan helper klon off-screen rapat dengan wrapper aman (hilangkan position/left negatif saat render foreignObject): KD Store selebar isi, Org selebar isi, AM rata kiri, AC ±230px (maks 2 baris), tanggal 48-56px, font minimal 13px, tinggi baris <= 40px, background putih solid, deteksi gambar kosong.
- [x] 1.3 Implementasikan layout adaptif: jika <= 14 kolom tanggal gunakan 1 blok tabel; jika > 14 kolom gunakan Opsi B (2 blok bertumpuk: tgl 1-8 dan 9-16, identitas toko diulang di tiap blok, judul & 5 kartu di bagian atas).
- [x] 1.4 Validasi data 5 kartu KPI termuat dengan benar sebelum render klon off-screen.
- [x] 1.5 Uji "Salin Gambar" dan "Unduh PNG" untuk rentang <= 14 hari dan rentang 01-16 Okt (16 hari), pastikan gambar tajam (1600-2400px), terbukti terisi (bukan putih polos), tidak terpotong, dan rapi saat dipaste ke WhatsApp.
- [x] 1.6 Tambahkan sticky column di website (KD Store & Organisation sticky di kiri saat scroll horizontal) tanpa merusak layout dashboard lainnya.

### Target D - Riwayat AM/AC per Bulan & Toko Belum Aktif
- [x] 2.1 File `referensi/am_ac_histori.tsv` sudah tersedia (4 snapshot: Juli 17, Agust 26, Sept 27, Okt 27).
- [x] 2.2 Buat tabel baru `store_am_ac_history` (kd_store TEXT, month TEXT, am TEXT, ac TEXT, PRIMARY KEY (kd_store, month)) di SQLite/Supabase.
- [x] 2.3 Buat skrip seed idempoten parser TSV untuk 4 snapshot (Juli, Agustus, September, Oktober 2026), normalisasi format Tgl Aktivasi ke ISO YYYY-MM-DD (isi ke Master Toko hanya bila kosong/"-"), jalankan dry-run dan verifikasi jumlah baris (Juli: 17, Agust: 26, Sept: 27, Okt: 27). Laporkan perbedaan ejaan ("DONI HARTANTO" vs "DONI HARIANTO", simpan apa adanya) dan perbedaan tgl aktivasi jika ada.
- [x] 2.4 Jalankan seed migrasi database setelah dry-run terverifikasi.
- [x] 2.5 Buat modul helper tunggal (`lib/storeAssignments.ts`): fungsi baca AM/AC per bulan (terbaru <= M, fallback Juli 2026, lintas bulan ikut tanggal akhir) dan filter toko belum aktif (toko belum di snapshot / sebelum aktivasi tidak tampil).
- [x] 2.6 Perbarui endpoint API `/api/stores` (baca & tulis AM/AC ke tabel riwayat pada bulan berjalan Asia/Jakarta) dan `/api/data/stats`.
- [x] 2.7 Integrasikan helper tunggal ke tabel dashboard, 5 kartu KPI, baris TOTAL, SUM/AVG, Salin Gambar, dan Unduh PNG.

### Target C - Ekspor Excel
- [ ] 3.1 [DITUNDA] Sheet "Dashboard" hanya toko Tampil (27 toko), nomor ulang dari 1, hitung ulang TOTAL/SUM/AVG/5 kartu dari baris tersisa, integrasi helper Target D (AM/AC & filter belum aktif). Menunggu user mengetik "kerjakan excel".
- [ ] 3.2 [DITUNDA] Sheet raw "Data dd-Mmm-yyyy" memuat SEMUA toko (baik Tampil maupun Sembunyi) pada rentang tanggal terpilih. Toko belum aktif di sheet raw akan dikonfirmasi perlakuannya saat Target C dimulai.

## 6. Catatan Keputusan dan Hasil Eksekusi
- *Penyebab Bug Gambar Kosong (Putih Polos):* Container klon sebelumnya memakai `position:absolute; top:-9999px; left:-9999px;`. Library `html-to-image` menyalin style negatif tersebut ke SVG `<foreignObject>`, merender elemen 9999px di luar canvas (hasil canvas hanya putih polos). Solusi: Container capture ditempatkan di dalam wrapper off-screen, tetapi container capture sendiri ber-style `position:static; left:0; top:0; transform:none; opacity:1; visibility:visible;`. Ditambahkan batas canvas aman (max 16000px, 100M px), error notification try/catch, dan validasi canvas kosong (RGBA sample check).
- *Hasil Seed TSV Target D:*
  - Jumlah baris per bulan: Juli 17, Agustus 26, September 27, Oktober 27 (Total 97 records berhasil di-upsert).
  - Kd Store: 27 toko, 100% cocok dengan Master Toko (tidak ada Kd Store baru).
  - Perbedaan Tgl Aktivasi: 0 perbedaan terhadap Master Toko.
  - Perbedaan Ejaan: Juli & Agustus "DONI HARTANTO", September & Oktober "DONI HARIANTO" (disimpan apa adanya sesuai TSV).
- *Aturan Toko Belum Aktif (D6):*
  - Toko yang belum ada di snapshot atau tanggalnya sebelum Tgl Aktivasi tidak ditampilkan dan tidak diekspor pada rentang itu (contoh: rentang Juli hanya 17 toko; Cihampelas 6A8U aktivasi 2026-08-19 tidak muncul di Juli).
  - Toko yang aktivasinya di tengah rentang tetap tampil, sel tanggal sebelum aktivasi bernilai `"-"`.
- *Revisi Aturan Excel (Target C):*
  - Sheet "Dashboard": Hanya 27 toko Tampil, No. ulang dari 1, TOTAL/SUM/AVG/5 kartu dihitung ulang dari toko tersisa, sel sebelum aktivasi `"-"`, helper Target D digunakan.
  - Sheet raw: Memuat SEMUA toko (Tampil & Sembunyi).

## 7. LANJUTKAN DARI SINI
Tugas 1 (Fix Gambar Kosong) dan Tugas 2 (Target D) telah selesai 100%. Target C (Ekspor Excel) ditunda hingga user memberikan perintah "kerjakan excel".
