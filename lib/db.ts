import 'server-only';

import { createClient as createLibsqlClient, Client as LibsqlClient } from '@libsql/client';
import { createClient as createSupabaseClient, SupabaseClient } from '@supabase/supabase-js';
import path from 'path';
import fs from 'fs';
import { getJakartaToday, MAX_DATE_RANGE_DAYS } from './constants';

export type VendorSource = 'hypernet' | 'tachyon';

export interface DailyStoreStat {
  source: VendorSource;
  source_key: string;
  date: string; // YYYY-MM-DD
  users: number;
  upload_bytes: number | null;
  download_bytes: number | null;
  total_bytes: number;
  duration_seconds: number;
  fetched_at: string;
}

export interface KpiCacheItem {
  source: VendorSource;
  date_start: string;
  date_end: string;
  new_users: number;
  returning_new_users: number | null;
  returning_users: number;
  all_users: number;
  fetched_at: string;
}

export interface StoreItem {
  id: string;
  source: VendorSource;
  source_key: string;
  display_name: string;
  kd_store: string | null;
  activation_date: string | null;
  active: number; // 1 = true, 0 = false
  is_visible: number; // 1 = true, 0 = false (terpisah dari status aktif)
  is_new_flag: number; // 1 = true, 0 = false
}

export interface StoreAssignment {
  store_id: string;
  month: string; // YYYY-MM
  am: string | null;
  ac: string | null;
}

let localDbClient: LibsqlClient | null = null;
let supabaseClient: SupabaseClient | null = null;
let isInitialized = false;

/**
 * Mendapatkan koneksi database.
 * Jika SUPABASE_URL & SUPABASE_SERVICE_KEY tersedia, gunakan Supabase Postgres.
 * Jika tidak, gunakan SQLite lokal berbasis file (@libsql/client).
 */
export function getDbMode(): 'turso' | 'supabase' | 'local_sqlite' {
  if (process.env.TURSO_DATABASE_URL) {
    return 'turso';
  }
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    return 'supabase';
  }
  return 'local_sqlite';
}

function getLocalClient(): LibsqlClient {
  if (!localDbClient) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (url) {
      localDbClient = createLibsqlClient({
        url,
        authToken,
      });
    } else {
      const dataDir = path.join(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      const dbPath = path.join(dataDir, 'wifi_rekap.db');
      localDbClient = createLibsqlClient({
        url: `file:${dbPath.replace(/\\/g, '/')}`,
      });
    }
  }
  return localDbClient;
}

function getSupabase(): SupabaseClient {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_KEY!;
    supabaseClient = createSupabaseClient(url, key, {
      auth: { persistSession: false },
    });
  }
  return supabaseClient;
}

/**
 * Inisialisasi skema tabel jika belum ada.
 */
export async function initDb(): Promise<void> {
  if (isInitialized) return;

  const mode = getDbMode();
  if (mode !== 'supabase') {
    const db = getLocalClient();

    await db.execute(`
      CREATE TABLE IF NOT EXISTS daily_store_stats (
        source TEXT NOT NULL,
        source_key TEXT NOT NULL,
        date TEXT NOT NULL,
        users INTEGER NOT NULL DEFAULT 0,
        upload_bytes INTEGER,
        download_bytes INTEGER,
        total_bytes INTEGER NOT NULL DEFAULT 0,
        duration_seconds REAL NOT NULL DEFAULT 0,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (source, source_key, date)
      );
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS kpi_cache (
        source TEXT NOT NULL,
        date_start TEXT NOT NULL,
        date_end TEXT NOT NULL,
        new_users INTEGER NOT NULL DEFAULT 0,
        returning_new_users INTEGER,
        returning_users INTEGER NOT NULL DEFAULT 0,
        all_users INTEGER NOT NULL DEFAULT 0,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (source, date_start, date_end)
      );
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS stores (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_key TEXT NOT NULL,
        display_name TEXT NOT NULL,
        kd_store TEXT,
        activation_date TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        is_visible INTEGER NOT NULL DEFAULT 1,
        is_new_flag INTEGER NOT NULL DEFAULT 1,
        UNIQUE (source, source_key)
      );
    `);

    // Migration aman jika kolom is_visible belum ada di tabel stores lama
    try {
      await db.execute(`ALTER TABLE stores ADD COLUMN is_visible INTEGER NOT NULL DEFAULT 1;`);
    } catch {}

    await db.execute(`
      CREATE TABLE IF NOT EXISTS store_assignments (
        store_id TEXT NOT NULL,
        month TEXT NOT NULL,
        am TEXT,
        ac TEXT,
        PRIMARY KEY (store_id, month)
      );
    `);

    // Tabel Riwayat AM dan AC per toko (Target D1)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS store_am_ac_history (
        kd_store TEXT NOT NULL,
        month TEXT NOT NULL,
        am TEXT,
        ac TEXT,
        PRIMARY KEY (kd_store, month)
      );
    `);

    // Tabel untuk persistensi sesi sinkronisasi (mencegah sesi hilang saat recompile / worker isolation)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS sync_sessions (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        hypernet_session TEXT,
        tachyon_session TEXT
      );
    `);

    // Tabel pencatatan log scheduler retensi data
    await db.execute(`
      CREATE TABLE IF NOT EXISTS auto_clean_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        executed_at TEXT NOT NULL,
        date_start TEXT,
        date_end TEXT,
        deleted_stats INTEGER NOT NULL DEFAULT 0,
        deleted_kpi INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        message TEXT
      );
    `);

    // Tabel lock scheduler untuk mencegah eksekusi paralel / ganda
    await db.execute(`
      CREATE TABLE IF NOT EXISTS scheduler_lock (
        id TEXT PRIMARY KEY,
        locked_at INTEGER NOT NULL
      );
    `);

    // Index bantu untuk query rentang tanggal
    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_store_stats(date);
    `);
    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_daily_stats_source_date ON daily_store_stats(source, date);
    `);
  } else {
    // Mode Supabase Postgres: tabel diasumsikan sudah dibuat atau via Supabase REST
    // Kita pastikan rpc/schema check berjalan
  }

  isInitialized = true;
}

/**
 * Simpan atau perbarui data harian per toko (Upsert)
 */
