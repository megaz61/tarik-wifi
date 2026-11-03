# Panduan & Cara Kerja Import Struktur AM / AC dari Excel

Dokumen ini menjelaskan secara rinci dan mudah dipahami mengenai **cara kerja sistem membaca dan mengambil data AM (Area Manager), AC (Area Coordinator), Kd Store, dan Nama Store** dari file Excel Struktur Nasional Lawson, meskipun format atau letak kolomnya berubah-ubah setiap bulannya.

---

## 1. Ringkasan Singkat

| Pertanyaan | Jawaban |
|---|---|
| **Apakah file Excel-nya disimpan di server/database?** | **TIDAK.** File Excel hanya dibaca di memori RAM selama 1–2 detik, lalu langsung dibuang. Tidak ada file `.xlsx` yang tersimpan di harddisk maupun database. |
| **Sheet mana yang dibaca?** | **Khusus sheet `MASTER`.** Sistem memprioritaskan sheet `MASTER` sebagai sumber resmi struktur nasional. Jika file tidak memiliki sheet `MASTER`, sistem langsung menampilkan notifikasi error. |
| **Apa yang sebenarnya disimpan?** | Hanya **4 teks singkat per toko**: `kd_store` (kode toko), `month` (bulan target), `am` (nama AM), dan `ac` (nama AC). |
| **Apakah mengubah database vendor?** | **TIDAK.** Fitur ini hanya memperbarui tabel lokal Anda sendiri: `store_am_ac_history`. |
| **Bagaimana jika kolom di Excel pindah posisi?** | **Tetap terbaca otomatis.** Sistem tidak mengunci posisi kolom (seperti kolom A, B, atau C), melainkan mencari baris judul (header) secara dinamis pada sheet `MASTER` dengan pencocokan pola teks (*regex fuzzy matching*). |

---

## 2. Alur Kerja (Step-by-Step)

```
[User Upload File Excel]
           ↓
[Dibaca di Memori RAM oleh ExcelJS]
           ↓
[Cek Sheet "MASTER"]
   ├── Jika tidak ada -> Beri notifikasi: "Tidak ada sheet 'MASTER'"
   └── Jika ada -> Lanjut proses
           ↓
[Scan Baris Judul Kolom pada Sheet MASTER (Fuzzy Regex)]
           ↓
[Ekstrak Nilai: Kd Store, Nama Store, AM, AC]
           ↓
[Cocokkan dengan Database Master Toko & Cek Tanggal Aktivasi WiFi]
           ↓
[Tampilkan Preview: Toko Aktif vs Toko Belum Aktif]
           ↓
[User Konfirmasi Simpan -> Upsert Teks ke store_am_ac_history]
```

---

## 3. Cara Sistem Mencari Sheet "MASTER" & Kolom Otomatis

File Excel Struktur Nasional Lawson biasanya memiliki banyak sheet (seperti *Pergantian Struktur*, *MDP AC*, *TOKO TUTUP*, dll). Agar data yang diambil selalu akurat dan tidak tercampur dengan sheet parsial/sementara, sistem bekerja dengan langkah berikut:

### A. Verifikasi Sheet "MASTER"
1. Sistem mencari sheet dengan nama **`MASTER`** (tidak sensitif huruf besar/kecil: `MASTER`, `Master`, atau `master`).
2. **Jika sheet `MASTER` tidak ditemukan**:
   Sistem langsung membatalkan proses dan menampilkan notifikasi:
   > ❌ *Tidak ada sheet "MASTER" di dalam file Excel. Pastikan file Struktur Nasional memiliki sheet bernama "MASTER".*
3. **Jika sheet `MASTER` ditemukan**: Sistem melanjutkan ke tahap pemindaian baris judul.

### B. Memindai Baris Judul pada Sheet "MASTER" (Baris 1 s/d 30)
Di dalam sheet `MASTER`, posisi baris judul bisa berubah di setiap edisi bulanan (misalnya di baris 6 atau baris 12). Sistem memindai sel dari baris 1 sampai baris ke-30:
1. Membaca teks di setiap sel pada baris tersebut.
2. Memeriksa apakah teks sel cocok dengan pola kata kunci kolom berikut:

| Kolom Target | Pola Teks yang Dikenali Otomatis (*Case-Insensitive*) |
|---|---|
| **`kd_store`** | `KD STORE`, `KODE STORE`, `KODE`, `KD`, `STORE CODE`, `CODE` |
| **`nama_store`** | `NAMA STORE`, `NAMA TOKO`, `STORE NAME`, `NAMA` |
| **`ac`** | Seluruh variasi kata yang memuat `AREA COORDINATOR` atau singkatan `AC` |
| **`am`** | Seluruh variasi kata yang memuat `AREA MANAGER` atau singkatan `AM` |

