import {
  TACHYON_API_BASE,
  TACHYON_ORIGIN,
  SATUAN_DURASI_TACHYON,
  USER_AGENT,
  POLITE_DELAY_MS,
  MAX_RETRIES,
  sleep,
} from './constants';
import { DailyStoreStat, KpiCacheItem } from './db';
import { safeVendorFetch } from './vendorGuard';

export interface TachyonSession {
  accessToken: string;
  refreshToken?: string;
  createdAt: number;
}

export interface TachyonCell {
  store_id: string | number;
  store_name: string;
  nas_ip?: string;
  user_count: number;
  users_percentage: number;
  upload_bytes: number;
  download_bytes: number;
  total_traffic: number;
  total_sessions_duration: number; // default detik, atau ms tergantung SATUAN_DURASI_TACHYON
}

export interface TachyonMetrics {
  new: number;
  returning: number;
  total: number;
}

/**
 * =====================================================================
 * FUNGSI AUTH MODULAR TACHYON (Sesuai catatan 4b)
 * Jika format header auth berubah dari Bearer token ke bentuk lain,
 * CUKUP UBAH FUNGSI INI SAJA.
 * =====================================================================
 */
export function getTachyonAuthHeaders(session: TachyonSession): Record<string, string> {
  return {
    Authorization: `Bearer ${session.accessToken}`,
    Origin: TACHYON_ORIGIN,
    Referer: `${TACHYON_ORIGIN}/dashboard`,
    Accept: 'application/json',
    'User-Agent': USER_AGENT,
  };
}

/**
 * Login ke Tachyon (lawson-api.tachyon.net.id)
 */
export async function loginTachyon(user: string, pass: string): Promise<TachyonSession> {
  const loginUrl = `${TACHYON_API_BASE}/auth/login`;

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await safeVendorFetch(loginUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: TACHYON_ORIGIN,
          Referer: `${TACHYON_ORIGIN}/login`,
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({ username: user, password: pass }),
      });

      if (res.status === 401 || res.status === 403) {
        throw new Error('Login Tachyon gagal: Username atau password salah.');
      }

      if (!res.ok) {
        throw new Error(`Login Tachyon HTTP error: ${res.status} ${res.statusText}`);
      }

      const json = await res.json();
      const token = json?.data?.access_token;
      if (!token) {
        throw new Error('Login Tachyon berhasil tapi token tidak ditemukan di jawaban server.');
      }

      return {
        accessToken: token,
        refreshToken: json?.data?.refresh_token,
        createdAt: Date.now(),
      };
    } catch (err: any) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await sleep(POLITE_DELAY_MS);
      }
    }
  }

  throw lastError || new Error('Gagal login ke Tachyon setelah 2 percobaan.');
}

/**
 * Mengambil tabel per toko dari Tachyon
 * format tanggal YYYY-MM-DD
 */
export async function fetchTachyonTable(
  session: TachyonSession,
  fromDateStr: string,
  toDateStr?: string
): Promise<TachyonCell[]> {
  const to = toDateStr || fromDateStr;
  const url = `${TACHYON_API_BASE}/dashboard/tables?from=${fromDateStr}&to=${to}`;

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await safeVendorFetch(url, {
        method: 'GET',
        headers: getTachyonAuthHeaders(session),
      });

      if (res.status === 401 || res.status === 403) {
        throw new Error('Sesi Tachyon ditolak/kedaluwarsa (401/403).');
      }

      if (!res.ok) {
        throw new Error(`Tachyon API HTTP error: ${res.status}`);
      }

      const json = await res.json();
      if (!json || !Array.isArray(json.data)) {
        throw new Error('Format respon Tachyon tidak sesuai (properti "data" bukan array).');
      }

      return json.data as TachyonCell[];
    } catch (err: any) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await sleep(POLITE_DELAY_MS);
      }
    }
  }

  throw lastError || new Error('Gagal mengambil data tabel Tachyon.');
}

/**
 * Mengambil ringkasan metrics (kartu) dari Tachyon
 */
export async function fetchTachyonMetrics(
  session: TachyonSession,
  fromDateStr: string,
  toDateStr?: string
): Promise<TachyonMetrics> {
  const to = toDateStr || fromDateStr;
  const url = `${TACHYON_API_BASE}/dashboard/metrics?from=${fromDateStr}&to=${to}`;

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await safeVendorFetch(url, {
        method: 'GET',
        headers: getTachyonAuthHeaders(session),
      });

      if (res.status === 401 || res.status === 403) {
        throw new Error('Sesi Tachyon ditolak/kedaluwarsa (401/403).');
      }

      if (!res.ok) {
        throw new Error(`Tachyon metrics HTTP error: ${res.status}`);
      }

      const json = await res.json();
      if (!json?.data) {
        throw new Error('Format respon metrics Tachyon tidak sesuai.');
      }

      return {
        new: Number(json.data.new || 0),
        returning: Number(json.data.returning || 0),
        total: Number(json.data.total || 0),
      };
    } catch (err: any) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await sleep(POLITE_DELAY_MS);
      }
    }
  }

  throw lastError || new Error('Gagal mengambil metrics Tachyon.');
}

/**
 * Mengubah cell Tachyon ke DailyStoreStat
 */
export function mapTachyonCellsToDailyStats(
  cells: TachyonCell[],
  dateStr: string
): DailyStoreStat[] {
  const now = new Date().toISOString();
  return cells.map((cell) => {
    let durSec = Number(cell.total_sessions_duration || 0);
    if (SATUAN_DURASI_TACHYON === 'ms') {
      durSec = durSec / 1000;
    }

    return {
      source: 'tachyon',
      source_key: String(cell.store_id),
      date: dateStr,
      users: Number(cell.user_count || 0),
      upload_bytes: Number(cell.upload_bytes || 0),
      download_bytes: Number(cell.download_bytes || 0),
      total_bytes: Number(cell.total_traffic || 0),
      duration_seconds: Math.round(durSec),
      fetched_at: now,
    };
  });
}

/**
 * Mengubah metrics Tachyon ke KpiCacheItem
 */
export function mapTachyonMetricsToCacheItem(
  metrics: TachyonMetrics,
  startDateStr: string,
  endDateStr: string
): KpiCacheItem {
  return {
    source: 'tachyon',
    date_start: startDateStr,
    date_end: endDateStr,
    new_users: metrics.new,
    returning_new_users: null, // Tachyon tidak punya Returning New Users
    returning_users: metrics.returning,
    all_users: metrics.total,
    fetched_at: new Date().toISOString(),
  };
}