export async function upsertDailyStoreStats(stats: DailyStoreStat[]): Promise<number> {
  if (stats.length === 0) return 0;
  await initDb();
  const mode = getDbMode();

  if (mode !== 'supabase') {
    const db = getLocalClient();
    // Gunakan batch / transaction untuk performa tinggi
    const stmts = stats.map((item) => ({
      sql: `
        INSERT INTO daily_store_stats (
          source, source_key, date, users, upload_bytes, download_bytes,
          total_bytes, duration_seconds, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source, source_key, date) DO UPDATE SET
          users = excluded.users,
          upload_bytes = excluded.upload_bytes,
          download_bytes = excluded.download_bytes,
          total_bytes = excluded.total_bytes,
          duration_seconds = excluded.duration_seconds,
          fetched_at = excluded.fetched_at;
      `,
      args: [
        item.source,
        item.source_key,
        item.date,
        item.users,
        item.upload_bytes,
        item.download_bytes,
        item.total_bytes,
        item.duration_seconds,
        item.fetched_at,
      ],
    }));

    await db.batch(stmts, 'write');
    return stats.length;
  } else {
    const supabase = getSupabase();
    const { error } = await supabase.from('daily_store_stats').upsert(stats, {
      onConflict: 'source,source_key,date',
    });
    if (error) throw new Error(`Supabase upsertDailyStoreStats error: ${error.message}`);
    return stats.length;
  }
}

/**
 * Otomatis daftarkan toko baru jika belum ada di tabel stores.
 * Default display_name = nama asli (source_key).
 * Toko baru ditandai is_new_flag = 1.
 */
export async function autoRegisterStores(
  storesList: { source: VendorSource; source_key: string; display_name?: string }[]
): Promise<number> {
  if (storesList.length === 0) return 0;
  await initDb();
  const mode = getDbMode();

  // Map referensi 27 toko
  const refMap = new Map<string, ReferenceStoreDef>();
  for (const ref of REFERENCE_27_STORES) {
    const k1 = `${ref.source}__${ref.sourceKey.toLowerCase().replace(/\s+/g, ' ').trim()}`;
    refMap.set(k1, ref);
  }

  if (mode !== 'supabase') {
    const db = getLocalClient();
    let newCount = 0;
    const stmts = storesList.map((st) => {
      const id = `${st.source}__${st.source_key}`;
      const storeKeyNorm = `${st.source}__${st.source_key.toLowerCase().replace(/\s+/g, ' ').trim()}`;
      const matchedRef = refMap.get(storeKeyNorm);

      const displayName = matchedRef?.organisation || st.display_name || st.source_key;
      const kdStore = matchedRef?.kdStore || null;
      const activationDate = matchedRef?.activationDate || null;
      const isVisible = matchedRef ? 1 : 0; // 27 toko tampil, toko lain default tersembunyi

      return {
        sql: `
          INSERT INTO stores (id, source, source_key, display_name, kd_store, activation_date, active, is_visible, is_new_flag)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, 1)
          ON CONFLICT(source, source_key) DO NOTHING;
        `,
        args: [id, st.source, st.source_key, displayName, kdStore, activationDate, isVisible],
      };
    });

    const results = await db.batch(stmts, 'write');
    for (const res of results) {
      if (res.rowsAffected && res.rowsAffected > 0) {
        newCount++;
      }
    }
    return newCount;
  } else {
    const supabase = getSupabase();
    const payload = storesList.map((st) => {
      const storeKeyNorm = `${st.source}__${st.source_key.toLowerCase().replace(/\s+/g, ' ').trim()}`;
      const matchedRef = refMap.get(storeKeyNorm);
      return {
        id: `${st.source}__${st.source_key}`,
        source: st.source,
        source_key: st.source_key,
        display_name: matchedRef?.organisation || st.display_name || st.source_key,
        kd_store: matchedRef?.kdStore || null,
        activation_date: matchedRef?.activationDate || null,
        active: 1,
        is_visible: matchedRef ? 1 : 0,
        is_new_flag: 1,
      };
    });
    const { data, error } = await supabase.from('stores').upsert(payload, {
      onConflict: 'source,source_key',
      ignoreDuplicates: true,
    });
    if (error) console.error('Supabase autoRegisterStores error:', error);
    return data ? (data as any[]).length : 0;
  }
}

/**
 * Simpan / perbarui cache KPI
 */
export async function upsertKpiCache(kpi: KpiCacheItem): Promise<void> {
  await initDb();
  const mode = getDbMode();

  if (mode !== 'supabase') {
    const db = getLocalClient();
    await db.execute({
      sql: `
        INSERT INTO kpi_cache (
          source, date_start, date_end, new_users, returning_new_users,
          returning_users, all_users, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source, date_start, date_end) DO UPDATE SET
          new_users = excluded.new_users,
          returning_new_users = excluded.returning_new_users,
          returning_users = excluded.returning_users,
          all_users = excluded.all_users,
          fetched_at = excluded.fetched_at;
      `,
      args: [
        kpi.source,
        kpi.date_start,
        kpi.date_end,
        kpi.new_users,
        kpi.returning_new_users,
        kpi.returning_users,
        kpi.all_users,
        kpi.fetched_at,
      ],
    });
  } else {
    const supabase = getSupabase();
    const { error } = await supabase.from('kpi_cache').upsert(kpi, {
      onConflict: 'source,date_start,date_end',
    });
    if (error) throw new Error(`Supabase upsertKpiCache error: ${error.message}`);
  }
}

/**
 * Mendapatkan cache KPI untuk rentang tanggal
 */
export async function getKpiCache(
  source: VendorSource,
  dateStart: string,
  dateEnd: string
): Promise<KpiCacheItem | null> {
  await initDb();
  const mode = getDbMode();

  if (mode !== 'supabase') {
    const db = getLocalClient();
    const res = await db.execute({
      sql: `SELECT * FROM kpi_cache WHERE source = ? AND date_start = ? AND date_end = ?`,
      args: [source, dateStart, dateEnd],
    });
    if (res.rows.length === 0) return null;
    return res.rows[0] as unknown as KpiCacheItem;
  } else {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('kpi_cache')
      .select('*')
      .eq('source', source)
      .eq('date_start', dateStart)
      .eq('date_end', dateEnd)
      .maybeSingle();
    return data || null;
  }
}

/**
 * Mendapatkan tanggal-tanggal yang sudah ada di database untuk sumber dan rentang tertentu
 */
