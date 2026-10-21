import 'server-only';

import { randomUUID } from 'crypto';
import {
  loginHypernet,
  fetchHypernetTable,
  fetchHypernetKpi,
  mapHypernetCellsToDailyStats,
  mapHypernetKpiToCacheItem,
  HypernetSession,
} from './hypernet';
import {
  loginTachyon,
  fetchTachyonTable,
  fetchTachyonMetrics,
  mapTachyonCellsToDailyStats,
  mapTachyonMetricsToCacheItem,
  TachyonSession,
} from './tachyon';
import {
  upsertDailyStoreStats,
  autoRegisterStores,
  upsertKpiCache,
  getExistingDates,
  VendorSource,
  DailyStoreStat,
  KpiCacheItem,
  saveSyncSession,
  getSyncSession,
  deleteSyncSession,
  cleanupExpiredSyncSessions,
  DbSyncSession,
} from './db';
import { getJakartaToday, POLITE_DELAY_MS, sleep, getDatesInRange } from './constants';

interface ActiveSession {
  id: string;
  createdAt: number;
  expiresAt: number;
  hypernet?: HypernetSession;
  tachyon?: TachyonSession;
}

// Memory store fallback untuk sesi sinkronisasi aktif (max 15 menit)
const sessionStore = new Map<string, ActiveSession>();

// Cleanup helper
async function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [id, sess] of sessionStore.entries()) {
    if (sess.expiresAt < now) {
      sessionStore.delete(id);
    }
  }
  try {
    await cleanupExpiredSyncSessions();
  } catch {}
}

/**
 * Menghitung daftar tanggal antara startDate dan endDate (inklusif) secara UTC aman.
 */
export function generateDateRange(startDateStr: string, endDateStr: string): string[] {
  return getDatesInRange(startDateStr, endDateStr);
}

/**
 * Menentukan tanggal mana saja dalam rentang yang perlu ditarik:
 * Sesuai ketentuan baru: Mekanisme otomatis upsert di database aplikasi.
 * Seluruh tanggal yang diminta akan disinkronkan, data lama diperbarui dan data baru ditambahkan.
 */
export async function determineDatesToSync(
  source: VendorSource,
  startDateStr: string,
  endDateStr: string
): Promise<{ allDates: string[]; datesToSync: string[]; skippedDates: string[] }> {
  const allDates = getDatesInRange(startDateStr, endDateStr);
  return { allDates, datesToSync: allDates, skippedDates: [] };
}

/**
 * Memulai sesi sinkronisasi:
 * Melakukan login SEKALI ke masing-masing vendor yang kredensialnya tersedia.
 * Session token disimpan dalam memory dan database SQLite (tahan terhadap HMR / worker reload).
 */
export async function startSyncSession(options: {
  hypernetCreds?: { username: string; password: string };
  tachyonCreds?: { username: string; password: string };
}): Promise<{
  sessionId: string;
  hypernetReady: boolean;
  tachyonReady: boolean;
  errors: Record<string, string>;
}> {
  await cleanupExpiredSessions();
  const sessionId = randomUUID();
  const errors: Record<string, string> = {};

  let hypernetSession: HypernetSession | undefined;
  let tachyonSession: TachyonSession | undefined;

  // 1. Hypernet Login jika kredensial ada
  if (options.hypernetCreds?.username && options.hypernetCreds?.password) {
    try {
      hypernetSession = await loginHypernet(
        options.hypernetCreds.username,
        options.hypernetCreds.password
      );
    } catch (err: any) {
      errors.hypernet = err.message || 'Gagal login Hypernet';
    }
  }

  // 2. Tachyon Login jika kredensial ada
  if (options.tachyonCreds?.username && options.tachyonCreds?.password) {
    try {
      tachyonSession = await loginTachyon(
        options.tachyonCreds.username,
        options.tachyonCreds.password
      );
    } catch (err: any) {
      errors.tachyon = err.message || 'Gagal login Tachyon';
    }
  }

  const sessionObj: ActiveSession = {
    id: sessionId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 15 * 60 * 1000, // 15 menit
    hypernet: hypernetSession,
    tachyon: tachyonSession,
  };

  // Simpan di memori
  sessionStore.set(sessionId, sessionObj);

  // Simpan di SQLite agar persisten lintas proses worker dan reload server
  try {
    await saveSyncSession(sessionObj);
  } catch (dbErr) {
    console.error('Gagal menyimpan sesi sinkronisasi ke SQLite:', dbErr);
  }

  return {
    sessionId,
    hypernetReady: Boolean(hypernetSession),
    tachyonReady: Boolean(tachyonSession),
    errors,
  };
}

