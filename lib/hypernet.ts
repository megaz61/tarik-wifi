import {
  HYPERNET_BASE,
  HYPERNET_ROOT_ORG_ID,
  HYPERNET_COLUMNS,
  TIMEZONE,
  USER_AGENT,
  POLITE_DELAY_MS,
  MAX_RETRIES,
  hypernetDayRangeMs,
  sleep,
} from './constants';
import { DailyStoreStat, KpiCacheItem } from './db';
import { safeVendorFetch } from './vendorGuard';

export interface HypernetSession {
  cookieHeader: string;
  createdAt: number;
}

export interface HypernetCell {
  organization: string;
  users: number;
  participation: number; // persentase
  totalTransfer: number; // byte
  transferPerUser?: number;
  totalDuration: number; // milidetik
  durationPerUser?: number;
}

export interface HypernetKpi {
  newUsers: number;
  newReturningUsers: number;
  returningUsers: number;
  allUsers: number;
}

/**
 * Cookie Jar Helper sederhana untuk menangani Set-Cookie dari Hypernet
 */
function extractAndMergeCookies(existingCookieStr: string, response: Response): string {
  const cookieMap = new Map<string, string>();

  if (existingCookieStr) {
    existingCookieStr.split(';').forEach((part) => {
      const [k, ...v] = part.trim().split('=');
      if (k) cookieMap.set(k.trim(), v.join('='));
    });
  }

  // Ambil set-cookie headers
  const getSetCookie = (response.headers as any).getSetCookie;
  let rawCookies: string[] = [];
  if (typeof getSetCookie === 'function') {
    rawCookies = response.headers.getSetCookie();
  } else {
    const single = response.headers.get('set-cookie');
    if (single) rawCookies = [single];
  }

  for (const cookie of rawCookies) {
    const main = cookie.split(';')[0];
    const [k, ...v] = main.split('=');
    if (k) cookieMap.set(k.trim(), v.join('='));
  }

  return Array.from(cookieMap.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/**
 * Login ke Hypernet (portal.openwifi.id)
 * Menangani 2FA jika "Recommend" -> skip otomatis.
 */
export async function loginHypernet(user: string, pass: string): Promise<HypernetSession> {
  const loginUrl = `${HYPERNET_BASE}/userAuth/login`;

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await safeVendorFetch(loginUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: HYPERNET_BASE,
          Referer: `${HYPERNET_BASE}/portal/`,
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({ username: user, password: pass }),
      });

      if (res.status === 401 || res.status === 403) {
        throw new Error('Login Hypernet gagal: Username atau password salah.');
      }

      if (!res.ok) {
        throw new Error(`Login Hypernet HTTP error: ${res.status} ${res.statusText}`);
      }

      let cookies = extractAndMergeCookies('', res);
      const data = await res.json().catch(() => ({}));

      const twoFactor = data?.twoFactorType;
      if (twoFactor === 'Recommend') {
        // Skip 2FA step
        const skipRes = await safeVendorFetch(`${HYPERNET_BASE}/userAuth/twoFactor/setup/skip`, {
          method: 'POST',
          headers: {
            organizationid: HYPERNET_ROOT_ORG_ID,
            Origin: HYPERNET_BASE,
            'User-Agent': USER_AGENT,
            Cookie: cookies,
          },
        });
        cookies = extractAndMergeCookies(cookies, skipRes);
      } else if (twoFactor) {
        throw new Error(
          `Akun meminta verifikasi 2 langkah (twoFactorType=${twoFactor}). Robot belum mendukung ini.`
        );
      }

      return {
        cookieHeader: cookies,
        createdAt: Date.now(),
      };
    } catch (err: any) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await sleep(POLITE_DELAY_MS);
      }
    }
  }

  throw lastError || new Error('Gagal login ke Hypernet setelah 2 percobaan.');
}

/**
 * Mengambil tabel per toko dari Hypernet untuk satu tanggal atau rentang tanggal
 */