export async function getExistingDates(
  source: VendorSource,
  dateStart: string,
  dateEnd: string
): Promise<string[]> {
  await initDb();
  const mode = getDbMode();

  if (mode !== 'supabase') {
    const db = getLocalClient();
    const res = await db.execute({
      sql: `
        SELECT DISTINCT date FROM daily_store_stats
        WHERE source = ? AND date >= ? AND date <= ?
        ORDER BY date ASC;
      `,
      args: [source, dateStart, dateEnd],
    });
    return res.rows.map((r) => String(r.date));
  } else {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('daily_store_stats')
      .select('date')
      .eq('source', source)
      .gte('date', dateStart)
      .lte('date', dateEnd);
    if (!data) return [];
    const set = new Set(data.map((d: any) => d.date));
    return Array.from(set).sort();
  }
}

/**
 * Mendapatkan semua tanggal unik yang tersedia di daily_store_stats
 */
export async function getAllAvailableDates(): Promise<string[]> {
  await initDb();
  const mode = getDbMode();

  if (mode !== 'supabase') {
    const db = getLocalClient();
    const res = await db.execute(`SELECT DISTINCT date FROM daily_store_stats ORDER BY date ASC;`);
    return res.rows.map((r) => String(r.date));
  } else {
    const supabase = getSupabase();
    const { data } = await supabase.from('daily_store_stats').select('date');
    if (!data) return [];
    const set = new Set(data.map((d: any) => d.date));
    return Array.from(set).sort();
  }
}

/**
 * Mengambil ringkasan statistik harian per toko pada rentang tanggal
 */
export async function getDailyStatsByDateRange(
  dateStart: string,
  dateEnd: string
): Promise<DailyStoreStat[]> {
  await initDb();
  const mode = getDbMode();

  if (mode !== 'supabase') {
    const db = getLocalClient();
    const res = await db.execute({
      sql: `
        SELECT * FROM daily_store_stats
        WHERE date >= ? AND date <= ?
        ORDER BY date ASC, users DESC;
      `,
      args: [dateStart, dateEnd],
    });
    return res.rows as unknown as DailyStoreStat[];
  } else {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('daily_store_stats')
      .select('*')
      .gte('date', dateStart)
      .lte('date', dateEnd)
      .order('date', { ascending: true })
      .order('users', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []) as DailyStoreStat[];
  }
}

/**
 * Mengambil semua toko dari tabel stores.
 * Jika onlyVisible = true, hanya mengambil toko dengan is_visible = 1.
 */
export async function getStores(onlyVisible: boolean = false): Promise<StoreItem[]> {
  await initDb();
  const mode = getDbMode();

  if (mode !== 'supabase') {
    const db = getLocalClient();
    const sql = onlyVisible
      ? `SELECT * FROM stores WHERE is_visible = 1 ORDER BY display_name ASC;`
      : `SELECT * FROM stores ORDER BY display_name ASC;`;
    const res = await db.execute(sql);
    return res.rows as unknown as StoreItem[];
  } else {
    const supabase = getSupabase();
    let query = supabase.from('stores').select('*').order('display_name');
    if (onlyVisible) {
      query = (query as any).eq('is_visible', 1);
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data || []) as StoreItem[];
  }
}

/**
 * Mengambil penugasan AM / AC untuk bulan tertentu
 */
export async function getStoreAssignmentsByMonth(month: string): Promise<Record<string, StoreAssignment>> {
  await initDb();
  const mode = getDbMode();

  if (mode !== 'supabase') {
    const db = getLocalClient();
    const res = await db.execute({
      sql: `SELECT * FROM store_assignments WHERE month = ?`,
      args: [month],
    });
    const map: Record<string, StoreAssignment> = {};
    for (const r of res.rows) {
      const item = r as unknown as StoreAssignment;
      map[item.store_id] = item;
    }
    return map;
  } else {
    const supabase = getSupabase();
    const { data } = await supabase.from('store_assignments').select('*').eq('month', month);
    const map: Record<string, StoreAssignment> = {};
    for (const item of (data || []) as StoreAssignment[]) {
      map[item.store_id] = item;
    }
    return map;
  }
}

/**
 * Perbarui informasi toko di tabel stores (Master Toko - Section 7)
 */
export async function updateStore(
  id: string,
  fields: {
    display_name?: string;
    kd_store?: string | null;
    activation_date?: string | null;
    active?: number;
    is_visible?: number;
    is_new_flag?: number;
  }
): Promise<void> {
  await initDb();
  const mode = getDbMode();

  if (mode !== 'supabase') {
    const db = getLocalClient();
    const sets: string[] = [];
    const args: any[] = [];

    if (fields.display_name !== undefined) {
      sets.push('display_name = ?');
      args.push(fields.display_name);
    }
    if (fields.kd_store !== undefined) {
      sets.push('kd_store = ?');
      args.push(fields.kd_store);
    }
    if (fields.activation_date !== undefined) {
      sets.push('activation_date = ?');
      args.push(fields.activation_date);
    }
    if (fields.active !== undefined) {
      sets.push('active = ?');
      args.push(fields.active);
    }
    if (fields.is_visible !== undefined) {
      sets.push('is_visible = ?');
      args.push(fields.is_visible);
    }
    if (fields.is_new_flag !== undefined) {
      sets.push('is_new_flag = ?');
      args.push(fields.is_new_flag);
    }

    if (sets.length === 0) return;
    args.push(id);

    await db.execute({
      sql: `UPDATE stores SET ${sets.join(', ')} WHERE id = ?;`,
      args,
    });
  } else {
    const supabase = getSupabase();
    const { error } = await supabase.from('stores').update(fields).eq('id', id);
    if (error) throw new Error(`Supabase updateStore error: ${error.message}`);
  }
}

/**
 * Simpan / perbarui penugasan AM & AC toko untuk bulan tertentu (Section 7)
 */
export async function upsertStoreAssignment(
  store_id: string,
  month: string,
  am: string | null,
  ac: string | null
): Promise<void> {
  await initDb();
  const mode = getDbMode();

  if (mode !== 'supabase') {
    const db = getLocalClient();
    await db.execute({
      sql: `
        INSERT INTO store_assignments (store_id, month, am, ac)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(store_id, month) DO UPDATE SET
          am = excluded.am,
          ac = excluded.ac;
      `,
      args: [store_id, month, am, ac],
    });
  } else {
    const supabase = getSupabase();
    const { error } = await supabase.from('store_assignments').upsert(
      { store_id, month, am, ac },
      { onConflict: 'store_id,month' }
    );
    if (error) throw new Error(`Supabase upsertStoreAssignment error: ${error.message}`);
  }
}

