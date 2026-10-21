/**
 * Global Constants & Utility Functions
 * Zona waktu: Asia/Jakarta (UTC+7)
 */

// Satuan data: 1024 (GB biner) atau 1000 (desimal).
export const BASIS_SATUAN = 1024;

// Satuan durasi dari API Tachyon: "s" = detik, "ms" = milidetik.
export const SATUAN_DURASI_TACHYON: 's' | 'ms' = 's';

// Zona Waktu
export const TIMEZONE = 'Asia/Jakarta';
export const TIMEZONE_OFFSET_HOURS = 7;

// Hypernet Config
export const HYPERNET_BASE = 'https://portal.openwifi.id';
export const HYPERNET_ROOT_ORG_ID = '84456'; // Lawson
export const HYPERNET_COLUMNS =
  'organization,users,participation,totalTransfer,transferPerUser,percentageOfTotalParentTransfer,totalDuration,durationPerUser,percentageOfTotalParentDuration';

// Tachyon Config
export const TACHYON_API_BASE = 'https://lawson-api.tachyon.net.id/api/v1';
export const TACHYON_ORIGIN = 'https://lawson-cms.tachyon.net.id';

// Politeness & Retry
export const USER_AGENT = 'Mozilla/5.0 (rekap-wifi-robot)';
export const POLITE_DELAY_MS = 600; // 0.6 detik
export const MAX_RETRIES = 2;

// Shared Access Code default fallback (in case ACCESS_CODE env is empty)
export const DEFAULT_ACCESS_CODE = 'lawson2026';
export const ACCESS_COOKIE_NAME = 'lawson_access_token';

/**
 * Format bytes ke string B / KB / MB / GB / TB
 */
export function fmtBytes(bytes: number | null | undefined, base: number = BASIS_SATUAN): string {
  if (bytes == null || isNaN(bytes)) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Number(bytes);
  let i = 0;
  while (v >= base && i < units.length - 1) {
    v /= base;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

/**
 * Format detik ke string readable "12 d 15 h 25 min 28 s"
 */
export function fmtDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || isNaN(totalSeconds) || totalSeconds <= 0) return '0 s';
  let s = Math.round(totalSeconds);
  const d = Math.floor(s / 86400);
  s %= 86400;
  const h = Math.floor(s / 3600);
  s %= 3600;
  const m = Math.floor(s / 60);
  s %= 60;

  const parts: string[] = [];
  if (d > 0) parts.push(`${d} d`);
  if (d > 0 || h > 0) parts.push(`${h} h`);
  if (d > 0 || h > 0 || m > 0) parts.push(`${m} min`);
  parts.push(`${s} s`);
  return parts.join(' ');
}

/**
 * Mendapatkan tanggal saat ini di zona Asia/Jakarta (YYYY-MM-DD)
 */
export function getJakartaToday(): string {
  const now = new Date();
  // now.getTime() selalu UTC ms; tambah offset Jakarta langsung ke UTC
  const jakartaDate = new Date(now.getTime() + 3600000 * TIMEZONE_OFFSET_HOURS);
  return jakartaDate.toISOString().slice(0, 10);
}

/**
 * Mendapatkan tanggal kemarin di zona Asia/Jakarta (YYYY-MM-DD, H-1)
 */
export function getJakartaYesterday(todayStr?: string): string {
  const today = todayStr || getJakartaToday();
  const [y, m, d] = today.split('-').map(Number);
  const prevDate = new Date(Date.UTC(y, m - 1, d - 1));
  return prevDate.toISOString().slice(0, 10);
}

/**
 * Menghitung batas milidetik UTC untuk Hypernet:
 * "DateStart, DateEnd (milidetik; tengah malam UTC dari tanggalnya;
 * DateEnd = tengah malam UTC hari setelah tanggal akhir, eksklusif)"
 */
export function hypernetDayRangeMs(startDateStr: string, endDateStr?: string): { startMs: number; endMs: number } {
  const [sY, sM, sD] = startDateStr.split('-').map(Number);
  const [eY, eM, eD] = (endDateStr || startDateStr).split('-').map(Number);

  // UTC midnight start
  const startUtc = Date.UTC(sY, sM - 1, sD, 0, 0, 0, 0);
  // UTC midnight end = end_day + 1 day
  const endUtc = Date.UTC(eY, eM - 1, eD, 0, 0, 0, 0) + 86400000;

  return { startMs: startUtc, endMs: endUtc };
}

