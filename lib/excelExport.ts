import ExcelJS from 'exceljs';
import {
  fmtBytes,
  fmtDuration,
  formatDateColumnHeader,
  formatMonthHeader,
  getShortMonthUpper,
  formatActivationDate,
  BASIS_SATUAN,
} from './constants';
import { isDateBeforeActivation } from './storeAssignments';

export interface ExportTableStoreRow {
  id: string;
  source: 'hypernet' | 'tachyon';
  source_key: string;
  display_name: string;
  kd_store: string;
  activation_date: string;
  active: boolean;
  am: string;
  ac: string;
  dateValues: Record<string, number>;
  sumMonth: number;
  avgMonth: number;
}

export interface ExportDailyStat {
  source: 'hypernet' | 'tachyon';
  source_key: string;
  date: string;
  users: number;
  upload_bytes: number | null;
  download_bytes: number | null;
  total_bytes: number;
  duration_seconds: number;
}

export interface ExportStoreInfo {
  id: string;
  source: 'hypernet' | 'tachyon';
  source_key: string;
  display_name: string;
  kd_store: string | null;
  activation_date: string | null;
  active: number;
}

export interface ExportKpiData {
  sumStore: number;
  newUsers: number | null | string;
  returningNewUsers: number | null | string;
  returningUsers: number | null | string;
  allUsers: number | null | string;
}

export interface ExportExcelParams {
  startDate: string;
  endDate: string;
  monthRef: string;
  monthPeriod: {
    startDate: string;
    endDate: string;
    daysCount: number;
  };
  selectedDates: string[];
  tableRows: ExportTableStoreRow[];
  totals: {
    dateTotals: Record<string, number>;
    totalSum: number;
    totalAvg: number;
  };
  kpi: ExportKpiData;
  stores: ExportStoreInfo[];
  stats: ExportDailyStat[];
  chartImageBase64?: string | null;
}

interface DashboardColumn {
  id: string;
  header: string;
  width: number;
  align: 'left' | 'center' | 'right';
  numFmt?: string;
  isDateCol?: boolean;
  isSumAvgCol?: boolean;
  getValue: (row: ExportTableStoreRow, idx: number) => string | number;
  getTotalValue: () => string | number;
}

/**
 * Membuat berkas Excel (.xlsx) dengan 2 sheet sesuai spesifikasi Section 8:
 * 1. Sheet "Dashboard": Judul, 5 Kartu KPI, Tabel rekap lengkap (angka sebagai angka, sel 0 kuning lembut), dan Gambar Chart.
 * 2. Sheet "Tarikan Mentahan": Blok harian berisi toko Hypernet lalu Tachyon, Users in org. dihitung ulang, data transfer & durasi terformat.
 */
