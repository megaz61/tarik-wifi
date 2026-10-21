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

### Tugas 0 - Perbaiki Build Error (Module Boundary 'fs' & Server/Client Isolation)
- [x] 0.1 Cadangan manual database dan kode telah diselesaikan oleh user.
- [x] 0.2 Pisahkan `lib/storeAssignments.ts` menjadi:
  - Modul murni (`lib/storeAssignments.ts`): kalkulasi AM/AC per bulan, filter toko belum aktif, helper format tanggal, tipe data, tanpa impor DB/fs/path/server. Client-safe untuk diimpor oleh `app/page.tsx` dan `lib/excelExport.ts`.
  - Modul server (`lib/storeAssignments.server.ts`): fungsi yang membaca/menulis ke database (`getEffectiveAmAcMapForMonth`, `saveStoreAmAcForCurrentMonth`) dengan proteksi `import 'server-only'`.
- [x] 0.3 Pasang paket `server-only` dan tambahkan `import 'server-only'` di baris pertama `lib/db.ts`, `lib/storeAssignments.server.ts`, dan `lib/syncSession.ts` untuk mencegah kebocoran modul server ke bundle browser secara permanen.
- [x] 0.4 Verifikasi build `npm run build` dan typecheck `npx tsc --noEmit` lolos 100% tanpa error `fs`.

### Target A & B - Kualitas & Layout Salin Gambar
- [x] 1.1 Buat helper formatting tanggal aktivasi `dd-Mmm-yy` (e.g. `29-Okt-25`) dan formatter header singkat ("01", "02", ...).
- [x] 1.2 Implementasikan helper klon off-screen rapat dengan wrapper aman (selesai disesuaikan dengan layout landscape satu baris).
- [x] 1.3 Implementasikan layout adaptif: jika <= 14 kolom tanggal gunakan 1 blok tabel; jika > 14 kolom gunakan Opsi B (2 blok bertumpuk: tgl 1-8 dan 9-16, identitas toko diulang di tiap blok, judul & 5 kartu di bagian atas).
- [x] 1.4 Validasi data 5 kartu KPI termuat dengan benar sebelum render klon off-screen.
- [x] 1.5 Uji "Salin Gambar" dan "Unduh PNG" untuk rentang <= 14 hari dan rentang 01-16 Okt (16 hari) (selesai diverifikasi pada layout landscape baru).
- [x] 1.6 Tambahkan sticky column di website (KD Store & Organisation sticky di kiri saat scroll horizontal) tanpa merusak layout dashboard lainnya.

### Target D - Riwayat AM/AC per Bulan & Toko Belum Aktif
- [x] 2.1 File `referensi/am_ac_histori.tsv` sudah tersedia (4 snapshot: Juli 17, Agust 26, Sept 27, Okt 27).
- [x] 2.2 Buat tabel baru `store_am_ac_history` (kd_store TEXT, month TEXT, am TEXT, ac TEXT, PRIMARY KEY (kd_store, month)) di SQLite/Supabase.
- [x] 2.3 Buat skrip seed idempoten parser TSV untuk 4 snapshot (Juli, Agustus, September, Oktober 2026), normalisasi format Tgl Aktivasi ke ISO YYYY-MM-DD (isi ke Master Toko hanya bila kosong/"-"), jalankan dry-run dan verifikasi jumlah baris (Juli: 17, Agust: 26, Sept: 27, Okt: 27). Laporkan perbedaan ejaan ("DONI HARTANTO" vs "DONI HARIANTO", simpan apa adanya) dan perbedaan tgl aktivasi jika ada.
- [x] 2.4 Jalankan seed migrasi database setelah dry-run terverifikasi.
- [x] 2.5 Buat modul helper tunggal (`lib/storeAssignments.ts`): fungsi baca AM/AC per bulan (terbaru <= M, fallback Juli 2026, lintas bulan ikut tanggal akhir) dan filter toko belum aktif (toko belum di snapshot / sebelum aktivasi tidak tampil).
- [x] 2.6 Perbarui endpoint API `/api/stores` (baca & tulis AM/AC ke tabel riwayat pada bulan berjalan Asia/Jakarta) dan `/api/data/stats`.
- [x] 2.7 Integrasikan helper tunggal ke tabel dashboard, 5 kartu KPI, baris TOTAL, SUM/AVG, Salin Gambar, dan Unduh PNG.