/**
 * Sleep helper
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const INDONESIAN_MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export const INDONESIAN_MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des',
];

export const INDONESIAN_MONTHS_UPPER = [
  'JAN', 'FEB', 'MAR', 'APR', 'MEI', 'JUN',
  'JUL', 'AGT', 'SEP', 'OKT', 'NOV', 'DES',
];

/**
 * Format tanggal YYYY-MM-DD ke header tabel "08-Okt-26"
 */
export function formatDateColumnHeader(dateStr: string): string {
  if (!dateStr || dateStr.length < 10) return dateStr;
  const [y, m, d] = dateStr.split('-');
  const monthIdx = parseInt(m, 10) - 1;
  const shortMonth = INDONESIAN_MONTHS_SHORT[monthIdx] || m;
  const shortYear = y.slice(-2);
  return `${d}-${shortMonth}-${shortYear}`;
}

/**
 * Format tanggal aktivasi YYYY-MM-DD ke dd-Mmm-yy (contoh: 2025-10-29 -> 29-Okt-25)
 */
export function formatActivationDate(dateStr: string | null | undefined): string {
  if (!dateStr || dateStr === '-' || dateStr.trim() === '') return '-';
  const clean = dateStr.trim();
  if (clean.length < 10) return clean;
  const [y, m, d] = clean.split('-');
  const monthIdx = parseInt(m, 10) - 1;
  const shortMonth = INDONESIAN_MONTHS_SHORT[monthIdx] || m;
  const shortYear = y.slice(-2);
  return `${d}-${shortMonth}-${shortYear}`;
}

/**
 * Format tanggal YYYY-MM-DD ke nomor hari saja "01", "02", ... untuk klon gambar ringkas
 */
export function formatDateDayOnly(dateStr: string): string {
  if (!dateStr || dateStr.length < 10) return dateStr;
  return dateStr.slice(8, 10);
}

/**
 * Format tanggal YYYY-MM-DD ke "dd-Mmm" (contoh: 2026-10-16 -> 16-Okt)
 */
export function formatDateDayMonth(dateStr: string): string {
  if (!dateStr || dateStr.length < 10) return dateStr;
  const [, m, d] = dateStr.split('-');
  const monthIdx = parseInt(m, 10) - 1;
  const shortMonth = INDONESIAN_MONTHS_SHORT[monthIdx] || m;
  return `${d}-${shortMonth}`;
}

/**
 * Format bulan YYYY-MM ke nama bulan penuh "Oktober 2026"
 */
export function formatMonthHeader(monthRef: string): string {
  if (!monthRef || monthRef.length < 7) return monthRef;
  const [y, m] = monthRef.split('-');
  const monthIdx = parseInt(m, 10) - 1;
  const fullMonth = INDONESIAN_MONTHS[monthIdx] || m;
  return `${fullMonth} ${y}`;
}

/**
 * Singkatan bulan kapital untuk kolom "SUM OKT", "AVG OKT"
 */
export function getShortMonthUpper(monthRef: string): string {
  if (!monthRef || monthRef.length < 7) return 'BLN';
  const [, m] = monthRef.split('-');
  const monthIdx = parseInt(m, 10) - 1;
  return INDONESIAN_MONTHS_UPPER[monthIdx] || 'BLN';
}

/**
 * Menghitung periode bulanan sesuai aturan (Section 6):
 * "Periode bulanan = tanggal 1 bulan itu sampai min(akhir bulan, hari ini), hari ini ikut dihitung."
 */
// Batas maksimal penarikan dan penampilan data: 93 hari (31 × 3)
export const MAX_DATE_RANGE_DAYS = 93;

/**
 * Menghitung periode bulanan sesuai aturan:
 * Periode bulanan = tanggal 1 bulan itu sampai min(akhir bulan, hari ini).
 */
export function getMonthPeriod(monthRef: string, todayStr?: string): {
  startDate: string;
  endDate: string;
  daysCount: number;
} {
  const today = todayStr || getJakartaToday();
  const [yearStr, monthStr] = monthRef.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  const startDate = `${monthRef}-01`;
  // Tanggal terakhir sesuai kalender secara UTC aman
  const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const calendarLastDate = `${monthRef}-${String(lastDayOfMonth).padStart(2, '0')}`;

  const endDate = calendarLastDate < today ? calendarLastDate : today;

  const daysCount = calculateDaysCount(startDate, endDate);

  return { startDate, endDate, daysCount };
}

