'use client';

import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import {
  TrendingUp,
  BarChart3,
  Users2,
  PieChart as PieIcon,
  Grid,
  UserCheck,
  ChevronRight,
  Info,
  Download,
  RefreshCw,
} from 'lucide-react';
import { toPng } from 'html-to-image';
import { formatDateColumnHeader } from '@/lib/constants';

interface StoreItem {
  id: string;
  source: 'hypernet' | 'tachyon';
  source_key: string;
  display_name: string;
  kd_store: string | null;
  active: number;
  is_visible?: number;
}

interface DailyStoreStat {
  source: 'hypernet' | 'tachyon';
  source_key: string;
  date: string;
  users: number;
}

interface StoreAssignment {
  store_id: string;
  month: string;
  am: string | null;
  ac: string | null;
}

interface DashboardChartsProps {
  selectedDates: string[];
  stores: StoreItem[];
  stats: DailyStoreStat[];
  assignments: Record<string, StoreAssignment>;
  kpi: {
    hypernet: any;
    tachyon: any;
    monthHypernet: any;
    monthTachyon: any;
  };
}

export default function DashboardCharts({
  selectedDates,
  stores,
  stats,
  assignments,
  kpi,
}: DashboardChartsProps) {
  // Toggle for AM vs AC
  const [personnelView, setPersonnelView] = useState<'am' | 'ac'>('am');
  const [isDownloadingChart, setIsDownloadingChart] = useState(false);

  const handleDownloadChart = async () => {
    const node = document.getElementById('dashboard-charts-area');
    if (!node || isDownloadingChart) return;
    setIsDownloadingChart(true);
    try {
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        cacheBust: true,
      });
      const a = document.createElement('a');
      a.href = dataUrl;
      const startD = selectedDates[0] || 'rekap';
      const endD = selectedDates[selectedDates.length - 1] || 'rekap';
      a.download = `Chart_WiFi_Lawson_${startD}_sd_${endD}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e: any) {
      alert(`Gagal mengunduh chart: ${e.message}`);
    } finally {
      setIsDownloadingChart(false);
    }
  };

  // Stats Lookup Map: `${source}__${source_key}__${date}` => users
  const statsLookup = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of stats) {
      map.set(`${item.source}__${item.source_key}__${item.date}`, item.users);
    }
    return map;
  }, [stats]);

  // Active & Visible stores set
  const activeStores = useMemo(() => {
    return stores.filter((s) => s.active === 1 && (s.is_visible === undefined || s.is_visible === 1));
  }, [stores]);

  // 1. TREN TOTAL PENGGUNA HARIAN (AreaChart)
  const dailyTrendData = useMemo(() => {
    return selectedDates.map((dateStr) => {
      let total = 0;
      let hypernet = 0;
      let tachyon = 0;

      for (const st of activeStores) {
        const val = statsLookup.get(`${st.source}__${st.source_key}__${dateStr}`) || 0;
        total += val;
        if (st.source === 'hypernet') hypernet += val;
        else tachyon += val;
      }

      return {
        date: dateStr,
        label: formatDateColumnHeader(dateStr),
        total,
        hypernet,
        tachyon,
      };
    });
  }, [selectedDates, activeStores, statsLookup]);

  // 2. 10 TOKO TERATAS PADA RENTANG TERPILIH (BarChart Horizontal)
  const top10StoresData = useMemo(() => {
    const storeTotals = activeStores.map((st) => {
      let sum = 0;
      for (const d of selectedDates) {
        sum += statsLookup.get(`${st.source}__${st.source_key}__${d}`) || 0;
      }
      return {
        id: st.id,
        name: st.display_name,
        source: st.source,
        users: sum,
      };
    });

    // Sort descending & take top 10
    storeTotals.sort((a, b) => b.users - a.users);
    return storeTotals.slice(0, 10).reverse(); // reverse for horizontal bar order
  }, [activeStores, selectedDates, statsLookup]);

  // 3. TOTAL PENGGUNA PER AM DAN PER AC (BarChart Vertikal)
  const personnelData = useMemo(() => {
    const totalsMap = new Map<string, number>();

    for (const st of activeStores) {
      let storeSum = 0;
      for (const d of selectedDates) {
        storeSum += statsLookup.get(`${st.source}__${st.source_key}__${d}`) || 0;
      }

      const asg = assignments[st.id];
      const personName =
        personnelView === 'am' ? asg?.am || 'Belum Ditugaskan' : asg?.ac || 'Belum Ditugaskan';

      totalsMap.set(personName, (totalsMap.get(personName) || 0) + storeSum);
    }

    const result = Array.from(totalsMap.entries()).map(([name, users]) => ({
      name,
      users,
    }));

    // Sort descending
    result.sort((a, b) => b.users - a.users);
    return result;
  }, [activeStores, selectedDates, statsLookup, assignments, personnelView]);

  // 4. PETA PANAS (HEATMAP) TOKO X TANGGAL
  const heatmapData = useMemo(() => {
    // Toko dengan total > 0 atau ambil 25 toko teratas
    const storesWithSums = activeStores.map((st) => {
      let sum = 0;
      const days: Record<string, number> = {};
      for (const d of selectedDates) {
        const val = statsLookup.get(`${st.source}__${st.source_key}__${d}`) || 0;
        days[d] = val;
        sum += val;
      }
      return {
        id: st.id,
        name: st.display_name,
        source: st.source,
        sum,
        days,
      };
    });

    // Sort by sum descending
    storesWithSums.sort((a, b) => b.sum - a.sum);

    // Ambil maksimal 20 toko teraktif untuk heatmap yang sangat terbaca
    const displayStores = storesWithSums.slice(0, 20);

    // Hitung nilai maksimum untuk normalisasi warna
    let maxVal = 1;
    for (const st of displayStores) {
      for (const d of selectedDates) {
        if (st.days[d] > maxVal) maxVal = st.days[d];
      }
    }

    return { stores: displayStores, maxVal };
  }, [activeStores, selectedDates, statsLookup]);

  // 5. KOMPOSISI NEW VS RETURNING (Donut Chart dari Kartu)
  const donutData = useMemo(() => {
    const hKpi = kpi.monthHypernet || kpi.hypernet;
    const tKpi = kpi.monthTachyon || kpi.tachyon;

    const newUsers = (hKpi?.new_users || 0) + (tKpi?.new_users || 0);
    const returningNewUsers = hKpi?.returning_new_users || 0;
    const returningUsers = (hKpi?.returning_users || 0) + (tKpi?.returning_users || 0);

    const items = [
      { name: 'New Users', value: newUsers, color: '#2563eb' },
      { name: 'Returning Users', value: returningUsers, color: '#7c3aed' },
    ];

    if (returningNewUsers > 0) {
      items.splice(1, 0, {
        name: 'Returning New Users',
        value: returningNewUsers,
        color: '#0284c7',
      });
    }

    const total = items.reduce((acc, i) => acc + i.value, 0);

    return { items, total };
  }, [kpi]);

  // Heatmap Color Helper
  const getHeatmapColor = (val: number, max: number) => {
    if (val === 0) return 'bg-slate-100 text-slate-400 font-normal';
    const ratio = val / max;
    if (ratio <= 0.25) return 'bg-blue-100 text-blue-900 font-semibold';
    if (ratio <= 0.5) return 'bg-blue-300 text-blue-950 font-bold';
    if (ratio <= 0.75) return 'bg-blue-500 text-white font-bold';
    return 'bg-blue-700 text-white font-extrabold';
  };

  return (
    <section id="dashboard-charts-area" className="space-y-6 pt-2">
      <div className="flex items-center justify-between pb-2 border-b border-slate-200">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            <span>Bagian 2 — Visualisasi &amp; Analisis Chart</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Analisis visual interaktif mengikuti rentang tanggal terpilih ({selectedDates.length} hari).
          </p>
        </div>

        <button
          type="button"
          onClick={handleDownloadChart}
          disabled={isDownloadingChart}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-xl transition-all shadow-2xs cursor-pointer disabled:opacity-50"
          title="Unduh seluruh visualisasi grafik sebagai gambar PNG"
        >
          {isDownloadingChart ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />
          ) : (
            <Download className="w-3.5 h-3.5 text-blue-600" />
          )}
          <span>{isDownloadingChart ? 'Mengunduh...' : 'Unduh Chart (PNG)'}</span>
        </button>
      </div>

      {/* GRID 1: Tren Harian (Kiri) + Donut Komposisi Pengguna (Kanan) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* CHART 1: Tren Total Pengguna Harian */}
        <div className="lg:col-span-2 bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                <TrendingUp className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Tren Total Pengguna Harian</h3>
                <p className="text-[11px] text-slate-500">Akumulasi seluruh toko aktif per tanggal</p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 text-slate-600">
                <span className="w-3 h-3 rounded-full bg-blue-600 inline-block"></span>
                <span>Total Pengguna</span>
              </span>
            </div>
          </div>

          <div className="h-64 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickLine={false}
                  axisLine={{ stroke: '#cbd5e1' }}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(val) => Number(val).toLocaleString('id-ID')}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-slate-900 text-white px-3 py-2 rounded-xl text-xs shadow-lg space-y-1">
                          <p className="font-semibold text-slate-300">{data.label} ({data.date})</p>
                          <p className="text-blue-400 font-bold text-sm">
                            Total: {data.total.toLocaleString('id-ID')} Pengguna
                          </p>
                          <div className="pt-1 text-[11px] text-slate-400 border-t border-slate-800 flex justify-between gap-4">
                            <span>Hypernet: {data.hypernet}</span>
                            <span>Tachyon: {data.tachyon}</span>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="#2563eb"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#colorTotal)"
                  activeDot={{ r: 6, fill: '#2563eb', stroke: '#ffffff', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* CHART 5: Komposisi New vs Returning Users (Donut Chart) */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <PieIcon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Komposisi Pengguna Unik</h3>
              <p className="text-[11px] text-slate-500">New vs Returning (dari Kartu KPI)</p>
            </div>
          </div>

          <div className="h-48 w-full relative flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donutData.items}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={75}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {donutData.items.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: any, name: any) => [
                    `${Number(value).toLocaleString('id-ID')} (${donutData.total > 0 ? Math.round((Number(value) / donutData.total) * 100) : 0}%)`,
                    name,
                  ]}
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.75rem', color: '#fff', fontSize: '11px' }}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Center total */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
              <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Total Unik</span>
              <span className="text-base font-extrabold text-slate-900 leading-tight">
                {donutData.total.toLocaleString('id-ID')}
              </span>
            </div>
          </div>

          <div className="space-y-1.5 pt-1 border-t border-slate-100 text-xs">
            {donutData.items.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-slate-600">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: item.color }} />
                  <span>{item.name}</span>
                </span>
                <span className="font-bold text-slate-900 font-mono">
                  {item.value.toLocaleString('id-ID')}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* GRID 2: Top 10 Toko (Kiri) + Total per AM / AC (Kanan) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* CHART 2: 10 Toko Teratas pada Rentang Terpilih */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <BarChart3 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">10 Toko Teratas</h3>
                <p className="text-[11px] text-slate-500">Akumulasi pengguna tertinggi pada rentang ini</p>
              </div>
            </div>
            <span className="text-[11px] text-slate-400 font-medium">Urut Tertinggi</span>
          </div>

          <div className="h-80 w-full pt-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={top10StoresData}
                layout="vertical"
                margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11, fill: '#1e293b', fontWeight: 500 }}
                  axisLine={{ stroke: '#cbd5e1' }}
                  tickLine={false}
                  width={165}
                />
                <Tooltip
                  formatter={(val: any) => [`${Number(val).toLocaleString('id-ID')} Pengguna`, 'Total Users']}
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.75rem', color: '#fff', fontSize: '11px' }}
                />
                <Bar dataKey="users" fill="#10b981" radius={[0, 6, 6, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* CHART 3: Total Pengguna per AM dan per AC */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center">
                <Users2 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Total per {personnelView === 'am' ? 'Area Manager (AM)' : 'Area Coordinator (AC)'}
                </h3>
                <p className="text-[11px] text-slate-500">Akumulasi pengguna seluruh toko binaan</p>
              </div>
            </div>

            {/* Toggle AM / AC */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
              <button
                type="button"
                onClick={() => setPersonnelView('am')}
                className={`px-2.5 py-1 rounded-md font-semibold transition-all ${personnelView === 'am' ? 'bg-white text-violet-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
              >
                Per AM
              </button>
              <button
                type="button"
                onClick={() => setPersonnelView('ac')}
                className={`px-2.5 py-1 rounded-md font-semibold transition-all ${personnelView === 'ac' ? 'bg-white text-violet-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
              >
                Per AC
              </button>
            </div>
          </div>

          <div className="h-72 w-full pt-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={personnelData} margin={{ top: 10, right: 10, left: -20, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10, fill: '#475569' }}
                  angle={-20}
                  textAnchor="end"
                  interval={0}
                  axisLine={{ stroke: '#cbd5e1' }}
                  tickLine={false}
                />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(val: any) => [`${Number(val).toLocaleString('id-ID')} Pengguna`, 'Total Users']}
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.75rem', color: '#fff', fontSize: '11px' }}
                />
                <Bar dataKey="users" fill="#8b5cf6" radius={[6, 6, 0, 0]} barSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* CHART 4: PETA PANAS (HEATMAP) TOKO X TANGGAL */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center">
              <Grid className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Peta Panas (Heatmap) Toko × Tanggal</h3>
              <p className="text-[11px] text-slate-500">
                Distribusi intensitas pengguna harian toko (20 toko teraktif pada rentang)
              </p>
            </div>
          </div>

          {/* Color Scale Legend */}
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <span>Rendah</span>
            <div className="flex items-center gap-0.5">
              <span className="w-3.5 h-3.5 bg-slate-100 rounded-xs border border-slate-200" title="0" />
              <span className="w-3.5 h-3.5 bg-blue-100 rounded-xs" title="1 - 25%" />
              <span className="w-3.5 h-3.5 bg-blue-300 rounded-xs" title="26 - 50%" />
              <span className="w-3.5 h-3.5 bg-blue-500 rounded-xs" title="51 - 75%" />
              <span className="w-3.5 h-3.5 bg-blue-700 rounded-xs" title="76 - 100%" />
            </div>
            <span>Tinggi</span>
          </div>
        </div>

        {/* Heatmap Grid Matrix */}
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-xs text-slate-700 border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 font-bold uppercase text-[10px] text-slate-600">
              <tr>
                <th className="py-2.5 px-3 w-56 text-left sticky left-0 z-10 bg-slate-50 border-r border-slate-200">
                  Nama Toko
                </th>
                {selectedDates.map((d) => (
                  <th key={d} className="py-2.5 px-2 text-center min-w-[50px] font-mono">
                    {formatDateColumnHeader(d)}
                  </th>
                ))}
                <th className="py-2.5 px-3 w-20 text-right bg-blue-50 text-blue-900 border-l border-slate-200">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {heatmapData.stores.length === 0 ? (
                <tr>
                  <td colSpan={selectedDates.length + 2} className="py-8 text-center text-slate-400">
                    Belum ada data untuk heatmap.
                  </td>
                </tr>
              ) : (
                heatmapData.stores.map((st) => (
                  <tr key={st.id} className="hover:bg-slate-50/50">
                    <td className="py-2 px-3 font-semibold text-slate-900 truncate max-w-[220px] sticky left-0 z-10 bg-white border-r border-slate-200 text-[11px]" title={st.name}>
                      {st.name}
                    </td>

                    {selectedDates.map((d) => {
                      const val = st.days[d] || 0;
                      const cellClass = getHeatmapColor(val, heatmapData.maxVal);
                      return (
                        <td
                          key={d}
                          className="py-1 px-1 text-center"
                          title={`${st.name} | ${formatDateColumnHeader(d)}: ${val} Pengguna`}
                        >
                          <div
                            className={`w-full py-1 rounded-sm text-[11px] font-mono transition-transform hover:scale-105 cursor-default ${cellClass}`}
                          >
                            {val}
                          </div>
                        </td>
                      );
                    })}

                    <td className="py-2 px-3 text-right font-bold text-slate-900 font-mono text-xs bg-blue-50/30 border-l border-slate-200">
                      {st.sum.toLocaleString('id-ID')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