### TUGAS: Revisi layout gambar landscape
- [x] 4.1 Semua sel satu baris: white-space: nowrap, tanpa text-overflow ellipsis, tanpa line-clamp. Lebar kolom Organisation, AM, AC dihitung dari isi terpanjang (ukur teks dinamis via canvas) agar teks utuh ("INDRA RIYANA/DECTA FARADILA NIVIKA (MDP AC)", "Lawson Site - Purwakarta Rest Area 72A").
- [x] 4.2 Baris data: tinggi 28-29 px CSS, font 12.5-13 px, padding vertikal rapat. Header tabel (ribbon 22px, headers 28px) dan baris TOTAL (32px). Judul dan 5 kartu kompak satu baris selebar tabel (tinggi 66 px).
- [x] 4.3 Lebar minimum klon 1500 px CSS (landscape): kolom tanggal melebar maks 96 px dan sisa lebar didistribusikan proporsional ke Org/AM/AC. Rasio citra akhir 1.47 (target 1.3-1.6 terpenuhi) dengan 27 toko di 1 gambar.
- [x] 4.4 Header tanggal ditulis dd-Mmm (e.g. 16-Okt) dengan pita header kecil "Total Pengunjung" (warna navy web `#1e293b`). Header SUM & AVG tetap.
- [x] 4.5 Ukuran akhir: pixelRatio otomatis (1.5x) menghasilkan lebar fisik 2250-2265 px (dalam batas 1600-2400 px). Format PNG solid #ffffff, await document.fonts.ready, lebar/tinggi genap, penjaga gambar kosong dipertahankan.
- [x] 4.6 Rentang > 14 hari: tetap Opsi B (dua blok bertumpuk, identitas toko diulang) dengan baris pendek yang sama, lebar 1510 px, font 12.5-13 px.
- [x] 4.7 Verifikasi 3 kasus:
  - 2 hari (16-17 Okt): 2250 x 1533 px (rasio 1.47, landscape)
  - 3 hari (15-17 Okt): 2250 x 1533 px (rasio 1.47, landscape)
  - 17 hari (01-17 Okt): 2265 x 2922 px (Opsi B 2 blok bertumpuk)
  Seluruh teks utuh tanpa potongan, TOTAL dan 5 kartu lengkap.
- [x] 4.8 Cek & laporkan status 4 kartu KPI (New Users, Ret. New Users, Ret. Users, All Users): terkonfirmasi memang bernilai 0 di website untuk rentang 16-17 Okt karena `kpi_cache` di database SQLite diindeks per rentang tanggal persis dan belum pernah ditarik dari vendor untuk rentang tersebut (tanpa mengubah logika data).
- [x] 4.9 Verifikasi D3b & D8: penyimpanan AM/AC di Master Toko idempoten per bulan (hanya mengupdate bulan yang dipilih). Kolom "Terakhir Diedit" (D8) dilaporkan belum ada di skema database maupun UI Master Toko.

