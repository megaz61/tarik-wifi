'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import {
  Store,
  Wifi,
  Search,
  CheckCircle2,
  AlertCircle,
  Copy,
  Calendar,
  Lock,
  LogOut,
  RefreshCw,
  Sparkles,
  ArrowRight,
  Database,
  Filter,
  SlidersHorizontal,
  ChevronDown,
  Info,
  Eye,
  EyeOff,
  ShieldCheck,
} from 'lucide-react';
import { formatMonthHeader, getJakartaToday } from '@/lib/constants';

interface StoreItem {
  id: string;
  source: 'hypernet' | 'tachyon';
  source_key: string;
  display_name: string;
  kd_store: string | null;
  activation_date: string | null;
  active: number;
  is_visible: number; // 1 = tampil, 0 = sembunyi
  is_new_flag: number;
}

interface StoreAssignment {
  store_id: string;
  month: string;
  am: string | null;
  ac: string | null;
}

interface SystemStatus {
  authenticated: boolean;
  dbMode: 'turso' | 'supabase' | 'local_sqlite';
}

const REF_KD_STORES = new Set([
  '6A19', '6A0W', '6A6E', '6A8E', '6A6J', '6A6C', '6A3A', '6A8A', '6A3H', '6AAC',
  '6A23', '6A9Z', '6A44', '6A5G', '6A20', '6A08', '6A8U', '6A70', '6AAJ', '6A39',
  '6A9V', '6A96', '6A54', '6AAI', '6A1F', '6A03', '6AAM',
]);