export interface StoreAmAcHistoryItem {
  kd_store: string;
  month: string;
  am: string | null;
  ac: string | null;
}

/**
 * Mengambil seluruh riwayat penugasan AM & AC (Target D1 & D2)
 */
export async function getAllStoreAmAcHistory(): Promise<StoreAmAcHistoryItem[]> {
  await initDb();
  const mode = getDbMode();

  if (mode !== 'supabase') {
    const db = getLocalClient();
    const res = await db.execute({
      sql: `SELECT kd_store, month, am, ac FROM store_am_ac_history ORDER BY month ASC`,
      args: [],
    });
    return res.rows.map((r: any) => ({
      kd_store: String(r.kd_store),
      month: String(r.month),
      am: r.am ? String(r.am) : null,
      ac: r.ac ? String(r.ac) : null,
    }));
  } else {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('store_am_ac_history')
      .select('kd_store, month, am, ac')
      .order('month', { ascending: true });
    if (error) throw new Error(`Supabase getAllStoreAmAcHistory error: ${error.message}`);
    return (data || []) as StoreAmAcHistoryItem[];
  }
}

/**
 * Simpan / perbarui sekumpulan riwayat AM & AC (Batch Upsert - Target D5)
 */
export async function upsertStoreAmAcHistory(
  records: StoreAmAcHistoryItem[]
): Promise<number> {
  if (records.length === 0) return 0;
  await initDb();
  const mode = getDbMode();

  if (mode !== 'supabase') {
    const db = getLocalClient();
    const stmts = records.map((r) => ({
      sql: `
        INSERT INTO store_am_ac_history (kd_store, month, am, ac)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(kd_store, month) DO UPDATE SET
          am = excluded.am,
          ac = excluded.ac;
      `,
      args: [r.kd_store.trim().toUpperCase(), r.month.trim(), r.am ?? null, r.ac ?? null],
    }));
    await db.batch(stmts, 'write');
    return records.length;
  } else {
    const supabase = getSupabase();
    const { error } = await supabase.from('store_am_ac_history').upsert(
      records.map((r) => ({
        kd_store: r.kd_store.trim().toUpperCase(),
        month: r.month.trim(),
        am: r.am ?? null,
        ac: r.ac ?? null,
      })),
      { onConflict: 'kd_store,month' }
    );
    if (error) throw new Error(`Supabase upsertStoreAmAcHistory error: ${error.message}`);
    return records.length;
  }
}

/**
 * Simpan penugasan AM/AC toko untuk bulan tertentu (Target D3)
 */
export async function upsertSingleStoreAmAcHistory(
  kd_store: string,
  month: string,
  am: string | null,
  ac: string | null
): Promise<void> {
  await initDb();
  const mode = getDbMode();

  if (mode !== 'supabase') {
    const db = getLocalClient();
    await db.execute({
      sql: `
        INSERT INTO store_am_ac_history (kd_store, month, am, ac)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(kd_store, month) DO UPDATE SET
          am = excluded.am,
          ac = excluded.ac;
      `,
      args: [kd_store.trim().toUpperCase(), month.trim(), am ?? null, ac ?? null],
    });
  } else {
    const supabase = getSupabase();
    const { error } = await supabase.from('store_am_ac_history').upsert(
      { kd_store: kd_store.trim().toUpperCase(), month: month.trim(), am, ac },
      { onConflict: 'kd_store,month' }
    );
    if (error) throw new Error(`Supabase upsertSingleStoreAmAcHistory error: ${error.message}`);
  }
}

/**
 * Salin penugasan AM dan AC dari bulan sebelumnya (Section 7):
 * "Bulan lama tidak ikut berubah saat bulan baru diedit."
 */
export async function copyAssignmentsFromPreviousMonth(
  targetMonth: string,
  sourceMonth: string
): Promise<number> {
  await initDb();
  const mode = getDbMode();

  if (mode !== 'supabase') {
    const db = getLocalClient();
    const src = await db.execute({
      sql: `SELECT store_id, am, ac FROM store_assignments WHERE month = ?`,
      args: [sourceMonth],
    });

    if (src.rows.length === 0) return 0;

    const stmts = src.rows.map((r: any) => ({
      sql: `
        INSERT INTO store_assignments (store_id, month, am, ac)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(store_id, month) DO UPDATE SET
          am = excluded.am,
          ac = excluded.ac;
      `,
      args: [r.store_id, targetMonth, r.am, r.ac],
    }));

    await db.batch(stmts, 'write');
    return src.rows.length;
  } else {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('store_assignments')
      .select('store_id, am, ac')
      .eq('month', sourceMonth);

    if (!data || data.length === 0) return 0;

    const payload = data.map((d: any) => ({
      store_id: d.store_id,
      month: targetMonth,
      am: d.am,
      ac: d.ac,
    }));

    const { error } = await supabase
      .from('store_assignments')
      .upsert(payload, { onConflict: 'store_id,month' });
    if (error) throw new Error(`Supabase copyAssignments error: ${error.message}`);
    return data.length;
  }
}

/**
 * Hapus data tarikan pada rentang tanggal tertentu (Section 6b).
 * HANYA menghapus daily_store_stats dan kpi_cache.

 * TIDAK MENYENTUH stores dan store_assignments!
 */
export async function deleteDailyStatsAndKpi(
  dateStart: string,
  dateEnd: string
): Promise<{ deletedStats: number; deletedKpi: number }> {
  await initDb();
  const mode = getDbMode();

  if (mode !== 'supabase') {
    const db = getLocalClient();
    const r1 = await db.execute({
      sql: `DELETE FROM daily_store_stats WHERE date >= ? AND date <= ?;`,
      args: [dateStart, dateEnd],
    });
    const r2 = await db.execute({
      sql: `DELETE FROM kpi_cache WHERE date_start >= ? AND date_end <= ?;`,
      args: [dateStart, dateEnd],
    });
    return {
      deletedStats: r1.rowsAffected || 0,
      deletedKpi: r2.rowsAffected || 0,
    };
  } else {
    const supabase = getSupabase();
    const { count: c1 } = await supabase
      .from('daily_store_stats')
      .delete({ count: 'exact' })
      .gte('date', dateStart)
      .lte('date', dateEnd);
    const { count: c2 } = await supabase
      .from('kpi_cache')
      .delete({ count: 'exact' })
      .gte('date_start', dateStart)
      .lte('date_end', dateEnd);
    return {
      deletedStats: c1 || 0,
      deletedKpi: c2 || 0,
    };
  }
}