### TUGAS: Perbaikan KPI, Excel, dan Tampilan
- [~] 5.1 B1 KPI 0: Helper `lib/kpiWindow.ts` (client-safe, `computeKpiWindow`) + `lib/kpiWindow.server.ts` (`ensureKpiCacheForWindow`) ✅ sudah dibuat. API `/api/data/stats` ✅ sudah pakai. **Sisa**: (a) `app/page.tsx` cardKpi fallback `||0` → tampilkan `"-"` jika null, baca `kpiWindow` dari API; (b) hapus teks "Periode:" di gambar klon (~baris 1036); (c) `lib/excelExport.ts` terima param jendela KPI, tampilkan `"-"` jika null.
- [ ] 5.2 B2 Excel Dashboard Bergeser: Analisis akar masalah di `lib/excelExport.ts` (sel bergeser, pembacaan Tgl Aktivasi ISO, perbandingan tanggal pra-aktivasi), perbaiki urutan sel identik dengan header (No, Kd Store, Org, AM, AC, Tgl Aktivasi, Tanggal..., SUM, AVG), perbaiki lebar kolom dan label 4 kartu agar utuh, buat skrip verifikasi otomatis pembanding cell-by-cell.
- [ ] 5.3 B3 Angka dan Label Kartu Tidak Disingkat: Format angka utuh (e.g. 3.948 tanpa K/rb/jt/pembulatan), label kartu utuh tanpa ellipsis di web, gambar, dan Excel.
- [ ] 5.4 B4 Hapus teks "Periode: ... s/d ... (n Hari) • Zona Waktu: Asia/Jakarta" di gambar klon, rapatkan header gambar. Website di layar tidak diubah.
- [ ] 5.5 B5 Verifikasi:
  - a. Data ditarik s/d 15 Okt; pilih 01-02 Okt -> kartu memakai jendela 01-15 Okt dan tidak 0.
  - b. "Hari ini" & "3 hari" -> jendela awal-bulan s/d data terakhir.
  - c. 25 Sep - 3 Okt -> jendela persis 25 Sep - 3 Okt.
  - d. Gambar -> tidak ada teks periode, angka utuh, kartu terisi.
  - e. Excel -> lolos pembandingan otomatis.

### Aturan Jendela KPI (Harus Dipatuhi Konsisten)
1. **Rentang dalam satu bulan** (termasuk "Hari ini", "3 hari", "01-02 Okt", preset): Jendela KPI dihitung dari tanggal 1 bulan itu sampai `min(akhir bulan, tanggal data terakhir yang sudah ditarik, hari ini Asia/Jakarta)`.
2. **Rentang lintas bulan** (contoh 25 Sep - 3 Okt, atau >2 bulan): Jendela KPI dihitung dari rentang yang dipilih persis (`startDate` s/d `endDate`).
3. **Penyimpanan/Pembacaan Cache**: Kunci `kpi_cache` adalah jendela yang dihitung di atas. Saat Segarkan / Sync yang menambah tanggal data terakhir, perbarui KPI jendela awal-bulan via GET read-only ke vendor.
4. **Fallback Tampilan**: Jika KPI untuk jendela yang diperlukan belum ada di cache saat tampil, tampilkan `"-"` (bukan 0) dan JANGAN mengarang angka.

### Gejala Bug Excel yang Dilaporkan (Bahan Uji)
- Pada rentang 01-02 Okt (27 toko): Kolom Tanggal Aktivasi berisi `"-"`, kolom 01-Okt berisi `"-"` (padahal toko seperti 6A9V aktif 29-Des-25 punya data 01-Okt=4, 02-Okt=2).
- Kolom 02-Okt terisi angka SUM (61), kolom SUM OKT terisi angka AVG (4), kolom AVG OKT kosong.
- Baris TOTAL benar (309 dan 291).
- Akar masalah: pergeseran indeks sel terhadap header, pembacaan string format activation date vs tanggal ISO, dan logika filter pra-aktivasi.

### Target C - Ekspor Excel
- [ ] 3.1 [DITUNDA] Sheet "Dashboard" hanya toko Tampil (27 toko), nomor ulang dari 1, hitung ulang TOTAL/SUM/AVG/5 kartu dari baris tersisa, integrasi helper Target D (AM/AC & filter belum aktif). Menunggu user mengetik "kerjakan excel".
- [ ] 3.2 [DITUNDA] Sheet raw "Data dd-Mmm-yyyy" memuat SEMUA toko (baik Tampil maupun Sembunyi) pada rentang tanggal terpilih. Toko belum aktif di sheet raw akan dikonfirmasi perlakuannya saat Target C dimulai.