### C. Validasi Baris Header
Sebuah baris dinyatakan sebagai **Baris Judul yang Sah** jika pada baris tersebut ditemukan:
- Kolom **`kd_store`** **DAN**
- Minimal salah satu kolom **`am`** atau **`ac`**.

Begitu baris judul ditemukan, sistem langsung mencatat nomor kolom masing-masing (misalnya pada file contoh: *Kd Store di Kolom 4, Nama di Kolom 5, AC di Kolom 31, AM di Kolom 32*).

---

## 4. Cara Pengambilan Nilai Sel (Row Parsing)

Setelah nomor kolom diketahui, sistem mulai membaca baris data tepat di bawah baris judul sampai akhir tabel:

1. **Pembersihan Kode Toko (`kd_store`)**:
   - Spasi dan karakter aneh dibersihkan.
   - Dibuat menjadi huruf kapital semua (contoh: `"6a19 "` → `"6A19"`).
   - Baris yang bukan kode toko yang valid (misalnya baris kosong atau baris judul bab) otomatis diabaikan.

2. **Dukungan Format Kompleks Excel**:
   - Jika sel berisi teks biasa → diambil teksnya.
   - Jika sel berisi formula / rumus Excel → diambil nilai hasilnya (`formula result`).
   - Jika sel berisi teks berformat warna-warni (*Rich Text*) → digabungkan menjadi teks murni.

3. **Fokus Tunggal ke Sheet "MASTER"**:
   - Sistem langsung menargetkan sheet `MASTER` sebagai sumber kebenaran data (*single source of truth*) struktur organisasi toko nasional.
   - Jika sheet `MASTER` tidak ditemukan, sistem menolak proses dan memberikan notifikasi: *"Tidak ada sheet 'MASTER' di dalam file Excel"*, sehingga terhindar dari membaca sheet sementara / parsial yang keliru.

---

## 5. Pencocokan dengan Toko Free WiFi & Tanggal Aktivasi

Setelah data dari Excel terekstrak, sistem mencocokkannya dengan database toko Anda:

1. **Pencocokan Kd Store**:
   - Sistem membandingkan `kd_store` dari Excel dengan 27 toko Free WiFi yang ada di database Anda.
   - Toko di luar 27 toko acuan (toko Lawson reguler yang tidak pasang Free WiFi) ditandai sebagai `Di Luar DB` dan **tidak disimpan**.

2. **Pengecekan Tanggal Aktivasi Free WiFi (`activation_date`)**:
   - Sistem memeriksa bulan target yang dipilih user (misalnya `2026-07`).
   - Batas akhir bulan tersebut dihitung (misalnya `2026-07-31`).
   - **Jika `activation_date <= 2026-07-31`**: Toko dikelompokkan ke **`✅ Aktif Free WiFi`** (pada bulan Juli berjumlah **17 toko**).
   - **Jika `activation_date > 2026-07-31`**: Toko dikelompokkan ke **`⏳ Belum Aktif WiFi`** (pada bulan Juli berjumlah **10 toko**, misalnya Cihampelas yang baru aktif 19 Agustus 2026).

---

## 6. Proses Penyimpanan ke Database

Saat pengguna menekan tombol **"Simpan Toko ke Bulan [Target]"**:

1. **Perintah Database**:
   Sistem menjalankan perintah SQL *Upsert*:
   ```sql
   INSERT INTO store_am_ac_history (kd_store, month, am, ac)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(kd_store, month) DO UPDATE SET
     am = excluded.am,
     ac = excluded.ac;
   ```

2. **Keuntungan Teknis**:
   - **Bulan Lain Tidak Berubah**: Hanya baris bulan yang dipilih yang diisi/diperbarui.
   - **Anti Duplikasi**: Mengimpor berkali-kali tidak akan membuat database bengkak, karena data lama pada bulan tersebut langsung diperbarui di tempat (*in-place update*).
   - **Ukuran Sangat Ringan**: Setiap toko hanya memakan ukuran ~60 byte. 17 toko hanya memakan **~1 KB**.

---

## 7. Lokasi File Kode Terkait

Bagi pengembang yang ingin meninjau kodenya langsung di proyek ini:

- **Backend API (Logika Ekstraksi & Penyimpanan)**:
  [`app/api/stores/import-excel/route.ts`](file:///d:/CODING/tarik_freewifi/app/api/stores/import-excel/route.ts)
- **Frontend UI (Modal, Pemilih Bulan, Preview, & Filter)**:
  [`app/stores/page.tsx`](file:///d:/CODING/tarik_freewifi/app/stores/page.tsx)
- **Fungsi Database Lokal**:
  [`lib/db.ts`](file:///d:/CODING/tarik_freewifi/lib/db.ts#L756-L784) (`upsertSingleStoreAmAcHistory`)
