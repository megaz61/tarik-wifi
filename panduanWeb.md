# Panduan Web: Rekap WiFi Toko Lawson

> **Untuk siapa dokumen ini?**
> Dokumen ini ditujukan untuk atasan, tim operasional, atau staf baru yang ingin memahami cara kerja web ini tanpa harus membaca kode program. Setiap istilah teknis akan dijelaskan dengan bahasa sehari-hari.

---

## Daftar Isi

1. [Gambaran Umum](#1-gambaran-umum)
2. [Cara Kerja dari Awal sampai Akhir](#2-cara-kerja-dari-awal-sampai-akhir)
3. [Peta File Penting](#3-peta-file-penting)
4. [Koneksi ke Vendor (API & Network DevTools)](#4-koneksi-ke-vendor)
5. [Penyimpanan Data & Logika Toko (Filter 40 vs 27 vs 17 Toko)](#5-penyimpanan-data--logika-toko)
6. [Konfigurasi dan Deploy](#6-konfigurasi-dan-deploy)
7. [Masalah Umum dan Tanya Jawab (FAQ)](#7-masalah-umum-dan-tanya-jawab-faq)
8. [Glosarium](#8-glosarium)

---

## 1. Gambaran Umum

### Web ini untuk apa?

Web ini adalah **dasbor rekap penggunaan WiFi** di toko-toko Lawson. Setiap hari, toko-toko Lawson menyediakan WiFi gratis untuk pelanggan. Data penggunaan WiFi itu dicatat oleh dua perusahaan penyedia jaringan (disebut **vendor**):

- **Hypernet** — menyimpan data WiFi sebagian besar toko, bisa diakses melalui portal `portal.openwifi.id`
- **Tachyon** — menyimpan data WiFi untuk beberapa toko lainnya, bisa diakses melalui `lawson-api.tachyon.net.id`

Masalahnya: data dari kedua vendor itu tersebar, formatnya berbeda-beda, dan harus dibuka manual satu per satu. Web ini **menarik data dari kedua vendor secara otomatis**, menyimpannya di satu tempat, lalu menampilkannya dalam tabel dan grafik yang mudah dibaca.

### Siapa yang menggunakannya?

Tim internal Lawson — khususnya **AM (Area Manager)** dan **AC (Area Coordinator)** — yang bertugas memantau performa WiFi di toko-toko yang menjadi tanggung jawab mereka.

### Masalah yang diselesaikan

| Masalah Lama | Solusi di Web Ini |
|---|---|
| Data dari 2 vendor harus dicek manual di 2 website berbeda | Semua data ditarik dan digabung di satu tempat |
| Format data berbeda sehingga susah dibandingkan | Data distandarisasi ke format yang seragam |
| Tidak ada rekap harian per toko | Ada tabel lengkap: jumlah pengguna, data transfer, durasi |
| Tidak ada laporan Excel siap pakai | Bisa ekspor ke Excel dengan 1 klik |
| Penugasan AM/AC berubah tiap bulan dan susah dilacak | Ada halaman Master Toko dengan riwayat AM/AC per bulan |

---

## 2. Cara Kerja dari Awal sampai Akhir

### Alur Umum

```
┌─────────────┐     Buka Web      ┌──────────────────────────────┐
│   Pengguna  │ ────────────────▶ │  Halaman Dasbor (browser)    │
│  (Browser)  │                   │  app/page.tsx                │
└─────────────┘                   └──────────────┬───────────────┘
                                                 │ Minta data
                                                 ▼
                                  ┌──────────────────────────────┐
                                  │  API Internal Web            │
                                  │  /api/data/stats             │
                                  └──────────────┬───────────────┘
                                                 │ Baca dari DB
                                                 ▼
                                  ┌──────────────────────────────┐
                                  │  Database (Turso/SQLite)     │
                                  │  lib/db.ts                   │
                                  └──────────────────────────────┘
```

### Alur Tarik Data (saat pengguna klik "Tarik Data")

```
Pengguna klik "Tarik Data"
         │
         ▼
  [1] Login ke vendor
      POST /api/sync/session
      → Login ke Hypernet & Tachyon, dapat token sesi
         │
         ▼
  [2] Siapkan daftar tanggal
      POST /api/sync/prepare
      → Tentukan tanggal berapa saja yang akan ditarik
         │
         ▼
  [3] Tarik data per hari (satu per satu, bergiliran)
      POST /api/sync/day  (per hari, per vendor)
      → Ambil data tabel toko dari Hypernet / Tachyon
      → Simpan ke database (upsert)
      → Daftarkan toko baru jika belum ada
         │
         ▼
  [4] Tarik KPI (ringkasan jumlah pengguna)
      POST /api/sync/kpi
      → Ambil data footfall / metrics dari vendor
      → Simpan ke tabel kpi_cache
         │
         ▼
  [5] Tutup sesi
      POST /api/sync/finish
      → Hapus token sesi dari memori dan database
         │
         ▼
  [6] Tampilkan data di dasbor
      GET /api/data/stats
      → Ambil data dari database, gabungkan dengan info toko & AM/AC
      → Kirim ke halaman web
```

### Alur Login Pengguna

```
Pengguna masukkan Kode Akses
         │
         ▼
  POST /api/auth/login
  → Cocokkan dengan ACCESS_CODE di server
         │
         ├── Cocok → Simpan cookie "lawson_access_token" (berlaku 30 hari)
         │           Pengguna langsung masuk
         │
         └── Tidak cocok → Tampilkan pesan error
```

---

## 3. Peta File Penting

### Area: Tampilan (Halaman Web)

| File | Fungsi (Bahasa Awam) | Kepentingan |
|---|---|---|
| `app/page.tsx` | **Halaman utama / dasbor.** Menampilkan tabel rekap harian, grafik, tombol Tarik Data, ekspor Excel. File ini sangat besar (~122 KB). | Tinggi |
| `app/stores/page.tsx` | **Halaman Master Toko.** Daftar semua toko, penugasan AM/AC per bulan, toggle tampil/sembunyi toko. | Tinggi |
| `app/layout.tsx` | Kerangka umum halaman web (judul, font, dsb.). | Sedang |
| `app/globals.css` | Gaya tampilan dasar (warna, font). | Rendah |
| `components/DashboardCharts.tsx` | Komponen grafik (Recharts) yang tampil di dasbor. | Sedang |

### Area: Logika & Aturan Bisnis

| File | Fungsi (Bahasa Awam) | Kepentingan |
|---|---|---|
| `lib/syncSession.ts` | **Otak proses Tarik Data.** Mengatur sesi login, memanggil vendor, menyimpan hasil, mendaftarkan toko baru. | Tinggi |
| `lib/hypernet.ts` | Semua kode yang berbicara dengan server Hypernet (login, ambil tabel, ambil KPI). | Tinggi |
| `lib/tachyon.ts` | Semua kode yang berbicara dengan server Tachyon (login, ambil tabel, ambil metrics). | Tinggi |
| `lib/db.ts` | **Semua operasi database.** Simpan, baca, perbarui data. Berisi juga daftar 27 toko acuan dan scheduler pembersihan data. | Tinggi |
| `lib/auth.ts` | Cek apakah pengguna sudah login (dari cookie), dan ambil kredensial vendor dari variabel lingkungan. | Tinggi |
| `lib/constants.ts` | Konstanta global: URL vendor, zona waktu, format tanggal, fungsi bantu. | Tinggi |
| `lib/storeAssignments.ts` | Aturan penentuan AM/AC efektif per bulan dan filter toko yang boleh tampil. | Sedang |
| `lib/excelExport.ts` | Logika pembentukan file Excel (menggunakan library ExcelJS). | Sedang |
| `lib/vendorGuard.ts` | Penjaga keamanan: memastikan web **hanya membaca** dari vendor, tidak pernah menulis/mengubah data di vendor. | Sedang |
| `lib/kpiWindow.ts` | Menghitung rentang jendela waktu untuk KPI. | Sedang |
| `lib/kpiWindow.server.ts` | Memastikan cache KPI tersedia; jika belum ada, tarik dari vendor secara otomatis saat halaman dibuka. | Sedang |

### Area: API (Pintu Masuk Request)

| File | Endpoint | Fungsi (Bahasa Awam) |
|---|---|---|
| `app/api/auth/login/route.ts` | `POST /api/auth/login` | Login pengguna dengan kode akses |
| `app/api/auth/logout/route.ts` | `POST /api/auth/logout` | Logout, hapus cookie |
| `app/api/auth/status/route.ts` | `GET /api/auth/status` | Cek apakah pengguna sudah login |
| `app/api/data/stats/route.ts` | `GET /api/data/stats` | Ambil data rekap dari database untuk ditampilkan di dasbor |
| `app/api/data/manage/route.ts` | `GET/DELETE /api/data/manage` | Info ukuran database, hapus data per rentang tanggal |
| `app/api/stores/route.ts` | `GET/PATCH/POST /api/stores` | Ambil / ubah data toko dan penugasan AM/AC |
| `app/api/stores/import-excel/route.ts` | `POST /api/stores/import-excel` | Import otomatis data AM & AC dari Excel Struktur Nasional per bulan |
| `app/api/sync/session/route.ts` | `POST /api/sync/session` | Mulai sesi Tarik Data (login ke vendor) |
| `app/api/sync/prepare/route.ts` | `POST /api/sync/prepare` | Siapkan daftar tanggal yang akan ditarik |
| `app/api/sync/day/route.ts` | `POST /api/sync/day` | Tarik data 1 hari dari 1 vendor |
| `app/api/sync/kpi/route.ts` | `POST /api/sync/kpi` | Tarik KPI (ringkasan pengguna) dari vendor |
| `app/api/sync/finish/route.ts` | `POST /api/sync/finish` | Tutup sesi Tarik Data |
| `app/api/retention/cleanup/route.ts` | `GET/POST /api/retention/cleanup` | Lihat log atau jalankan pembersihan data lama |

### Area: Database & Konfigurasi

| File | Fungsi (Bahasa Awam) | Kepentingan |
|---|---|---|
| `data/wifi_rekap.db` | File database SQLite lokal (dibuat otomatis saat pertama jalan, jika tidak pakai Turso/Supabase). | Tinggi |
| `.env.local` | File rahasia: berisi kode akses, username/password vendor, URL database. **Tidak boleh dibagikan atau di-upload ke GitHub.** | Tinggi |
| `.env.example` | Contoh format `.env.local` tanpa nilai rahasia. Aman dibagikan. | Sedang |
| `next.config.ts` | Konfigurasi framework Next.js. | Rendah |
| `package.json` | Daftar library yang dipakai dan perintah untuk menjalankan web. | Sedang |

---

## 4. Koneksi ke Vendor

> **Analogi:** API itu seperti pelayan restoran. Web kita adalah tamu yang memesan makanan (data). Pelayan (API vendor) menerima pesanan, pergi ke dapur (server vendor), lalu membawa data yang diminta. Web kita **hanya bisa memesan / membaca**, tidak bisa masuk ke dapur dan mengubah resep.

Penjamin keamanan ini ada di [`lib/vendorGuard.ts`](lib/vendorGuard.ts) — setiap permintaan ke vendor diperiksa, dan permintaan yang bersifat "tulis" (mengubah data) langsung ditolak secara otomatis.

---

### 4.1 Dari Mana API Ini Didapatkan? (Hasil Inspect Network DevTools)

Semua endpoint API vendor di bawah ini didapatkan dari hasil **Inspect Element (tab Network di Chrome DevTools)** saat membuka website resmi kedua vendor dari halaman login hingga tabel data toko terbuka:

1. **Bagaimana cara kerjanya saat di-inspect?**
   - Saat login di website portal vendor, tab Network merekam request `POST` autentikasi yang mengirimkan username & password.
   - Saat halaman tabel/dasbor vendor terbuka, tab Network merekam request `GET` yang meminta data tabel toko (berisi nama toko, user count, transfer bytes, durasi) serta 4 kartu KPI footfall/metrics.
   - Semua URL, parameter tanggal, header organisasi, serta respon JSON tersebut kemudian dipindahkan dan diimplementasikan ke dalam kode backend kita di [`lib/hypernet.ts`](lib/hypernet.ts) dan [`lib/tachyon.ts`](lib/tachyon.ts).

2. **Kenapa API vendor tidak ditembak langsung dari browser pengguna?**
   - **Masalah CORS (Cross-Origin Resource Sharing)**: Browser melarang aplikasi web memanggil langsung domain luar (`portal.openwifi.id` atau `tachyon.net.id`) tanpa izin server tujuan.
   - **Keamanan Password**: Jika dipanggil dari browser pengguna, password akun vendor akan terlihat oleh siapa pun yang membuka inspect browser.
   - **Solusi**: Tombol "Tarik Data" di browser hanya memanggil API internal kita (`/api/sync/...`). Lalu server backend Next.js kita bertindak sebagai robot pengambil data yang aman di balik layar.

---

### 4.2 Vendor: Hypernet (`portal.openwifi.id`)

#### File dan Fungsi yang Terlibat

| Fungsi | File | Baris | Keterangan |
|---|---|---|---|
| `loginHypernet()` | `lib/hypernet.ts` | 75 | Login ke Hypernet, mendapatkan cookie sesi |
| `fetchHypernetTable()` | `lib/hypernet.ts` | 140 | Mengambil tabel statistik per toko |
| `fetchHypernetKpi()` | `lib/hypernet.ts` | 193 | Mengambil 4 angka KPI footfall |
| `mapHypernetCellsToDailyStats()` | `lib/hypernet.ts` | 254 | Mengubah format data Hypernet ke format database kita |
| `mapHypernetKpiToCacheItem()` | `lib/hypernet.ts` | 275 | Mengubah format KPI Hypernet ke format database kita |

#### Konfigurasi Autentikasi

Login menggunakan **username dan password** yang dikirim via POST ke endpoint login Hypernet. Nilainya diambil dari variabel lingkungan:

- `HYPERNET_USER` — nama pengguna akun Hypernet
- `HYPERNET_PASS` — kata sandi akun Hypernet

Variabel ini diatur di file `.env.local` (di server/Vercel). Nilai aslinya **tidak pernah dicatat ke database, cookie, log, maupun kode**. Lihat `lib/auth.ts` fungsi `resolveHypernetCredentials()`.

Setelah login berhasil, server Hypernet mengirimkan **cookie sesi** (bukan token teks biasa). Cookie ini disimpan sementara di memori dan database `sync_sessions` selama **15 menit**, lalu otomatis dihapus.

Jika akun mengaktifkan 2FA bertipe "Recommend", web secara otomatis melewatinya (`/userAuth/twoFactor/setup/skip`). Jika 2FA wajib (tipe lain), proses akan gagal dengan pesan error.

#### Endpoint Hypernet yang Dipanggil

**1. Login**

```
URL    : https://portal.openwifi.id/userAuth/login
Metode : POST
Body   : { "username": "...", "password": "..." }
Respons: Cookie sesi di header Set-Cookie
```

**2. Tabel Statistik Per Toko**

```
URL    : https://portal.openwifi.id/flow/statistics/data/organizations/subOrganizationShareTable
Metode : GET
Header : organizationid: 84456 (ID organisasi Lawson di Hypernet)
         timezone: Asia/Jakarta
         Cookie: <cookie sesi>
Param  : DateStart=<timestamp ms UTC awal hari>
         DateEnd=<timestamp ms UTC awal hari berikutnya>
         ColumnIds=organization,users,participation,totalTransfer,...
Respons: { "cells": [ { "organization": "Lawson Site - Cipete", "users": 42, "totalTransfer": 1234567, ... }, ... ] }
```

*Contoh data fiktif:*
```json
{
  "cells": [
    { "organization": "Lawson Site - Cipete", "users": 42, "totalTransfer": 524288000, "totalDuration": 7200000 },
    { "organization": "Lawson Site - Syahdan", "users": 18, "totalTransfer": 209715200, "totalDuration": 3600000 }
  ]
}
```

**3. KPI Footfall (4 endpoint terpisah)**

```
URL    : https://portal.openwifi.id/flow/statistics/data/footfall/{tipe}
         Tipe: newUsers, newReturningUsers, returningUsers, users
Metode : GET
Header : (sama seperti tabel di atas)
Param  : DateStart=..., DateEnd=...
Respons: { "value": "1234" }
```

#### Kapan dipanggil dan apa yang terjadi jika gagal?

- **Tabel toko** → dipanggil setiap kali pengguna klik Tarik Data, untuk setiap tanggal yang dipilih.
- **KPI** → dipanggil sekali untuk seluruh rentang tanggal. Juga dipanggil otomatis saat halaman dasbor dibuka jika cache KPI belum ada (melalui `lib/kpiWindow.server.ts`).
- **Jika gagal** → sistem mencoba ulang sebanyak **2 kali** (lihat `MAX_RETRIES` di `lib/constants.ts`). Jika tetap gagal, pesan error ditampilkan dan proses berhenti. Data yang sudah berhasil diambil sebelum error **tetap tersimpan**.

---

### 4.3 Vendor: Tachyon (`lawson-api.tachyon.net.id`)

#### File dan Fungsi yang Terlibat

| Fungsi | File | Baris | Keterangan |
|---|---|---|---|
| `loginTachyon()` | `lib/tachyon.ts` | 57 | Login ke Tachyon, mendapatkan Bearer token |
| `fetchTachyonTable()` | `lib/tachyon.ts` | 108 | Mengambil tabel statistik per toko |
| `fetchTachyonMetrics()` | `lib/tachyon.ts` | 152 | Mengambil ringkasan metrics (new/returning/total users) |
| `mapTachyonCellsToDailyStats()` | `lib/tachyon.ts` | 200 | Mengubah format data Tachyon ke format database kita |
| `mapTachyonMetricsToCacheItem()` | `lib/tachyon.ts` | 228 | Mengubah format metrics Tachyon ke format database kita |

#### Konfigurasi Autentikasi

Login menggunakan **username dan password** via POST. Tachyon mengembalikan **Bearer token** (string panjang yang dipakai sebagai "tiket masuk" di setiap permintaan berikutnya). Variabel lingkungan:

- `TACHYON_USER` — nama pengguna akun Tachyon
- `TACHYON_PASS` — kata sandi akun Tachyon

Diatur di `.env.local`. Nilai aslinya tidak pernah disimpan ke database atau log. Lihat `lib/auth.ts` fungsi `resolveTachyonCredentials()`.

#### Endpoint Tachyon yang Dipanggil

**1. Login**

```
URL    : https://lawson-api.tachyon.net.id/api/v1/auth/login
Metode : POST
Body   : { "username": "...", "password": "..." }
Respons: { "data": { "access_token": "eyJ...", "refresh_token": "..." } }
```

**2. Tabel Statistik Per Toko**

```
URL    : https://lawson-api.tachyon.net.id/api/v1/dashboard/tables
Metode : GET
Header : Authorization: Bearer <access_token>
Param  : from=2026-10-01&to=2026-10-01
Respons: { "data": [ { "store_id": "01a03ea9-...", "store_name": "DAAN MOGOT", "user_count": 55, ... }, ... ] }
```

*Contoh data fiktif:*
```json
{
  "data": [
    { "store_id": "01a03ea9-6bd0-790a-ad8e-4d895a0052d2", "store_name": "DAAN MOGOT",
      "user_count": 55, "upload_bytes": 104857600, "download_bytes": 524288000, "total_traffic": 629145600 },
    { "store_id": "01a03e86-e023-7903-b46c-2e0d2773017a", "store_name": "CILILITAN BESAR",
      "user_count": 38, "upload_bytes": 52428800, "download_bytes": 262144000, "total_traffic": 314572800 }
  ]
}
```

**3. Metrics (KPI)**

```
URL    : https://lawson-api.tachyon.net.id/api/v1/dashboard/metrics
Metode : GET
Header : Authorization: Bearer <access_token>
Param  : from=2026-10-01&to=2026-10-31
Respons: { "data": { "new": 980, "returning": 1240, "total": 2220 } }
```

#### Perbedaan utama Hypernet vs Tachyon

| Aspek | Hypernet | Tachyon |
|---|---|---|
| Autentikasi | Cookie sesi | Bearer Token |
| Identitas toko | Nama teks (contoh: "Lawson Site - Cipete") | UUID (contoh: "01a03e86-e023-...") |
| Data upload/download | Tidak dipisahkan (hanya total) | Dipisahkan (upload + download) |
| KPI yang tersedia | New, New Returning, Returning, All Users | New, Returning, Total |

---

## 5. Penyimpanan Data & Logika Toko

### Di mana data disimpan?

Web ini mendukung **3 opsi database**, dipilih secara otomatis berdasarkan variabel lingkungan:

| Prioritas | Opsi | Kapan Digunakan | File Terkait |
|---|---|---|---|
| 1 (tertinggi) | **Turso** (database cloud berbasis libSQL) | Jika `TURSO_DATABASE_URL` tersedia | `lib/db.ts` |
| 2 | **Supabase** (database cloud berbasis PostgreSQL) | Jika `SUPABASE_URL` dan `SUPABASE_SERVICE_KEY` tersedia | `lib/db.ts` |
| 3 (fallback) | **SQLite lokal** (file di server) | Jika tidak ada variabel cloud | `data/wifi_rekap.db` |

Untuk deploy di Vercel (serverless), **Turso sangat disarankan** karena SQLite lokal tidak cocok dengan lingkungan serverless.

### Tabel-tabel dalam database

| Nama Tabel | Isi | Dihapus Otomatis? |
|---|---|---|
| `daily_store_stats` | Data harian per toko: jumlah pengguna, transfer data, durasi. Kunci utama: (source, source_key, date). | Ya (lihat Retensi) |
| `kpi_cache` | Cache KPI footfall/metrics per vendor per rentang tanggal. | Ya (lihat Retensi) |
| `stores` | Daftar semua toko yang pernah muncul dari vendor, beserta nama tampilan, kode toko (kd_store), tanggal aktivasi, dan flag visibilitas. | Tidak |
| `store_assignments` | Penugasan AM/AC per toko per bulan (tabel historis lama, dipakai sebagai fallback). | Tidak |
| `store_am_ac_history` | Riwayat penugasan AM/AC per kd_store per bulan (tabel utama yang digunakan saat ini). | Tidak |
| `sync_sessions` | Token sesi login vendor yang sedang aktif. Berlaku maksimal 15 menit. | Ya (otomatis saat kadaluarsa) |
| `auto_clean_logs` | Log riwayat pembersihan data otomatis. | Tidak |
| `scheduler_lock` | Kunci untuk mencegah pembersihan data berjalan dua kali bersamaan. | Tidak |

### Bagaimana data disimpan atau diperbarui (Upsert)?

Saat data ditarik dari vendor, sistem menggunakan strategi **upsert** — artinya:
- Jika data untuk toko + tanggal tersebut **belum ada** → data baru ditambahkan.
- Jika data untuk toko + tanggal tersebut **sudah ada** → data yang lama **ditimpa** dengan nilai baru.

Ini memastikan data selalu up-to-date meski Tarik Data dilakukan berkali-kali untuk tanggal yang sama. Fungsinya ada di `lib/db.ts`, fungsi `upsertDailyStoreStats()`.

### Pendaftaran Toko Baru Otomatis & Cara Melengkapinya

Saat Anda menekan tombol "Tarik Data", sistem secara otomatis memeriksa apakah ada toko baru di vendor:

1. **Apakah toko baru otomatis ketarik?**
   - **Ya, 100% otomatis!** Fungsi `autoRegisterStores()` di `lib/db.ts` akan langsung memasukkan toko baru ke tabel `stores`.
   - Data trafik pengguna WiFi hariannya pun **langsung tersimpan** ke tabel `daily_store_stats`.

2. **Bagaimana status awal toko baru tersebut?**
   - **Visibilitas (`is_visible = 0`)**: Otomatis berstatus **Sembunyi**. Hal ini sengaja agar dasbor utama tidak langsung berantakan jika toko baru tersebut ternyata adalah toko uji coba, toko gudang, atau lokasi testing vendor.
   - **Label Toko Baru (`is_new_flag = 1`)**: Diberi penanda khusus sehingga di halaman Master Toko akan muncul badge/label kuning bertuliskan **"Baru"**.
   - **Kd Store, Tgl Aktivasi, AM, & AC**: Berstatus **kosong (`null`)**, karena API vendor memang tidak menyimpan kode toko internal Lawson maupun nama AM/AC.

3. **Bagaimana cara mengubah dan melengkapinya?**
   Buka halaman **Master Toko** (`/stores`). Ada dua cara:
   - **Cara Manual**: Centang filter *"Toko Baru Saja"*, klik switch menjadi **Tampil**, ketik **Kd Store** (misal: `6AXX`), masukkan **Tanggal Aktivasi**, pilih **AM & AC**, lalu klik tombol kecil *"Hapus label baru"*.
   - **Cara Semi-Otomatis (Import Excel)**: Cukup ketik **Kd Store** pada toko baru tersebut, lalu klik tombol **"Import Excel Struktur"** di pojok kanan atas dan unggah file Excel Struktur Nasional Lawson bulanan. Sistem akan secara otomatis mencari sheet **"MASTER"**, mencocokkan Kd Store, dan mengisi nama AM & AC secara serentak. Jika file tidak memiliki sheet `MASTER`, sistem akan langsung memunculkan notifikasi peringatan.

### Logika Filter Toko Berbasis Waktu (Kenapa 40 di DB, 27 di Dasbor, 17 di Juni?)

Sering muncul pertanyaan: *"Kenapa di database ada 40 toko, di dasbor bulan ini muncul 27 toko, tapi pas pilih bulan Juni yang muncul hanya 17 toko?"*

Ini adalah **fitur filter pintar berbasis waktu** di `lib/storeAssignments.ts` (fungsi `isStoreEligibleForRange()`), agar data historis tetap akurat dan tidak memunculkan toko yang pada saat itu belum buka atau belum pasang WiFi:

```
┌─────────────────────────────────────────────────────────────────┐
│                    TOTAL TOKO DI DATABASE                       │
│                           (40 Toko)                             │
│   Seluruh data mentah yang pernah dikembalikan oleh API vendor  │
└────────────────────────────────┬────────────────────────────────┘
                                 │ Difilter status "Tampil" (is_visible = 1)
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                     TOKO PANTAUAN AKTIF                         │
│                           (27 Toko)                             │
│       Toko resmi Lawson yang statusnya diaktifkan di Master Toko │
└─────────────────┬─────────────────────────────┬─────────────────┘
                  │                             │
    Pilih Bulan Berjalan (misal: Oktober)       │ Pilih Bulan Historis (misal: Juni)
                  │                             │
                  ▼                             ▼
┌───────────────────────────────────┐ ┌───────────────────────────────────┐
│          TAMPIL 27 TOKO           │ │          TAMPIL 17 TOKO           │
│  Semua 27 toko sudah aktif dan    │ │  10 toko baru belum pasang WiFi   │
│  tercatat di struktur organisasi. │ │  atau belum masuk struktur AM/AC  │
└───────────────────────────────────┘ └───────────────────────────────────┘
```

Aturan pemeriksaannya terdiri dari 3 lapis:
1. **Lapis 1 - Status Master Toko (`is_visible`)**:
   Hanya toko berstatus "Tampil" yang boleh masuk dasbor (maksimal 27 toko). 13 toko lainnya disembunyikan.
2. **Lapis 2 - Tanggal Aktivasi (`activation_date`)**:
   Jika tanggal aktivasi toko berada setelah rentang tanggal yang dipilih (`activation_date > endDate`), toko otomatis disembunyikan karena pada tanggal tersebut WiFi memang belum terpasang di toko.
   *Contoh:* Toko Cihampelas baru pasang WiFi tanggal 19 Agustus 2026. Saat membuka bulan Juni, toko ini otomatis tidak ditampilkan.
3. **Lapis 3 - Riwayat Snapshot AM & AC (`referensi/am_ac_histori.tsv`)**:
   Sistem mencatat kapan toko pertama kali masuk struktur pengawasan nasional:
   - Snapshot paling awal adalah **Juli 2026** (yang juga berlaku untuk bulan-bulan historis sebelumnya seperti Juni). Pada masa ini, toko yang terpasang WiFi **persis ada 17 toko acuan**.
   - Sebanyak **10 toko lainnya** (seperti *Cihampelas, Summarecon Serpong, Gili Sampeng, Purwakarta Rest Area 72A*, dll.) baru resmi beroperasi dan masuk struktur organisasi pada **Agustus, September, atau Oktober 2026**.
   - Karena ke-10 toko tersebut baru ada di bulan Agustus ke atas, maka ketika dasbor diarahkan ke bulan Juni, ke-10 toko tersebut otomatis disembunyikan, menyisakan **17 toko** yang memang sah beroperasi pada bulan Juni.

### Retensi Data (Pembersihan Otomatis)

Sistem secara otomatis **membersihkan data lama** agar database tidak terlalu besar. Aturannya:

- Data boleh disimpan maksimal **93 hari** ke belakang dari hari ini.
- Setiap **14 hari sekali**, sistem menghapus **7 hari data terlama** yang sudah melewati batas 93 hari.
- Pembersihan **hanya menyentuh** `daily_store_stats` dan `kpi_cache`. Tabel `stores` dan `store_assignments` **tidak pernah dihapus**.
- Pembersihan dicatat ke tabel `auto_clean_logs`.
- Pembersihan berjalan secara otomatis di background setiap kali halaman "Kelola Database" dibuka (`GET /api/data/manage`), atau bisa dipicu manual melalui endpoint `/api/retention/cleanup`.

Logika pembersihan ada di `lib/db.ts`, fungsi `runAutoRetentionCleanup()`.

---

## 6. Konfigurasi dan Deploy

### Variabel Lingkungan yang Dibutuhkan

> **Penting:** Variabel ini diatur di file `.env.local` (lokal) atau di panel Settings Vercel (production). Jangan pernah menulis nilainya langsung di kode.

| Nama Variabel | Wajib? | Keterangan |
|---|---|---|
| `ACCESS_CODE` | Disarankan | Kode akses yang digunakan pengguna untuk login ke web. Default: `lawson2026`. |
| `HYPERNET_USER` | Opsional* | Username akun Hypernet |
| `HYPERNET_PASS` | Opsional* | Password akun Hypernet |
| `TACHYON_USER` | Opsional* | Username akun Tachyon |
| `TACHYON_PASS` | Opsional* | Password akun Tachyon |
| `TURSO_DATABASE_URL` | Disarankan (production) | URL database Turso cloud |
| `TURSO_AUTH_TOKEN` | Disarankan (production) | Token autentikasi Turso |
| `SUPABASE_URL` | Opsional** | URL project Supabase (alternatif Turso) |
| `SUPABASE_SERVICE_KEY` | Opsional** | Service key Supabase (alternatif Turso) |

> \* Jika tidak diisi, pengguna akan diminta memasukkan username/password vendor secara manual setiap kali menekan tombol Tarik Data.
>
> \*\* Tidak perlu diisi jika sudah menggunakan Turso.

### Cara Menjalankan di Komputer Lokal (Mode Pengembangan)

```
1. Salin .env.example menjadi .env.local dan isi nilainya.
2. Jalankan: npm install
3. Jalankan: npm run dev
4. Buka browser: http://localhost:3000
```

### Cara Build dan Deploy ke Production (Vercel)

```
1. Pastikan variabel lingkungan sudah diatur di Vercel Settings.
2. Push kode ke GitHub (branch main/master).
3. Vercel otomatis mendeteksi perubahan dan melakukan build.
4. Atau build manual: npm run build → npm run start
```

### Teknologi yang Dipakai

| Teknologi | Versi | Fungsi |
|---|---|---|
| Next.js | 16.4.0 | Framework web (React + server API) |
| React | 19.3.0 | Library tampilan antarmuka |
| TypeScript | 5.x | Bahasa pemrograman (JavaScript + tipe data) |
| @libsql/client | 0.18.0 | Koneksi ke database Turso/SQLite |
| @supabase/supabase-js | 2.117.3 | Koneksi ke database Supabase |
| ExcelJS | 4.4.0 | Membuat file Excel |
| Recharts | 3.10.1 | Grafik di dasbor |
| Tailwind CSS | 4.x | Gaya tampilan |

---

## 7. Masalah Umum dan Tanya Jawab (FAQ)

### 🔴 Data tidak muncul di dasbor

**Penyebab kemungkinan:**

1. **Belum pernah Tarik Data** untuk rentang tanggal yang dipilih.
   - *Solusi:* Klik tombol "Tarik Data", pilih rentang tanggal, dan tunggu sampai selesai.

2. **Toko tidak tampil karena `is_visible = 0`.**
   - *Solusi:* Buka halaman Master Toko → cari toko → aktifkan tombol tampil (ikon mata).

3. **Rentang tanggal yang dipilih terlalu jauh ke belakang** (lebih dari 93 hari dari hari ini).
   - *Solusi:* Data tersebut sudah dibersihkan oleh sistem retensi. Pilih rentang yang lebih baru.

4. **Toko baru yang tanggal aktivasinya setelah rentang yang dipilih** tidak akan tampil.
   - *Ini bukan bug, ini aturan bisnis.* Toko hanya muncul setelah tanggal aktivasinya.

---

### 🔴 Proses Tarik Data gagal / error

**Penyebab kemungkinan:**

1. **Username atau password vendor salah.**
   - *Cek:* Pastikan `HYPERNET_USER`, `HYPERNET_PASS`, `TACHYON_USER`, `TACHYON_PASS` di `.env.local` sudah benar.
   - Jika salah, sistem akan menampilkan: `"Login Hypernet gagal: Username atau password salah."`

2. **Sesi vendor kedaluwarsa saat proses sedang berjalan.**
   - Sesi hanya berlaku 15 menit. Jika Tarik Data terlalu lama, sesi bisa habis.
   - *Solusi:* Mulai ulang proses Tarik Data.

3. **Server vendor sedang down atau tidak bisa dijangkau.**
   - Sistem otomatis mencoba ulang 2 kali. Jika tetap gagal, tunggu beberapa menit dan coba lagi.

4. **Format respons vendor berubah** (jarang terjadi, tapi mungkin setelah vendor update sistem mereka).
   - *Cek:* Akan ada pesan error seperti `"Format respon Hypernet tidak sesuai (properti 'cells' hilang)."`
   - Harus dilaporkan ke tim teknis untuk disesuaikan.

---

### 🔴 Ekspor Excel tidak berfungsi

**Penyebab kemungkinan:**

1. Tidak ada data yang dimuat terlebih dahulu di dasbor.
   - *Solusi:* Pastikan data sudah tampil di tabel dasbor sebelum ekspor.

2. Pemblokir popup di browser.
   - *Solusi:* Izinkan popup untuk situs ini di pengaturan browser.

---

### 🔴 Login gagal (kode akses ditolak)

**Penyebab kemungkinan:**

1. Kode akses salah atau sudah diubah.
   - *Cek:* Lihat variabel `ACCESS_CODE` di `.env.local` atau Vercel Settings.
   - Default jika variabel tidak diisi: `lawson2026` (lihat `lib/constants.ts`, baris 32).

2. Cookie lama yang berisi kode lama masih tersimpan di browser.
   - *Solusi:* Logout terlebih dahulu atau hapus cookie browser untuk situs ini.

---

### 🔴 Import Excel gagal: "Tidak ada sheet 'MASTER' di dalam file Excel"

**Penyebab:**
Sistem sengaja mengunci pencarian data struktur hanya ke sheet bernama **`MASTER`** sebagai sumber resmi tunggal (*single source of truth*) struktur organisasi Lawson nasional. Hal ini untuk mencegah sistem salah membaca sheet lain yang berisi data sementara, pergantian struktur parsial, atau catatan internal lainnya.

**Solusi:**
1. Pastikan file yang diunggah adalah file resmi **Struktur Nasional**.
2. Buka file Excel tersebut dan periksa tab sheet di bagian bawah. Pastikan sheet utama struktur toko dinamai **`MASTER`** (huruf besar/kecil tidak masalah, misal `MASTER`, `Master`, atau `master`).
3. Pastikan di dalam sheet `MASTER` tersebut terdapat kolom kode toko (`KD STORE`), nama toko (`NAMA STORE`), serta `AM` dan `AC`.

---

### ❓ Bagaimana cara kerja fitur Import Excel Struktur jika file memiliki banyak sheet?

1. **Fokus Tunggal ke Sheet "MASTER"**: Meskipun file Excel Struktur Nasional memuat belasan sheet (*Pergantian Struktur*, *MDP AC*, *TOKO TUTUP*, dsb.), sistem secara otomatis **hanya membaca sheet "MASTER"**.
2. **Pencarian Baris Judul Otomatis (Regex Fuzzy)**: Sistem tidak mengunci letak baris atau huruf kolom. Sistem memindai baris 1 s/d 30 pada sheet `MASTER` untuk menemukan kolom kode toko dan nama AM/AC.
3. **Penyaringan Toko Free WiFi**: Dari ratusan toko nasional di sheet `MASTER`, sistem hanya mencocokkan kode toko dengan toko Free WiFi di database Anda. Toko Lawson reguler lainnya otomatis dikelompokkan ke *"Di Luar DB"* sehingga tidak mengotori database.
4. **Keamanan Data**: File Excel tidak disimpan di harddisk server (hanya dibaca beberapa detik di RAM lalu dibuang). Data tersimpan rapi khusus untuk bulan target yang Anda pilih.

---

### ❓ Kenapa jumlah toko saat saya pilih bulan Juni (17 toko) berbeda dengan bulan berjalan sekarang (27 toko)?

**Bukan error atau data hilang, melainkan fitur pintar berbasis tanggal aktif & riwayat organisasi:**
1. **Tanggal Aktivasi WiFi**: Sistem memeriksa kapan toko tersebut dipasangi WiFi. Jika toko baru pasang WiFi di bulan Agustus (seperti Lawson Cihampelas), maka saat Anda membuka laporan bulan Juni, toko tersebut **otomatis disembunyikan** karena pada bulan Juni toko tersebut memang belum memiliki fasilitas WiFi.
2. **Riwayat Struktur Organisasi AM/AC**: Pada data snapshot historis awal (Juli 2026 dan bulan sebelumnya seperti Juni), jumlah toko acuan yang aktif baru **17 toko**. Sebanyak 10 toko lainnya baru buka dan masuk struktur di bulan Agustus ke atas. Sistem secara otomatis menyelaraskan agar laporan bulan lalu hanya menampilkan toko yang memang sudah eksis pada bulan tersebut.

---

### ❓ Kalau ada toko baru di web vendor, apakah datanya otomatis ketarik dan bagaimana status AM/AC-nya?

1. **Otomatis Ketarik 100%**: Saat Anda klik tombol "Tarik Data", sistem secara otomatis mendaftarkan toko baru tersebut ke database dan menyimpan data penggunaan WiFi hariannya.
2. **Status Awal Bawaan**:
   - Status diatur **Sembunyi (`is_visible = 0`)** agar tidak langsung mengotori dasbor jika toko tersebut ternyata toko testing/gudang.
   - Diberi tanda badge kuning bertuliskan **"Baru"** di halaman Master Toko.
   - Kode Toko (Kd Store), Tanggal Aktivasi, AM, dan AC berstatus **kosong** karena API vendor tidak memiliki data tim internal Lawson.
3. **Cara Mengaturnya**:
   - Buka menu **Master Toko** (`/stores`).
   - Ubah saklar status menjadi **Tampil**.
   - Masukkan **Kd Store** dan **Tanggal Aktivasi**.
   - Untuk AM & AC: Anda bisa ketik manual atau gunakan tombol **"Import Excel Struktur"** untuk mengisi AM & AC semua toko secara instan dari file Excel Struktur Nasional.
   - Klik *"Hapus label baru"* jika data toko sudah lengkap.

---

## 8. Glosarium

| Istilah | Artinya |
|---|---|
| **API** | "Application Programming Interface" — seperti pelayan restoran. Web kita memesan data lewat API, vendor menyiapkannya. |
| **Endpoint** | Alamat URL spesifik untuk satu layanan tertentu, seperti alamat loket yang berbeda-beda di kantor pos. |
| **GET / POST / PATCH / DELETE** | Jenis permintaan ke server: GET = minta data, POST = kirim/buat data baru, PATCH = ubah sebagian, DELETE = hapus. |
| **Database** | Tempat penyimpanan data terstruktur, seperti lemari arsip digital yang terorganisir. |
| **Tabel** | Seperti lembar di Excel: ada baris (data) dan kolom (jenis data). |
| **Upsert** | Gabungan "update" dan "insert": kalau sudah ada, perbarui; kalau belum ada, tambahkan. |
| **Cookie** | Catatan kecil yang disimpan di browser pengguna, digunakan untuk mengingat bahwa pengguna sudah login. |
| **Token / Bearer Token** | Tiket masuk digital yang dikirim bersama setiap permintaan ke vendor sebagai bukti sudah login. |
| **Vendor** | Perusahaan penyedia layanan WiFi untuk toko (dalam kasus ini: Hypernet dan Tachyon). |
| **Sinkronisasi / Sync** | Proses menyamakan data dari sumber eksternal (vendor) ke database kita. |
| **Variabel Lingkungan (Environment Variable)** | Pengaturan rahasia yang disimpan di server, bukan di kode program. Contoh: password, URL database. |
| **Serverless** | Cara deploy aplikasi di cloud tanpa perlu mengelola server sendiri (contoh: Vercel). |
| **SQLite** | Jenis database yang disimpan dalam satu file, cocok untuk pengembangan lokal. |
| **Turso** | Layanan database cloud berbasis SQLite, cocok untuk aplikasi serverless. |
| **Supabase** | Layanan database cloud berbasis PostgreSQL. |
| **KPI** | "Key Performance Indicator" — angka ringkasan performa, dalam konteks ini jumlah pengguna WiFi baru vs. yang kembali. |
| **Footfall** | Istilah Hypernet untuk jumlah pengguna WiFi yang terdeteksi dalam periode tertentu. |
| **is_visible** | Flag (tanda) di database: 1 = toko tampil di dasbor, 0 = toko tersembunyi. |
| **is_new_flag** | Flag di database: 1 = toko baru terdeteksi dari vendor (belum diverifikasi tim). |
| **kd_store** | Kode toko internal Lawson (format: 6A19, 6A0W, dst.). Digunakan sebagai kunci pencocokan data AM/AC. |
| **AM** | Area Manager — penanggung jawab wilayah di level manajemen. |
| **AC** | Area Coordinator — koordinator di lapangan. |
| **Retensi** | Kebijakan berapa lama data disimpan sebelum dihapus otomatis (batas 93 hari dalam sistem ini). |
| **Upsert** | Operasi database: jika data sudah ada, timpa; jika belum ada, tambah. |
| **source_key** | Identitas unik toko di sistem vendor: nama teks di Hypernet, UUID di Tachyon. |
| **UUID** | Kode unik acak yang panjang, dipakai Tachyon untuk mengidentifikasi toko. Contoh: `01a03ea9-6bd0-...` |
| **Next.js** | Framework web yang dipakai untuk membangun aplikasi ini. Menggabungkan tampilan (React) dan logika server dalam satu paket. |
| **httpOnly Cookie** | Cookie yang hanya bisa dibaca oleh server, tidak bisa diakses oleh JavaScript di browser — lebih aman. |