/**
 * Menghitung selisih hari kalender antara dua tanggal inklusif (YYYY-MM-DD).
 * Menggunakan UTC murni untuk mencegah pergeseran zona waktu.
 */
export function calculateDaysCount(startDateStr: string, endDateStr: string): number {
  if (!startDateStr || !endDateStr) return 0;
  const [sY, sM, sD] = startDateStr.split('-').map(Number);
  const [eY, eM, eD] = endDateStr.split('-').map(Number);
  const tStart = Date.UTC(sY, sM - 1, sD);
  const tEnd = Date.UTC(eY, eM - 1, eD);
  if (isNaN(tStart) || isNaN(tEnd)) return 0;
  return Math.round((tEnd - tStart) / 86400000) + 1;
}

/**
 * Menghasilkan daftar tanggal YYYY-MM-DD secara inklusif.
 * Sepenuhnya menggunakan UTC untuk menghindari pergeseran timezone lokal.
 */
export function getDatesInRange(startDateStr: string, endDateStr: string): string[] {
  const dates: string[] = [];
  if (!startDateStr || !endDateStr) return dates;
  const [sY, sM, sD] = startDateStr.split('-').map(Number);
  const [eY, eM, eD] = endDateStr.split('-').map(Number);
  let cur = new Date(Date.UTC(sY, sM - 1, sD));
  const end = new Date(Date.UTC(eY, eM - 1, eD));
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Validasi ketat rentang tanggal:
 * 1. Format tanggal YYYY-MM-DD.
 * 2. Tanggal akhir tidak boleh melewati hari ini (Asia/Jakarta).
 * 3. Tanggal awal harus lebih awal dari tanggal akhir (kecuali allowSingleDay = true).
 * 4. Rentang penarikan dan penampilan maksimal 93 hari kalender inklusif (31 × 3).
 * 5. Jika enforceYesterdayLimit = true: tanggal awal maksimal H-1 (hanya untuk endpoint Tarik Data).
 */
export function validateDateRange(
  startDateStr: string,
  endDateStr: string,
  todayStr?: string,
  allowSingleDay: boolean = false,
  enforceYesterdayLimit: boolean = false
): { valid: boolean; error?: string; daysCount: number } {
  const today = todayStr || getJakartaToday();

  if (!startDateStr || !endDateStr) {
    return { valid: false, error: 'Tanggal awal dan tanggal akhir wajib diisi.', daysCount: 0 };
  }

  // Format YYYY-MM-DD regex check
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(startDateStr) || !dateRegex.test(endDateStr)) {
    return { valid: false, error: 'Format tanggal harus YYYY-MM-DD.', daysCount: 0 };
  }

  // Tanggal awal maksimal H-1 – hanya untuk endpoint Tarik Data (sync/prepare)
  if (enforceYesterdayLimit) {
    const yesterday = getJakartaYesterday(today);
    if (startDateStr > yesterday) {
      return {
        valid: false,
        error: `Tanggal awal (${startDateStr}) tidak boleh melebihi kemarin (${yesterday}). Data hari ini belum lengkap.`,
        daysCount: 0,
      };
    }
  }

  if (endDateStr > today) {
    return { valid: false, error: `Tanggal akhir (${endDateStr}) tidak boleh melewati hari ini (${today}).`, daysCount: 0 };
  }

  if (!allowSingleDay && startDateStr === endDateStr) {
    return { valid: false, error: 'Tanggal awal dan tanggal akhir tidak boleh sama. Tanggal awal harus lebih awal dari tanggal akhir.', daysCount: 1 };
  }

  if (startDateStr > endDateStr) {
    return { valid: false, error: 'Tanggal awal harus lebih awal dari tanggal akhir.', daysCount: 0 };
  }

  const daysCount = calculateDaysCount(startDateStr, endDateStr);
  if (daysCount > MAX_DATE_RANGE_DAYS) {
    return {
      valid: false,
      error: `Rentang tanggal maksimal ${MAX_DATE_RANGE_DAYS} hari kalender (31 × 3). Rentang yang dipilih adalah ${daysCount} hari.`,
      daysCount,
    };
  }

  return { valid: true, daysCount };
}