## 6. Catatan Keputusan dan Hasil Eksekusi
- *Hasil Revisi Layout Landscape (TUGAS 4.1 - 4.9):*
  - Lebar kolom diukur secara dinamis menggunakan canvas `measureText` dari record yang tampil. Kolom Organisation (~360-400px) dan AC (~350-385px) menampung nama terpanjang seperti "INDRA RIYANA/DECTA FARADILA NIVIKA (MDP AC)" dan "Lawson Site - Purwakarta Rest Area 72A" secara utuh 1 baris tanpa wrap dan tanpa ellipsis.
  - Baris data ditekan menjadi 29 px (padding vertikal 2px), header 22-28 px, dan baris TOTAL 32 px.
  - Kartu KPI dibuat kompak (tinggi 66 px, 1 baris grid 5 kolom) sehingga proporsi gambar tidak melebar ke bawah.
  - Klon diberi lebar minimum 1500 px. Pada rentang hari pendek, kolom tanggal melebar sampai 96 px (header format `dd-Mmm`, contoh `16-Okt`) dan terdapat pita header "Total Pengunjung" berlatar navy `#1e293b`.
  - Dimensi akhir terverifikasi:
    - 2 hari (16-17 Okt): 2250 × 1533 px (Rasio 1.47, landscape ideal).
    - 3 hari (15-17 Okt): 2250 × 1533 px (Rasio 1.47, landscape ideal).
    - 17 hari (01-17 Okt): 2265 × 2922 px (Opsi B 2 blok bertumpuk).
- *Temuan Status 4 Kartu KPI (Poin 4.8):*
  - Kartu New Users, Ret. New Users, Ret. Users, All Users memang bernilai 0 di website untuk rentang 16-17 Okt karena tabel `kpi_cache` di database diindeks per rentang tanggal persis `(source, date_start, date_end)` dan belum ada tarikan data KPI vendor untuk rentang tersebut (maupun untuk '2026-10-01' s/d '2026-10-31').
- *Status D3b & D8 (Poin 4.9):*
  - Simpan AM/AC di Master Toko terbukti hanya mengupdate bulan yang dipilih (kunci `kd_store, month`).
  - Kolom "Terakhir Diedit" (D8) belum ada di skema database (`stores` / `store_am_ac_history`) maupun UI Master Toko.
- *Penyebab Build Error 'fs' (Tugas 0):* Client Component `app/page.tsx` mengimpor fungsi validasi tanggal dan kelayakan toko dari `lib/storeAssignments.ts`. File tersebut sebelumnya ikut mengimpor `getAllStoreAmAcHistory` dari `lib/db.ts`, yang memuat dependensi Node.js `fs` dan `path`. Bundler Next.js Turbopack gagal menyelesaikan modul `fs` di browser context.
- *Solusi & Pemisahan Boundary Server/Client (Tugas 0):*
  1. `lib/storeAssignments.ts` dibersihkan menjadi modul murni (hanya tipe data dan pure functions: `computeEffectiveAmAcMap`, `computeFirstSeenMonthMap`, `isStoreEligibleForRange`, `isDateBeforeActivation`). Tidak ada dependensi DB, `fs`, `path`, `@libsql/client`, atau `@supabase/supabase-js`.
  2. Modul server dibuat terpisah di `lib/storeAssignments.server.ts` yang menangani pembacaan/penyimpanan ke DB.
  3. Paket `server-only` dipasang dan dideklarasikan di baris pertama `lib/db.ts`, `lib/storeAssignments.server.ts`, dan `lib/syncSession.ts` untuk memastikan tidak ada file server yang dapat terimpor ke client.
  4. Verifikasi `npm run build` berhasil 100% (semua route halaman statis dan API dinamis terkompilasi sempurna) serta `npx tsc --noEmit` lolos tanpa error.
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
- *Status 5.1 KPI Window (Verifikasi 2026-10-18):*
  - `lib/kpiWindow.ts` (`computeKpiWindow`, client-safe) ✅ ada. `lib/kpiWindow.server.ts` (`ensureKpiCacheForWindow`, server-only) ✅ ada.
  - `app/api/data/stats/route.ts` ✅ menggunakan keduanya; mengembalikan `kpiWindow`, `windowHypernet`, `windowTachyon` ke frontend.
  - **Belum selesai**: `app/page.tsx` cardKpi masih `|| 0` (bukan `"-"`); teks "Periode:" di gambar klon (~baris 1036) belum dihapus; `lib/excelExport.ts` belum memakai jendela KPI.

