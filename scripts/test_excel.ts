import { generateRekapExcelBlob } from '../lib/excelExport';
import ExcelJS from 'exceljs';

async function testExcelGeneration() {
  console.log('=== [1] Pengujian Pembuatan Berkas Excel (Tahap 5) ===');

  const dummyParams = {
    startDate: '2026-08-31',
    endDate: '2026-08-31',
    monthRef: '2026-08',
    monthPeriod: {
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      daysCount: 31,
    },
    selectedDates: ['2026-08-31'],
    tableRows: [
      {
        id: 'hypernet__Lawson Site - Nusantara Raya',
        source: 'hypernet' as const,
        source_key: 'Lawson Site - Nusantara Raya',
        display_name: 'Lawson Site - Nusantara Raya',
        kd_store: 'LW-001',
        activation_date: '2026-01-15',
        active: true,
        am: 'Budi AM',
        ac: 'Siti AC',
        dateValues: { '2026-08-31': 21 },
        sumMonth: 457,
        avgMonth: 15,
      },
      {
        id: 'hypernet__Lawson Site - Bandung Malang',
        source: 'hypernet' as const,
        source_key: 'Lawson Site - Bandung Malang',
        display_name: 'Lawson Site - Bandung Malang',
        kd_store: 'LW-002',
        activation_date: '2026-02-10',
        active: true,
        am: 'Budi AM',
        ac: 'Agus AC',
        dateValues: { '2026-08-31': 0 }, // Uji sel 0
        sumMonth: 120,
        avgMonth: 4,
      },
      {
        id: 'tachyon__101',
        source: 'tachyon' as const,
        source_key: '101',
        display_name: 'CILILITAN BESAR',
        kd_store: 'LW-101',
        activation_date: '2026-03-01',
        active: true,
        am: 'Hendra AM',
        ac: 'Rudi AC',
        dateValues: { '2026-08-31': 77 },
        sumMonth: 77,
        avgMonth: 2,
      },
    ],
    totals: {
      dateTotals: { '2026-08-31': 98 },
      totalSum: 654,
      totalAvg: 21,
    },
    kpi: {
      sumStore: 3,
      newUsers: 3720,
      returningNewUsers: 359,
      returningUsers: 200,
      allUsers: 4279,
    },
    stores: [
      {
        id: 'hypernet__Lawson Site - Nusantara Raya',
        source: 'hypernet' as const,
        source_key: 'Lawson Site - Nusantara Raya',
        display_name: 'Lawson Site - Nusantara Raya',
        kd_store: 'LW-001',
        activation_date: '2026-01-15',
        active: 1,
      },
      {
        id: 'hypernet__Lawson Site - Bandung Malang',
        source: 'hypernet' as const,
        source_key: 'Lawson Site - Bandung Malang',
        display_name: 'Lawson Site - Bandung Malang',
        kd_store: 'LW-002',
        activation_date: '2026-02-10',
        active: 1,
      },
      {
        id: 'tachyon__101',
        source: 'tachyon' as const,
        source_key: '101',
        display_name: 'CILILITAN BESAR',
        kd_store: 'LW-101',
        activation_date: '2026-03-01',
        active: 1,
      },
    ],
    stats: [
      {
        source: 'hypernet' as const,
        source_key: 'Lawson Site - Nusantara Raya',
        date: '2026-08-31',
        users: 21,
        upload_bytes: null,
        download_bytes: null,
        total_bytes: 12500000000,
        duration_seconds: 36000,
      },
      {
        source: 'hypernet' as const,
        source_key: 'Lawson Site - Bandung Malang',
        date: '2026-08-31',
        users: 0,
        upload_bytes: null,
        download_bytes: null,
        total_bytes: 0,
        duration_seconds: 0,
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
      },
    ],
  };

  const blob = await generateRekapExcelBlob(dummyParams);
  console.log(`✓ Berhasil membuat Blob Excel! Ukuran berkas: ${blob.size} bytes`);
  if (blob.size < 1000) {
    throw new Error('Ukuran berkas Excel terlalu kecil!');
  }

  // Baca ulang file Excel menggunakan ExcelJS untuk memverifikasi isi 2 Sheet
  const arrayBuffer = await blob.arrayBuffer();
  const readerWb = new ExcelJS.Workbook();
  await readerWb.xlsx.load(arrayBuffer);

  const sheetNames = readerWb.worksheets.map((s) => s.name);
  console.log('✓ Sheet yang ditemukan di dalam berkas:', sheetNames);

  if (!sheetNames.includes('Dashboard')) {
    throw new Error('Sheet "Dashboard" tidak ditemukan!');
  }
  if (!sheetNames.includes('Data 31-Agt-2026')) {
    throw new Error('Sheet "Data 31-Agt-2026" tidak ditemukan!');
  }

  const wsDash = readerWb.getWorksheet('Dashboard')!;
  const wsRaw = readerWb.getWorksheet('Data 31-Agt-2026')!;

  console.log(`✓ Baris pada Sheet Dashboard: ${wsDash.rowCount}`);
  console.log(`✓ Baris pada Sheet Data 31-Agt-2026: ${wsRaw.rowCount}`);

  // Cek sel 0 di sheet Dashboard
  // Cari baris Bandung Malang (users = 0)
  let foundZeroCellFormatted = false;
  wsDash.eachRow((row) => {
    const org = row.getCell(3).value;
    if (org === 'Lawson Site - Bandung Malang') {
      const zeroVal = row.getCell(7).value;
      const fill = row.getCell(7).fill as any;
      console.log('✓ Nilai toko Bandung Malang pada 31-Agt:', zeroVal);
      console.log('✓ Warna sel 0 (kuning lembut):', fill?.fgColor?.argb);
      if (zeroVal === 0 && fill?.fgColor?.argb === 'FFFEF9C3') {
        foundZeroCellFormatted = true;
      }
    }
  });

  if (!foundZeroCellFormatted) {
    throw new Error('Sel 0 tidak berlatar kuning lembut!');
  }

  // Cek Sheet Data 31-Agt-2026: Hypernet lebih dulu lalu Tachyon
  let foundHypernetBeforeTachyon = false;
  let hypernetRowIdx = -1;
  let tachyonRowIdx = -1;

  wsRaw.eachRow((row, rowNumber) => {
    const org = String(row.getCell(2).value || '');
    if (org.includes('Nusantara Raya')) {
      hypernetRowIdx = rowNumber;
    }
    if (org.includes('CILILITAN')) {
      tachyonRowIdx = rowNumber;
    }
  });

  console.log(`✓ Baris Hypernet: ${hypernetRowIdx}, Baris Tachyon: ${tachyonRowIdx}`);
  if (hypernetRowIdx > 0 && tachyonRowIdx > hypernetRowIdx) {
    foundHypernetBeforeTachyon = true;
    console.log('✓ Terkonfirmasi: Toko Hypernet di atas dan Toko Tachyon di bawahnya.');
  } else {
    throw new Error('Urutan Hypernet sebelum Tachyon pada Sheet Data tidak sesuai!');
  }

  console.log('\n=== [2] Pengujian Pembuatan Berkas Excel Multi-Tanggal (01 s/d 03 Okt) ===');
  const multiDayParams = {
    ...dummyParams,
    startDate: '2026-10-01',
    endDate: '2026-10-03',
    monthRef: '2026-10',
    selectedDates: ['2026-10-01', '2026-10-02', '2026-10-03'],
    stats: [
      { source: 'hypernet' as const, source_key: 'Lawson Site - Nusantara Raya', date: '2026-10-01', users: 15, upload_bytes: null, download_bytes: null, total_bytes: 1000, duration_seconds: 100 },
      { source: 'hypernet' as const, source_key: 'Lawson Site - Nusantara Raya', date: '2026-10-02', users: 20, upload_bytes: null, download_bytes: null, total_bytes: 2000, duration_seconds: 200 },
      { source: 'hypernet' as const, source_key: 'Lawson Site - Nusantara Raya', date: '2026-10-03', users: 25, upload_bytes: null, download_bytes: null, total_bytes: 3000, duration_seconds: 300 },
    ],
  };

  const multiBlob = await generateRekapExcelBlob(multiDayParams as any);
  const multiReaderWb = new ExcelJS.Workbook();
  await multiReaderWb.xlsx.load(await multiBlob.arrayBuffer());
  const multiSheets = multiReaderWb.worksheets.map((s) => s.name);
  console.log('✓ Sheet pada pengujian multi-tanggal:', multiSheets);

  if (!multiSheets.includes('Dashboard') || !multiSheets.includes('Data 01-Okt-2026') || !multiSheets.includes('Data 02-Okt-2026') || !multiSheets.includes('Data 03-Okt-2026')) {
    throw new Error('Sheet terpisah per tanggal tidak lengkap!');
  }
  console.log('✓ Terkonfirmasi: Multi-sheet terpisah per tanggal ("Data 01-Okt-2026", dst.) berhasil dibuat!');

  console.log('\n=== SEMUA PENGUJIAN EKSPOR EXCEL BERHASIL LULUS 100% ===\n');
}

testExcelGeneration().catch((err) => {
  console.error('Test Excel gagal:', err);
  process.exit(1);
});
