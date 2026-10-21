'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import {
  Store,
  Wifi,
  Lock,
  Key,
  ShieldCheck,
  RefreshCw,
  Database,
  Calendar,
  AlertCircle,
  HardDrive,
  Users,
  Radio,
  FileSpreadsheet,
  Trash2,
  ExternalLink,
  Info,
  LogOut,
  ChevronDown,
  ChevronUp,
  Search,
  ArrowUpDown,
  Filter,
  CheckCircle2,
  Clock,
  Download,
  Copy,
  Eye,
  EyeOff,
  SlidersHorizontal,
} from 'lucide-react';
import {
  fmtBytes,
  fmtDuration,
  getJakartaToday,
  formatDateColumnHeader,
  formatMonthHeader,
  getShortMonthUpper,
  getMonthPeriod,
  INDONESIAN_MONTHS_SHORT,
  calculateDaysCount,
  MAX_DATE_RANGE_DAYS,
  getDatesInRange,
} from '@/lib/constants';
import DashboardCharts from '@/components/DashboardCharts';
import { generateRekapExcelBlob } from '@/lib/excelExport';
import { toPng } from 'html-to-image';

interface SystemStatus {
  authenticated: boolean;
  hypernetConfigured: boolean;
  tachyonConfigured: boolean;
  supabaseConfigured: boolean;
  dbMode: 'turso' | 'supabase' | 'local_sqlite';
}

interface StoreItem {
  id: string;
  source: 'hypernet' | 'tachyon';
  source_key: string;
  display_name: string;
  kd_store: string | null;
  activation_date: string | null;
  active: number; // 1 = true, 0 = false
  is_visible?: number; // 1 = visible, 0 = hidden
  is_new_flag: number;
}

interface DailyStoreStat {
  source: 'hypernet' | 'tachyon';
  source_key: string;
  date: string;
  users: number;
  upload_bytes: number | null;
  download_bytes: number | null;
  total_bytes: number;
  duration_seconds: number;
  fetched_at: string;
}

interface KpiItem {
  source: string;
  date_start: string;
  date_end: string;
  new_users: number;
  returning_new_users: number | null;
  returning_users: number;
  all_users: number;
}

interface StoreAssignment {
  store_id: string;
  month: string;
  am: string | null;
  ac: string | null;
}

interface SyncLogItem {
  time: string;
  type: 'info' | 'success' | 'warn' | 'error';
  message: string;
}

type SortField = 'kd_store' | 'display_name' | 'am' | 'ac' | 'activation_date' | 'sum' | 'avg' | string;

