import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import {
  getDailyStatsByDateRange,
  getStores,
  getKpiCache,
  getAllStoreAmAcHistory,
  getAllAvailableDates,
} from '@/lib/db';
import { getMonthPeriod, validateDateRange } from '@/lib/constants';
import { computeEffectiveAmAcMap, computeFirstSeenMonthMap } from '@/lib/storeAssignments';
import { computeKpiWindow } from '@/lib/kpiWindow';
import { ensureKpiCacheForWindow } from '@/lib/kpiWindow.server';

export async function GET(request: Request) {
  const authed = await isAuthenticated();
  if (!authed) {
    return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const onlyVisible =
      searchParams.get('onlyVisible') !== 'false' && searchParams.get('includeHidden') !== 'true'; // default true

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'Parameter startDate dan endDate wajib disertakan.' },
        { status: 400 }
      );
    }

    // Mengizinkan kueri 1 hari untuk dashboard (allowSingleDay = true)
    const val = validateDateRange(startDate, endDate, undefined, true);
    if (!val.valid) {
      return NextResponse.json({ error: val.error }, { status: 400 });
    }

    const monthRef = endDate.slice(0, 7); // YYYY-MM
    const monthPeriod = getMonthPeriod(monthRef);

    // Ambil rentang gabungan: dari min(startDate, monthPeriod.startDate) sampai max(endDate, monthPeriod.endDate)
    const queryStart = startDate < monthPeriod.startDate ? startDate : monthPeriod.startDate;
    const queryEnd = endDate > monthPeriod.endDate ? endDate : monthPeriod.endDate;

    const startMonth = startDate.slice(0, 7);
    const endMonth = endDate.slice(0, 7);
    const monthsToFetch = Array.from(new Set([startMonth, endMonth, monthRef]));

    const refreshKpi = searchParams.get('refresh') === 'true';

    const [
      availableDates,
      stores,
      historyList,
    ] = await Promise.all([
      getAllAvailableDates(),
      getStores(onlyVisible),
      getAllStoreAmAcHistory(),
    ]);

    // Hitung jendela KPI sesuai Aturan Jendela KPI tunggal (Bug 1)
    const kpiWindow = computeKpiWindow(startDate, endDate, availableDates);

    // Ambil atau segarkan KPI cache untuk jendela tersebut
    const [allStats, windowKpiData, rangeHypernetKpi, rangeTachyonKpi] = await Promise.all([
      getDailyStatsByDateRange(queryStart, queryEnd),
      ensureKpiCacheForWindow(kpiWindow.windowStart, kpiWindow.windowEnd, refreshKpi),
      getKpiCache('hypernet', startDate, endDate),
      getKpiCache('tachyon', startDate, endDate),
    ]);

    // Hitung penugasan efektif AM/AC untuk bulan acuan (Target D2 & D4)
    const effectiveAmAcMap = computeEffectiveAmAcMap(historyList, monthRef);
    const firstSeenMap = computeFirstSeenMonthMap(historyList);

    const mergedAssignments: Record<string, any> = {};
    for (const store of stores) {
      const kd = store.kd_store ? store.kd_store.trim().toUpperCase() : null;
      if (kd && effectiveAmAcMap.has(kd)) {
        mergedAssignments[store.id] = effectiveAmAcMap.get(kd);
      }
    }

    return NextResponse.json({
      success: true,
      startDate,
      endDate,
      monthRef,
      monthPeriod,
      kpiWindow,
      stats: allStats,
      stores,
      availableDates,
      kpi: {
        windowHypernet: windowKpiData.hypernet,
        windowTachyon: windowKpiData.tachyon,
        hypernet: windowKpiData.hypernet || rangeHypernetKpi,
        tachyon: windowKpiData.tachyon || rangeTachyonKpi,
        monthHypernet: windowKpiData.hypernet,
        monthTachyon: windowKpiData.tachyon,
      },
      assignments: mergedAssignments,
      firstSeenMap: Object.fromEntries(firstSeenMap),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Gagal mengambil data dari database.' },
      { status: 500 }
    );
  }
}