export default function MasterTokoPage() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  // Month selector for assignments
  const [today, setToday] = useState('2026-10-10');
  useEffect(() => {
    setToday(getJakartaToday());
  }, []);
  const [selectedMonth, setSelectedMonth] = useState('2026-10');

  // Stores & Assignments Data
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [assignments, setAssignments] = useState<Record<string, StoreAssignment>>({});
  const [loadingData, setLoadingData] = useState(true);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'hypernet' | 'tachyon'>('all');
  const [onlyNew, setOnlyNew] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'visible' | 'hidden'>('all');

  // Modal Pengaturan Tampilan Toko (Section 5)
  const [showVisibilityModal, setShowVisibilityModal] = useState(false);
  const [visibilityModalSearch, setVisibilityModalSearch] = useState('');
  const [isBatchUpdating, setIsBatchUpdating] = useState(false);

  // Autosave status per store & assignment
  // key: storeId, value: 'saving' | 'saved' | 'idle' | 'error'
  const [saveStatusMap, setSaveStatusMap] = useState<Record<string, 'saving' | 'saved' | 'error'>>({});

  // Copy previous month modal
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [prevMonthToCopy, setPrevMonthToCopy] = useState('');
  const [isCopying, setIsCopying] = useState(false);

  // Toast notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Compute previous month of selectedMonth
  useEffect(() => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(y, m - 1, 0); // last day of prev month
    const prevM = String(d.getMonth() + 1).padStart(2, '0');
    setPrevMonthToCopy(`${d.getFullYear()}-${prevM}`);
  }, [selectedMonth]);

  // Load Status
  useEffect(() => {
    fetch('/api/auth/status')
      .then((res) => res.json())
      .then((data) => {
        setStatus(data);
        if (data.authenticated) {
          loadStoresData(selectedMonth);
        }
      })
      .catch(console.error)
      .finally(() => setLoadingStatus(false));
  }, []);

  const loadStoresData = async (month: string) => {
    setLoadingData(true);
    try {
      const res = await fetch(`/api/stores?month=${month}`);
      const data = await res.json();
      if (data.success) {
        setStores(data.stores || []);
        setAssignments(data.assignments || {});
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingData(false);
    }
  };

  // Handle month change
  const handleMonthChange = (newMonth: string) => {
    setSelectedMonth(newMonth);
    loadStoresData(newMonth);
  };

  // Debounced Autosave for Store Fields
  const saveTimeoutRef = useRef<Record<string, NodeJS.Timeout>>({});

  const triggerStoreUpdate = (id: string, fields: Partial<StoreItem>) => {
    // 1. Update state locally
    setStores((prev) =>
      prev.map((st) => (st.id === id ? { ...st, ...fields } : st))
    );

    // 2. Mark as saving
    setSaveStatusMap((prev) => ({ ...prev, [id]: 'saving' }));

    // 3. Clear existing timer for this store
    if (saveTimeoutRef.current[id]) {
      clearTimeout(saveTimeoutRef.current[id]);
    }

    // 4. Set debounce timer (500ms)
    saveTimeoutRef.current[id] = setTimeout(async () => {
      try {
        const res = await fetch('/api/stores', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, fields }),
        });
        const data = await res.json();
        if (data.success) {
          setSaveStatusMap((prev) => ({ ...prev, [id]: 'saved' }));
          setTimeout(() => {
            setSaveStatusMap((prev) => {
              const next = { ...prev };
              delete next[id];
              return next;
            });
          }, 2000);
        } else {
          setSaveStatusMap((prev) => ({ ...prev, [id]: 'error' }));
        }
      } catch {
        setSaveStatusMap((prev) => ({ ...prev, [id]: 'error' }));
      }
    }, 500);
  };

  // Debounced Autosave for AM / AC assignment
  const assignmentTimeoutRef = useRef<Record<string, NodeJS.Timeout>>({});

  const triggerAssignmentUpdate = (storeId: string, field: 'am' | 'ac', value: string) => {
    // 1. Update state locally
    setAssignments((prev) => {
      const existing = prev[storeId] || {
        store_id: storeId,
        month: selectedMonth,
        am: null,
        ac: null,
      };
      return {
        ...prev,
        [storeId]: {
          ...existing,
          [field]: value.trim() ? value.trim() : null,
        },
      };
    });

    const assignKey = `asg__${storeId}`;
    setSaveStatusMap((prev) => ({ ...prev, [assignKey]: 'saving' }));

    if (assignmentTimeoutRef.current[assignKey]) {
      clearTimeout(assignmentTimeoutRef.current[assignKey]);
    }

    assignmentTimeoutRef.current[assignKey] = setTimeout(async () => {
      try {
        const currentAsg = assignments[storeId] || {};
        const amVal = field === 'am' ? value.trim() || null : currentAsg.am || null;
        const acVal = field === 'ac' ? value.trim() || null : currentAsg.ac || null;

        const res = await fetch('/api/stores', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'assign',
            store_id: storeId,
            month: selectedMonth,
            am: amVal,
            ac: acVal,
          }),
        });
        const data = await res.json();
        if (data.success) {
          setSaveStatusMap((prev) => ({ ...prev, [assignKey]: 'saved' }));
          setTimeout(() => {
            setSaveStatusMap((prev) => {
              const next = { ...prev };
              delete next[assignKey];
              return next;
            });
          }, 2000);
        } else {
          setSaveStatusMap((prev) => ({ ...prev, [assignKey]: 'error' }));
        }
      } catch {
        setSaveStatusMap((prev) => ({ ...prev, [assignKey]: 'error' }));
      }
    }, 500);
  };

  // Copy from Previous Month Execution
  const handleCopyFromPreviousMonth = async () => {
    setIsCopying(true);
    try {
      const res = await fetch('/api/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'copy_prev',
          targetMonth: selectedMonth,
          sourceMonth: prevMonthToCopy,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'Berhasil menyalin penugasan AM/AC.');
        setShowCopyModal(false);
        loadStoresData(selectedMonth);
      } else {
        alert(data.error || 'Gagal menyalin penugasan.');
      }
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setIsCopying(false);
    }
  };

  const handleApplyRef27 = async () => {
    if (!confirm('Terapkan acuan 27 toko? 27 Toko acuan akan ditampilkan dan toko lainnya akan disembunyikan.')) return;
    setIsBatchUpdating(true);
    try {
      const res = await fetch('/api/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'seed_ref27', month: selectedMonth }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'Berhasil menerapkan 27 toko acuan.');
        loadStoresData(selectedMonth);
      } else {
        alert(data.error || 'Gagal menerapkan toko acuan.');
      }
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setIsBatchUpdating(false);
    }
  };

  const handleSetAllVisibility = async (visible: boolean) => {
    const actionText = visible ? 'menampilkan semua' : 'menyembunyikan semua';
    if (!confirm(`Apakah Anda yakin ingin ${actionText} toko di sistem?`)) return;
    setIsBatchUpdating(true);
    try {
      const res = await fetch('/api/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_all_visibility', is_visible: visible ? 1 : 0 }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'Visibilitas toko berhasil diperbarui.');
        loadStoresData(selectedMonth);
      } else {
        alert(data.error || 'Gagal memperbarui visibilitas.');
      }
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setIsBatchUpdating(false);
    }
  };

  // Filtered Stores List
  const filteredStores = useMemo(() => {
    return stores.filter((st) => {
      // Source filter
      if (sourceFilter !== 'all' && st.source !== sourceFilter) return false;

      // Status filter
      if (statusFilter === 'active' && st.active !== 1) return false;
      if (statusFilter === 'inactive' && st.active === 1) return false;

      // Visibility filter (Section 5)
      if (visibilityFilter === 'visible' && st.is_visible !== 1) return false;
      if (visibilityFilter === 'hidden' && st.is_visible === 1) return false;

      // Only new filter
      if (onlyNew && st.is_new_flag !== 1) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const asg = assignments[st.id];
        const matchName = st.display_name.toLowerCase().includes(q);
        const matchSourceKey = st.source_key.toLowerCase().includes(q);
        const matchKd = (st.kd_store || '').toLowerCase().includes(q);
        const matchAm = (asg?.am || '').toLowerCase().includes(q);
        const matchAc = (asg?.ac || '').toLowerCase().includes(q);
        if (!matchName && !matchSourceKey && !matchKd && !matchAm && !matchAc) {
          return false;
        }
      }

      return true;
    });
  }, [stores, assignments, sourceFilter, statusFilter, visibilityFilter, onlyNew, searchQuery]);

  // Statistics Count
  const statsSummary = useMemo(() => {
    const total = stores.length;
    const active = stores.filter((s) => s.active === 1).length;
    const inactive = total - active;
    const visibleCount = stores.filter((s) => s.is_visible === 1).length;
    const hiddenCount = total - visibleCount;
    const newCount = stores.filter((s) => s.is_new_flag === 1).length;
    const assignedCount = stores.filter((s) => {
      const asg = assignments[s.id];
      return Boolean(asg?.am || asg?.ac);
    }).length;

    return { total, active, inactive, visibleCount, hiddenCount, newCount, assignedCount };
  }, [stores, assignments]);

  if (loadingStatus) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-slate-600 font-medium">Memuat Master Toko...</p>
        </div>
      </div>
    );
  }

  if (!status?.authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-sm w-full text-center space-y-4">
          <Lock className="w-10 h-10 text-rose-500 mx-auto" />
          <h2 className="text-lg font-bold text-slate-900">Sesi Belum Terotentikasi</h2>
          <p className="text-xs text-slate-500">
            Silakan masukkan kode akses di halaman utama sebelum mengakses Master Toko.
          </p>
          <Link
            href="/"
            className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold"
          >
            Menuju Halaman Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/70 flex flex-col font-sans text-slate-800">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white text-xs px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Navbar with Tab Navigation */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-2xs">
        <div className="max-w-[1520px] mx-auto px-3 sm:px-6 lg:px-8 h-auto py-2.5 sm:h-16 sm:py-0 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2">
          {/* Logo & Brand */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 sm:w-9 sm:h-9 bg-blue-600 text-white rounded-xl flex items-center justify-center shadow-xs shrink-0">
              <Store className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-sm sm:text-base font-bold text-slate-900 leading-tight">Master Toko Lawson</h1>
                <span className="hidden sm:inline px-2 py-0.5 text-[11px] font-semibold bg-emerald-100 text-emerald-800 rounded-md">
                  Autosave Aktif
                </span>
              </div>
              <p className="text-[11px] text-slate-500 hidden sm:block">
                Kelola Nama Tampilan, Kd Store, Aktivasi, &amp; Penugasan AM/AC Bulanan
              </p>
            </div>
          </div>

          {/* Navigation Tabs between Dashboard & Master Toko */}
          <div className="flex items-center gap-2 order-3 sm:order-none w-full sm:w-auto">
            <nav className="flex-1 sm:flex-none flex items-center bg-slate-100 p-0.5 sm:p-1 rounded-xl border border-slate-200/80">
              <Link
                href="/"
                className="flex-1 sm:flex-none text-center px-2.5 sm:px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-lg transition-colors flex items-center justify-center gap-1.5"
              >
                <Wifi className="w-3.5 h-3.5" />
                <span>Dashboard</span>
              </Link>
              <span className="flex-1 sm:flex-none text-center px-2.5 sm:px-3.5 py-1.5 text-xs font-bold bg-white text-blue-700 shadow-xs rounded-lg flex items-center justify-center gap-1.5">
                <Store className="w-3.5 h-3.5" />
                <span>Master Toko</span>
              </span>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1520px] mx-auto px-4 sm:px-6 lg:px-8 py-5 flex-1 w-full space-y-5">
        {/* ACTION BAR: Month Selector & AM/AC Copy Feature */}
        <section className="bg-white border border-slate-200/90 rounded-2xl p-3 sm:p-5 shadow-xs space-y-3 sm:space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4">
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-base sm:text-xl font-extrabold text-slate-900 tracking-tight">
                  Pengaturan Toko
                </h2>
                <span className="text-xs font-semibold px-2.5 py-1 bg-blue-50 text-blue-700 border border-blue-200/60 rounded-full">
                  {formatMonthHeader(selectedMonth)}
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5 sm:mt-1">
                Semua perubahan otomatis tersimpan (autosave). Struktur AM/AC disimpan <strong>per bulan</strong>.
              </p>
            </div>

            {/* Month Selector, Visibility Setting & Copy Button */}
            <div className="grid grid-cols-1 sm:grid-cols-3 lg:flex lg:flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 text-xs">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span className="font-semibold text-slate-600">Bulan:</span>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => e.target.value && handleMonthChange(e.target.value)}
                  className="bg-transparent font-bold text-slate-900 focus:outline-none cursor-pointer flex-1"
                />
              </div>

              <button
                type="button"
                onClick={() => setShowVisibilityModal(true)}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold rounded-xl text-xs shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                title="Atur toko mana saja yang ditampilkan di Dashboard, Ekspor, dan Grafik"
              >
                <Eye className="w-3.5 h-3.5 text-blue-100" />
                <span>Tampilan Toko ({statsSummary.visibleCount})</span>
              </button>

              <button
                type="button"
                onClick={() => setShowCopyModal(true)}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-900 active:bg-black text-white font-semibold rounded-xl text-xs shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                title="Salin semua penugasan AM & AC dari bulan sebelumnya"
              >
                <Copy className="w-3.5 h-3.5 text-slate-300" />
                <span>Salin Bulan Sebelumnya</span>
              </button>
            </div>
          </div>

          {/* Quick Metrics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-3 border-t border-slate-100 text-xs">
            <div className="bg-slate-50/70 p-3 rounded-xl border border-slate-200/60">
              <span className="text-slate-500 font-medium text-[11px] block">Total Toko</span>
              <strong className="text-base text-slate-900">{statsSummary.total}</strong> toko
            </div>

            <div className="bg-emerald-50/50 p-3 rounded-xl border border-emerald-200/60">
              <span className="text-emerald-700 font-medium text-[11px] block">Ditampilkan di Dashboard</span>
              <strong className="text-base text-emerald-800">{statsSummary.visibleCount}</strong> toko
            </div>

            <div className="bg-slate-100/70 p-3 rounded-xl border border-slate-200/60">
              <span className="text-slate-500 font-medium text-[11px] block">Disembunyikan</span>
              <strong className="text-base text-slate-600">{statsSummary.hiddenCount}</strong> toko
            </div>

            <div className="bg-amber-50/50 p-3 rounded-xl border border-amber-200/60">
              <span className="text-amber-800 font-medium text-[11px] block">Toko Baru (Perlu Dilengkapi)</span>
              <strong className="text-base text-amber-900">{statsSummary.newCount}</strong> toko
            </div>

            <div className="bg-blue-50/40 p-3 rounded-xl border border-blue-200/60">
              <span className="text-blue-700 font-medium text-[11px] block">Terisi AM/AC ({formatMonthHeader(selectedMonth)})</span>
              <strong className="text-base text-blue-800">{statsSummary.assignedCount}</strong> toko
            </div>
          </div>
        </section>

        {/* MASTER TOKO TABLE SECTION */}
        <section className="bg-white border border-slate-200/90 rounded-2xl shadow-xs overflow-hidden">
          {/* Filter & Search Bar */}
          <div className="p-3 sm:p-4 border-b border-slate-100 flex flex-col gap-2.5 text-xs">
            {/* Search Input & Dropdowns */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2">
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari toko / kode / AM / AC..."
                  className="w-full sm:w-64 pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
              </div>

              <div className="grid grid-cols-2 sm:flex gap-2">
                {/* Filter Sumber */}
                <select
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value as any)}
                  className="w-full sm:w-auto px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                >
                  <option value="all">Semua Sumber</option>
                  <option value="hypernet">Hypernet</option>
                  <option value="tachyon">Tachyon</option>
                </select>

                {/* Filter Status Aktif */}
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="w-full sm:w-auto px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                >
                  <option value="all">Semua Status</option>
                  <option value="active">Aktif</option>
                  <option value="inactive">Nonaktif</option>
                </select>
              </div>

              <div className="grid grid-cols-2 sm:flex gap-2">
                {/* Filter Visibilitas */}
                <select
                  value={visibilityFilter}
                  onChange={(e) => setVisibilityFilter(e.target.value as any)}
                  className="w-full sm:w-auto px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer font-medium"
                >
                  <option value="all">Semua Visibilitas ({statsSummary.total})</option>
                  <option value="visible">Tampil ({statsSummary.visibleCount})</option>
                  <option value="hidden">Tersembunyi ({statsSummary.hiddenCount})</option>
                </select>

                {/* Toggle Hanya Toko Baru */}
                <label className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={onlyNew}
                    onChange={(e) => setOnlyNew(e.target.checked)}
                    className="w-3.5 h-3.5 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                  />
                  <span className="text-slate-700 font-semibold text-[11px]">Toko Baru ({statsSummary.newCount})</span>
                </label>
              </div>
            </div>

            <div className="text-slate-500 text-[11px] font-medium">
              Menampilkan <strong className="text-slate-900">{filteredStores.length}</strong> dari {stores.length} toko
            </div>
          </div>

          {/* Table Container */}
          <div className="overflow-x-auto max-h-[720px] relative">
            <table className="w-full text-left text-xs text-slate-700 border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[11px] sticky top-0 z-20 shadow-2xs">
                <tr>
                  <th scope="col" className="py-3 px-3 w-12 text-center">
                    No
                  </th>
                  <th scope="col" className="py-3 px-3 w-24">
                    Sumber
                  </th>
                  <th scope="col" className="py-3 px-4 min-w-[200px] max-w-[260px]">
                    Nama Asli (Read-Only)
                  </th>
                  <th scope="col" className="py-3 px-4 min-w-[280px]">
                    Nama Tampilan (Bebas Diubah)
                  </th>
                  <th scope="col" className="py-3 px-3 w-32">
                    Kd Store
                  </th>
                  <th scope="col" className="py-3 px-3 w-36">
                    Tgl Aktivasi
                  </th>
                  <th scope="col" className="py-3 px-3 w-20 text-center">
                    Status
                  </th>
                  <th scope="col" className="py-3 px-3 w-28 text-center">
                    Tampilan
                  </th>
                  <th scope="col" className="py-3 px-3 w-32 bg-blue-50/40 text-blue-900 border-l border-slate-200">
                    AM ({selectedMonth.slice(-2)})
                  </th>
                  <th scope="col" className="py-3 px-3 w-32 bg-blue-50/40 text-blue-900 border-l border-slate-200">
                    AC ({selectedMonth.slice(-2)})
                  </th>
                  <th scope="col" className="py-3 px-3 w-28 text-center">
                    Status Simpan
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredStores.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-12 text-center text-slate-400">
                      {loadingData ? (
                        <div className="flex items-center justify-center gap-2">
                          <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
                          <span>Memuat master toko...</span>
                        </div>
                      ) : (
                        'Tidak ada toko yang sesuai dengan filter pencarian.'
                      )}
                    </td>
                  </tr>
                ) : (
                  filteredStores.map((st, idx) => {
                    const asg = assignments[st.id] || { am: '', ac: '' };
                    const storeSaveState = saveStatusMap[st.id];
                    const asgSaveState = saveStatusMap[`asg__${st.id}`];

                    return (
                      <tr
                        key={st.id}
                        className={`hover:bg-slate-50/80 transition-colors ${st.active === 0 ? 'bg-slate-50/50 text-slate-400' : 'bg-white'
                          }`}
                      >
                        {/* No */}
                        <td className="py-3 px-3 text-center font-mono text-slate-400 text-xs">
                          {idx + 1}
                        </td>

                        {/* Sumber */}
                        <td className="py-3 px-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${st.source === 'hypernet'
                                ? 'bg-sky-100 text-sky-800'
                                : 'bg-indigo-100 text-indigo-800'
                              }`}
                          >
                            {st.source}
                          </span>
                        </td>

                        {/* Nama Asli (Read-Only) */}
                        <td className="py-3 px-4 font-mono text-slate-600 text-[11px] truncate max-w-[260px]" title={st.source_key}>
                          <div className="flex items-center gap-1.5">
                            <span className="truncate">{st.source_key}</span>
                            {st.kd_store && REF_KD_STORES.has(st.kd_store.toUpperCase()) && (
                              <span className="text-[10px] px-1.5 py-0.2 bg-blue-100 text-blue-800 rounded font-bold shrink-0">
                                27 Acuan
                              </span>
                            )}
                            {st.is_new_flag === 1 && (
                              <span className="text-[10px] px-1 py-0.2 bg-amber-100 text-amber-800 rounded font-bold shrink-0">
                                Baru
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Nama Tampilan (Inline Editable) */}
                        <td className="py-2.5 px-4">
                          <div className="relative">
                            <input
                              type="text"
                              value={st.display_name}
                              onChange={(e) => triggerStoreUpdate(st.id, { display_name: e.target.value })}
                              placeholder="Nama tampilan toko..."
                              className="w-full px-2.5 py-1.5 bg-slate-50/80 hover:bg-white focus:bg-white border border-slate-300 rounded-lg text-slate-900 font-semibold text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                            />
                            {st.is_new_flag === 1 && (
                              <button
                                type="button"
                                onClick={() => triggerStoreUpdate(st.id, { is_new_flag: 0 })}
                                className="mt-1 text-[10px] text-amber-700 hover:text-amber-900 font-medium underline flex items-center gap-0.5 cursor-pointer"
                                title="Hapus label baru setelah data lengkap"
                              >
                                Tandai Selesai Dilengkapi
                              </button>
                            )}
                          </div>
                        </td>

                        {/* Kd Store (Inline Editable) */}
                        <td className="py-2.5 px-3">
                          <input
                            type="text"
                            value={st.kd_store || ''}
                            onChange={(e) => triggerStoreUpdate(st.id, { kd_store: e.target.value ? e.target.value : null })}
                            placeholder="Kd Store..."
                            className="w-full px-2 py-1.5 bg-slate-50/80 hover:bg-white focus:bg-white border border-slate-300 rounded-lg text-slate-800 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </td>

                        {/* Tanggal Aktivasi (Inline Date Input) */}
                        <td className="py-2.5 px-3">
                          <input
                            type="date"
                            value={st.activation_date || ''}
                            onChange={(e) => triggerStoreUpdate(st.id, { activation_date: e.target.value ? e.target.value : null })}
                            className="w-full px-2 py-1.5 bg-slate-50/80 hover:bg-white focus:bg-white border border-slate-300 rounded-lg text-slate-800 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                          />
                        </td>

                        {/* Status Aktif Switch */}
                        <td className="py-2.5 px-3 text-center">
                          <label className="inline-flex items-center cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={st.active === 1}
                              onChange={(e) => triggerStoreUpdate(st.id, { active: e.target.checked ? 1 : 0 })}
                              className="sr-only peer"
                            />
                            <div className="w-8 h-4.5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-emerald-600 relative"></div>
                          </label>
                        </td>

                        {/* Visibilitas / Tampilan Switch */}
                        <td className="py-2.5 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => triggerStoreUpdate(st.id, { is_visible: st.is_visible === 1 ? 0 : 1 })}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${st.is_visible === 1
                                ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                                : 'bg-slate-100 text-slate-500 hover:bg-slate-200 border border-slate-200'
                              }`}
                            title={st.is_visible === 1 ? 'Klik untuk sembunyikan dari Dashboard' : 'Klik untuk tampilkan di Dashboard'}
                          >
                            {st.is_visible === 1 ? (
                              <>
                                <Eye className="w-3.5 h-3.5 text-emerald-600" />
                                <span>Tampil</span>
                              </>
                            ) : (
                              <>
                                <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                                <span>Sembunyi</span>
                              </>
                            )}
                          </button>
                        </td>

                        {/* AM Bulanan */}
                        <td className="py-2.5 px-3 bg-blue-50/20 border-l border-slate-200">
                          <input
                            type="text"
                            value={asg?.am || ''}
                            onChange={(e) => triggerAssignmentUpdate(st.id, 'am', e.target.value)}
                            placeholder="Nama AM..."
                            className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-800 font-medium text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </td>

                        {/* AC Bulanan */}
                        <td className="py-2.5 px-3 bg-blue-50/20 border-l border-slate-200">
                          <input
                            type="text"
                            value={asg?.ac || ''}
                            onChange={(e) => triggerAssignmentUpdate(st.id, 'ac', e.target.value)}
                            placeholder="Nama AC..."
                            className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-800 font-medium text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </td>

                        {/* Save Feedback Indicator */}
                        <td className="py-3 px-3 text-center text-[11px] font-medium">
                          {storeSaveState === 'saving' || asgSaveState === 'saving' ? (
                            <span className="text-blue-600 flex items-center justify-center gap-1">
                              <RefreshCw className="w-3 h-3 animate-spin" />
                              <span>Simpan</span>
                            </span>
                          ) : storeSaveState === 'saved' || asgSaveState === 'saved' ? (
                            <span className="text-emerald-600 flex items-center justify-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Tersimpan</span>
                            </span>
                          ) : storeSaveState === 'error' || asgSaveState === 'error' ? (
                            <span className="text-rose-600 flex items-center justify-center gap-1">
                              <AlertCircle className="w-3.5 h-3.5" />
                              <span>Gagal</span>
                            </span>
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Footer Legend */}
          <div className="p-3.5 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <Info className="w-4 h-4 text-slate-400" />
              <span>
                Nama tampilan hanya mengubah tampilan, ekspor, dan gambar. Penarikan data tetap memakai nama asli.
              </span>
            </span>
            <span className="text-[11px] font-mono text-slate-400">
              Total {stores.length} toko terdaftar di tabel stores
            </span>
          </div>
        </section>
      </main>

      {/* MODAL: SALIN DARI BULAN SEBELUMNYA */}
      {showCopyModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-base">
                <Copy className="w-5 h-5 text-blue-600" />
                <span>Salin Penugasan AM &amp; AC</span>
              </div>
              <button
                type="button"
                onClick={() => setShowCopyModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-600 leading-relaxed">
              <p>
                Fitur ini akan menyalin seluruh data AM dan AC dari bulan sumber ke bulan target, sehingga Anda hanya perlu mengedit toko yang mengalami perubahan personil.
              </p>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div>
                  <span className="text-slate-400 text-[11px] block">Bulan Sumber (Yang Disalin):</span>
                  <input
                    type="month"
                    value={prevMonthToCopy}
                    onChange={(e) => setPrevMonthToCopy(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-800 font-bold text-xs mt-1"
                  />
                </div>

                <div className="pt-1">
                  <span className="text-slate-400 text-[11px] block">Bulan Target (Tujuan):</span>
                  <strong className="text-sm font-bold text-blue-700 block mt-0.5">
                    {formatMonthHeader(selectedMonth)} ({selectedMonth})
                  </strong>
                </div>
              </div>

              <div className="p-2.5 bg-emerald-50 text-emerald-800 rounded-lg border border-emerald-200 text-[11px]">
                ✓ <strong>Bulan Lama Tidak Berubah:</strong> Setelah disalin, penugasan bulan {prevMonthToCopy} tetap aman dan tidak akan terpengaruh jika bulan {selectedMonth} diedit.
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowCopyModal(false)}
                disabled={isCopying}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleCopyFromPreviousMonth}
                disabled={isCopying}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition-colors disabled:opacity-50 flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                {isCopying ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
                <span>Salin ke {selectedMonth}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: PENGATURAN TAMPILAN TOKO (VISIBILITAS) */}
      {showVisibilityModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-base">
                <Eye className="w-5 h-5 text-blue-600" />
                <span>Pengaturan Tampilan Toko (Dashboard &amp; Ekspor)</span>
              </div>
              <button
                type="button"
                onClick={() => setShowVisibilityModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-600 leading-relaxed shrink-0">
              <p>
                Toko yang ditandai <strong>Tampil</strong> akan muncul di tabel Dashboard, Grafik, dan Ekspor Excel. Toko yang <strong>Disembunyikan</strong> tetap tersimpan di database lokal namun tidak mengacaukan tampilan laporan.
              </p>

              {/* Quick Batch Actions */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={isBatchUpdating}
                  onClick={handleApplyRef27}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Terapkan 27 Toko Acuan</span>
                </button>
                <button
                  type="button"
                  disabled={isBatchUpdating}
                  onClick={() => handleSetAllVisibility(true)}
                  className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-semibold rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Tampilkan Semua ({stores.length})</span>
                </button>
                <button
                  type="button"
                  disabled={isBatchUpdating}
                  onClick={() => handleSetAllVisibility(false)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 font-semibold rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <EyeOff className="w-3.5 h-3.5 text-slate-500" />
                  <span>Sembunyikan Semua</span>
                </button>
              </div>

              {/* Search Inside Modal */}
              <div className="relative pt-1">
                <input
                  type="text"
                  value={visibilityModalSearch}
                  onChange={(e) => setVisibilityModalSearch(e.target.value)}
                  placeholder="Cari nama toko / kode toko dalam modal..."
                  className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-3.5 pointer-events-none" />
              </div>
            </div>

            {/* Store Checkbox List */}
            <div className="overflow-y-auto flex-1 border border-slate-200 rounded-xl divide-y divide-slate-100 p-1 min-h-[240px]">
              {stores
                .filter((st) => {
                  if (!visibilityModalSearch.trim()) return true;
                  const q = visibilityModalSearch.toLowerCase();
                  return (
                    st.display_name.toLowerCase().includes(q) ||
                    st.source_key.toLowerCase().includes(q) ||
                    (st.kd_store || '').toLowerCase().includes(q)
                  );
                })
                .map((st) => {
                  const isRef = Boolean(st.kd_store && REF_KD_STORES.has(st.kd_store.toUpperCase()));
                  return (
                    <label
                      key={st.id}
                      className="flex items-center justify-between p-2.5 hover:bg-slate-50 rounded-lg cursor-pointer transition-colors text-xs select-none"
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={st.is_visible === 1}
                          onChange={(e) => triggerStoreUpdate(st.id, { is_visible: e.target.checked ? 1 : 0 })}
                          className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900">{st.display_name}</span>
                            {isRef && (
                              <span className="px-1.5 py-0.2 bg-blue-100 text-blue-800 rounded text-[10px] font-bold">
                                27 Acuan
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                            <span className="font-mono text-slate-400">{st.kd_store || 'Tanpa Kode'}</span>
                            <span>•</span>
                            <span className="uppercase text-[10px] font-bold text-slate-600">{st.source}</span>
                            <span>•</span>
                            <span className="font-mono text-[10px] text-slate-400 truncate max-w-[200px]">{st.source_key}</span>
                          </div>
                        </div>
                      </div>

                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${st.is_visible === 1
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-500'
                          }`}
                      >
                        {st.is_visible === 1 ? 'Ditampilkan' : 'Disembunyikan'}
                      </span>
                    </label>
                  );
                })}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-100 shrink-0">
              <span className="text-xs text-slate-500 font-medium">
                Aktif: <strong className="text-emerald-700">{statsSummary.visibleCount}</strong> dari {statsSummary.total} toko
              </span>
              <button
                type="button"
                onClick={() => {
                  setShowVisibilityModal(false);
                  showToast('Pengaturan tampilan toko tersimpan.');
                }}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer shadow-xs"
              >
                Selesai
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-4 mt-auto">
        <div className="max-w-[1520px] mx-auto px-4 sm:px-6 lg:px-8 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Rekap Pengguna Free WiFi Lawson • Master Toko</span>
          <span>Zona Waktu: Asia/Jakarta (UTC+7)</span>
        </div>
      </footer>
    </div>
  );
}
