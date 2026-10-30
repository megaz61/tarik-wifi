# Panduan Web: Rekap WiFi Toko Lawson

> **Untuk siapa dokumen ini?**
> Dokumen ini ditujukan untuk atasan, tim operasional, atau staf baru yang ingin memahami cara kerja web ini tanpa harus membaca kode program. Setiap istilah teknis akan dijelaskan dengan bahasa sehari-hari.

---

## Daftar Isi

1. [Gambaran Umum](#1-gambaran-umum)
2. [Cara Kerja dari Awal sampai Akhir](#2-cara-kerja-dari-awal-sampai-akhir)
3. [Peta File Penting](#3-peta-file-penting)
4. [Koneksi ke Vendor](#4-koneksi-ke-vendor)
5. [Penyimpanan Data](#5-penyimpanan-data)
6. [Konfigurasi dan Deploy](#6-konfigurasi-dan-deploy)
7. [Masalah Umum dan Cara Mengeceknya](#7-masalah-umum-dan-cara-mengeceknya)
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

### 4.1 Vendor: Hypernet (`portal.openwifi.id`)

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

### 4.2 Vendor: Tachyon (`lawson-api.tachyon.net.id`)

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

## 5. Penyimpanan Data

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

### Pendaftaran Toko Baru Otomatis

Setiap kali data ditarik, semua nama/ID toko yang dikembalikan vendor **otomatis didaftarkan** ke tabel `stores` jika belum ada. Ini dilakukan oleh fungsi `autoRegisterStores()` di `lib/db.ts`.

Namun toko baru yang tidak ada dalam **daftar 27 toko acuan** (`REFERENCE_27_STORES` di `lib/db.ts`, baris 968–996) akan **langsung tersembunyi** (`is_visible = 0`) dan tidak tampil di dasbor utama, sampai diaktifkan secara manual di halaman Master Toko.

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

## 7. Masalah Umum dan Cara Mengeceknya

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

### 🔴 Toko baru aktif WiFi tidak muncul di dasbor

Ini adalah perilaku yang disengaja. Lihat penjelasan lengkap di Bab 2 (Alur Tarik Data) dan Bab 5 (Pendaftaran Toko Baru Otomatis).

**Ringkasan solusi:**
1. Lakukan Tarik Data → toko baru akan muncul di **Master Toko**.
2. Di halaman Master Toko, aktifkan tombol tampil (ikon mata) untuk toko baru tersebut.
3. Atau tambahkan toko ke daftar `REFERENCE_27_STORES` di `lib/db.ts` agar langsung tampil otomatis.

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