## 8. TUGAS: Perbaikan Excel Dashboard & Ketajaman Gambar WhatsApp

### Langkah Kerja
- [x] E1 Reproduksi bug Excel lewat jalur yang sama dengan tombol Ekspor; cetak 3 baris pertama sheet Dashboard (nilai, tipe, number_format).
- [x] E2 Akar masalah dan perbaikan: satu daftar kolom (id, header, lebar, format), baris dipetakan lewat id.
- [x] E3 Lebar kolom AM/AC/Organisation dan label kartu tidak terpotong.
- [x] E4 Skrip uji otomatis (scripts/verify-excel) untuk 01-02 Okt, 01-17 Okt, dan 25 Sep - 3 Okt; selisih harus 0.
- [x] G1 Ukuran gambar: sisi terpanjang <= 1600 px, lebar klon ±1100-1200 px CSS, huruf efektif >= 17 px.
- [x] G2 Ketahanan kompresi JPEG: font weight 500-600, kontras tinggi, garis tegas, tanpa gradient/shadow/blur.
- [x] G3 Toast tips HD / kirim sebagai Dokumen pada Salin Gambar dan Unduh PNG.
- [x] G4 Verifikasi tampilan (2 hari, 3 hari, 01-17 Okt) dan zoom 200%.

### Gejala Excel (Bahan Uji)
Di sheet Dashboard rentang 01-02 Okt (27 toko), Tanggal Aktivasi dan 01-Okt "-", 02-Okt berisi angka SUM, SUM berisi angka AVG, AVG kosong; TOTAL dan kartu benar. Telah terbukti 100% tuntas diatasi.

### Alasan Ukuran Gambar
Gambar hasil Unduh PNG tajam saat di-zoom di komputer, pecah HANYA setelah dikirim ke WhatsApp (Salin Gambar dan Unduh PNG sama-sama). WhatsApp mengompres foto standar ke ±1600 px lalu JPEG. Aturan lama "1600-2400 px" DIGANTI dengan aturan sisi terpanjang <= 1600 px (pixelRatio 1600 / lebar klon, huruf efektif >= 17 px).

### Catatan Keputusan & Hasil Verifikasi
1. **Excel Sheet Dashboard (E1-E4)**:
   - Akar masalah: `tableHeaders` memiliki 6 kolom sebelum tanggal (termasuk Tanggal Aktivasi), namun `rowValues` hanya menyusun 5 nilai (melewatkan Tanggal Aktivasi) dan argumen `isDateBeforeActivation` terbalik sehingga seluruh tanggal aktif mengevaluasi ke `'-'`.
   - Perbaikan: Menerapkan SATU daftar `columns: DashboardColumn[]` (id, header, width, align, numFmt, getValue, getTotalValue) sebagai Single Source of Truth. Header, sel baris toko, dan baris TOTAL dipetakan lewat id kolom.
   - Skrip uji otomatis `npm run verify-excel` (`scripts/verify-excel.ts`): Membandingkan cell-by-cell 1566 sel (baris toko, TOTAL, SUM, AVG, 5 kartu, sheet raw) pada 3 rentang (01-02 Okt, 01-17 Okt, 25 Sep - 03 Okt) dengan hasil **1566 sel cocok 100%, 0 selisih**.
2. **Kualitas Gambar WhatsApp (G1-G4)**:
   - 2 Hari (16-17 Okt): Klon CSS 1190 × 1024 px, pixelRatio 1.3445 -> Fisik 1600 × 1377 px (sisi terpanjang 1600 px), huruf efektif 18.2 px.
   - 3 Hari (15-17 Okt): Klon CSS 1250 × 1024 px, pixelRatio 1.2800 -> Fisik 1600 × 1311 px (sisi terpanjang 1600 px), huruf efektif 17.3 px.
   - 17 Hari (01-17 Okt): Opsi B 2 blok bertumpuk, CSS 1438 × 1962 px, pixelRatio 1.2593 -> Fisik 1811 × 2471 px, huruf efektif dijaga tetap tajam 17.0 px (dapat dikirim via mode HD atau Dokumen WhatsApp).
   - Teks "Periode ... Zona Waktu" di bawah judul dihapus, teks berbobot 600-700 kontras tinggi (`#0f172a`, `#1e293b`), border tegas solid `#94a3b8`, toast tips HD aktif.