export async function fetchHypernetTable(
  session: HypernetSession,
  startDateStr: string,
  endDateStr?: string
): Promise<HypernetCell[]> {
  const { startMs, endMs } = hypernetDayRangeMs(startDateStr, endDateStr);
  const url = new URL(`${HYPERNET_BASE}/flow/statistics/data/organizations/subOrganizationShareTable`);
  url.searchParams.set('DateStart', String(startMs));
  url.searchParams.set('DateEnd', String(endMs));
  url.searchParams.set('ColumnIds', HYPERNET_COLUMNS);

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await safeVendorFetch(url.toString(), {
        method: 'GET',
        headers: {
          organizationid: HYPERNET_ROOT_ORG_ID,
          timezone: TIMEZONE,
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
          Cookie: session.cookieHeader,
        },
      });

      if (res.status === 401 || res.status === 403) {
        throw new Error('Sesi Hypernet kedaluwarsa atau tidak valid (401/403).');
      }

      if (!res.ok) {
        throw new Error(`Hypernet API HTTP error: ${res.status}`);
      }

      const json = await res.json();
      if (!json || !Array.isArray(json.cells)) {
        throw new Error('Format respon Hypernet tidak sesuai (properti "cells" hilang).');
      }

      return json.cells as HypernetCell[];
    } catch (err: any) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await sleep(POLITE_DELAY_MS);
      }
    }
  }

  throw lastError || new Error('Gagal mengambil data tabel Hypernet.');
}

/**
 * Mengambil 4 KPI Footfall dari Hypernet (New, Returning New, Returning, All Users)
 */
export async function fetchHypernetKpi(
  session: HypernetSession,
  startDateStr: string,
  endDateStr?: string
): Promise<HypernetKpi> {
  const { startMs, endMs } = hypernetDayRangeMs(startDateStr, endDateStr);
  const endpoints = [
    { key: 'newUsers', path: 'newUsers' },
    { key: 'newReturningUsers', path: 'newReturningUsers' },
    { key: 'returningUsers', path: 'returningUsers' },
    { key: 'allUsers', path: 'users' },
  ] as const;

  const result: Record<string, number> = {};

  for (const ep of endpoints) {
    const url = `${HYPERNET_BASE}/flow/statistics/data/footfall/${ep.path}?DateStart=${startMs}&DateEnd=${endMs}`;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await safeVendorFetch(url, {
          method: 'GET',
          headers: {
            organizationid: HYPERNET_ROOT_ORG_ID,
            timezone: TIMEZONE,
            Accept: 'application/json',
            'User-Agent': USER_AGENT,
            Cookie: session.cookieHeader,
          },
        });

        if (!res.ok) throw new Error(`Footfall ${ep.path} HTTP error: ${res.status}`);
        const data = await res.json();
        result[ep.key] = parseInt(data?.value || '0', 10);
        break;
      } catch (err: any) {
        lastError = err;
        if (attempt < MAX_RETRIES) await sleep(POLITE_DELAY_MS);
      }
    }

    if (result[ep.key] === undefined) {
      throw lastError || new Error(`Gagal mengambil KPI Hypernet ${ep.path}`);
    }

    // Jeda sopan antar permintaan
    await sleep(POLITE_DELAY_MS);
  }

  return {
    newUsers: result.newUsers || 0,
    newReturningUsers: result.newReturningUsers || 0,
    returningUsers: result.returningUsers || 0,
    allUsers: result.allUsers || 0,
  };
}

/**
 * Mengubah cell Hypernet menjadi format model DailyStoreStat
 */
export function mapHypernetCellsToDailyStats(
  cells: HypernetCell[],
  dateStr: string
): DailyStoreStat[] {
  const now = new Date().toISOString();
  return cells.map((cell) => ({
    source: 'hypernet',
    source_key: cell.organization,
    date: dateStr,
    users: cell.users || 0,
    upload_bytes: null, // Hypernet tidak memisahkan upload/download
    download_bytes: null,
    total_bytes: cell.totalTransfer || 0,
    duration_seconds: Math.round((cell.totalDuration || 0) / 1000), // ms -> s
    fetched_at: now,
  }));
}

/**
 * Mengubah KPI Hypernet menjadi format model KpiCacheItem
 */
export function mapHypernetKpiToCacheItem(
  kpi: HypernetKpi,
  startDateStr: string,
  endDateStr: string
): KpiCacheItem {
  return {
    source: 'hypernet',
    date_start: startDateStr,
    date_end: endDateStr,
    new_users: kpi.newUsers,
    returning_new_users: kpi.newReturningUsers,
    returning_users: kpi.returningUsers,
    all_users: kpi.allUsers,
    fetched_at: new Date().toISOString(),
  };
}
