import {
  initDb,
  upsertDailyStoreStats,
  autoRegisterStores,
  upsertKpiCache,
  getDailyStatsByDateRange,
  getStores,
  getKpiCache,
  deleteDailyStatsAndKpi,
  getDatabaseMetrics,
} from '../lib/db';
import { hypernetDayRangeMs, fmtBytes, fmtDuration } from '../lib/constants';

async function runTests() {
  console.log('=== [1] Inisialisasi Database ===');
  await initDb();
  console.log('✓ Database dan tabel berhasil diinisialisasi.');

  console.log('\n=== [2] Pengujian Constants & Formatter ===');
  console.log('1024 Bytes:', fmtBytes(1024));
  console.log('1.5 GB:', fmtBytes(1.5 * 1024 * 1024 * 1024));
  console.log('Duration 90065s:', fmtDuration(90065));

  const { startMs, endMs } = hypernetDayRangeMs('2026-08-31', '2026-08-31');
  console.log('Hypernet 2026-08-31 UTC range:', { startMs, endMs, diffHours: (endMs - startMs) / 3600000 });
  if ((endMs - startMs) / 3600000 !== 24) {
    throw new Error('Rentang 1 hari Hypernet harus tepat 24 jam!');
  }

  console.log('\n=== [3] Pengujian Upsert & Auto-Register Stores ===');
  const dummyStores = [
    { source: 'hypernet' as const, source_key: 'Lawson Site - Nusantara Raya' },
    { source: 'hypernet' as const, source_key: 'Lawson Site - Bandung Malang' },
    { source: 'tachyon' as const, source_key: '101', display_name: 'CILILITAN BESAR' },
  ];
  const newStoresCount = await autoRegisterStores(dummyStores);
  console.log(`✓ Auto-register stores: ${newStoresCount} toko baru didaftarkan.`);

  const allStores = await getStores();
  console.log(`✓ Total toko di database: ${allStores.length}`);

  console.log('\n=== [4] Pengujian Upsert Daily Store Stats ===');
  const dummyStats = [
    {
      source: 'hypernet' as const,
      source_key: 'Lawson Site - Nusantara Raya',
      date: '2026-08-31',
      users: 21,
      upload_bytes: null,
      download_bytes: null,
      total_bytes: 12500000000,
      duration_seconds: 36000,
      fetched_at: new Date().toISOString(),
    },
    {
      source: 'hypernet' as const,
      source_key: 'Lawson Site - Bandung Malang',
      date: '2026-08-31',
      users: 12,
      upload_bytes: null,
      download_bytes: null,
      total_bytes: 8500000000,
      duration_seconds: 24000,
      fetched_at: new Date().toISOString(),
    },
    {
      source: 'tachyon' as const,
      source_key: '101',
      date: '2026-08-31',
      users: 77,
      upload_bytes: 2000000000,
      download_bytes: 15000000000,
      total_bytes: 17000000000,
      duration_seconds: 45000,
      fetched_at: new Date().toISOString(),
    },
  ];
  await upsertDailyStoreStats(dummyStats);
  console.log('✓ Upsert daily store stats berhasil.');

  const fetchedStats = await getDailyStatsByDateRange('2026-08-31', '2026-08-31');
  console.log(`✓ Data yang diambil untuk 2026-08-31: ${fetchedStats.length} baris.`);
  if (fetchedStats.length !== 3) {
    throw new Error('Jumlah stats harus 3 baris!');
  }

  console.log('\n=== [5] Pengujian KPI Cache ===');
  await upsertKpiCache({
    source: 'hypernet',
    date_start: '2026-08-01',
    date_end: '2026-08-31',
    new_users: 3720,
    returning_new_users: 359,
    returning_users: 200,
    all_users: 4279,
    fetched_at: new Date().toISOString(),
  });
  const cachedKpi = await getKpiCache('hypernet', '2026-08-01', '2026-08-31');
  console.log('✓ KPI Cache:', cachedKpi);
  if (cachedKpi?.all_users !== 4279) {
    throw new Error('All users KPI harus 4279!');
  }

  console.log('\n=== [6] Pengujian Metrik Database ===');
  const metrics = await getDatabaseMetrics();
  console.log('✓ Metrik Database:', metrics);

  console.log('\n=== [7] Pengujian Penghapusan Aman (Section 6b) ===');
  const delRes = await deleteDailyStatsAndKpi('2026-08-31', '2026-08-31');
  console.log(`✓ Data tarikan dihapus: ${delRes.deletedStats} stats, ${delRes.deletedKpi} kpi`);

  const storesAfterDel = await getStores();
  console.log(`✓ Toko tetap utuh: ${storesAfterDel.length} toko (stores tidak tersentuh)`);
  if (storesAfterDel.length !== allStores.length) {
    throw new Error('Tabel stores TIDAK boleh berkurang saat data tarikan dihapus!');
  }

  console.log('\n========================================');
  console.log('🎉 SEMUA PENGUJIAN TAHAP 1 BERHASIL! 100%');
  console.log('========================================');
}

runTests().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