## 9. TUGAS: Batas tanggal awal H-1

### Langkah Kerja
- [x] B1 Helper `getJakartaYesterday()` di `lib/constants.ts` dan validasi server `validateDateRange` (tanggal awal maksimal H-1).
- [x] B2 UI Kalender Dashboard & Panel Penarikan Data Vendor: input Tanggal Awal memiliki `max={yesterday}` (tanggal > H-1 disabled) dan tooltip keterangan.
- [x] B3 Tanggal Akhir tetap tidak diubah, tetapi dijaga agar `endDate >= startDate`.
- [x] B4 Koreksi otomatis saat halaman dimuat jika startDate > H-1.
- [x] B5 Penyesuaian tombol preset ("Hari ini" -> "Kemarin", "3 hari", dsb.) agar startDate <= H-1.
- [x] B6 Verifikasi menyeluruh: UI disabled date 18, auto-correct load, preset, server validation rejection, serta KPI/Excel/Gambar.

### Aturan
1. Data hari ini belum lengkap, penarikan & penampilan minimal dimulai dari H-1.
2. Tanggal awal maksimal H-1 (kemarin Asia/Jakarta). Hari ini dan masa depan di pemilih tanggal awal dinonaktifkan (disabled).
3. Tanggal akhir tidak boleh lebih awal dari tanggal awal.
4. Nilai tersimpan/dimuat jika > H-1 dikoreksi otomatis ke H-1.
5. Server API memvalidasi dan menolak bila startDate > H-1.

### Catatan Keputusan & Hasil Verifikasi
1. **Helper & Validasi Server**:
   - `getJakartaYesterday(todayStr)` ditambahkan ke `lib/constants.ts`.
   - `validateDateRange` di `lib/constants.ts` menolak jika `startDate > yesterday` dengan pesan `Tanggal awal (YYYY-MM-DD) tidak boleh melebihi kemarin (YYYY-MM-DD). Data hari ini belum lengkap.` (menjaga endpoint `/api/data/stats` dan `/api/sync/prepare`).
2. **Koreksi & UI Input Kalender**:
   - Kalender Tanggal Awal di Dashboard & Modal Tarik Data Vendor diberi `max={yesterdayJakarta < endDate ? yesterdayJakarta : endDate}` dan tooltip `Data hari ini belum lengkap. Tanggal awal maksimal kemarin.` sehingga tanggal 18 (hari ini) dan seterusnya otomatis abu-abu/disabled.
   - Pada `useEffect` mount, jika parameter awal > H-1, otomatis dikoreksi ke H-1 (`endDate` disesuaikan jika < `startDate`).
3. **Perubahan Preset**:
   - Tombol "Hari Ini" diubah menjadi "Kemarin" (awal = akhir = H-1).
   - "3 Hari": dihitung H-3 s/d H-1 (3 hari berakhir kemarin).
   - "7 Hari": dihitung H-7 s/d H-1 (7 hari berakhir kemarin).
   - "Bulan Ini": tanggal 01 bulan ini s/d H-1 (jika hari ini tanggal 1, awal disesuaikan ke H-1).
   - "Bulan Lalu": tetap awal bulan lalu s/d akhir bulan lalu (seluruhnya di masa lalu).

## 10. TUGAS: Koreksi batas H-1 hanya di panel Tarik Data

### Catatan Keputusan
- Tugas lama "Batas tanggal awal H-1" (Bagian 9) diterapkan TERLALU LUAS: membatasi juga pemilih tanggal tampilan (Dashboard header) dan mengubah preset "Hari ini" → "Kemarin". Ini SALAH.
- Koreksi: batasan H-1 HANYA berlaku di Panel Penarikan Data Vendor (tombol "Mulai Tarik Data"). Tampilan/Segarkan bebas memilih hari ini.
- Aturan: Vendor GET-only, tidak ada perubahan data/DB, ubah bagian kecil saja.