async function resolveActiveSession(sessionId: string): Promise<ActiveSession> {
  let session = sessionStore.get(sessionId);
  if (!session || session.expiresAt < Date.now()) {
    // Ambil dari SQLite jika memori di-reset oleh recompile / proses worker
    try {
      const dbSess = await getSyncSession(sessionId);
      if (dbSess && dbSess.expiresAt >= Date.now()) {
        session = {
          id: dbSess.id,
          createdAt: dbSess.createdAt,
          expiresAt: dbSess.expiresAt,
          hypernet: dbSess.hypernet,
          tachyon: dbSess.tachyon,
        };
        sessionStore.set(sessionId, session);
      }
    } catch (e) {
      console.warn('Gagal membaca sesi dari SQLite:', e);
    }
  }

  if (!session || session.expiresAt < Date.now()) {
    throw new Error('Sesi penarikan tidak ditemukan atau telah kedaluwarsa. Silakan mulai ulang.');
  }
  return session;
}

/**
 * Tarik data 1 hari untuk 1 vendor dengan sesi yang sedang aktif.
 */
export async function syncDayForSource(
  sessionId: string,
  source: VendorSource,
  dateStr: string
): Promise<{
  success: boolean;
  source: VendorSource;
  date: string;
  storeCount: number;
  totalUsers: number;
  newStoresCount: number;
  error?: string;
}> {
  const session = await resolveActiveSession(sessionId);

  // Jeda sopan antar permintaan
  await sleep(POLITE_DELAY_MS);

  if (source === 'hypernet') {
    if (!session.hypernet) {
      throw new Error('Sesi login Hypernet tidak aktif.');
    }

    const cells = await fetchHypernetTable(session.hypernet, dateStr);

    // Validasi data (Section 4c: kalau respon tidak sesuai atau toko 0 saat penarikan)
    if (!Array.isArray(cells)) {
      throw new Error(`Data Hypernet tanggal ${dateStr} tidak berformat tabel yang valid.`);
    }

    const stats = mapHypernetCellsToDailyStats(cells, dateStr);
    await upsertDailyStoreStats(stats);

    // Otomatis daftarkan toko baru ke stores
    const storesToRegister = cells.map((c) => ({
      source: 'hypernet' as const,
      source_key: c.organization,
      display_name: c.organization,
    }));
    const newStoresCount = await autoRegisterStores(storesToRegister);

    const totalUsers = stats.reduce((acc, s) => acc + s.users, 0);

    return {
      success: true,
      source: 'hypernet',
      date: dateStr,
      storeCount: stats.length,
      totalUsers,
      newStoresCount,
    };
  } else if (source === 'tachyon') {
    if (!session.tachyon) {
      throw new Error('Sesi login Tachyon tidak aktif.');
    }

    const cells = await fetchTachyonTable(session.tachyon, dateStr);

    if (!Array.isArray(cells)) {
      throw new Error(`Data Tachyon tanggal ${dateStr} tidak berformat tabel yang valid.`);
    }

    const stats = mapTachyonCellsToDailyStats(cells, dateStr);
    await upsertDailyStoreStats(stats);

    // Otomatis daftarkan toko baru ke stores
    const storesToRegister = cells.map((c) => ({
      source: 'tachyon' as const,
      source_key: String(c.store_id),
      display_name: c.store_name, // Contoh: "CILILITAN BESAR"
    }));
    const newStoresCount = await autoRegisterStores(storesToRegister);

    const totalUsers = stats.reduce((acc, s) => acc + s.users, 0);

    return {
      success: true,
      source: 'tachyon',
      date: dateStr,
      storeCount: stats.length,
      totalUsers,
      newStoresCount,
    };
  }

  throw new Error(`Sumber vendor '${source}' tidak dikenal.`);
}

/**
 * Tarik KPI Footfall / Metrics untuk seluruh rentang tanggal dan simpan ke kpi_cache.
 */
export async function syncKpiForSource(
  sessionId: string,
  source: VendorSource,
  startDateStr: string,
  endDateStr: string
): Promise<{
  success: boolean;
  source: VendorSource;
  kpi: KpiCacheItem;
}> {
  const session = await resolveActiveSession(sessionId);

  await sleep(POLITE_DELAY_MS);

  if (source === 'hypernet') {
    if (!session.hypernet) throw new Error('Sesi Hypernet tidak aktif.');
    const rawKpi = await fetchHypernetKpi(session.hypernet, startDateStr, endDateStr);
    const item = mapHypernetKpiToCacheItem(rawKpi, startDateStr, endDateStr);
    await upsertKpiCache(item);
    return { success: true, source, kpi: item };
  } else if (source === 'tachyon') {
    if (!session.tachyon) throw new Error('Sesi Tachyon tidak aktif.');
    const rawMetrics = await fetchTachyonMetrics(session.tachyon, startDateStr, endDateStr);
    const item = mapTachyonMetricsToCacheItem(rawMetrics, startDateStr, endDateStr);
    await upsertKpiCache(item);
    return { success: true, source, kpi: item };
  }

  throw new Error(`Sumber '${source}' tidak dikenal.`);
}

/**
 * Menutup sesi penarikan dan menghapus token dari memori dan database.
 */
export async function endSyncSession(sessionId: string): Promise<void> {
  sessionStore.delete(sessionId);
  try {
    await deleteSyncSession(sessionId);
  } catch {}
}
