import './mock_server_only.js';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { generateRekapExcelBlob } from '../lib/excelExport';
import {
  isStoreEligibleForRange,
  isDateBeforeActivation,
  computeEffectiveAmAcMap,
  computeFirstSeenMonthMap,
} from '../lib/storeAssignments';
import {
  getMonthPeriod,
  calculateDaysCount,
  getDatesInRange,
  formatDateColumnHeader,
  formatActivationDate,
  getShortMonthUpper,
} from '../lib/constants';
import {
  initDb,
  getStores,
  getDailyStatsByDateRange,
  getKpiCache,
  getAllStoreAmAcHistory,
  getAllAvailableDates,
} from '../lib/db';
import { computeKpiWindow } from '../lib/kpiWindow';

interface VerifyRangeResult {
  range: string;
  storesCount: number;
  datesCount: number;
  cellsCompared: number;
  diffCount: number;
  errors: string[];
}

async function verifyRange(startDate: string, endDate: string): Promise<VerifyRangeResult> {
  const isMultiMonth = startDate.slice(0, 7) !== endDate.slice(0, 7);
  const monthRef = endDate.slice(0, 7);
  const monthPeriod = getMonthPeriod(monthRef);
  const selectedDatesList = getDatesInRange(startDate, endDate);
  const periodDaysCount = isMultiMonth ? selectedDatesList.length : monthPeriod.daysCount;
  const periodDates = isMultiMonth
    ? selectedDatesList
    : getDatesInRange(monthPeriod.startDate, monthPeriod.endDate);

  const [availableDates, allStores, historyList] = await Promise.all([
    getAllAvailableDates(),
    getStores(false),
    getAllStoreAmAcHistory(),
  ]);

  const queryStart = startDate < monthPeriod.startDate ? startDate : monthPeriod.startDate;
  const queryEnd = endDate > monthPeriod.endDate ? endDate : monthPeriod.endDate;

  const [allStats, rangeHypernetKpi, rangeTachyonKpi] = await Promise.all([
    getDailyStatsByDateRange(queryStart, queryEnd),
    getKpiCache('hypernet', startDate, endDate),
    getKpiCache('tachyon', startDate, endDate),
  ]);

  const effectiveAmAcMap = computeEffectiveAmAcMap(historyList, monthRef);
  const firstSeenMap = computeFirstSeenMonthMap(historyList);

  const mergedAssignments: Record<string, any> = {};
  for (const store of allStores) {
    const kd = store.kd_store ? store.kd_store.trim().toUpperCase() : null;
    if (kd && effectiveAmAcMap.has(kd)) {
      mergedAssignments[store.id] = effectiveAmAcMap.get(kd);
    }
  }

  const exportStatsMap = new Map<string, number>();
  for (const s of allStats) {
    exportStatsMap.set(`${s.source}__${s.source_key}__${s.date}`, s.users);
  }

  // Exact UI data preparation
  const allExportRows = allStores.map((store) => {
    const assignment = mergedAssignments[store.id];
    const am = assignment?.am || '';
    const ac = assignment?.ac || '';

    const dateValues: Record<string, number> = {};
    for (const d of selectedDatesList) {
      if (isDateBeforeActivation(store.activation_date, d)) {
        dateValues[d] = 0;
      } else {
        const val = exportStatsMap.get(`${store.source}__${store.source_key}__${d}`);
        dateValues[d] = val !== undefined ? val : 0;
      }
    }

    let sumMonth = 0;
    for (const md of periodDates) {
      if (!isDateBeforeActivation(store.activation_date, md)) {
        const v = exportStatsMap.get(`${store.source}__${store.source_key}__${md}`);
        if (v !== undefined) sumMonth += v;
      }
    }

    const avgMonth = periodDaysCount > 0 ? Math.round(sumMonth / periodDaysCount) : 0;

    return {
      id: store.id,
      source: store.source as 'hypernet' | 'tachyon',
      source_key: store.source_key,
      display_name: store.display_name,
      kd_store: store.kd_store || '',
      activation_date: store.activation_date || '',
      active: store.active === 1,
      is_visible: store.is_visible,
      am,
      ac,
      dateValues,
      sumMonth,
      avgMonth,
    };
  });

  const filteredExportRows = allExportRows.filter((row) => {
    return isStoreEligibleForRange(row as any, startDate, endDate, firstSeenMap, true, false);
  });

  const sortedExportRows = [...filteredExportRows].sort((a, b) => {
    return a.kd_store.localeCompare(b.kd_store);
  });

  const exportDateTotals: Record<string, number> = {};
  for (const d of selectedDatesList) exportDateTotals[d] = 0;
  let exportTotalSum = 0;
  let exportTotalAvg = 0;
  for (const row of sortedExportRows) {
    for (const d of selectedDatesList) {
      exportDateTotals[d] += row.dateValues[d] || 0;
    }
    exportTotalSum += row.sumMonth;
    exportTotalAvg += row.avgMonth;
  }

  const kpiData = {
    sumStore: sortedExportRows.length,
    newUsers: (rangeHypernetKpi?.new_users || 0) + (rangeTachyonKpi?.new_users || 0),
    returningNewUsers: rangeHypernetKpi?.returning_new_users || 0,
    returningUsers: (rangeHypernetKpi?.returning_users || 0) + (rangeTachyonKpi?.returning_users || 0),
    allUsers: (rangeHypernetKpi?.all_users || 0) + (rangeTachyonKpi?.all_users || 0),
  };

  const blob = await generateRekapExcelBlob({
    startDate,
    endDate,
    monthRef,
    monthPeriod,
    selectedDates: selectedDatesList,
    tableRows: sortedExportRows,
    totals: { dateTotals: exportDateTotals, totalSum: exportTotalSum, totalAvg: exportTotalAvg },
    kpi: kpiData,
    stores: allStores.map((s) => ({ ...s, active: s.active })),
    stats: allStats,
  });

  const arrayBuffer = await blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);

  const ws = workbook.getWorksheet('Dashboard');
  if (!ws) throw new Error('Sheet Dashboard not found in generated workbook');

  let cellsCompared = 0;
  let diffCount = 0;
  const errors: string[] = [];

  function checkCell(rowNum: number, colNum: number, expected: any, desc: string) {
    cellsCompared++;
    const actual = ws?.getRow(rowNum).getCell(colNum).value;
    const expStr = expected === null || expected === undefined ? '' : String(expected);
    const actStr = actual === null || actual === undefined ? '' : String(actual);
    if (expStr !== actStr) {
      diffCount++;
      const err = `[${desc}] Row ${rowNum} Col ${colNum}: expected "${expStr}", got "${actStr}"`;
      if (errors.length < 15) errors.push(err);
    }
  }

  // 1. Verifikasi 5 Kartu KPI (Baris 5 & 6)
  const expectedCards = [
    { col: 2, label: 'SUM STORE', val: kpiData.sumStore },
    { col: 3, label: 'NEW USERS', val: kpiData.newUsers },
    { col: 4, label: 'RETURNING NEW USERS', val: kpiData.returningNewUsers },
    { col: 5, label: 'RETURNING USERS', val: kpiData.returningUsers },
    { col: 6, label: 'ALL USERS', val: kpiData.allUsers },
  ];
  for (const card of expectedCards) {
    checkCell(5, card.col, card.label, `Card Header ${card.label}`);
    checkCell(6, card.col, card.val, `Card Value ${card.label}`);
  }

  // 2. Cari baris header tabel (kolom 1 bernilai "No.")
  let headerRowIdx = -1;
  ws.eachRow((r, rowNumber) => {
    if (r.getCell(1).value === 'No.') {
      headerRowIdx = rowNumber;
    }
  });

  if (headerRowIdx === -1) {
    diffCount++;
    errors.push('Header row (No.) not found');
    return { range: `${startDate} s/d ${endDate}`, storesCount: sortedExportRows.length, datesCount: selectedDatesList.length, cellsCompared, diffCount, errors };
  }

  const shortMonthUpper = getShortMonthUpper(monthRef);
  const expectedHeaders = [
    'No.',
    'Kd Store',
    'Organisation',
    'AM',
    'AC',
    'Tanggal Aktivasi',
    ...selectedDatesList.map((d) => formatDateColumnHeader(d)),
    `SUM ${shortMonthUpper}`,
    `AVG ${shortMonthUpper}`,
  ];

  for (let c = 0; c < expectedHeaders.length; c++) {
    checkCell(headerRowIdx, c + 1, expectedHeaders[c], `Table Header Col ${c + 1}`);
  }

  // 3. Verifikasi Setiap Baris Toko
  sortedExportRows.forEach((row, idx) => {
    const rowNum = headerRowIdx + 1 + idx;

    checkCell(rowNum, 1, idx + 1, `Store #${idx + 1} No.`);
    checkCell(rowNum, 2, row.kd_store || '-', `Store #${idx + 1} Kd Store`);
    checkCell(rowNum, 3, row.display_name, `Store #${idx + 1} Organisation`);
    checkCell(rowNum, 4, row.am || '-', `Store #${idx + 1} AM`);
    checkCell(rowNum, 5, row.ac || '-', `Store #${idx + 1} AC`);
    checkCell(rowNum, 6, formatActivationDate(row.activation_date), `Store #${idx + 1} Tanggal Aktivasi`);

    selectedDatesList.forEach((d, dIdx) => {
      const colNum = 7 + dIdx;
      const expectedVal = isDateBeforeActivation(row.activation_date, d) ? '-' : (row.dateValues[d] ?? 0);
      checkCell(rowNum, colNum, expectedVal, `Store #${idx + 1} ${d}`);
    });

    const sumCol = 7 + selectedDatesList.length;
    const avgCol = sumCol + 1;
    checkCell(rowNum, sumCol, row.sumMonth, `Store #${idx + 1} SUM`);
    checkCell(rowNum, avgCol, row.avgMonth, `Store #${idx + 1} AVG`);
  });

  // 4. Verifikasi Baris Total
  const totalRowNum = headerRowIdx + 1 + sortedExportRows.length;
  checkCell(totalRowNum, 1, '', 'Total Row Col 1');
  checkCell(totalRowNum, 2, '', 'Total Row Col 2');
  checkCell(totalRowNum, 3, 'TOTAL', 'Total Row Label');
  checkCell(totalRowNum, 4, '', 'Total Row Col 4');
  checkCell(totalRowNum, 5, '', 'Total Row Col 5');
  checkCell(totalRowNum, 6, '', 'Total Row Col 6');

  selectedDatesList.forEach((d, dIdx) => {
    const colNum = 7 + dIdx;
    checkCell(totalRowNum, colNum, exportDateTotals[d] ?? 0, `Total Row Date ${d}`);
  });

  const totalSumCol = 7 + selectedDatesList.length;
  const totalAvgCol = totalSumCol + 1;
  checkCell(totalRowNum, totalSumCol, exportTotalSum, 'Total Row totalSum');
  checkCell(totalRowNum, totalAvgCol, exportTotalAvg, 'Total Row totalAvg');

  // 5. Verifikasi Multi-sheet raw "Data dd-Mmm-yyyy" ada untuk setiap tanggal
  selectedDatesList.forEach((dateStr) => {
    const [y, m, d] = dateStr.split('-');
    const mIdx = parseInt(m, 10) - 1;
    const shortM = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des'][mIdx] || m;
    const sheetName = `Data ${d}-${shortM}-${y}`;
    cellsCompared++;
    const rawWs = workbook.getWorksheet(sheetName);
    if (!rawWs) {
      diffCount++;
      errors.push(`Raw sheet ${sheetName} missing`);
    }
  });

  return {
    range: `${startDate} s/d ${endDate}`,
    storesCount: sortedExportRows.length,
    datesCount: selectedDatesList.length,
    cellsCompared,
    diffCount,
    errors,
  };
}

