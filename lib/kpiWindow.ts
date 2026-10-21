import { getJakartaToday, getMonthPeriod } from './constants';

export interface KpiWindowResult {
  windowStart: string;
  windowEnd: string;
  isCrossMonth: boolean;
  label: string;
}

/**
 * Single Unified Helper: Aturan Jendela KPI (Bug 1)
 * Digunakan secara konsisten oleh:
 * - API /api/data/stats
 * - Dashboard Website (app/page.tsx)
 * - Salin Gambar & Unduh PNG (app/page.tsx)
 * - Ekspor Excel (lib/excelExport.ts)
 *
 * Aturan:
 * A. Rentang TIDAK lintas bulan (mis. 01-02 Okt, "Hari ini", "3 hari"):
 *    Dihitung dari TANGGAL 1 bulan itu sampai min(akhir bulan, tanggal data terakhir yang sudah ditarik untuk bulan itu, hari ini Asia/Jakarta).
 *    Contoh: data ditarik s/d 15 Okt, rentang dipilih 01-02 Okt -> jendela = 01 s/d 15 Okt.
 * B. Rentang LINTAS bulan (mis. 25 Sep - 3 Okt):
 *    Dihitung dari rentang yang dipilih persis (25 Sep - 3 Okt).
 */
export function computeKpiWindow(
  startDate: string,
  endDate: string,
  availableDates: string[] = [],
  todayJakartaOverride?: string
): KpiWindowResult {
  const startMonth = startDate.slice(0, 7); // YYYY-MM
  const endMonth = endDate.slice(0, 7);
  const isCrossMonth = startMonth !== endMonth;

  if (isCrossMonth) {
    return {
      windowStart: startDate,
      windowEnd: endDate,
      isCrossMonth: true,
      label: `${startDate} s/d ${endDate}`,
    };
  }

  // Rentang dalam 1 bulan yang sama
  const windowStart = `${startMonth}-01`;

  // Cari tanggal data harian terakhir yang ditarik untuk bulan tersebut
  const datesInMonth = availableDates
    .filter((d) => d.startsWith(startMonth))
    .sort();
  const latestDateInMonth = datesInMonth.length > 0 ? datesInMonth[datesInMonth.length - 1] : null;

  // Tanggal akhir bulan kalender
  const monthPeriod = getMonthPeriod(startMonth);
  const monthEnd = monthPeriod.endDate;

  // Hari ini di Asia/Jakarta
  const todayJakarta = todayJakartaOverride || getJakartaToday();

  // Kandidat batas akhir: akhir bulan, hari ini (jika bulan berjalan), tanggal data terakhir ditarik
  const candidates: string[] = [monthEnd];
  if (todayJakarta.startsWith(startMonth)) {
    candidates.push(todayJakarta);
  }
  if (latestDateInMonth) {
    candidates.push(latestDateInMonth);
  }

  // Ambil tanggal terkecil (paling awal) dari kandidat
  candidates.sort();
  const windowEnd = candidates[0];

  return {
    windowStart,
    windowEnd,
    isCrossMonth: false,
    label: `${windowStart} s/d ${windowEnd}`,
  };
}
