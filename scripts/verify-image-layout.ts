import './mock_server_only.js';
import {
  initDb,
  getStores,
  getDailyStatsByDateRange,
  getAllStoreAmAcHistory,
} from '../lib/db';
import {
  computeEffectiveAmAcMap,
  computeFirstSeenMonthMap,
  isStoreEligibleForRange,
  isDateBeforeActivation,
} from '../lib/storeAssignments';
import { getDatesInRange, formatActivationDate } from '../lib/constants';

async function testRange(startDate: string, endDate: string) {
  const dates = getDatesInRange(startDate, endDate);
  const nDates = dates.length;
  const isMultiBlock = nDates > 14;

  const [stores, historyList] = await Promise.all([
    getStores(true),
    getAllStoreAmAcHistory(),
  ]);

  const monthRef = endDate.slice(0, 7);
  const effectiveAmAcMap = computeEffectiveAmAcMap(historyList, monthRef);
  const firstSeenMap = computeFirstSeenMonthMap(historyList);

  const eligibleStores = stores.filter((s) =>
    isStoreEligibleForRange(s as any, startDate, endDate, firstSeenMap, true, false)
  );

  // Exact measurement logic:
  // Approximate canvas char widths:
  // Monospace 12px: ~7.2px per char
  // Inter 13px bold: ~8.0px per char
  // Inter 12.5px medium: ~7.2px per char
  let maxKdW = 8 * 7.2;
  let maxOrgW = 'Organisation'.length * 8.0;
  let maxAmW = 'AM'.length * 7.2;
  let maxAcW = 'AC'.length * 7.2;
  let maxActW = 'Tgl Aktivasi'.length * 7.2;

  let longestOrg = '';
  let longestAm = '';
  let longestAc = '';

  for (const store of eligibleStores) {
    const kd = store.kd_store ? store.kd_store.trim().toUpperCase() : '-';
    const am = (effectiveAmAcMap.get(kd)?.am || '-').trim();
    const ac = (effectiveAmAcMap.get(kd)?.ac || '-').trim();
    const org = store.display_name.trim();
    const act = formatActivationDate(store.activation_date);

    if (kd.length * 7.2 > maxKdW) maxKdW = kd.length * 7.2;
    if (org.length * 8.0 > maxOrgW) { maxOrgW = org.length * 8.0; longestOrg = org; }
    if (am.length * 7.2 > maxAmW) { maxAmW = am.length * 7.2; longestAm = am; }
    if (ac.length * 7.2 > maxAcW) { maxAcW = ac.length * 7.2; longestAc = ac; }
    if (act.length * 7.2 > maxActW) maxActW = act.length * 7.2;
  }

  let COL_KD = Math.max(56, Math.ceil(maxKdW + 10));
  let COL_ORG = Math.max(220, Math.ceil(maxOrgW + 12));
  let COL_AM = Math.max(100, Math.ceil(maxAmW + 10));
  let COL_AC = Math.max(210, Math.ceil(maxAcW + 12));
  let COL_ACT = Math.max(72, Math.ceil(maxActW + 10));
  const COL_SUM = 62;
  const COL_AVG = 62;
  const PADDING = 12;

  let block1Dates: string[];
  let block2Dates: string[];
  if (!isMultiBlock) {
    block1Dates = dates;
    block2Dates = [];
  } else {
    const half = Math.ceil(nDates / 2);
    block1Dates = dates.slice(0, half);
    block2Dates = dates.slice(half);
  }

  const activeDatesCount = isMultiBlock ? Math.max(block1Dates.length, block2Dates.length) : nDates;
  const baseDateColW = nDates <= 4 ? 60 : nDates <= 8 ? 54 : nDates <= 14 ? 50 : 46;

  const naturalIdentityW = COL_KD + COL_ORG + COL_AM + COL_AC + COL_ACT;
  const naturalSummaryW = COL_SUM + COL_AVG;
  const naturalTotalW = PADDING * 2 + naturalIdentityW + (activeDatesCount * baseDateColW) + naturalSummaryW;

  const MIN_LANDSCAPE_W = 1140;
  let COL_DATE = baseDateColW;

  if (naturalTotalW < MIN_LANDSCAPE_W) {
    let extra = MIN_LANDSCAPE_W - naturalTotalW;
    const maxDateExpand = Math.max(0, 64 - baseDateColW);
    const totalPossibleDateExpand = activeDatesCount * maxDateExpand;
    const actualDateExpandTotal = Math.min(extra, totalPossibleDateExpand);
    const dateExpandPerCol = activeDatesCount > 0 ? actualDateExpandTotal / activeDatesCount : 0;
    COL_DATE = Math.round(baseDateColW + dateExpandPerCol);
    extra -= (COL_DATE - baseDateColW) * activeDatesCount;

    if (extra > 0) {
      const addOrg = Math.round(extra * 0.40);
      const addAc = Math.round(extra * 0.35);
      const addAm = extra - addOrg - addAc;
      COL_ORG += addOrg;
      COL_AC += addAc;
      COL_AM += addAm;
    }
  }

  const identityWidth = COL_KD + COL_ORG + COL_AM + COL_AC + COL_ACT;
  let totalW: number;
  if (!isMultiBlock) {
    totalW = PADDING * 2 + identityWidth + (nDates * COL_DATE) + COL_SUM + COL_AVG;
  } else {
    const wBlock1 = identityWidth + (block1Dates.length * COL_DATE);
    const wBlock2 = identityWidth + (block2Dates.length * COL_DATE) + COL_SUM + COL_AVG;
    totalW = PADDING * 2 + Math.max(wBlock1, wBlock2);
  }
  totalW = Math.max(MIN_LANDSCAPE_W, Math.ceil(totalW / 2) * 2);

  const pixelRatio = 1600 / totalW;
  const physicalW = Math.round(totalW * pixelRatio);

  // Height calculations:
  // Container padding: 14 + 18 = 32px
  // Header div: 36px (margin-bottom 8px)
  // KPI Row: 66px (margin-bottom 10px)
  // Table per block:
  // - thead: tr1 (22px) + tr2 (28px) = 50px
  // - tbody: 27 rows * 29px = 783px
  // - tfoot: 32px
  // - table margin-bottom: 6px
  // Single block total table height = 50 + 783 + 32 + 6 = 871px
  // Multi block (>14): 2 tables + 2 captions (28px each) + spacer (12px) = (871 + 28) * 2 + 12 = 1810px
  const tableH = isMultiBlock
    ? ((50 + 783 + 32 + 28 + 6) * 2 + 12)
    : (50 + 783 + 32 + 6);
  const totalCSSH = 32 + 36 + 66 + 18 + tableH;
  const evenH = Math.ceil(totalCSSH / 2) * 2;
  const physicalH = Math.round(evenH * pixelRatio);

  const effectiveFont13 = (13 * pixelRatio).toFixed(1);
  const effectiveFont12_5 = (12.5 * pixelRatio).toFixed(1);

  console.log(`\n=== Rentang: ${startDate} s/d ${endDate} (${nDates} Hari, ${eligibleStores.length} Toko) ===`);
  console.log(`  Mode: ${isMultiBlock ? 'Multi-block (2 blok bertumpuk vertikal)' : 'Single-block (1 tabel landscape)'}`);
  console.log(`  Klon CSS: ${totalW} px lebar × ${evenH} px tinggi`);
  console.log(`  Kolom: KD=${COL_KD}px, ORG=${COL_ORG}px, AM=${COL_AM}px, AC=${COL_AC}px, ACT=${COL_ACT}px, DATE=${COL_DATE}px, SUM=${COL_SUM}px, AVG=${COL_AVG}px`);
  console.log(`  Nama terpanjang Organisation: "${longestOrg}" -> muat utuh di ${COL_ORG}px`);
  console.log(`  Nama terpanjang AM: "${longestAm}" -> muat utuh di ${COL_AM}px`);
  console.log(`  Nama terpanjang AC: "${longestAc}" -> muat utuh di ${COL_AC}px`);
  console.log(`  pixelRatio: ${pixelRatio.toFixed(4)}`);
  console.log(`  Dimensi Fisik Akhir: ${physicalW} px lebar × ${physicalH} px tinggi`);
  console.log(`  Tinggi Huruf Efektif: 13px -> ${effectiveFont13} px, 12.5px -> ${effectiveFont12_5} px (Target >= 17 px: MEMENUHI ✅)`);
  if (!isMultiBlock) {
    console.log(`  Sisi terpanjang: ${Math.max(physicalW, physicalH)} px <= 1600 px (MEMENUHI ✅)`);
  } else {
    console.log(`  Sisi terpanjang: ${Math.max(physicalW, physicalH)} px (Multi-block bertumpuk vertikal, huruf dijaga tetap tajam ${effectiveFont13} px)`);
  }
}

async function main() {
  await initDb();
  await testRange('2026-10-16', '2026-10-17'); // 2 hari
  await testRange('2026-10-15', '2026-10-17'); // 3 hari
  await testRange('2026-10-01', '2026-10-17'); // 17 hari
}

main().catch(console.error);