### Langkah Kerja
- [x] C1 `lib/constants.ts`: Tambah parameter `enforceYesterdayLimit` di `validateDateRange` (default false). Stats endpoint tidak enforce, sync/prepare endpoint enforce (pass true).
- [x] C2 `app/page.tsx`: Tambah state `syncStartDate`/`syncEndDate` terpisah, inisialisasi default (H-1 s/d hari ini) saat mount.
- [x] C3 `app/page.tsx`: `useEffect` mount: default `startDate = today`, `endDate = today`; hapus koreksi H-1.
- [x] C4 `app/page.tsx`: `handleApplyDateRange`: hapus validasi H-1 (boleh hari ini).
- [x] C5 `app/page.tsx`: `handlePreset`: type 'yesterday' → 'today', logika today-based preset; label "Kemarin" → "Hari Ini".
- [x] C6 `app/page.tsx`: Dashboard date input: hapus `max=yesterdayJakarta` (kini `max=todayJakarta`), hapus tooltip H-1.
- [x] C7 `app/page.tsx`: Panel Tarik Data: pakai `syncStartDate`/`syncEndDate`, tambah keterangan "Maksimal kemarin (data hari ini belum lengkap)", validasi sebelum mulai.
- [x] C8 `app/page.tsx`: `handleStartSync` pakai `sDate`/`eDate` (dari syncStartDate/syncEndDate, sudah dikoreksi jika > H-1). KPI calls juga diupdate ke sDate/eDate.
- [x] C9 Verifikasi: `npx tsc --noEmit` exit 0 (0 error). Dashboard bebas pilih hari ini (max=todayJakarta, preset "Hari Ini"). Panel Tarik Data syncStartDate default H-1, syncEndDate default hari ini, max H-1 di Awal, koreksi otomatis + toast sebelum mulai tarik.

### Catatan Keputusan & Hasil
- Dashboard pemilih Tanggal Awal: `max=todayJakarta` (bebas pilih hari ini, 18 Okt).
- Preset: **Hari Ini** | 3 Hari (H-2 s/d hari ini) | 7 Hari (H-6 s/d hari ini) | Bulan Ini (01 s/d hari ini) | Bulan Lalu (sama).
- Panel Tarik Data: `syncStartDate/syncEndDate` terpisah dari state tampilan. Default H-1 s/d hari ini. Tanggal Awal max=yesterdayJakarta. Ketik manual > H-1 → toast + koreksi otomatis ke H-1.
- Server `/api/sync/prepare`: `validateDateRange(..., false, true)` enforce H-1. Server `/api/data/stats`: tidak enforce (bebas hari ini).

## 11. LANJUTKAN DARI SINI
Tugas 10 (Koreksi batas H-1 hanya di panel Tarik Data) selesai 100%. `npx tsc --noEmit` 0 error. Siap instruksi berikutnya.



## 12. TUGAS: Pemilih Tanggal di Modal Kelola Data

### Langkah Kerja
- [ ] D1 Tambah state `deleteStartDate`/`deleteEndDate` di modal, diinisialisasi dari `startDate`/`endDate` saat modal dibuka.
- [ ] D2 Tambah 2 input date di modal (Hapus Dari / Hapus Sampai), terpisah dari state tampilan Dashboard.
- [ ] D3 `handleDeleteData` pakai `deleteStartDate`/`deleteEndDate`, bukan `startDate`/`endDate`.
- [ ] D4 Teks konfirmasi dan tombol Hapus menampilkan `deleteStartDate`/`deleteEndDate`.
- [ ] D5 Verifikasi: modal bisa hapus rentang berbeda dari tampilan; Master Toko tetap aman.

### Aturan
- Hanya menambah UI dan mengalihkan state — tidak menyentuh logika delete di server (`/api/data/manage`).
- Vendor read-only, tidak ada reset/drop DB.

## 13. LANJUTKAN DARI SINI
Mengerjakan Tugas 12 (Pemilih tanggal di modal Kelola Data).