/**
 * Mendapatkan ringkasan pemakaian database (Section 6b)
 */
export async function getDatabaseMetrics(): Promise<{
  mode: 'turso' | 'supabase' | 'local_sqlite';
  dailyStatsCount: number;
  kpiCacheCount: number;
  storesCount: number;
  estimatedSizeBytes: number;
}> {
  await initDb();
  const mode = getDbMode();

  if (mode !== 'supabase') {
    const db = getLocalClient();
    const [sCount, kCount, stCount] = await Promise.all([
      db.execute('SELECT COUNT(*) as cnt FROM daily_store_stats'),
      db.execute('SELECT COUNT(*) as cnt FROM kpi_cache'),
      db.execute('SELECT COUNT(*) as cnt FROM stores'),
    ]);
    const dailyStatsCount = Number(sCount.rows[0]?.cnt || 0);
    const kpiCacheCount = Number(kCount.rows[0]?.cnt || 0);
    const storesCount = Number(stCount.rows[0]?.cnt || 0);

    let estimatedSizeBytes = 0;
    if (mode === 'local_sqlite') {
      try {
        const dbPath = path.join(process.cwd(), 'data', 'wifi_rekap.db');
        if (fs.existsSync(dbPath)) {
          estimatedSizeBytes = fs.statSync(dbPath).size;
        }
      } catch {}
    }
    if (estimatedSizeBytes === 0) {
      estimatedSizeBytes = (dailyStatsCount + kpiCacheCount + storesCount) * 200;
    }

    return {
      mode,
      dailyStatsCount,
      kpiCacheCount,
      storesCount,
      estimatedSizeBytes,
    };
  } else {
    const supabase = getSupabase();
    const [{ count: c1 }, { count: c2 }, { count: c3 }] = await Promise.all([
      supabase.from('daily_store_stats').select('*', { count: 'exact', head: true }),
      supabase.from('kpi_cache').select('*', { count: 'exact', head: true }),
      supabase.from('stores').select('*', { count: 'exact', head: true }),
    ]);

    const dailyStatsCount = c1 || 0;
    const kpiCacheCount = c2 || 0;
    const storesCount = c3 || 0;
    // Estimasi ~ 150 byte per baris
    const estimatedSizeBytes = (dailyStatsCount + kpiCacheCount + storesCount) * 150;

    return {
      mode: 'supabase',
      dailyStatsCount,
      kpiCacheCount,
      storesCount,
      estimatedSizeBytes,
    };
  }
}

export interface ReferenceStoreDef {
  kdStore: string;
  organisation: string;
  am: string;
  ac: string;
  activationDate: string; // YYYY-MM-DD
  source: VendorSource;
  sourceKey: string;
}