async function main() {
  await initDb();
  console.log('=== SKRIP PENGUJIAN OTOMATIS EKSPOR EXCEL CELL-BY-CELL ===\n');

  const ranges = [
    { start: '2026-10-01', end: '2026-10-02' },
    { start: '2026-10-01', end: '2026-10-17' },
    { start: '2026-09-25', end: '2026-10-03' },
  ];

  let grandTotalCells = 0;
  let grandTotalDiff = 0;
  const results: VerifyRangeResult[] = [];

  for (const r of ranges) {
    console.log(`Menguji rentang: ${r.start} s/d ${r.end}...`);
    const res = await verifyRange(r.start, r.end);
    results.push(res);
    grandTotalCells += res.cellsCompared;
    grandTotalDiff += res.diffCount;
    if (res.diffCount > 0) {
      console.error(`  GAGAL! Ditemukan ${res.diffCount} selisih pada rentang ${res.range}:`);
      res.errors.forEach((e) => console.error(`    - ${e}`));
    } else {
      console.log(`  SUKSES! 0 selisih (${res.cellsCompared} sel diverifikasi cocok 100%).`);
    }
  }

  console.log('\n================ RINGKASAN HASIL ================');
  console.log('| Rentang Tanggal        | Toko | Hari | Sel Dibandingkan | Selisih | Status |');
  console.log('|------------------------|------|------|------------------|---------|--------|');
  for (const r of results) {
    const status = r.diffCount === 0 ? 'LOLOS ✅' : 'GAGAL ❌';
    console.log(
      `| ${r.range.padEnd(22)} | ${String(r.storesCount).padStart(4)} | ${String(r.datesCount).padStart(4)} | ${String(r.cellsCompared).padStart(16)} | ${String(r.diffCount).padStart(7)} | ${status} |`
    );
  }
  console.log(`\nTotal Sel Dibandingkan: ${grandTotalCells}`);
  console.log(`Total Selisih: ${grandTotalDiff}`);

  if (grandTotalDiff > 0) {
    console.error(`\nPENGUJIAN GAGAL: Terdeteksi ${grandTotalDiff} selisih.`);
    process.exit(1);
  } else {
    console.log('\nPENGUJIAN BERHASIL: Seluruh sel pada semua rentang 100% IDENTIK dengan web.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
