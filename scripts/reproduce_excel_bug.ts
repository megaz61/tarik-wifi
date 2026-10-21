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
import { getMonthPeriod, calculateDaysCount, getDatesInRange } from '../lib/constants';
import {
  initDb,
  getStores,
  getDailyStatsByDateRange,
  getKpiCache,
  getAllStoreAmAcHistory,
  getAllAvailableDates,
} from '../lib/db';
import { computeKpiWindow } from '../lib/kpiWindow';

async function reproduce() {
  await initDb();
  console.log('Database initialized.');

  const startDate = '2026-10-01';
  const endDate = '2026-10-02';
  const monthRef = endDate.slice(0, 7);
  const monthPeriod = getMonthPeriod(monthRef);
  const selectedDatesList = ['2026-10-01', '2026-10-02'];
  const periodDaysCount = calculateDaysCount(monthPeriod.startDate, monthPeriod.endDate);
  const periodDates = getDatesInRange(monthPeriod.startDate, monthPeriod.endDate);

  const [availableDates, allStores, historyList] = await Promise.all([
    getAllAvailableDates(),
    getStores(false), // all stores including hidden, matching export handler includeHidden=true
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

  // Exact UI logic from app/page.tsx handleExportExcel:
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

  // Sort by kd_store default
  const sortedExportRows = [...filteredExportRows].sort((a, b) => a.kd_store.localeCompare(b.kd_store));

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

  console.log(`Generating excel for ${sortedExportRows.length} stores...`);
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
  const outPath = path.join(__dirname, 'reproduced_output.xlsx');
  fs.writeFileSync(outPath, buffer);
  console.log(`Saved exported excel to ${outPath}\n`);

  // Read back and inspect
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(outPath);
  const ws = workbook.getWorksheet('Dashboard');
  if (!ws) throw new Error('Sheet Dashboard not found');

  let headerRowIdx = -1;
  ws.eachRow((r, rowNumber) => {
    if (r.getCell(1).value === 'No.') {
      headerRowIdx = rowNumber;
    }
  });

  const hRow = ws.getRow(headerRowIdx);
  const headerCells: string[] = [];
  hRow.eachCell({ includeEmpty: true }, (c, col) => {
    headerCells[col] = String(c.value ?? '');
  });
  console.log('Headers:', headerCells.slice(1));

  // Print first 3 store rows
  for (let r = headerRowIdx + 1; r <= headerRowIdx + 3; r++) {
    const row = ws.getRow(r);
    console.log(`\n--- BARIS ${r} (Toko #${r - headerRowIdx}) ---`);
    for (let c = 1; c < headerCells.length; c++) {
      const cell = row.getCell(c);
      console.log(`  Col ${c} [${headerCells[c]}]: value = ${JSON.stringify(cell.value)}, type = ${cell.type}, numFmt = ${JSON.stringify(cell.numFmt)}`);
    }
  }
}

reproduce().catch(console.error);