export const REFERENCE_27_STORES: ReferenceStoreDef[] = [
  { kdStore: '6A19', organisation: 'Lawson Site - Permata Karawaci', am: 'HENDRA WIGUNA', ac: 'AGUS SETIAWAN', activationDate: '2025-10-07', source: 'hypernet', sourceKey: 'Lawson Site - Permata Karawaci' },
  { kdStore: '6A0W', organisation: 'Lawson Site - Braga 66', am: 'HENDRA SUHENDAR', ac: 'SETO SUBEKTI', activationDate: '2025-11-12', source: 'hypernet', sourceKey: 'Lawson Site - Braga 66' },
  { kdStore: '6A6E', organisation: 'Lawson Site - DAAN MOGOT', am: 'HENDRA WIGUNA', ac: 'SILVIA LISANI/SUMARDI NABABAN (MDP AC)', activationDate: '2026-08-27', source: 'tachyon', sourceKey: '01a03ea9-6bd0-790a-ad8e-4d895a0052d2' },
  { kdStore: '6A8E', organisation: 'Lawson Site - Nusantara Raya', am: 'HENDRA WIGUNA', ac: 'MIA BUDIARTI', activationDate: '2025-10-30', source: 'hypernet', sourceKey: 'Lawson Site - Nusantara Raya' },
  { kdStore: '6A6J', organisation: 'Lawson site - IPB Dramaga', am: 'HENDRA WIGUNA', ac: 'BENI HERMAWAN', activationDate: '2026-08-24', source: 'hypernet', sourceKey: 'Lawson site - IPB Dramaga' },
  { kdStore: '6A6C', organisation: 'Lawson Site - CILILITAN BESAR', am: 'HENDRA SUHENDAR', ac: 'INDRA RIYANA/DECTA FARADILA NIVIKA (MDP AC)', activationDate: '2026-08-27', source: 'tachyon', sourceKey: '01a03e86-e023-7903-b46c-2e0d2773017a' },
  { kdStore: '6A3A', organisation: 'Lawson Site - GILI SAMPENG', am: 'RIO PRATAMA', ac: 'VIVAL DARMAWAN', activationDate: '2026-08-26', source: 'tachyon', sourceKey: '01a03e44-2d15-7a87-a56f-de74fbc89480' },
  { kdStore: '6A8A', organisation: 'Lawson Site - RAYA BOGOR', am: 'HENDRA WIGUNA', ac: 'BENI HERMAWAN', activationDate: '2026-08-27', source: 'tachyon', sourceKey: '01a03e63-7965-7c63-9eab-e8c842cd26b5' },
  { kdStore: '6A3H', organisation: 'Lawson site - Aniva Junction', am: 'HENDRA WIGUNA', ac: 'DONI HARIANTO/IMAM TAUFIK ISMAIL (MDP AC)', activationDate: '2026-09-18', source: 'hypernet', sourceKey: 'Lawson Site - Aniva Junction' },
  { kdStore: '6AAC', organisation: 'Lawson site - RSUD Kab Tangerang', am: 'HENDRA WIGUNA', ac: 'SILVIA LISANI', activationDate: '2026-08-24', source: 'hypernet', sourceKey: 'Lawson site - RSUD Kab Tangerang' },
  { kdStore: '6A23', organisation: 'Lawson Site - Syahdan', am: 'RIO PRATAMA', ac: 'VIVAL DARMAWAN', activationDate: '2025-10-21', source: 'hypernet', sourceKey: 'Lawson Site - Syahdan' },
  { kdStore: '6A9Z', organisation: 'Lawson Site - Siliwangi', am: 'HENDRA SUHENDAR', ac: 'SETO SUBEKTI', activationDate: '2025-11-18', source: 'hypernet', sourceKey: 'Lawson Site - Siliwangi' },
  { kdStore: '6A44', organisation: 'Lawson Site - Purwakarta Rest Area 72A', am: 'HENDRA SUHENDAR', ac: 'ODI RUSTANDI', activationDate: '2026-08-16', source: 'hypernet', sourceKey: 'Lawson Site - Purwakarta Rest Area 72A' },
  { kdStore: '6A5G', organisation: 'Lawson Site - Kelapa Dua Dalam', am: 'HENDRA WIGUNA', ac: 'MIA BUDIARTI', activationDate: '2025-10-20', source: 'hypernet', sourceKey: 'Lawson Site - Kelapa Dua Dalam' },
  { kdStore: '6A20', organisation: 'Lawson Site - Raya Pamulang', am: 'HENDRA WIGUNA', ac: 'MIA BUDIARTI', activationDate: '2025-10-09', source: 'hypernet', sourceKey: 'Lawson Site - Raya Pamulang' },
  { kdStore: '6A08', organisation: 'Lawson Site - Cipete', am: 'HENDRA WIGUNA', ac: 'SETIYONINGSIH', activationDate: '2025-10-20', source: 'hypernet', sourceKey: 'Lawson Site - Cipete' },
  { kdStore: '6A8U', organisation: 'Lawson Site - Cihampelas', am: 'HENDRA SUHENDAR', ac: 'HELGAN SOPAN', activationDate: '2026-08-19', source: 'hypernet', sourceKey: 'Lawson Site - Cihampelas' },
  { kdStore: '6A70', organisation: 'Lawson Site - Thamrin City', am: 'RIO PRATAMA', ac: 'MUHAMAD ALDI', activationDate: '2025-11-12', source: 'hypernet', sourceKey: 'Lawson Site - Thamrin City' },
  { kdStore: '6AAJ', organisation: 'Lawson Site - Salemba Raya', am: 'RIO PRATAMA', ac: 'MUHAMAD ALFARIZI', activationDate: '2026-02-27', source: 'hypernet', sourceKey: 'Lawson Site - Salemba Raya' },
  { kdStore: '6A39', organisation: 'Lawson Site - Graha Tamiya', am: 'HENDRA WIGUNA', ac: 'DONI HARIANTO', activationDate: '2025-11-21', source: 'hypernet', sourceKey: 'Lawson Site - Graha Tamiya' },
  { kdStore: '6A9V', organisation: 'Lawson Site - Emerald Sumarecon', am: 'HENDRA SUHENDAR', ac: 'MELINDA DWI APRILIANI', activationDate: '2025-12-29', source: 'hypernet', sourceKey: 'Lawson Site - Emerald Sumarecon' },
  { kdStore: '6A96', organisation: 'Lawson Site - Tangerang City', am: 'HENDRA WIGUNA', ac: 'SILVIA LISANI', activationDate: '2025-11-12', source: 'hypernet', sourceKey: 'Lawson Site - Tangerang City' },
  { kdStore: '6A54', organisation: 'Lawson Site - Aeropolis', am: 'HENDRA WIGUNA', ac: 'SILVIA LISANI', activationDate: '2025-10-29', source: 'hypernet', sourceKey: 'Lawson Site - Aeropolis' },
  { kdStore: '6AAI', organisation: 'Lawson Site - Dayang Sumbi', am: 'HENDRA SUHENDAR', ac: 'SETO SUBEKTI', activationDate: '2026-06-22', source: 'hypernet', sourceKey: 'Lawson Site -  Dayang Sumbi' },
  { kdStore: '6A1F', organisation: 'Lawson Site - Kelapa Dua', am: 'HENDRA WIGUNA', ac: 'MIA BUDIARTI', activationDate: '2025-10-22', source: 'hypernet', sourceKey: 'Lawson Site - Kelapa Dua' },
  { kdStore: '6A03', organisation: 'Lawson Site - Meruya Selatan', am: 'RIO PRATAMA', ac: 'VIVAL DARMAWAN', activationDate: '2025-10-02', source: 'hypernet', sourceKey: 'Lawson Site - Meruya Selatan' },
  { kdStore: '6AAM', organisation: 'Lawson Site - SUMMARECON SERPONG', am: 'HENDRA WIGUNA', ac: 'DONI HARIANTO', activationDate: '2026-08-26', source: 'tachyon', sourceKey: '01a03cd5-79a1-747b-ad3d-01f3254f92ad' },
];

/**
 * Normalisasi dan sinkronisasi 27 toko acuan:
 * 1. Menandai 27 toko acuan agar is_visible = 1, kd_store sesuai, display_name sesuai, dan tanggal aktivasi ternormalisasi (YYYY-MM-DD).
 * 2. Menandai toko di luar 27 toko acuan agar is_visible = 0 secara default (tetap tersimpan).
 * 3. Mengisi penugasan AM dan AC untuk 27 toko acuan pada bulan-bulan target.
 */
export async function seedReferenceStores(months: string[] = ['2026-10', '2026-08', '2026-09']): Promise<{
  matchedCount: number;
  hiddenCount: number;
}> {
  await initDb();
  const mode = getDbMode();

  const allStores = await getStores(false);
  const refMap = new Map<string, ReferenceStoreDef>();

  for (const ref of REFERENCE_27_STORES) {
    // Normalisasi key pencocokan
    const normKey = `${ref.source}__${ref.sourceKey.toLowerCase().replace(/\s+/g, ' ').trim()}`;
    refMap.set(normKey, ref);
  }

  let matchedCount = 0;
  let hiddenCount = 0;

  for (const store of allStores) {
    const storeKeyNorm = `${store.source}__${store.source_key.toLowerCase().replace(/\s+/g, ' ').trim()}`;
    const storeDisplayNorm = `${store.source}__${store.display_name.toLowerCase().replace(/\s+/g, ' ').trim()}`;

    const matchedRef = refMap.get(storeKeyNorm) || refMap.get(storeDisplayNorm);

    if (matchedRef) {
      matchedCount++;
      await updateStore(store.id, {
        kd_store: matchedRef.kdStore,
        display_name: matchedRef.organisation,
        activation_date: matchedRef.activationDate,
        is_visible: 1,
        active: 1,
        is_new_flag: 0,
      });

      // Penugasan AM & AC untuk bulan-bulan target
      for (const m of months) {
        await upsertStoreAssignment(store.id, m, matchedRef.am, matchedRef.ac);
      }
    } else {
      hiddenCount++;
      // Toko lain tetap tersimpan dan disembunyikan secara default
      await updateStore(store.id, {
        is_visible: 0,
      });
    }
  }

  return { matchedCount, hiddenCount };
}