export default function HomePage() {
  // --- Status & Auth ---
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [accessCodeInput, setAccessCodeInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);

  // --- Date Range Parameters ---
  const [todayJakarta, setTodayJakarta] = useState('2026-10-10');
  useEffect(() => {
    setTodayJakarta(getJakartaToday());
  }, []);
  const [startDate, setStartDate] = useState('2026-08-01');
  const [endDate, setEndDate] = useState('2026-08-31');

  // Reference Month & Monthly Period
  const monthRef = useMemo(() => (endDate ? endDate.slice(0, 7) : todayJakarta.slice(0, 7)), [endDate, todayJakarta]);
  const monthPeriod = useMemo(() => getMonthPeriod(monthRef, todayJakarta), [monthRef, todayJakarta]);
  const shortMonthUpper = useMemo(() => getShortMonthUpper(monthRef), [monthRef]);
  const fullMonthTitle = useMemo(() => formatMonthHeader(monthRef), [monthRef]);
  const isMultiMonth = useMemo(() => {
    return Boolean(startDate && endDate && startDate.slice(0, 7) !== endDate.slice(0, 7));
  }, [startDate, endDate]);

  // List of dates in selected range
  const selectedDatesList = useMemo(() => {
    return getDatesInRange(startDate, endDate);
  }, [startDate, endDate]);

  // --- Data from Backend ---
  const [dbData, setDbData] = useState<{
    stats: DailyStoreStat[];
    stores: StoreItem[];
    availableDates?: string[];
    kpi: {
      hypernet: KpiItem | null;
      tachyon: KpiItem | null;
      monthHypernet: KpiItem | null;
      monthTachyon: KpiItem | null;
    };
    assignments: Record<string, StoreAssignment>;
  } | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [isCopyingImage, setIsCopyingImage] = useState(false);
  const [isDownloadingPng, setIsDownloadingPng] = useState(false);

  // --- Filtering & Sorting ---
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAm, setSelectedAm] = useState('');
  const [selectedAc, setSelectedAc] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  // Sort state (Initial: tanggal terakhir terpilih asc)
  const [sortField, setSortField] = useState<SortField>(endDate);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Update sort field when endDate changes if sorting by last date
  useEffect(() => {
    setSortField(endDate);
    setSortOrder('asc');
  }, [endDate]);

  // --- Modals & Panels ---
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [selectedSyncSource, setSelectedSyncSource] = useState<'both' | 'hypernet' | 'tachyon'>('both');

  // In-memory vendor manual credentials (Section 3b)
  const [hypernetUser, setHypernetUser] = useState('');
  const [hypernetPass, setHypernetPass] = useState('');
  const [tachyonUser, setTachyonUser] = useState('');
  const [tachyonPass, setTachyonPass] = useState('');
  const [showHypernetPass, setShowHypernetPass] = useState(false);
  const [showTachyonPass, setShowTachyonPass] = useState(false);

  // Sync execution state
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [currentStepText, setCurrentStepText] = useState('');
  const [syncLogs, setSyncLogs] = useState<SyncLogItem[]>([]);

  // DB Metrics & Deletion
  const [dbMetrics, setDbMetrics] = useState<{
    dailyStatsCount: number;
    kpiCacheCount: number;
    storesCount: number;
    estimatedSizeBytes: number;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Toast / notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // --- Status & Data Loaders ---
  const loadStatus = async () => {
    try {
      const res = await fetch('/api/auth/status');
      const data = await res.json();
      setStatus(data);
      if (data.authenticated) {
        loadData(startDate, endDate);
        loadDbMetrics();
      }
    } catch (e) {
      console.error('Failed to load status:', e);
    } finally {
      setLoadingStatus(false);
    }
  };

  const loadData = async (sDate: string, eDate: string, isRefreshClick: boolean = false) => {
    setLoadingData(true);
    try {
      const res = await fetch(`/api/data/stats?startDate=${sDate}&endDate=${eDate}`);
      const data = await res.json();
      if (data.success) {
        const statsList = data.stats || [];
        const availDates = data.availableDates || [];
        setDbData({
          stats: statsList,
          stores: data.stores || [],
          availableDates: availDates,
          kpi: data.kpi || { hypernet: null, tachyon: null, monthHypernet: null, monthTachyon: null },
          assignments: data.assignments || {},
        });
        if (isRefreshClick) {
          if (statsList.length === 0 && availDates.length === 0) {
            showToast('Silakan tarik data terlebih dahulu sebelum menggunakan fitur Segarkan.');
          } else {
            showToast('Data berhasil disegarkan dari penyimpanan aplikasi.');
          }
        }
      } else {
        showToast(data.error || 'Gagal memuat data dari database.');
      }
    } catch (e: any) {
      console.error('Failed to load data:', e);
      showToast(e.message || 'Gagal memuat data dari database.');
    } finally {
      setLoadingData(false);
    }
  };

  const handleRefreshClick = () => {
    const hasData =
      (dbData && dbData.stats.length > 0) ||
      Boolean(dbData?.availableDates && dbData.availableDates.length > 0) ||
      Boolean(dbMetrics && dbMetrics.dailyStatsCount > 0);

    if (!hasData) {
      showToast('Silakan tarik data terlebih dahulu sebelum menggunakan fitur Segarkan.');
      return;
    }
    loadData(startDate, endDate, true);
  };

  const loadDbMetrics = async () => {
    try {
      const res = await fetch('/api/data/manage');
      const data = await res.json();
      if (data.success) {
        setDbMetrics({
          dailyStatsCount: data.dailyStatsCount,
          kpiCacheCount: data.kpiCacheCount,
          storesCount: data.storesCount,
          estimatedSizeBytes: data.estimatedSizeBytes,
        });
      }
    } catch (e) {
      console.error('Failed to load metrics:', e);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  // When date range changes, fetch fresh data (dengan validasi rentang maksimal 93 hari)
  const handleApplyDateRange = (newStart: string, newEnd: string) => {
    if (!newStart || !newEnd) {
      showToast('Tanggal awal dan akhir harus diisi.');
      return;
    }
    if (newStart > newEnd) {
      showToast('Tanggal awal harus lebih awal atau sama dengan tanggal akhir.');
      return;
    }
    if (newStart > todayJakarta || newEnd > todayJakarta) {
      showToast(`Tanggal tidak boleh melewati hari ini (${todayJakarta}).`);
      return;
    }
    const days = calculateDaysCount(newStart, newEnd);
    if (days > MAX_DATE_RANGE_DAYS) {
      showToast(`Rentang tanggal maksimal ${MAX_DATE_RANGE_DAYS} hari kalender (31 × 3). Rentang yang dipilih adalah ${days} hari.`);
      return;
    }

    setStartDate(newStart);
    setEndDate(newEnd);

    // Beri tahu pengguna jika rentang yang dipilih belum ada datanya
    const available = dbData?.availableDates || [];
    if (available.length > 0) {
      const hasDataInRange = available.some((d) => d >= newStart && d <= newEnd);
      if (!hasDataInRange) {
        showToast('Rentang tanggal ini belum memiliki data. Silakan tarik data terlebih dahulu.');
      }
    }
    loadData(newStart, newEnd);
  };

  // Quick Preset Handlers (Bebas dari pergeseran zona waktu)
  const handlePreset = (type: 'today' | 'yesterday' | 'threeDays' | 'fiveDays' | 'sevenDays' | 'thisMonth' | 'lastMonth') => {
    const today = todayJakarta;
    const [tY, tM, tD] = today.split('-').map(Number);

    if (type === 'today') {
      handleApplyDateRange(today, today);
    } else if (type === 'yesterday') {
      const d = new Date(Date.UTC(tY, tM - 1, tD));
      d.setUTCDate(d.getUTCDate() - 1);
      const yest = d.toISOString().slice(0, 10);
      handleApplyDateRange(yest, yest);
    } else if (type === 'sevenDays') {
      const d = new Date(Date.UTC(tY, tM - 1, tD));
      d.setUTCDate(d.getUTCDate() - 6);
      const s7 = d.toISOString().slice(0, 10);
      handleApplyDateRange(s7, today);
    }
    else if (type === 'threeDays') {
      const d = new Date(Date.UTC(tY, tM - 1, tD));
      d.setUTCDate(d.getUTCDate() - 2);
      const s3 = d.toISOString().slice(0, 10);
      handleApplyDateRange(s3, today);
    } else if (type === 'fiveDays') {
      const d = new Date(Date.UTC(tY, tM - 1, tD));
      d.setUTCDate(d.getUTCDate() - 4);
      const s5 = d.toISOString().slice(0, 10);
      handleApplyDateRange(s5, today);
    } else if (type === 'thisMonth') {
      const thisMonthStart = today.slice(0, 7) + '-01';
      handleApplyDateRange(thisMonthStart, today);
    } else if (type === 'lastMonth') {
      let prevY = tY;
      let prevM = tM - 1;
      if (prevM === 0) {
        prevM = 12;
        prevY -= 1;
      }
      const lastDay = new Date(Date.UTC(prevY, prevM, 0)).getUTCDate();
      const lStart = `${prevY}-${String(prevM).padStart(2, '0')}-01`;
      const lEnd = `${prevY}-${String(prevM).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      handleApplyDateRange(lStart, lEnd);
    }
  };

  // Quick Test Presets (Section 10)
  const handleTestPreset = (preset: 'hypernet_day' | 'hypernet_month' | 'tachyon_range' | 'combined_range') => {
    if (preset === 'hypernet_day') {
      handleApplyDateRange('2026-08-31', '2026-08-31');
    } else if (preset === 'hypernet_month') {
      handleApplyDateRange('2026-08-01', '2026-08-31');
    } else if (preset === 'tachyon_range') {
      handleApplyDateRange('2026-10-01', '2026-10-09');
    } else if (preset === 'combined_range') {
      handleApplyDateRange('2026-10-01', '2026-10-09');
    }
  };

  // --- Authentication Handler ---
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessCodeInput.trim()) return;
    setIsSubmittingAuth(true);
    setAuthError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessCode: accessCodeInput }),
      });
      const data = await res.json();
      if (data.success) {
        setAccessCodeInput('');
        loadStatus();
      } else {
        setAuthError(data.error || 'Kode akses tidak cocok.');
      }
    } catch {
      setAuthError('Gagal menghubungi server.');
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    loadStatus();
  };

  // --- Live Data Tarik Execution ---
  const addLog = (message: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    const time = new Date().toLocaleTimeString('id-ID');
    setSyncLogs((prev) => [{ time, message, type }, ...prev]);
  };

  const handleStartSync = async () => {
    setIsSyncing(true);
    setSyncProgress(0);
    setSyncLogs([]);
    setCurrentStepText('Menyiapkan daftar tanggal penarikan...');

    try {
      addLog(`Menyiapkan rentang ${startDate} s/d ${endDate}...`);
      const prepRes = await fetch('/api/sync/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate }),
      });
      const prepData = await prepRes.json();
      if (!prepData.success) throw new Error(prepData.error || 'Gagal menyiapkan tanggal.');

      const sources: ('hypernet' | 'tachyon')[] = [];
      if (selectedSyncSource === 'both' || selectedSyncSource === 'hypernet') sources.push('hypernet');
      if (selectedSyncSource === 'both' || selectedSyncSource === 'tachyon') sources.push('tachyon');

      setCurrentStepText('Melakukan otentikasi ke vendor...');
      addLog('Membuka sesi penarikan...');

      const sessionRes = await fetch('/api/sync/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourcesToSync: sources,
          hypernetCreds: hypernetUser && hypernetPass ? { username: hypernetUser, password: hypernetPass } : undefined,
          tachyonCreds: tachyonUser && tachyonPass ? { username: tachyonUser, password: tachyonPass } : undefined,
        }),
      });
      const sessionData = await sessionRes.json();
      if (!sessionData.success) throw new Error(sessionData.error || 'Gagal login ke vendor.');

      const { sessionId, hypernetReady, tachyonReady, errors } = sessionData;

      if (sources.includes('hypernet')) {
        if (hypernetReady) addLog('✓ Berhasil login Hypernet (portal.openwifi.id).', 'success');
        else addLog(`✕ Hypernet gagal: ${errors?.hypernet || 'Kredensial tidak valid'}`, 'error');
      }
      if (sources.includes('tachyon')) {
        if (tachyonReady) addLog('✓ Berhasil login Tachyon (lawson-api.tachyon.net.id).', 'success');
        else addLog(`✕ Tachyon gagal: ${errors?.tachyon || 'Kredensial tidak valid'}`, 'error');
      }

      const syncTasks: { source: 'hypernet' | 'tachyon'; date: string }[] = [];
      if (hypernetReady && sources.includes('hypernet')) {
        for (const d of prepData.hypernet.datesToSync) {
          syncTasks.push({ source: 'hypernet', date: d });
        }
      }
      if (tachyonReady && sources.includes('tachyon')) {
        for (const d of prepData.tachyon.datesToSync) {
          syncTasks.push({ source: 'tachyon', date: d });
        }
      }

      const totalTasks = syncTasks.length + (hypernetReady ? 1 : 0) + (tachyonReady ? 1 : 0);
      let completedTasks = 0;
      let successTasks = 0;
      let failedTasks = 0;

      if (syncTasks.length === 0) {
        addLog('Tidak ada hari penarikan yang dijadwalkan.', 'info');
      }

      // Loop per hari per sumber
      for (const task of syncTasks) {
        setCurrentStepText(`Menarik ${task.source.toUpperCase()} tanggal ${task.date}...`);
        try {
          const dayRes = await fetch('/api/sync/day', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, source: task.source, date: task.date }),
          });
          const dayData = await dayRes.json();
          if (dayData.success) {
            successTasks++;
            addLog(
              `[${task.source.toUpperCase()}] ${task.date}: ${dayData.storeCount} toko (${dayData.totalUsers} users)${dayData.newStoresCount > 0 ? `, +${dayData.newStoresCount} toko baru` : ''
              }`,
              'success'
            );
          } else {
            failedTasks++;
            addLog(`[${task.source.toUpperCase()}] ${task.date} gagal: ${dayData.error}`, 'error');
          }
        } catch (err: any) {
          failedTasks++;
          addLog(`[${task.source.toUpperCase()}] ${task.date} error: ${err.message}`, 'error');
        }
        completedTasks++;
        setSyncProgress(Math.round((completedTasks / totalTasks) * 100));
      }

      // Tarik KPI rentang terpilih
      if (hypernetReady && sources.includes('hypernet')) {
        setCurrentStepText('Mengambil Footfall KPI Hypernet rentang...');
        try {
          const kpiRes = await fetch('/api/sync/kpi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, source: 'hypernet', startDate, endDate }),
          });
          const kpiData = await kpiRes.json();
          if (kpiData.success) {
            successTasks++;
            addLog(`✓ Hypernet Footfall: All Users = ${kpiData.kpi.all_users}`, 'success');
          } else {
            failedTasks++;
            addLog(`✕ Hypernet Footfall gagal: ${kpiData.error || 'Gagal'}`, 'error');
          }
        } catch (kpiErr: any) {
          failedTasks++;
          addLog(`✕ Hypernet Footfall error: ${kpiErr.message}`, 'error');
        }
        completedTasks++;
        setSyncProgress(Math.round((completedTasks / totalTasks) * 100));
      }

      if (tachyonReady && sources.includes('tachyon')) {
        setCurrentStepText('Mengambil Metrics KPI Tachyon rentang...');
        try {
          const kpiRes = await fetch('/api/sync/kpi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, source: 'tachyon', startDate, endDate }),
          });
          const kpiData = await kpiRes.json();
          if (kpiData.success) {
            successTasks++;
            addLog(`✓ Tachyon Metrics: Total Users = ${kpiData.kpi.all_users}`, 'success');
          } else {
            failedTasks++;
            addLog(`✕ Tachyon Metrics gagal: ${kpiData.error || 'Gagal'}`, 'error');
          }
        } catch (kpiErr: any) {
          failedTasks++;
          addLog(`✕ Tachyon Metrics error: ${kpiErr.message}`, 'error');
        }
        completedTasks++;
        setSyncProgress(Math.round((completedTasks / totalTasks) * 100));
      }

      // Tutup sesi
      await fetch('/api/sync/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });

      if (failedTasks === 0 && successTasks > 0) {
        setCurrentStepText('Selesai!');
        addLog('Penarikan data selesai dengan sukses!', 'success');
        showToast('Data berhasil diperbarui dari vendor.');
      } else if (failedTasks > 0 && successTasks > 0) {
        setCurrentStepText('Selesai Sebagian');
        addLog(`Penarikan selesai sebagian: ${successTasks} berhasil, ${failedTasks} tugas gagal. Silakan periksa log rincian.`, 'warn');
        showToast(`Penarikan selesai sebagian (${failedTasks} tugas gagal).`);
      } else if (failedTasks > 0 && successTasks === 0) {
        setCurrentStepText('Penarikan Gagal');
        addLog(`Penarikan gagal: seluruh ${failedTasks} tugas gagal diproses.`, 'error');
        showToast('Penarikan gagal: seluruh data gagal ditarik dari vendor.');
      } else {
        setCurrentStepText('Selesai');
        addLog('Tidak ada tugas penarikan yang dijalankan.', 'info');
      }
      setSyncProgress(100);

      // Refresh DB data
      await loadData(startDate, endDate);
      await loadDbMetrics();
      showToast('Data berhasil diperbarui dari vendor.');
    } catch (err: any) {
      addLog(`Proses terhenti: ${err.message}`, 'error');
      setCurrentStepText(`Error: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // Safe Delete Handler (Section 6b)
  const handleDeleteData = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch('/api/data/manage', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate, confirmed: true }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message);
        setShowManageModal(false);
        await loadData(startDate, endDate);
        await loadDbMetrics();
      } else {
        alert(data.error || 'Gagal menghapus data.');
      }
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  // --- EKSPOR EXCEL (Tahap 5) ---
  const handleExportExcel = async () => {
    if (!dbData || isExportingExcel) return;
    setIsExportingExcel(true);
    try {
      // 1. Capture elemen visual chart jika tersedia di layar
      let chartPng: string | null = null;
      const chartElement = document.getElementById('dashboard-charts-area');
      if (chartElement) {
        try {
          chartPng = await toPng(chartElement, {
            pixelRatio: 1.5,
            backgroundColor: '#ffffff',
          });
        } catch (e) {
          console.warn('Gagal menangkap gambar chart untuk Excel:', e);
        }
      }

      // 2. Fetch data lengkap termasuk toko tersembunyi khusus jalur ekspor
      const exportRes = await fetch(
        `/api/data/stats?startDate=${startDate}&endDate=${endDate}&includeHidden=true`
      );
      const exportData = await exportRes.json();
      if (!exportData.success) {
        throw new Error(exportData.error || 'Gagal memuat data lengkap toko untuk ekspor.');
      }

      const allStoresList: StoreItem[] = exportData.stores || [];
      const allStatsList: DailyStoreStat[] = exportData.stats || [];

      // Susun data baris tabel untuk SEMUA toko (tampil & sembunyi)
      const periodDates = isMultiMonth
        ? selectedDatesList
        : getDatesInRange(monthPeriod.startDate, monthPeriod.endDate);
      const periodDaysCount = isMultiMonth
        ? selectedDatesList.length
        : monthPeriod.daysCount;

      const exportStatsMap = new Map<string, number>();
      for (const item of allStatsList) {
        exportStatsMap.set(`${item.source}__${item.source_key}__${item.date}`, item.users);
      }

      const allExportRows = allStoresList.map((store) => {
        const assignment = exportData.assignments?.[store.id];
        const am = assignment?.am || '';
        const ac = assignment?.ac || '';

        const dateValues: Record<string, number> = {};
        for (const d of selectedDatesList) {
          const val = exportStatsMap.get(`${store.source}__${store.source_key}__${d}`);
          dateValues[d] = val !== undefined ? val : 0;
        }

        let sumMonth = 0;
        for (const md of periodDates) {
          const v = exportStatsMap.get(`${store.source}__${store.source_key}__${md}`);
          if (v !== undefined) sumMonth += v;
        }

        const avgMonth = periodDaysCount > 0 ? Math.round(sumMonth / periodDaysCount) : 0;

        return {
          id: store.id,
          source: store.source,
          source_key: store.source_key,
          display_name: store.display_name,
          kd_store: store.kd_store || '',
          activation_date: store.activation_date || '',
          active: store.active === 1,
          am,
          ac,
          dateValues,
          sumMonth,
          avgMonth,
        };
      });

      // Terapkan filter pencarian / AM / AC yang aktif pada saat ekspor
      const filteredExportRows = allExportRows.filter((row) => {
        if (!showInactive && !row.active) return false;
        if (selectedAm && row.am !== selectedAm) return false;
        if (selectedAc && row.ac !== selectedAc) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchName = row.display_name.toLowerCase().includes(q);
          const matchKd = row.kd_store.toLowerCase().includes(q);
          const matchSource = row.source_key.toLowerCase().includes(q);
          if (!matchName && !matchKd && !matchSource) return false;
        }
        return true;
      });

      // Urutkan data ekspor sesuai sortField & sortOrder saat ini
      const sortedExportRows = [...filteredExportRows].sort((a, b) => {
        let valA: any;
        let valB: any;
        if (sortField === 'kd_store') {
          valA = a.kd_store; valB = b.kd_store;
        } else if (sortField === 'display_name') {
          valA = a.display_name; valB = b.display_name;
        } else if (sortField === 'am') {
          valA = a.am; valB = b.am;
        } else if (sortField === 'ac') {
          valA = a.ac; valB = b.ac;
        } else if (sortField === 'activation_date') {
          valA = a.activation_date; valB = b.activation_date;
        } else if (sortField === 'sum') {
          valA = a.sumMonth; valB = b.sumMonth;
        } else if (sortField === 'avg') {
          valA = a.avgMonth; valB = b.avgMonth;
        } else {
          valA = a.dateValues[sortField] !== undefined ? a.dateValues[sortField] : 0;
          valB = b.dateValues[sortField] !== undefined ? b.dateValues[sortField] : 0;
        }
        if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
        if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
        return a.display_name.localeCompare(b.display_name);
      });

      // Hitung totals untuk baris footer ekspor
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

      // 3. Generate Berkas Excel Blob (2 Sheet)
      const blob = await generateRekapExcelBlob({
        startDate,
        endDate,
        monthRef,
        monthPeriod,
        selectedDates: selectedDatesList,
        tableRows: sortedExportRows,
        totals: { dateTotals: exportDateTotals, totalSum: exportTotalSum, totalAvg: exportTotalAvg },
        kpi: cardKpi,
        stores: allStoresList,
        stats: allStatsList,
        chartImageBase64: chartPng,
      });

      // 3. Trigger Download Berkas di Browser
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Rekap_WiFi_Lawson_${startDate}_sd_${endDate}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast('Berhasil mengunduh berkas Excel (Dashboard & Tarikan Mentahan)!');
    } catch (err: any) {
      console.error('Error saat ekspor Excel:', err);
      alert(`Gagal mengekspor berkas Excel: ${err.message}`);
    } finally {
      setIsExportingExcel(false);
    }
  };

  // --- HELPER CAPTURE GAMBAR DASHBOARD (Tahap 6) ---
  const captureDashboardImage = async (): Promise<{ blob: Blob; dataUrl: string } | null> => {
    const node = document.getElementById('dashboard-capture-area');
    if (!node) return null;

    const tableWrapper = node.querySelector('.table-scroll-wrapper') as HTMLElement | null;
    const origMaxHeight = tableWrapper ? tableWrapper.style.maxHeight : '';
    const origOverflow = tableWrapper ? tableWrapper.style.overflow : '';
    const origWidth = node.style.width;

    try {
      // Buka batasan scroll agar seluruh baris tabel masuk ke gambar tanpa terpotong
      if (tableWrapper) {
        tableWrapper.style.maxHeight = 'none';
        tableWrapper.style.overflow = 'visible';
      }
      node.style.width = '1200px';

      const dataUrl = await toPng(node, {
        pixelRatio: 1.5, // Cukup tajam untuk WhatsApp, ukuran file lebih ringan (~64% lebih kecil dari 2.5)
        backgroundColor: '#f8fafc',
        cacheBust: true,
      });

      const res = await fetch(dataUrl);
      const blob = await res.blob();
      return { blob, dataUrl };
    } finally {
      // Kembalikan ke styling asli
      if (tableWrapper) {
        tableWrapper.style.maxHeight = origMaxHeight;
        tableWrapper.style.overflow = origOverflow;
      }
      node.style.width = origWidth;
    }
  };

  // Handler Salin Gambar (Ctrl+V ke WhatsApp)
  const handleCopyImage = async () => {
    if (!dbData || isCopyingImage) return;
    setIsCopyingImage(true);
    try {
      const result = await captureDashboardImage();
      if (!result) throw new Error('Area dashboard tidak ditemukan.');

      if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': result.blob }),
        ]);
        showToast('Gambar berhasil disalin! Tekan Ctrl+V di WhatsApp untuk menempelkan.');
      } else {
        // Fallback unduh otomatis jika browser membatasi ClipboardItem
        const a = document.createElement('a');
        a.href = result.dataUrl;
        a.download = `Rekap_WiFi_Lawson_${startDate}_sd_${endDate}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast('Clipboard dibatasi browser. Gambar otomatis diunduh sebagai PNG!');
      }
    } catch (err: any) {
      console.error('Error saat menyalin gambar:', err);
      // Fallback unduh PNG jika clipboard ditolak
      try {
        const result = await captureDashboardImage();
        if (result) {
          const a = document.createElement('a');
          a.href = result.dataUrl;
          a.download = `Rekap_WiFi_Lawson_${startDate}_sd_${endDate}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          showToast('Gambar otomatis diunduh sebagai file PNG!');
          return;
        }
      } catch { }
      alert(`Pemberitahuan: ${err.message}`);
    } finally {
      setIsCopyingImage(false);
    }
  };

  // Handler Unduh PNG
  const handleDownloadPng = async () => {
    if (!dbData || isDownloadingPng) return;
    setIsDownloadingPng(true);
    try {
      const result = await captureDashboardImage();
      if (!result) throw new Error('Area dashboard tidak ditemukan.');

      const a = document.createElement('a');
      a.href = result.dataUrl;
      a.download = `Rekap_WiFi_Lawson_${startDate}_sd_${endDate}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      showToast('Berhasil mengunduh gambar PNG!');
    } catch (err: any) {
      console.error('Error saat mengunduh PNG:', err);
      alert(`Gagal mengunduh berkas gambar: ${err.message}`);
    } finally {
      setIsDownloadingPng(false);
    }
  };

  // --- STATS INDEX & MAPS ---
  const statsLookup = useMemo(() => {
    const map = new Map<string, number>();
    if (!dbData?.stats) return map;
    for (const item of dbData.stats) {
      const key = `${item.source}__${item.source_key}__${item.date}`;
      map.set(key, item.users);
    }
    return map;
  }, [dbData?.stats]);

  // Check missing dates in selected range
  const missingDates = useMemo(() => {
    if (!dbData?.stats) return [];
    const dateHasData = new Set<string>();
    for (const item of dbData.stats) {
      dateHasData.add(item.date);
    }
    return selectedDatesList.filter((d) => !dateHasData.has(d));
  }, [selectedDatesList, dbData?.stats]);

  // List of unique AMs and ACs
  const { amList, acList } = useMemo(() => {
    const ams = new Set<string>();
    const acs = new Set<string>();
    if (dbData?.assignments) {
      for (const asg of Object.values(dbData.assignments)) {
        if (asg.am) ams.add(asg.am);
        if (asg.ac) acs.add(asg.ac);
      }
    }
    return {
      amList: Array.from(ams).sort(),
      acList: Array.from(acs).sort(),
    };
  }, [dbData?.assignments]);

  // --- TABLE ROWS CALCULATION ---
  const tableRows = useMemo(() => {
    if (!dbData?.stores) return [];

    const isMultiMonth = startDate.slice(0, 7) !== endDate.slice(0, 7);
    const periodDates = isMultiMonth
      ? selectedDatesList
      : getDatesInRange(monthPeriod.startDate, monthPeriod.endDate);
    const periodDaysCount = isMultiMonth
      ? selectedDatesList.length
      : monthPeriod.daysCount;

    const visibleStores = dbData.stores.filter(
      (store) => store.is_visible === undefined || store.is_visible === 1
    );

    return visibleStores.map((store) => {
      const assignment = dbData.assignments?.[store.id];
      const am = assignment?.am || '';
      const ac = assignment?.ac || '';

      // Hitung values per selected date
      const dateValues: Record<string, number> = {};
      for (const d of selectedDatesList) {
        const val = statsLookup.get(`${store.source}__${store.source_key}__${d}`);
        dateValues[d] = val !== undefined ? val : 0;
      }

      // Hitung SUM periode / bulan acuan
      let sumMonth = 0;
      for (const md of periodDates) {
        const v = statsLookup.get(`${store.source}__${store.source_key}__${md}`);
        if (v !== undefined) sumMonth += v;
      }

      // AVG = SUM / jumlah hari dalam periode
      const avgMonth = periodDaysCount > 0 ? Math.round(sumMonth / periodDaysCount) : 0;

      return {
        id: store.id,
        source: store.source,
        source_key: store.source_key,
        display_name: store.display_name,
        kd_store: store.kd_store || '',
        activation_date: store.activation_date || '',
        active: store.active === 1,
        is_new: store.is_new_flag === 1,
        am,
        ac,
        dateValues,
        sumMonth,
        avgMonth,
      };
    });
  }, [dbData?.stores, dbData?.assignments, selectedDatesList, statsLookup, monthPeriod]);

  // Filtered Rows
  const filteredRows = useMemo(() => {
    return tableRows.filter((row) => {
      // 1. Filter status aktif
      if (!showInactive && !row.active) return false;

      // 2. Filter AM
      if (selectedAm && row.am !== selectedAm) return false;

      // 3. Filter AC
      if (selectedAc && row.ac !== selectedAc) return false;

      // 4. Pencarian teks
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = row.display_name.toLowerCase().includes(q);
        const matchKd = row.kd_store.toLowerCase().includes(q);
        const matchSource = row.source_key.toLowerCase().includes(q);
        if (!matchName && !matchKd && !matchSource) return false;
      }

      return true;
    });
  }, [tableRows, showInactive, selectedAm, selectedAc, searchQuery]);

  // Sorted Rows
  const sortedRows = useMemo(() => {
    const list = [...filteredRows];

    list.sort((a, b) => {
      let valA: any;
      let valB: any;

      if (sortField === 'kd_store') {
        valA = a.kd_store || 'ZZZ';
        valB = b.kd_store || 'ZZZ';
      } else if (sortField === 'display_name') {
        valA = a.display_name.toLowerCase();
        valB = b.display_name.toLowerCase();
      } else if (sortField === 'am') {
        valA = a.am || 'ZZZ';
        valB = b.am || 'ZZZ';
      } else if (sortField === 'ac') {
        valA = a.ac || 'ZZZ';
        valB = b.ac || 'ZZZ';
      } else if (sortField === 'activation_date') {
        valA = a.activation_date || '0000-00-00';
        valB = b.activation_date || '0000-00-00';
      } else if (sortField === 'sum') {
        valA = a.sumMonth;
        valB = b.sumMonth;
      } else if (sortField === 'avg') {
        valA = a.avgMonth;
        valB = b.avgMonth;
      } else {
        // Sort berdasarkan tanggal spesifik (default: tanggal terakhir terpilih)
        valA = a.dateValues[sortField] !== undefined ? a.dateValues[sortField] : 0;
        valB = b.dateValues[sortField] !== undefined ? b.dateValues[sortField] : 0;
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      // Fallback secondary sort by name
      return a.display_name.localeCompare(b.display_name);
    });

    return list;
  }, [filteredRows, sortField, sortOrder]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  // --- FOOTER TOTAL ROW ---
  const totals = useMemo(() => {
    const dateTotals: Record<string, number> = {};
    for (const d of selectedDatesList) {
      dateTotals[d] = 0;
    }
    let totalSum = 0;
    let totalAvg = 0;

    for (const row of sortedRows) {
      for (const d of selectedDatesList) {
        dateTotals[d] += row.dateValues[d] || 0;
      }
      totalSum += row.sumMonth;
      totalAvg += row.avgMonth;
    }

    return { dateTotals, totalSum, totalAvg };
  }, [sortedRows, selectedDatesList]);

  // --- 5 KARTU KPI BULANAN (Section 6) ---
  // Angka kartu mengikuti angka dari sumber (pengguna unik untuk periode itu), dari kpi_cache
  const activeStoresCount = useMemo(() => {
    return (dbData?.stores || []).filter(
      (s) => s.active === 1 && (s.is_visible === undefined || s.is_visible === 1)
    ).length;
  }, [dbData?.stores]);

  const cardKpi = useMemo(() => {
    const hKpi = dbData?.kpi?.monthHypernet || dbData?.kpi?.hypernet;
    const tKpi = dbData?.kpi?.monthTachyon || dbData?.kpi?.tachyon;

    const newUsers = (hKpi?.new_users || 0) + (tKpi?.new_users || 0);
    const returningNewUsers = hKpi?.returning_new_users || 0; // Hanya Hypernet
    const returningUsers = (hKpi?.returning_users || 0) + (tKpi?.returning_users || 0);
    const allUsers = (hKpi?.all_users || 0) + (tKpi?.all_users || 0);

    return {
      sumStore: activeStoresCount,
      newUsers,
      returningNewUsers,
      returningUsers,
      allUsers,
      hasData: Boolean(hKpi || tKpi),
    };
  }, [dbData?.kpi, activeStoresCount]);

  // Loading Screen
  if (loadingStatus) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-slate-600 font-medium">Memuat sistem Rekap Free WiFi...</p>
        </div>
      </div>
    );
  }

  // Login Screen (Access Code)
  if (!status?.authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 via-blue-50/50 to-slate-200 p-4">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-xl shadow-blue-500/5 p-8">
          <div className="flex items-center justify-center w-14 h-14 bg-blue-600 rounded-2xl mx-auto mb-6 shadow-md shadow-blue-600/20 text-white">
            <Wifi className="w-7 h-7" />
          </div>

          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Rekap Free WiFi Lawson</h1>
            <p className="text-sm text-slate-500 mt-1">
              Masukkan Kode Akses Bersama untuk mengakses dashboard data vendor Hypernet &amp; Tachyon.
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Kode Akses (ACCESS_CODE)
              </label>
              <div className="relative">
                <input
                  type="password"
                  value={accessCodeInput}
                  onChange={(e) => setAccessCodeInput(e.target.value)}
                  placeholder="Ketik kode akses..."
                  required
                  autoFocus
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all pl-11"
                />
                <Key className="w-5 h-5 text-slate-400 absolute left-3.5 top-3.5" />
              </div>
              <p className="text-xs text-slate-400 mt-1.5">Kode disimpan di cookie httpOnly selama 30 hari.</p>
            </div>

            {authError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmittingAuth}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 text-white font-medium rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {isSubmittingAuth ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              <span>Buka Dashboard</span>
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              Data Dilindungi
            </span>
            <span>Zona Waktu: Asia/Jakarta</span>
          </div>
        </div>
      </div>
    );
  }

  // --- MAIN DASHBOARD TAHAP 2 ---
  return (
    <div className="min-h-screen bg-slate-50/60 flex flex-col font-sans text-slate-800">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white text-xs px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Navbar */}
      <header className="bg-white border-b border-slate-200/80 sticky top-0 z-30 shadow-xs">
        <div className="max-w-[1520px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 text-white rounded-xl flex items-center justify-center shadow-xs">
              <Wifi className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-slate-900 leading-tight">
                  Rekap Pengguna Akses Free WiFi
                </h1>
              </div>
              <p className="text-xs text-slate-500">
                Data Hypernet &amp; Tachyon • Zona Waktu: Asia/Jakarta (UTC+7)
              </p>
            </div>
          </div>

          {/* Navigation Tabs between Dashboard & Master Toko */}
          <nav className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200/80">
            <span className="px-3.5 py-1.5 text-xs font-bold bg-white text-blue-700 shadow-xs rounded-lg flex items-center gap-1.5">
              <Wifi className="w-3.5 h-3.5" />
              <span>Dashboard Rekap</span>
            </span>
            <Link
              href="/stores"
              className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <Store className="w-3.5 h-3.5" />
              <span>Master Toko</span>
            </Link>
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Kelola Data Tarikan (Section 6b) */}
            <button
              onClick={() => setShowManageModal(true)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-200/70 px-3 py-1.5 rounded-xl transition-colors cursor-pointer shadow-2xs"
              title="Kelola Data Tarikan & Kapasitas Database"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-blue-600" />
              <span>Kelola Data</span>
            </button>

            {/* Logout */}
            <button
              onClick={handleLogout}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-rose-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              title="Keluar"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-[1520px] mx-auto px-4 sm:px-6 lg:px-8 py-5 flex-1 w-full space-y-5">
        {/* ACTION BAR: Title, Presets, Date Selector, Buttons */}
        <section className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
            {/* Left: Judul & Bulan Acuan */}
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">
                  Rekap Pengguna Akses Free WiFi — {fullMonthTitle}
                </h2>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Data tabel difilter sesuai tanggal terpilih. Kolom SUM &amp; AVG serta 5 Kartu ringkasan mengacu pada periode bulanan {fullMonthTitle}.
              </p>
            </div>

            {/* Right: Tombol Tarik Data & Action Exports */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowSyncModal(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold rounded-xl text-xs shadow-xs transition-all flex items-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Tarik Data</span>
              </button>

              <button
                type="button"
                onClick={handleExportExcel}
                disabled={isExportingExcel || !dbData}
                title="Unduh rekap lengkap (.xlsx) dengan Sheet Dashboard & Tarikan Mentahan"
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 text-white font-semibold rounded-xl text-xs shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
              >
                {isExportingExcel ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                )}
                <span>{isExportingExcel ? 'Mengekspor...' : 'Ekspor Excel'}</span>
              </button>

              <button
                type="button"
                onClick={handleCopyImage}
                disabled={isCopyingImage || !dbData}
                title="Salin gambar rekap (kartu + tabel) ke clipboard untuk ditempel langsung (Ctrl+V) ke WhatsApp"
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 font-semibold rounded-xl text-xs shadow-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 border border-slate-200"
              >
                {isCopyingImage ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-blue-600" />
                )}
                <span>{isCopyingImage ? 'Menyalin...' : 'Salin Gambar'}</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadPng}
                disabled={isDownloadingPng || !dbData}
                title="Unduh gambar rekap (.png). Kirim sebagai dokumen di WhatsApp agar gambar tidak terkompresi"
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 font-semibold rounded-xl text-xs shadow-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 border border-slate-200"
              >
                {isDownloadingPng ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />
                ) : (
                  <Download className="w-3.5 h-3.5 text-blue-600" />
                )}
                <span>{isDownloadingPng ? 'Mengunduh...' : 'Unduh PNG'}</span>
              </button>
            </div>
          </div>

          {/* Date Range Selector & Shortcuts Bar */}
          <div className="pt-3 border-t border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
            {/* Quick Presets */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-slate-500 font-semibold mr-1">TAMPILAN:</span>
              <button
                type="button"
                onClick={() => handlePreset('today')}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition-colors cursor-pointer"
              >
                Hari Ini
              </button>
              <button
                type="button"
                onClick={() => handlePreset('yesterday')}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition-colors cursor-pointer"
              >
                Kemarin
              </button>
              <button
                type="button"
                onClick={() => handlePreset('threeDays')}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition-colors cursor-pointer"
              >
                3 Hari
              </button>
              <button
                type="button"
                onClick={() => handlePreset('fiveDays')}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition-colors cursor-pointer"
              >
                5 Hari
              </button>
              <button
                type="button"
                onClick={() => handlePreset('sevenDays')}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition-colors cursor-pointer"
              >
                7 Hari
              </button>
              <button
                type="button"
                onClick={() => handlePreset('thisMonth')}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition-colors cursor-pointer"
              >
                Bulan Ini
              </button>
              <button
                type="button"
                onClick={() => handlePreset('lastMonth')}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition-colors cursor-pointer"
              >
                Bulan Lalu
              </button>
            </div>

            {/* Date Pickers */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <input
                  type="date"
                  value={startDate}
                  max={endDate}
                  onChange={(e) => handleApplyDateRange(e.target.value, endDate)}
                  className="bg-transparent text-slate-800 text-xs focus:outline-none cursor-pointer"
                />
                <span className="text-slate-400 font-medium">s/d</span>
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  max={todayJakarta}
                  onChange={(e) => handleApplyDateRange(startDate, e.target.value)}
                  className="bg-transparent text-slate-800 text-xs focus:outline-none cursor-pointer"
                />
              </div>

              <button
                type="button"
                onClick={handleRefreshClick}
                disabled={loadingData}
                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 shadow-2xs border border-slate-200/70"
                title="Segarkan data dari database"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingData ? 'animate-spin text-blue-600' : ''}`} />
                <span>{loadingData ? 'Memuat...' : 'Segarkan'}</span>
              </button>
            </div>
          </div>
        </section>

        {/* MISSING DATES ALERT BANNER (Section 6) */}
        {missingDates.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 mt-0.5">
                <AlertCircle className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-bold text-amber-900">
                  {missingDates.length} hari pada rentang terpilih belum ada datanya di database
                </p>
                <p className="text-xs text-amber-800 mt-0.5">
                  Tanggal yang belum ditarik: <span className="font-mono">{missingDates.slice(0, 7).join(', ')}</span>
                  {missingDates.length > 7 ? ` (+${missingDates.length - 7} hari lainnya)` : ''}.
                  Klik tombol Tarik Data untuk melengkapi data vendor.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowSyncModal(true)}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white font-semibold rounded-xl text-xs shadow-xs transition-colors shrink-0 cursor-pointer flex items-center gap-1.5 justify-center"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Tarik Data Sekarang</span>
            </button>
          </div>
        )}

        {/* FILTER BAR — di luar area capture gambar, tidak ikut di-screenshot */}
        <div className="bg-white border border-slate-200/90 rounded-2xl shadow-xs px-4 py-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari toko / kode..."
                  className="w-52 pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
              </div>
              <select
                value={selectedAm}
                onChange={(e) => setSelectedAm(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                <option value="">Semua AM</option>
                {amList.map((am) => (
                  <option key={am} value={am}>AM: {am}</option>
                ))}
              </select>
              <select
                value={selectedAc}
                onChange={(e) => setSelectedAc(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                <option value="">Semua AC</option>
                {acList.map((ac) => (
                  <option key={ac} value={ac}>AC: {ac}</option>
                ))}
              </select>
              <label className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                  className="w-3.5 h-3.5 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                />
                <span className="text-slate-600 font-medium text-[11px]">Tampilkan Nonaktif</span>
              </label>
            </div>
            <div className="text-slate-500 text-[11px] font-medium flex items-center gap-2 shrink-0">
              <span>
                Menampilkan <strong className="text-slate-900">{sortedRows.length}</strong> dari {tableRows.length} toko
              </span>
              {sortField && (
                <span className="px-2 py-0.5 bg-slate-100 rounded text-slate-600">
                  Urutan: {sortField === endDate ? `Tgl Terakhir (${formatDateColumnHeader(endDate)})` : sortField} ({sortOrder.toUpperCase()})
                </span>
              )}
            </div>
          </div>
        </div>

        {/* CAPTURE CONTAINER AREA (ID: dashboard-capture-area) */}
        <div id="dashboard-capture-area" className="space-y-2 bg-slate-50/40 p-2.5 rounded-2xl border border-slate-200/60">
          {/* Header Area Gambar (Judul + Periode) */}
          <div className="bg-white border border-slate-200/90 rounded-xl p-3 shadow-xs flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                <Wifi className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-extrabold text-slate-900 tracking-tight leading-tight">
                  Rekap Pengguna Akses Free WiFi — {fullMonthTitle}
                </h2>
                {/* <p className="text-[10px] text-slate-500 mt-0.5">
                  Data: <span className="font-semibold text-slate-700">{startDate} s/d {endDate}</span>
                  {' '}•{' '}
                  Bulanan: <span className="font-semibold text-blue-700">{monthPeriod.startDate} s/d {monthPeriod.endDate} ({monthPeriod.daysCount} hari)</span>
                </p> */}
              </div>
            </div>
            <div className="text-right text-[10px] text-slate-400 shrink-0">
              <span className="font-medium text-slate-600">
                {new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
              </span>
            </div>
          </div>

          {/* 5 KARTU RINGKASAN PENGGUNA UNIK (Section 6) */}
          <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {/* Kartu 1: SUM STORE */}
            <div className="bg-white border border-slate-200/90 rounded-xl px-3 py-2.5 shadow-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">SUM STORE</span>
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"></span>
              </div>
              <p className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight leading-tight">
                {cardKpi.sumStore}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">toko aktif</p>
            </div>

            {/* Kartu 2: New Users */}
            <div className="bg-white border border-slate-200/90 rounded-xl px-3 py-2.5 shadow-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">New Users</span>
                <span className="text-[9px] text-slate-400 font-medium">unik</span>
              </div>
              <p className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight leading-tight">
                {cardKpi.newUsers.toLocaleString('id-ID')}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">pengguna baru</p>
            </div>

            {/* Kartu 3: Returning New Users (Hanya Hypernet) */}
            <div className="bg-white border border-slate-200/90 rounded-xl px-3 py-2.5 shadow-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Ret. New Users</span>
                <span className="text-[9px] text-slate-400 font-medium">unik</span>
              </div>
              <p className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight leading-tight">
                {cardKpi.returningNewUsers.toLocaleString('id-ID')}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">baru kembali</p>
            </div>

            {/* Kartu 4: Returning Users */}
            <div className="bg-white border border-slate-200/90 rounded-xl px-3 py-2.5 shadow-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Ret. Users</span>
                <span className="text-[9px] text-slate-400 font-medium">unik</span>
              </div>
              <p className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight leading-tight">
                {cardKpi.returningUsers.toLocaleString('id-ID')}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">pengguna setia</p>
            </div>

            {/* Kartu 5: All Users */}
            <div className="bg-gradient-to-b from-blue-50/40 to-white border border-blue-200/80 rounded-xl px-3 py-2.5 shadow-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700">All Users</span>
                <span className="text-[9px] text-blue-500 font-medium">unik</span>
              </div>
              <p className="text-xl sm:text-2xl font-extrabold text-blue-700 tracking-tight leading-tight">
                {cardKpi.allUsers.toLocaleString('id-ID')}
              </p>
              <p className="text-[10px] text-blue-500/70 mt-0.5">total pengguna unik</p>
            </div>
          </section>

          {/* BAGIAN 1 — TABEL REKAP TOKO (Section 6) */}
          <section className="bg-white border border-slate-200/90 rounded-2xl shadow-xs overflow-hidden">
            {/* Scrollable Table View with Sticky Columns */}
            <div className="overflow-x-auto max-h-[680px] relative table-scroll-wrapper">
              <table className="w-full text-left text-xs text-slate-700 border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[11px] sticky top-0 z-20 shadow-2xs">
                  <tr>
                    {/* Sticky Column 1: Kd Store */}
                    <th
                      scope="col"
                      onClick={() => handleSort('kd_store')}
                      className="py-3 px-3.5 w-24 sticky left-0 z-30 bg-slate-50 border-r border-slate-200/80 cursor-pointer hover:bg-slate-100 select-none"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span>Kd Store</span>
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      </div>
                    </th>

                    {/* Sticky Column 2: Organisation */}
                    <th
                      scope="col"
                      onClick={() => handleSort('display_name')}
                      className="py-3 px-4 min-w-[260px] max-w-[320px] sticky left-24 z-30 bg-slate-50 border-r border-slate-200/80 cursor-pointer hover:bg-slate-100 select-none shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)]"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span>Organisation</span>
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      </div>
                    </th>

                    {/* AM */}
                    <th
                      scope="col"
                      onClick={() => handleSort('am')}
                      className="py-3 px-3 w-20 text-center cursor-pointer hover:bg-slate-100 select-none"
                    >
                      <div className="flex items-center justify-center gap-1">
                        <span>AM</span>
                        <ArrowUpDown className="w-2.5 h-2.5 text-slate-400" />
                      </div>
                    </th>

                    {/* AC */}
                    <th
                      scope="col"
                      onClick={() => handleSort('ac')}
                      className="py-3 px-3 w-20 text-center cursor-pointer hover:bg-slate-100 select-none"
                    >
                      <div className="flex items-center justify-center gap-1">
                        <span>AC</span>
                        <ArrowUpDown className="w-2.5 h-2.5 text-slate-400" />
                      </div>
                    </th>

                    {/* Tanggal Aktivasi */}
                    <th
                      scope="col"
                      onClick={() => handleSort('activation_date')}
                      className="py-3 px-3 w-28 text-center cursor-pointer hover:bg-slate-100 select-none"
                    >
                      <div className="flex items-center justify-center gap-1">
                        <span>Tgl Aktivasi</span>
                        <ArrowUpDown className="w-2.5 h-2.5 text-slate-400" />
                      </div>
                    </th>

                    {/* Kolom Tanggal Terpilih (08-Okt-26 dst.) */}
                    {selectedDatesList.map((d) => (
                      <th
                        key={d}
                        scope="col"
                        onClick={() => handleSort(d)}
                        className={`py-3 px-2.5 min-w-[85px] text-right cursor-pointer hover:bg-slate-100 select-none ${d === endDate ? 'bg-blue-50/70 text-blue-900 font-extrabold' : ''
                          }`}
                        title={`Urutkan berdasarkan nilai tanggal ${d}`}
                      >
                        <div className="flex items-center justify-end gap-1 font-mono">
                          <span>{formatDateColumnHeader(d)}</span>
                          {sortField === d && (
                            <span className="text-blue-600 text-[10px]">
                              {sortOrder === 'asc' ? '▲' : '▼'}
                            </span>
                          )}
                        </div>
                      </th>
                    ))}

                    {/* SUM <BLN> */}
                    <th
                      scope="col"
                      onClick={() => handleSort('sum')}
                      className="py-3 px-3.5 min-w-[95px] text-right bg-blue-50/40 text-blue-900 border-l border-slate-200 cursor-pointer hover:bg-blue-100/50 select-none font-bold"
                    >
                      <div className="flex items-center justify-end gap-1 font-mono">
                        <span>SUM {isMultiMonth ? 'PERIODE' : shortMonthUpper}</span>
                        {sortField === 'sum' && (
                          <span className="text-blue-600 text-[10px]">
                            {sortOrder === 'asc' ? '▲' : '▼'}
                          </span>
                        )}
                      </div>
                    </th>

                    {/* AVG <BLN> */}
                    <th
                      scope="col"
                      onClick={() => handleSort('avg')}
                      className="py-3 px-3.5 min-w-[90px] text-right bg-blue-50/40 text-blue-900 border-l border-slate-200 cursor-pointer hover:bg-blue-100/50 select-none font-bold"
                    >
                      <div className="flex items-center justify-end gap-1 font-mono">
                        <span>AVG {isMultiMonth ? 'PERIODE' : shortMonthUpper}</span>
                        {sortField === 'avg' && (
                          <span className="text-blue-600 text-[10px]">
                            {sortOrder === 'asc' ? '▲' : '▼'}
                          </span>
                        )}
                      </div>
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100 bg-white">
                  {sortedRows.length === 0 ? (
                    <tr>
                      <td colSpan={7 + selectedDatesList.length} className="py-12 text-center text-slate-400">
                        {loadingData ? (
                          <div className="flex items-center justify-center gap-2">
                            <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
                            <span>Memuat data rekap...</span>
                          </div>
                        ) : (
                          'Tidak ada toko yang sesuai dengan filter atau tanggal terpilih.'
                        )}
                      </td>
                    </tr>
                  ) : (
                    sortedRows.map((row) => (
                      <tr
                        key={row.id}
                        className="hover:bg-slate-50/90 transition-colors bg-white group"
                      >
                        {/* Sticky Col 1: Kd Store */}
                        <td className="py-2.5 px-3.5 font-mono text-slate-600 sticky left-0 z-10 bg-white group-hover:bg-slate-50 border-r border-slate-200/80 text-xs">
                          {row.kd_store || '-'}
                        </td>

                        {/* Sticky Col 2: Organisation */}
                        <td className="py-2.5 px-4 font-semibold text-slate-900 sticky left-24 z-10 bg-white group-hover:bg-slate-50 border-r border-slate-200/80 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] truncate max-w-[320px]">
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="truncate">{row.display_name}</span>
                            {!row.active && (
                              <span className="text-[10px] px-1 py-0.2 bg-slate-200 text-slate-600 rounded shrink-0">
                                Nonaktif
                              </span>
                            )}
                            {row.is_new && (
                              <span className="text-[10px] px-1 py-0.2 bg-amber-100 text-amber-800 rounded shrink-0 font-medium">
                                Baru
                              </span>
                            )}
                          </div>
                        </td>

                        {/* AM */}
                        <td className="py-2.5 px-3 text-center text-slate-600 font-medium">
                          {row.am || '-'}
                        </td>

                        {/* AC */}
                        <td className="py-2.5 px-3 text-center text-slate-600 font-medium">
                          {row.ac || '-'}
                        </td>

                        {/* Tanggal Aktivasi */}
                        <td className="py-2.5 px-3 text-center text-slate-500 font-mono text-[11px]">
                          {row.activation_date || '-'}
                        </td>

                        {/* Nilai Pengguna Tiap Tanggal Terpilih */}
                        {selectedDatesList.map((d) => {
                          const val = row.dateValues[d];
                          const isZero = val === 0 || val === undefined;
                          return (
                            <td
                              key={d}
                              className={`py-2.5 px-2.5 text-right font-mono text-xs ${isZero
                                ? 'bg-amber-100 text-rose-600 font-semibold'
                                : 'text-slate-800 font-medium'
                                } ${d === endDate ? 'border-r border-l border-blue-200/60' : ''}`}
                            >
                              {val !== undefined ? val : 0}
                            </td>
                          );
                        })}

                        {/* SUM <BLN> */}
                        <td className="py-2.5 px-3.5 text-right font-mono font-bold text-slate-900 bg-blue-50/20 border-l border-slate-200">
                          {row.sumMonth.toLocaleString('id-ID')}
                        </td>

                        {/* AVG <BLN> */}
                        <td className="py-2.5 px-3.5 text-right font-mono font-bold text-blue-700 bg-blue-50/20 border-l border-slate-200">
                          {row.avgMonth.toLocaleString('id-ID')}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>

                {/* BARIS TOTAL / SUMMARY BAWAH TABEL */}
                {sortedRows.length > 0 && (
                  <tfoot className="bg-slate-100 border-t-2 border-slate-300 font-bold text-slate-900 sticky bottom-0 z-20 text-xs">
                    <tr>
                      <td className="py-3 px-3.5 sticky left-0 z-30 bg-slate-100 border-r border-slate-300">
                        TOTAL
                      </td>
                      <td className="py-3 px-4 sticky left-24 z-30 bg-slate-100 border-r border-slate-300 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)]">
                        {sortedRows.length} Toko
                      </td>
                      <td className="py-3 px-3 text-center text-slate-400">-</td>
                      <td className="py-3 px-3 text-center text-slate-400">-</td>
                      <td className="py-3 px-3 text-center text-slate-400">-</td>

                      {/* Total Tiap Tanggal */}
                      {selectedDatesList.map((d) => (
                        <td
                          key={d}
                          className={`py-3 px-2.5 text-right font-mono font-extrabold ${d === endDate ? 'bg-blue-100/70 text-blue-900 border-l border-r border-blue-300' : ''
                            }`}
                        >
                          {totals.dateTotals[d]?.toLocaleString('id-ID') || 0}
                        </td>
                      ))}

                      {/* Total SUM */}
                      <td className="py-3 px-3.5 text-right font-mono font-extrabold text-slate-900 bg-blue-100/60 border-l border-slate-300">
                        {totals.totalSum.toLocaleString('id-ID')}
                      </td>

                      {/* Total AVG */}
                      <td className="py-3 px-3.5 text-right font-mono font-extrabold text-blue-800 bg-blue-100/60 border-l border-slate-300">
                        {totals.totalAvg.toLocaleString('id-ID')}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {/* Table Footer Caption */}
            <div className="p-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 bg-amber-100 border border-amber-300 rounded-xs inline-block"></span>
                <span>Sel bernilai 0 ditandai kuning lembut dengan angka merah</span>
              </span>
              <span>
                Waktu Pengambilan Data: {new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
              </span>
            </div>
          </section>
        </div>

        {/* Bagian 2 — Visualisasi & Analisis Chart (Tahap 4) */}
        {dbData && (
          <DashboardCharts
            selectedDates={selectedDatesList}
            stores={dbData.stores}
            stats={dbData.stats}
            assignments={dbData.assignments}
            kpi={dbData.kpi}
          />
        )}
      </main>

      {/* MODAL 1: TARIK DATA VENDOR */}
      {showSyncModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-base">
                <RefreshCw className="w-5 h-5 text-blue-600" />
                <span>Panel Penarikan Data Vendor</span>
              </div>
              <button
                type="button"
                onClick={() => !isSyncing && setShowSyncModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Rentang Tanggal Tarikan */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Tanggal Awal
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    max={endDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Tanggal Akhir
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    min={startDate}
                    max={todayJakarta}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
              </div>

              {/* Pilihan Vendor */}
              <div>
                <label className="block font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Sumber Vendor
                </label>
                <select
                  value={selectedSyncSource}
                  onChange={(e) => setSelectedSyncSource(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl cursor-pointer"
                >
                  <option value="both">Kedua Sumber (Hypernet &amp; Tachyon)</option>
                  <option value="hypernet">Hypernet Saja (portal.openwifi.id)</option>
                  <option value="tachyon">Tachyon Saja (lawson-api.tachyon.net.id)</option>
                </select>
              </div>

              {/* Mekanisme Otomatis Upsert */}
              <div className="flex items-start gap-2.5 p-3 bg-blue-50/70 border border-blue-200/80 rounded-xl text-xs text-blue-900">
                <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-blue-950">Pembaruan Otomatis (Upsert)</span>
                  <p className="text-[11px] text-blue-800 mt-0.5 leading-relaxed">
                    Data yang sudah ada diperbarui dengan hasil penarikan terbaru, dan data yang belum ada ditambahkan tanpa duplikasi.
                  </p>
                </div>
              </div>

              {/* Manual Credential Forms (Section 3b) if env missing */}
              {(!status?.hypernetConfigured || !status?.tachyonConfigured) && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 space-y-3">
                  <div className="flex items-start gap-2">
                    <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-amber-900 text-xs">Kredensial Vendor Manual (In-Memory Saja)</p>
                      <p className="text-[11px] text-amber-800">
                        Tidak disimpan di DB/cookie/log. Hanya dipakai untuk sesi tarikan ini.
                      </p>
                    </div>
                  </div>

                  {!status?.hypernetConfigured && (selectedSyncSource === 'both' || selectedSyncSource === 'hypernet') && (
                    <div className="bg-white p-2.5 rounded-lg border border-amber-200 space-y-2">
                      <span className="font-bold text-slate-800 block">Akun Hypernet</span>
                      <input
                        type="text"
                        placeholder="Username Hypernet"
                        value={hypernetUser}
                        onChange={(e) => setHypernetUser(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-md"
                      />
                      <input
                        type="password"
                        placeholder="Password Hypernet"
                        value={hypernetPass}
                        onChange={(e) => setHypernetPass(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-md"
                      />
                    </div>
                  )}

                  {!status?.tachyonConfigured && (selectedSyncSource === 'both' || selectedSyncSource === 'tachyon') && (
                    <div className="bg-white p-2.5 rounded-lg border border-amber-200 space-y-2">
                      <span className="font-bold text-slate-800 block">Akun Tachyon</span>
                      <input
                        type="text"
                        placeholder="Username Tachyon"
                        value={tachyonUser}
                        onChange={(e) => setTachyonUser(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-md"
                      />
                      <input
                        type="password"
                        placeholder="Password Tachyon"
                        value={tachyonPass}
                        onChange={(e) => setTachyonPass(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-md"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Progress Bar & Status Text */}
              {isSyncing && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                    <span>{currentStepText}</span>
                    <span>{syncProgress}%</span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 transition-all duration-300"
                      style={{ width: `${syncProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Live Activity Logs */}
              {syncLogs.length > 0 && (
                <div className="bg-slate-900 rounded-xl p-3 text-[11px] font-mono text-slate-200 max-h-44 overflow-y-auto space-y-1">
                  <div className="text-slate-400 border-b border-slate-800 pb-1 mb-1.5 flex justify-between">
                    <span>Log Penarikan Vendor</span>
                    <span>{syncLogs.length} entri</span>
                  </div>
                  {syncLogs.map((log, idx) => (
                    <div key={idx} className="flex items-start gap-1.5">
                      <span className="text-slate-500 shrink-0">[{log.time}]</span>
                      <span
                        className={
                          log.type === 'success'
                            ? 'text-emerald-400'
                            : log.type === 'error'
                              ? 'text-rose-400'
                              : log.type === 'warn'
                                ? 'text-amber-400'
                                : 'text-slate-300'
                        }
                      >
                        {log.message}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowSyncModal(false)}
                disabled={isSyncing}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition-colors cursor-pointer"
              >
                Tutup
              </button>
              <button
                type="button"
                onClick={handleStartSync}
                disabled={isSyncing}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition-colors disabled:opacity-50 flex items-center gap-2 cursor-pointer shadow-xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Sedang Menarik...' : 'Mulai Tarik Data'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: KELOLA DATA & HAPUS TARIKAN (Section 6b) */}
      {showManageModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-base">
                <SlidersHorizontal className="w-5 h-5 text-slate-700" />
                <span>Kelola Data &amp; Kapasitas DB</span>
              </div>
              <button
                type="button"
                onClick={() => setShowManageModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* DB Capacity Indicator */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs space-y-2">
              <span className="font-bold text-slate-800 block">Kapasitas Database Saat Ini</span>
              <div className="grid grid-cols-2 gap-2 text-slate-600">
                <div>
                  <span className="text-[11px] text-slate-400 block">Baris Data Harian</span>
                  <strong className="text-slate-900 text-sm">{dbMetrics?.dailyStatsCount || 0}</strong> baris
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 block">Cache KPI Rentang</span>
                  <strong className="text-slate-900 text-sm">{dbMetrics?.kpiCacheCount || 0}</strong> baris
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 block">Master Toko</span>
                  <strong className="text-slate-900 text-sm">{dbMetrics?.storesCount || 0}</strong> toko
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 block">Ukuran File / Estimasi</span>
                  <strong className="text-slate-900 text-sm">{fmtBytes(dbMetrics?.estimatedSizeBytes || 0)}</strong>
                </div>
              </div>
            </div>

            {/* Hapus Data Tarikan Form (Section 6b) */}
            <div className="border border-rose-200 bg-rose-50/50 rounded-xl p-3.5 space-y-3 text-xs">
              <div className="flex items-center gap-2 text-rose-700 font-bold">
                <Trash2 className="w-4 h-4" />
                <span>Hapus Data Tarikan Rentang Tanggal</span>
              </div>

              <p className="text-slate-600 leading-relaxed text-[11px]">
                Hanya menghapus data statistik harian (<code>daily_store_stats</code>) dan <code>kpi_cache</code> pada rentang:
                <br />
                <strong className="text-slate-900 font-mono">{startDate} s/d {endDate}</strong>.
              </p>

              <div className="p-2.5 bg-white rounded-lg border border-rose-200 text-emerald-800 text-[11px]">
                ✓ <strong>Jaminan Keamanan:</strong> Master toko (<code>stores</code>) dan penugasan AM/AC (<code>store_assignments</code>) <strong>TIDAK AKAN DISENTUH</strong>.
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={handleDeleteData}
                  disabled={isDeleting}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs transition-colors disabled:opacity-50 flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  {isDeleting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  <span>Hapus Data Tarikan ({startDate} s/d {endDate})</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200/80 py-4 mt-auto">
        <div className="max-w-[1520px] mx-auto px-4 sm:px-6 lg:px-8 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Rekap Pengguna Free WiFi Lawson • Tahap 2 Selesai</span>
          <span>Waktu Perhitungan: Asia/Jakarta (UTC+7)</span>
        </div>
      </footer>
    </div>
  );
}
