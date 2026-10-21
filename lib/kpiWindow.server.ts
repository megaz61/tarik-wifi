import 'server-only';

import { getKpiCache, upsertKpiCache, KpiCacheItem, VendorSource } from './db';
import {
  startSyncSession,
  syncKpiForSource,
  endSyncSession,
} from './syncSession';
import { isHypernetEnvConfigured, isTachyonEnvConfigured } from './auth';

export interface WindowKpiData {
  hypernet: KpiCacheItem | null;
  tachyon: KpiCacheItem | null;
  fromCache: boolean;
}

/**
 * Memastikan KPI cache untuk rentang jendela (windowStart s/d windowEnd) tersedia.
 * - Jika sudah ada di kpi_cache dan !forceRefresh, langsung gunakan cache tanpa memanggil vendor.
 * - Jika belum ada (atau forceRefresh=true), panggil vendor via GET read-only dan simpan ke kpi_cache.
 */
export async function ensureKpiCacheForWindow(
  windowStart: string,
  windowEnd: string,
  forceRefresh: boolean = false
): Promise<WindowKpiData> {
  let hypKpi = await getKpiCache('hypernet', windowStart, windowEnd);
  let tacKpi = await getKpiCache('tachyon', windowStart, windowEnd);

  if (hypKpi && tacKpi && !forceRefresh) {
    return {
      hypernet: hypKpi,
      tachyon: tacKpi,
      fromCache: true,
    };
  }

  // Identifikasi sumber mana yang perlu ditarik dari vendor
  const sourcesToPull: VendorSource[] = [];
  if ((!hypKpi || forceRefresh) && isHypernetEnvConfigured()) {
    sourcesToPull.push('hypernet');
  }
  if ((!tacKpi || forceRefresh) && isTachyonEnvConfigured()) {
    sourcesToPull.push('tachyon');
  }

  if (sourcesToPull.length === 0) {
    return {
      hypernet: hypKpi,
      tachyon: tacKpi,
      fromCache: true,
    };
  }

  try {
    const sessionRes = await startSyncSession({
      hypernetCreds: sourcesToPull.includes('hypernet')
        ? { username: process.env.HYPERNET_USER || '', password: process.env.HYPERNET_PASS || '' }
        : undefined,
      tachyonCreds: sourcesToPull.includes('tachyon')
        ? { username: process.env.TACHYON_USER || '', password: process.env.TACHYON_PASS || '' }
        : undefined,
    });

    if (sessionRes.sessionId) {
      if (sourcesToPull.includes('hypernet') && sessionRes.hypernetReady) {
        try {
          const res = await syncKpiForSource(sessionRes.sessionId, 'hypernet', windowStart, windowEnd);
          if (res.kpi) hypKpi = res.kpi;
        } catch (e) {
          console.error(`Gagal tarik KPI Hypernet [${windowStart}..${windowEnd}]:`, e);
        }
      }

      if (sourcesToPull.includes('tachyon') && sessionRes.tachyonReady) {
        try {
          const res = await syncKpiForSource(sessionRes.sessionId, 'tachyon', windowStart, windowEnd);
          if (res.kpi) tacKpi = res.kpi;
        } catch (e) {
          console.error(`Gagal tarik KPI Tachyon [${windowStart}..${windowEnd}]:`, e);
        }
      }

      await endSyncSession(sessionRes.sessionId);
    }
  } catch (err) {
    console.error('Error saat sesi tarik KPI jendela:', err);
  }

  return {
    hypernet: hypKpi,
    tachyon: tacKpi,
    fromCache: false,
  };
}