/**
 * =========================================================================
 * PERSISTENSI SESI PENARIKAN (Memperbaiki regresi sesi hilang saat recompile)
 * =========================================================================
 */

export interface DbSyncSession {
  id: string;
  createdAt: number;
  expiresAt: number;
  hypernet?: any;
  tachyon?: any;
}

export async function saveSyncSession(session: DbSyncSession): Promise<void> {
  await initDb();
  const db = getLocalClient();
  await db.execute({
    sql: `
      INSERT INTO sync_sessions (id, created_at, expires_at, hypernet_session, tachyon_session)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        created_at = excluded.created_at,
        expires_at = excluded.expires_at,
        hypernet_session = excluded.hypernet_session,
        tachyon_session = excluded.tachyon_session;
    `,
    args: [
      session.id,
      session.createdAt,
      session.expiresAt,
      session.hypernet ? JSON.stringify(session.hypernet) : null,
      session.tachyon ? JSON.stringify(session.tachyon) : null,
    ],
  });
}

export async function getSyncSession(id: string): Promise<DbSyncSession | null> {
  await initDb();
  const db = getLocalClient();
  const res = await db.execute({
    sql: `SELECT * FROM sync_sessions WHERE id = ?;`,
    args: [id],
  });
  if (res.rows.length === 0) return null;
  const row = res.rows[0] as any;
  const expiresAt = Number(row.expires_at);
  if (expiresAt < Date.now()) {
    // Sesi telah kedaluwarsa
    await db.execute({ sql: `DELETE FROM sync_sessions WHERE id = ?;`, args: [id] });
    return null;
  }
  return {
    id: String(row.id),
    createdAt: Number(row.created_at),
    expiresAt,
    hypernet: row.hypernet_session ? JSON.parse(String(row.hypernet_session)) : undefined,
    tachyon: row.tachyon_session ? JSON.parse(String(row.tachyon_session)) : undefined,
  };
}

export async function deleteSyncSession(id: string): Promise<void> {
  await initDb();
  const db = getLocalClient();
  await db.execute({
    sql: `DELETE FROM sync_sessions WHERE id = ?;`,
    args: [id],
  });
}

export async function cleanupExpiredSyncSessions(): Promise<void> {
  await initDb();
  const db = getLocalClient();
  await db.execute({
    sql: `DELETE FROM sync_sessions WHERE expires_at < ?;`,
    args: [Date.now()],
  });
}

/**
 * =========================================================================
 * SCHEDULER RETENSI DATA (Setiap 14 hari hapus 7 hari terlama dari MIN tanggal)
 * =========================================================================
 */

export interface AutoCleanLog {
  id: number;
  executed_at: string;
  date_start: string | null;
  date_end: string | null;
  deleted_stats: number;
  deleted_kpi: number;
  status: 'SUCCESS' | 'SKIPPED' | 'FAILED';
  message: string | null;
}

export async function getAutoCleanLogs(limit: number = 20): Promise<AutoCleanLog[]> {
  await initDb();
  const db = getLocalClient();
  const res = await db.execute({
    sql: `SELECT * FROM auto_clean_logs ORDER BY id DESC LIMIT ?;`,
    args: [limit],
  });
  return res.rows as unknown as AutoCleanLog[];
}

export async function getLastSuccessfulAutoClean(): Promise<AutoCleanLog | null> {
  await initDb();
  const db = getLocalClient();
  const res = await db.execute(`
    SELECT * FROM auto_clean_logs
    WHERE status = 'SUCCESS'
    ORDER BY id DESC LIMIT 1;
  `);
  if (res.rows.length === 0) return null;
  return res.rows[0] as unknown as AutoCleanLog;
}

/**
 * Jalankan scheduler retensi data:
 * 1. Setiap 14 hari.
 * 2. Menggunakan lock database agar restart/eksekusi ganda tidak menghapus berulang.
 * 3. Menghapus data lokal dari 7 hari paling lama berdasarkan MIN(date) yang benar-benar ada di database.
 * 4. Hapus hanya data yang masuk kebijakan retensi (data yang melebihi batas kelola aplikasi 93 hari).
 * 5. Mencatat waktu, rentang, jumlah terhapus, dan status ke auto_clean_logs.
 */
