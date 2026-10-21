/**
 * Single Unified Helper: Penugasan AM & AC Bulanan + Filter Toko Belum Aktif (Target D)
 * Modul MURNI (Pure Client/Shared) - TANPA dependensi DB, fs, path, atau server.
 * Digunakan secara konsisten oleh:
 * - app/page.tsx (Client Component)
 * - lib/excelExport.ts
 * - app/api/data/stats/route.ts
 * - app/api/stores/route.ts
 */

export interface StoreEffectiveAmAc {
  am: string | null;
  ac: string | null;
  effectiveMonth: string;
}

export interface StoreBaseInfo {
  id: string;
  source: string;
  source_key: string;
  display_name: string;
  kd_store: string | null;
  activation_date: string | null;
  active: number | boolean;
  is_visible?: number;
}

export interface StoreAmAcHistoryItem {
  kd_store: string;
  month: string;
  am: string | null;
  ac: string | null;
}

/**
 * Pure function: Hitung AM/AC efektif dari array history
 */
export function computeEffectiveAmAcMap(
  history: StoreAmAcHistoryItem[],
  targetMonth: string
): Map<string, StoreEffectiveAmAc> {
  const effectiveMonthRef = targetMonth < '2026-07' ? '2026-07' : targetMonth;

  // Kelompokkan history per kd_store
  const byKd = new Map<string, StoreAmAcHistoryItem[]>();
  for (const item of history) {
    const kd = item.kd_store.trim().toUpperCase();
    if (!byKd.has(kd)) byKd.set(kd, []);
    byKd.get(kd)!.push(item);
  }

  const result = new Map<string, StoreEffectiveAmAc>();
  for (const [kd, items] of byKd.entries()) {
    // Cari item dengan month <= effectiveMonthRef yang paling baru (terbesar)
    const candidates = items
      .filter((i) => i.month <= effectiveMonthRef)
      .sort((a, b) => b.month.localeCompare(a.month));

    if (candidates.length > 0) {
      result.set(kd, {
        am: candidates[0].am,
        ac: candidates[0].ac,
        effectiveMonth: candidates[0].month,
      });
    }
  }

  return result;
}

/**
 * Menghitung bulan pertama kemunculan toko di riwayat snapshot
 * Toko Juli dianggap berlaku untuk Juli dan bulan sebelumnya.
 */
export function computeFirstSeenMonthMap(
  history: StoreAmAcHistoryItem[]
): Map<string, string> {
  const firstSeen = new Map<string, string>();
  for (const item of history) {
    const kd = item.kd_store.trim().toUpperCase();
    const cur = firstSeen.get(kd);
    if (!cur || item.month < cur) {
      firstSeen.set(kd, item.month);
    }
  }
  return firstSeen;
}

/**
 * Cek apakah toko aktif dan boleh tampil pada rentang tanggal terpilih (Aturan D6)
 *
 * Rentang [startDate, endDate], bulan acuan = endDate.slice(0, 7).
 * Toko tampil jika:
 * 1. Status visibility toko aktif (bukan disembunyikan permanen di Master Toko).
 * 2. Tgl Aktivasi: jika diketahui, harus <= endDate. (Jika activation_date > endDate, toko belum aktif -> tidak tampil).
 * 3. Riwayat snapshot:
 *    - Jika toko ada di snapshot riwayat:
 *      Bulan acuan (endDate) harus >= firstSeenMonth toko.
 *      (Catatan: toko Juli memiliki firstSeenMonth = '2026-07', berlaku untuk <= 2026-07).
 *      Toko yang baru muncul di snapshot Agustus (e.g. 6A8U Cihampelas, firstSeen = '2026-08') TIDAK tampil pada rentang sebelum Agustus (e.g. Juni atau Juli).
 *    - Jika toko tidak memiliki catatan riwayat sama sekali (e.g. toko test / kd_store "-"), mengikuti filter visibility.
 */
export function isStoreEligibleForRange(
  store: StoreBaseInfo,
  startDate: string,
  endDate: string,
  firstSeenMap?: Map<string, string>,
  onlyVisible: boolean = true,
  showInactive: boolean = false
): boolean {
  // 1. Filter visibility (Tampil/Sembunyi)
  if (onlyVisible && store.is_visible !== undefined && store.is_visible !== 1) {
    return false;
  }

  // 2. Filter status active
  const isActive = store.active === 1 || store.active === true;
  if (!showInactive && !isActive) {
    return false;
  }

  const kd = store.kd_store ? store.kd_store.trim().toUpperCase() : null;
  const monthRef = endDate.slice(0, 7);

  // 3. Tgl Aktivasi check
  const actDate = store.activation_date?.trim();
  if (actDate && actDate !== '-' && actDate !== '') {
    // Jika tgl aktivasi toko berada SETELAH rentang akhir, toko belum pasang WiFi -> TIDAK TAMPIL
    if (actDate > endDate) {
      return false;
    }
  }

  // 4. Snapshot check
  if (kd && firstSeenMap && firstSeenMap.has(kd)) {
    const firstMonth = firstSeenMap.get(kd)!;
    // Jika bulan pertama adalah '2026-07', toko berlaku untuk Juli dan semua bulan sebelumnya
    // Jika bulan pertama > '2026-07' (misal '2026-08' seperti Cihampelas), toko tidak boleh muncul sebelum bulan pertama tersebut
    if (firstMonth > '2026-07' && monthRef < firstMonth) {
      return false;
    }
  }

  return true;
}

/**
 * Cek apakah sel tanggal spesifik 'd' valid untuk toko tersebut.
 * Jika d < store.activation_date, sel harus ditampilkan sebagai "-" (bukan angka 0).
 */
export function isDateBeforeActivation(
  storeActivationDate: string | null | undefined,
  dateStr: string
): boolean {
  if (!storeActivationDate || storeActivationDate === '-' || storeActivationDate.trim() === '') {
    return false;
  }
  return dateStr < storeActivationDate.trim();
}