export async function generateRekapExcelBlob(params: ExportExcelParams): Promise<Blob> {
  const {
    startDate,
    endDate,
    monthRef,
    monthPeriod,
    selectedDates,
    tableRows,
    totals,
    kpi,
    stores,
    stats,
    chartImageBase64,
  } = params;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Rekap Free WiFi Robot';
  workbook.lastModifiedBy = 'Rekap Free WiFi';
  workbook.created = new Date();
  workbook.modified = new Date();

  // Map toko untuk lookup display_name yang cepat
  const storeDisplayMap = new Map<string, string>();
  for (const st of stores) {
    storeDisplayMap.set(`${st.source}__${st.source_key}`, st.display_name || st.source_key);
  }

  // =========================================================================
  // SHEET 1: DASHBOARD
  // =========================================================================
  const wsDash = workbook.addWorksheet('Dashboard', {
    views: [{ showGridLines: true }],
  });

  // 1. Judul & Header Periode
  const fullMonthTitle = formatMonthHeader(monthRef);
  const shortMonthUpper = getShortMonthUpper(monthRef);

  wsDash.addRow([]); // Baris 1 kosong
  const titleRow = wsDash.addRow([`REKAP PENGGUNA AKSES FREE WIFI — LAWSON INDONESIA`]);
  titleRow.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF003366' } };

  const subTitleRow = wsDash.addRow([
    `Rentang Terpilih: ${startDate} s/d ${endDate} | Periode Bulanan: ${fullMonthTitle} (${monthPeriod.startDate} s/d ${monthPeriod.endDate}, ${monthPeriod.daysCount} hari) | Zona Waktu: Asia/Jakarta (UTC+7)`,
  ]);
  subTitleRow.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF475569' } };

  wsDash.addRow([]); // Baris 4 kosong

  // 2. Lima Kartu Ringkasan KPI (Baris 5 & 6)
  const cardHeaders = [
    'SUM STORE',
    'NEW USERS',
    'RETURNING NEW USERS',
    'RETURNING USERS',
    'ALL USERS',
  ];
  const cardValues = [
    kpi.sumStore ?? '-',
    kpi.newUsers ?? '-',
    kpi.returningNewUsers ?? '-',
    kpi.returningUsers ?? '-',
    kpi.allUsers ?? '-',
  ];
  const cardNotes = [
    'Toko Aktif',
    'Pengguna Unik',
    'Hypernet Unik',
    'Pengguna Unik',
    'Total Pengguna Unik',
  ];

  // Buat Kartu di Kolom B sampai F
  const cardHeaderRow = wsDash.addRow(['', ...cardHeaders]);
  const cardValueRow = wsDash.addRow(['', ...cardValues]);
  const cardNoteRow = wsDash.addRow(['', ...cardNotes]);

  cardHeaderRow.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF64748B' } };
  cardValueRow.font = { name: 'Calibri', size: 15, bold: true, color: { argb: 'FF0F172A' } };
  cardNoteRow.font = { name: 'Calibri', size: 8, italic: true, color: { argb: 'FF94A3B8' } };

  // Styling Card Borders & Background
  for (let c = 2; c <= 6; c++) {
    const hCell = cardHeaderRow.getCell(c);
    const vCell = cardValueRow.getCell(c);
    const nCell = cardNoteRow.getCell(c);

    hCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    vCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    nCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };

    hCell.alignment = { horizontal: 'center', vertical: 'middle' };
    vCell.alignment = { horizontal: 'center', vertical: 'middle' };
    nCell.alignment = { horizontal: 'center', vertical: 'middle' };

    hCell.border = { top: { style: 'thin', color: { argb: 'FFCBD5E1' } }, left: { style: 'thin', color: { argb: 'FFCBD5E1' } }, right: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
    vCell.border = { left: { style: 'thin', color: { argb: 'FFCBD5E1' } }, right: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
    nCell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } }, left: { style: 'thin', color: { argb: 'FFCBD5E1' } }, right: { style: 'thin', color: { argb: 'FFCBD5E1' } } };

    // Format angka jika numerik
    if (typeof vCell.value === 'number') {
      vCell.numFmt = '#,##0';
    }
  }

  wsDash.addRow([]); // Baris 8 kosong

  // 3. Tabel Rekap Utama Menggunakan Arsitektur SATU Kolom Terpadu (ColumnDef)
  // Menghitung lebar dinamis agar Organisation, AM, AC, dan label kartu tidak terpotong
  let maxOrgLen = 'Organisation'.length;
  let maxAmLen = Math.max('AM'.length, 'RETURNING NEW USERS'.length); // Col D / Col 4 houses Card 3
  let maxAcLen = Math.max('AC'.length, 'RETURNING USERS'.length);     // Col E / Col 5 houses Card 4
  for (const r of tableRows) {
    if (r.display_name && r.display_name.length > maxOrgLen) maxOrgLen = r.display_name.length;
    if (r.am && r.am.length > maxAmLen) maxAmLen = r.am.length;
    if (r.ac && r.ac.length > maxAcLen) maxAcLen = r.ac.length;
  }

  const columns: DashboardColumn[] = [
    {
      id: 'no',
      header: 'No.',
      width: 6,
      align: 'center',
      getValue: (_row, idx) => idx + 1,
      getTotalValue: () => '',
    },
    {
      id: 'kd_store',
      header: 'Kd Store',
      width: 12,
      align: 'center',
      getValue: (row) => row.kd_store || '-',
      getTotalValue: () => '',
    },
    {
      id: 'organisation',
      header: 'Organisation',
      width: Math.max(38, maxOrgLen + 3),
      align: 'left',
      getValue: (row) => row.display_name,
      getTotalValue: () => 'TOTAL',
    },
    {
      id: 'am',
      header: 'AM',
      width: Math.max(24, maxAmLen + 3),
      align: 'center',
      getValue: (row) => row.am || '-',
      getTotalValue: () => '',
    },
    {
      id: 'ac',
      header: 'AC',
      width: Math.max(32, maxAcLen + 3),
      align: 'center',
      getValue: (row) => row.ac || '-',
      getTotalValue: () => '',
    },
    {
      id: 'activation_date',
      header: 'Tanggal Aktivasi',
      width: 18,
      align: 'center',
      getValue: (row) => formatActivationDate(row.activation_date),
      getTotalValue: () => '',
    },
    ...selectedDates.map((d): DashboardColumn => ({
      id: `date_${d}`,
      header: formatDateColumnHeader(d),
      width: 13,
      align: 'right',
      numFmt: '#,##0',
      isDateCol: true,
      getValue: (row) => {
        // "-" hanya jika tanggal d sebelum activation_date (dibandingkan sebagai string ISO YYYY-MM-DD)
        if (isDateBeforeActivation(row.activation_date, d)) {
          return '-';
        }
        return row.dateValues[d] ?? 0;
      },
      getTotalValue: () => totals.dateTotals[d] ?? 0,
    })),
    {
      id: 'sumMonth',
      header: `SUM ${shortMonthUpper}`,
      width: 14,
      align: 'right',
      numFmt: '#,##0',
      isSumAvgCol: true,
      getValue: (row) => row.sumMonth,
      getTotalValue: () => totals.totalSum,
    },
    {
      id: 'avgMonth',
      header: `AVG ${shortMonthUpper}`,
      width: 14,
      align: 'right',
      numFmt: '#,##0',
      isSumAvgCol: true,
      getValue: (row) => row.avgMonth,
      getTotalValue: () => totals.totalAvg,
    },
  ];

  // Susun Header dari daftar kolom tunggal
  const headerRow = wsDash.addRow(columns.map((c) => c.header));
  headerRow.height = 26;
  headerRow.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };

  headerRow.eachCell((cell, colNumber) => {
    const colDef = columns[colNumber - 1];
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: colDef?.isSumAvgCol ? 'FF1E3A8A' : 'FF0F172A' },
    };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF334155' } },
      bottom: { style: 'medium', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF334155' } },
    };
  });

  // Susun Baris Data Toko dengan memetakan setiap sel lewat col.getValue
  tableRows.forEach((row, idx) => {
    const rowValues = columns.map((col) => col.getValue(row, idx));
    const excelRow = wsDash.addRow(rowValues);
    excelRow.height = 19;
    excelRow.font = { name: 'Calibri', size: 10, color: { argb: 'FF0F172A' } };

    excelRow.eachCell((cell, colNumber) => {
      const colDef = columns[colNumber - 1];

      // Border standar
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };

      if (cell.value === '-') {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF94A3B8' } };
      } else {
        cell.alignment = { horizontal: colDef?.align || 'left', vertical: 'middle' };
        if (colDef?.id === 'organisation') {
          cell.font = { name: 'Calibri', size: 10, bold: true };
        } else if (colDef?.numFmt && typeof cell.value === 'number') {
          cell.numFmt = colDef.numFmt;
        }

        // Aturan: Sel bernilai 0 pada kolom tanggal ditandai kuning lembut teks merah
        if (colDef?.isDateCol) {
          if (cell.value === 0) {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFFEF9C3' },
            };
            cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFDC2626' } };
          } else {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
          }
        }

        // Kolom SUM & AVG diberi aksen hijau lembut
        if (colDef?.isSumAvgCol) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF166534' } };
        }
      }
    });
  });

  // Baris Total di Bawah Tabel
  const totalRowValues = columns.map((col) => col.getTotalValue());
  const totalRow = wsDash.addRow(totalRowValues);
  totalRow.height = 22;
  totalRow.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };

  totalRow.eachCell((cell, colNumber) => {
    const colDef = columns[colNumber - 1];
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF1E40AF' } },
      bottom: { style: 'double', color: { argb: 'FF1E40AF' } },
      left: { style: 'thin', color: { argb: 'FF93C5FD' } },
      right: { style: 'thin', color: { argb: 'FF93C5FD' } },
    };

    cell.alignment = { horizontal: colDef?.align || 'left', vertical: 'middle' };
    if (colDef?.numFmt && typeof cell.value === 'number') {
      cell.numFmt = colDef.numFmt;
    }
  });

  // Terapkan Lebar Kolom dari Definisi Kolom
  columns.forEach((col, idx) => {
    wsDash.getColumn(idx + 1).width = col.width;
  });


  // 4. Sematkan Gambar Chart jika tersedia
  if (chartImageBase64) {
    try {
      const cleanBase64 = chartImageBase64.replace(/^data:image\/png;base64,/, '');
      const imageId = workbook.addImage({
        base64: cleanBase64,
        extension: 'png',
      });

      const startRow = totalRow.number + 3;
      wsDash.addImage(imageId, {
        tl: { col: 1, row: startRow },
        ext: { width: 950, height: 500 },
      });
    } catch (err) {
      console.warn('Gagal menyematkan gambar chart ke Excel:', err);
    }
  }

  // =========================================================================
  // MULTI-SHEET DATA MENTAH PER TANGGAL (Section 8)
  // Format Nama: "Data 01-Okt-2026", "Data 02-Okt-2026", dst.
  // Kolom: No. | Organisation | Users | Users in org. | Data transfer | Total sessions duration
  // Urutan: Hypernet terlebih dahulu, kemudian Tachyon
  // =========================================================================
  const visibleStoreIdSet = new Set(tableRows.map((r) => r.id));

  selectedDates.forEach((dateStr) => {
    const [y, m, d] = dateStr.split('-');
    const mIdx = parseInt(m, 10) - 1;
    const shortM = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des'][mIdx] || m;
    const sheetName = `Data ${d}-${shortM}-${y}`;

    const wsDate = workbook.addWorksheet(sheetName, {
      views: [{ showGridLines: true }],
    });

    // Raw sheet memuat SEMUA toko baik Tampil maupun Sembunyi
    const rawDateStats = stats.filter((s) => s.date === dateStr);
    const dateStats = rawDateStats;

    const dayTotalUsers = dateStats.reduce((acc, s) => acc + (s.users || 0), 0);
    const dayTotalBytes = dateStats.reduce((acc, s) => acc + (s.total_bytes || 0), 0);
    const dayTotalDuration = dateStats.reduce((acc, s) => acc + (s.duration_seconds || 0), 0);

    // Hypernet terlebih dahulu (users menurun), kemudian Tachyon (users menurun)
    const hypernetItems = dateStats
      .filter((s) => s.source === 'hypernet')
      .sort((a, b) => b.users - a.users);

    const tachyonItems = dateStats
      .filter((s) => s.source === 'tachyon')
      .sort((a, b) => b.users - a.users);

    const combinedItems = [...hypernetItems, ...tachyonItems];

    // Header Sheet Tanggal
    const dateTitleRow = wsDate.addRow([`DATA RAW FREE WIFI LAWSON — TANGGAL: ${d}-${shortM}-${y} (${dateStr})`]);
    dateTitleRow.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF003366' } };

    const dateSubRow = wsDate.addRow([
      `Total Toko: ${combinedItems.length} | Total Pengguna: ${dayTotalUsers.toLocaleString('id-ID')} | Basis Satuan: ${BASIS_SATUAN}`,
    ]);
    dateSubRow.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF64748B' } };
    wsDate.addRow([]);

    // Header Kolom Baku
    const colHeaderRow = wsDate.addRow([
      'No.',
      'Organisation',
      'Users',
      'Users in org.',
      'Data transfer',
      'Total sessions duration',
      'Total Bytes (Raw)',
      'Duration Seconds (Raw)',
      'Vendor',
    ]);
    colHeaderRow.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    colHeaderRow.height = 22;

    colHeaderRow.eachCell((cell, colIdx) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF004D99' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF003366' } },
        bottom: { style: 'medium', color: { argb: 'FF003366' } },
        left: { style: 'thin', color: { argb: 'FF334155' } },
        right: { style: 'thin', color: { argb: 'FF334155' } },
      };
    });

    // Isi Baris Data Toko
    combinedItems.forEach((item, idx) => {
      const displayName = storeDisplayMap.get(`${item.source}__${item.source_key}`) || item.source_key;
      const pct = dayTotalUsers > 0 ? (item.users / dayTotalUsers) * 100 : 0;
      const pctFormatted = `${pct.toFixed(1)} %`;
      const transferStr = fmtBytes(item.total_bytes, BASIS_SATUAN);
      const durStr = fmtDuration(item.duration_seconds);

      const r = wsDate.addRow([
        idx + 1,
        displayName,
        item.users,
        pctFormatted,
        transferStr,
        durStr,
        item.total_bytes,
        item.duration_seconds,
        item.source === 'hypernet' ? 'Hypernet' : 'Tachyon',
      ]);
      r.height = 19;
      r.font = { name: 'Calibri', size: 9, color: { argb: 'FF0F172A' } };

      r.eachCell((cell, colNum) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };

        if (colNum === 1) cell.alignment = { horizontal: 'center' };
        else if (colNum === 2) cell.alignment = { horizontal: 'left' };
        else if (colNum === 3) {
          cell.alignment = { horizontal: 'right' };
          cell.numFmt = '#,##0';
        } else if (colNum === 4 || colNum === 5 || colNum === 6) {
          cell.alignment = { horizontal: 'right' };
        } else if (colNum === 7 || colNum === 8) {
          cell.alignment = { horizontal: 'right' };
          cell.numFmt = '#,##0';
        } else if (colNum === 9) {
          cell.alignment = { horizontal: 'center' };
        }
      });
    });

    // Baris Total di Bawah Sheet
    const subtotalRow = wsDate.addRow([
      '',
      `TOTAL ${d}-${shortM}-${y}`,
      dayTotalUsers,
      '100.0 %',
      fmtBytes(dayTotalBytes, BASIS_SATUAN),
      fmtDuration(dayTotalDuration),
      dayTotalBytes,
      dayTotalDuration,
      '',
    ]);
    subtotalRow.height = 22;
    subtotalRow.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF0F172A' } };

    subtotalRow.eachCell((cell, colNum) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF1E40AF' } },
        bottom: { style: 'double', color: { argb: 'FF1E40AF' } },
        left: { style: 'thin', color: { argb: 'FF93C5FD' } },
        right: { style: 'thin', color: { argb: 'FF93C5FD' } },
      };
      if (colNum === 3 || colNum === 7 || colNum === 8) {
        cell.numFmt = '#,##0';
        cell.alignment = { horizontal: 'right' };
      } else if (colNum >= 4 && colNum <= 6) {
        cell.alignment = { horizontal: 'right' };
      }
    });

    // Lebar Kolom
    wsDate.getColumn(1).width = 6;  // No
    wsDate.getColumn(2).width = 38; // Organisation
    wsDate.getColumn(3).width = 12; // Users
    wsDate.getColumn(4).width = 14; // Users in org.
    wsDate.getColumn(5).width = 16; // Data transfer
    wsDate.getColumn(6).width = 24; // Duration
    wsDate.getColumn(7).width = 16; // Bytes Raw (tersembunyi)
    wsDate.getColumn(7).hidden = true;
    wsDate.getColumn(8).width = 16; // Seconds Raw (tersembunyi)
    wsDate.getColumn(8).hidden = true;
    wsDate.getColumn(9).width = 14; // Vendor (tersembunyi)
    wsDate.getColumn(9).hidden = true;
  });

  // Generate buffer & create Blob
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