export async function runAutoRetentionCleanup(options?: {
  force?: boolean;
  ignoreCutoff?: boolean;
}): Promise<{
  executed: boolean;
  status: 'SUCCESS' | 'SKIPPED' | 'FAILED';
  dateStart?: string;
  dateEnd?: string;
  deletedStats: number;
  deletedKpi: number;
  message: string;
}> {
  await initDb();
  const mode = getDbMode();
  if (mode === 'supabase') {
    return {
      executed: false,
      status: 'SKIPPED',
      deletedStats: 0,
      deletedKpi: 0,
      message: 'Retention scheduler saat ini berjalan pada database libSQL/SQLite.',
    };
  }

  const db = getLocalClient();
  const nowMs = Date.now();
  const executedAt = new Date().toISOString();

  // 1. Lock check: cegah eksekusi paralel dalam rentang 5 menit
  try {
    const lockRes = await db.execute({
      sql: `SELECT locked_at FROM scheduler_lock WHERE id = 'retention';`,
    });
    if (lockRes.rows.length > 0) {
      const lockedAt = Number(lockRes.rows[0].locked_at);
      if (nowMs - lockedAt < 5 * 60 * 1000 && !options?.force) {
        return {
          executed: false,
          status: 'SKIPPED',
          deletedStats: 0,
          deletedKpi: 0,
          message: 'Scheduler retensi sedang berjalan oleh proses lain (lock aktif).',
        };
      }
    }

    // Set lock
    await db.execute({
      sql: `
        INSERT INTO scheduler_lock (id, locked_at) VALUES ('retention', ?)
        ON CONFLICT(id) DO UPDATE SET locked_at = excluded.locked_at;
      `,
      args: [nowMs],
    });
  } catch (lockErr: any) {
    console.warn('Gagal mengatur scheduler lock:', lockErr);
  }

  try {
    // 2. Cek interval 14 hari sejak eksekusi sukses terakhir
    const lastSuccess = await getLastSuccessfulAutoClean();
    if (lastSuccess && !options?.force) {
      const lastTime = new Date(lastSuccess.executed_at).getTime();
      const diffDays = (nowMs - lastTime) / (1000 * 86400);
      if (diffDays < 14) {
        return {
          executed: false,
          status: 'SKIPPED',
          deletedStats: 0,
          deletedKpi: 0,
          message: `Scheduler belum mencapai interval 14 hari (terakhir sukses ${diffDays.toFixed(1)} hari yang lalu pada ${lastSuccess.executed_at}).`,
        };
      }
    }

    // 3. Tentukan tanggal data paling lama yang benar-benar ada (MIN tanggal)
    const minRes = await db.execute(`SELECT MIN(date) as min_date FROM daily_store_stats;`);
    const minDate = minRes.rows[0]?.min_date ? String(minRes.rows[0].min_date) : null;

    if (!minDate) {
      const message = 'Tidak ada data di tabel daily_store_stats untuk dibersihkan.';
      await db.execute({
        sql: `
          INSERT INTO auto_clean_logs (executed_at, date_start, date_end, deleted_stats, deleted_kpi, status, message)
          VALUES (?, NULL, NULL, 0, 0, 'SKIPPED', ?);
        `,
        args: [executedAt, message],
      });
      return {
        executed: true,
        status: 'SKIPPED',
        deletedStats: 0,
        deletedKpi: 0,
        message,
      };
    }

    // 4. Periksa kebijakan retensi:
    // Kebijakan retensi aplikasi adalah data maksimal 93 hari kalender dari hari ini.
    // Data yang lebih tua dari batas retensi (date < cutoff) adalah data yang sah untuk dihapus.
    const todayStr = getJakartaToday();
    const [tY, tM, tD] = todayStr.split('-').map(Number);
    const cutoffDateObj = new Date(Date.UTC(tY, tM - 1, tD));
    cutoffDateObj.setUTCDate(cutoffDateObj.getUTCDate() - MAX_DATE_RANGE_DAYS);
    const retentionCutoff = cutoffDateObj.toISOString().slice(0, 10);

    // Ambil 7 hari paling lama yang benar-benar ada di daily_store_stats
    let candidateDatesQuery = `
      SELECT DISTINCT date FROM daily_store_stats
      ORDER BY date ASC
      LIMIT 7;
    `;
    let candidateRes = await db.execute(candidateDatesQuery);
    let candidateDates = candidateRes.rows.map((r) => String(r.date));

    if (candidateDates.length === 0) {
      const message = 'Tidak ada tanggal data yang dapat dihapus.';
      await db.execute({
        sql: `
          INSERT INTO auto_clean_logs (executed_at, date_start, date_end, deleted_stats, deleted_kpi, status, message)
          VALUES (?, NULL, NULL, 0, 0, 'SKIPPED', ?);
        `,
        args: [executedAt, message],
      });
      return {
        executed: true,
        status: 'SKIPPED',
        deletedStats: 0,
        deletedKpi: 0,
        message,
      };
    }

    // Jika tidak ignoreCutoff, pastikan hanya data yang melewati batas retensi 93 hari yang dihapus
    if (!options?.ignoreCutoff) {
      // Filter hanya tanggal yang < retentionCutoff
      const eligibleDates = candidateDates.filter((d) => d < retentionCutoff);
      if (eligibleDates.length === 0) {
        const message = `Semua data lokal (${minDate} s/d ...) masih berada dalam rentang retensi aktif (cutoff retensi 93 hari: ${retentionCutoff}). Tidak ada data yang dihapus.`;
        await db.execute({
          sql: `
            INSERT INTO auto_clean_logs (executed_at, date_start, date_end, deleted_stats, deleted_kpi, status, message)
            VALUES (?, NULL, NULL, 0, 0, 'SKIPPED', ?);
          `,
          args: [executedAt, message],
        });
        return {
          executed: true,
          status: 'SKIPPED',
          deletedStats: 0,
          deletedKpi: 0,
          message,
        };
      }
      candidateDates = eligibleDates;
    }

    const dateStart = candidateDates[0];
    const dateEnd = candidateDates[candidateDates.length - 1];

    // 5. Hapus 7 hari terlama tersebut hanya di daily_store_stats dan kpi_cache
    // DILARANG MENYENTUH stores dan store_assignments
    const delRes = await deleteDailyStatsAndKpi(dateStart, dateEnd);

    const message = `Berhasil membersihkan data lokal ${candidateDates.length} hari terlama (${dateStart} s/d ${dateEnd}): ${delRes.deletedStats} stats harian dan ${delRes.deletedKpi} cache KPI terhapus.`;

    await db.execute({
      sql: `
        INSERT INTO auto_clean_logs (executed_at, date_start, date_end, deleted_stats, deleted_kpi, status, message)
        VALUES (?, ?, ?, ?, ?, 'SUCCESS', ?);
      `,
      args: [executedAt, dateStart, dateEnd, delRes.deletedStats, delRes.deletedKpi, message],
    });

    return {
      executed: true,
      status: 'SUCCESS',
      dateStart,
      dateEnd,
      deletedStats: delRes.deletedStats,
      deletedKpi: delRes.deletedKpi,
      message,
    };
  } catch (err: any) {
    const errorMsg = `Error saat eksekusi retention scheduler: ${err.message}`;
    try {
      await db.execute({
        sql: `
          INSERT INTO auto_clean_logs (executed_at, date_start, date_end, deleted_stats, deleted_kpi, status, message)
          VALUES (?, NULL, NULL, 0, 0, 'FAILED', ?);
        `,
        args: [executedAt, errorMsg],
      });
    } catch {}

    return {
      executed: false,
      status: 'FAILED',
      deletedStats: 0,
      deletedKpi: 0,
      message: errorMsg,
    };
  } finally {
    // Release lock
    try {
      await db.execute(`DELETE FROM scheduler_lock WHERE id = 'retention';`);
    } catch {}
  }
}

