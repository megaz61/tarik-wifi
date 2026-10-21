/**
 * Skrip Seed Idempoten Riwayat AM/AC dari referensi/am_ac_histori.tsv (Target D5)
 */
import fs from 'fs';
import path from 'path';
import {
  initDb,
  getStores,
  updateStore,
  upsertStoreAmAcHistory,
  StoreAmAcHistoryItem,
} from '../lib/db';

const MONTH_MAP: Record<string, string> = {
  '#JULI 2026': '2026-07',
  '#AGUSTUS 2026': '2026-08',
  '#SEPTEMBER 2026': '2026-09',
  '#OKTOBER 2026': '2026-10',
};

function parseDateRobust(str: string): string {
  if (!str) return '';
  const s = str.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[-/\s]+([A-Za-z]+)[-/\s]+(\d{2,4})$/);
  if (m) {
    const day = m[1].padStart(2, '0');
    const monthStr = m[2].toLowerCase();
    let year = m[3];
    if (year.length === 2) year = '20' + year;
    const months: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', mei: '05', may: '05',
      jun: '06', jul: '07', agu: '08', ags: '08', agt: '08', aug: '08',
      sep: '09', okt: '10', oct: '10', nov: '11', des: '12', dec: '12',
    };
    const mm = months[monthStr.slice(0, 3)] || '01';
    return `${year}-${mm}-${day}`;
  }
  return s;
}

export async function runSeed(dryRun: boolean = false) {
  await initDb();

  const tsvPath = path.join(process.cwd(), 'referensi', 'am_ac_histori.tsv');
  if (!fs.existsSync(tsvPath)) {
    throw new Error(`File TSV tidak ditemukan di ${tsvPath}`);
  }

  const tsvContent = fs.readFileSync(tsvPath, 'utf-8');
  const lines = tsvContent.split(/\r?\n/);

  let currentSection = '';
  const sections: Record<string, { kd: string; org: string; am: string; ac: string; actDate: string }[]> = {
    '2026-07': [],
    '2026-08': [],
    '2026-09': [],
    '2026-10': [],
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const match = Object.keys(MONTH_MAP).find((k) => line.toUpperCase().startsWith(k));
      if (match) currentSection = MONTH_MAP[match];
      continue;
    }
    if (line.toLowerCase().startsWith('kd store')) continue;
    if (!currentSection) continue;

    const parts = rawLine.split('\t').map((p) => p.trim());
    const kd = parts[0]?.toUpperCase() || '';
    const org = parts[1] || '';
    const am = (parts[2] || '').replace(/\s+/g, ' ');
    const ac = (parts[3] || '').replace(/\s+/g, ' ');
    const actDate = parseDateRobust(parts[4] || '');

    sections[currentSection].push({ kd, org, am, ac, actDate });
  }

  console.log('=== JUMLAH BARIS TSV PER BULAN ===');
  for (const [m, rows] of Object.entries(sections)) {
    console.log(`Bulan ${m}: ${rows.length} baris`);
  }

  // Ambil data toko di database
  const masterStores = await getStores(false); // Semua toko termasuk hidden
  const storesByKd = new Map<string, any>();
  for (const s of masterStores) {
    if (s.kd_store) {
      storesByKd.set(s.kd_store.trim().toUpperCase(), s);
    }
  }

  // 1. Validasi Kd Store
  const historyToInsert: StoreAmAcHistoryItem[] = [];
  const unknownKd = new Set<string>();

  for (const [m, rows] of Object.entries(sections)) {
    for (const r of rows) {
      if (!storesByKd.has(r.kd)) {
        unknownKd.add(r.kd);
        continue;
      }
      historyToInsert.push({
        kd_store: r.kd,
        month: m,
        am: r.am,
        ac: r.ac,
      });
    }
  }

  console.log('\n=== VALIDASI KD STORE ===');
  if (unknownKd.size > 0) {
    console.log(`Peringatan: Kd Store tidak ada di Master Toko:`, Array.from(unknownKd));
  } else {
    console.log('Semua Kd Store valid dan ada di Master Toko (100% cocok).');
  }

  // 2. Snapshot Aktivasi Terbaru per Toko
  const latestActivationMap = new Map<string, string>();
  for (const m of ['2026-07', '2026-08', '2026-09', '2026-10']) {
    for (const r of sections[m]) {
      if (r.actDate) {
        latestActivationMap.set(r.kd, r.actDate);
      }
    }
  }

  console.log('\n=== CEK TANGGAL AKTIVASI MASTER TOKO ===');
  let filledCount = 0;
  let diffCount = 0;
  for (const [kd, newDate] of latestActivationMap.entries()) {
    const store = storesByKd.get(kd);
    if (!store) continue;
    const curDate = store.activation_date;
    if (!curDate || curDate === '-' || curDate.trim() === '') {
      console.log(`[ISI] Kd: ${kd} (${store.display_name}) belum punya tgl aktivasi -> isi ${newDate}`);
      if (!dryRun) {
        await updateStore(store.id, { activation_date: newDate });
      }
      filledCount++;
    } else if (curDate !== newDate) {
      console.log(`[BEDA - TIDAK DITIMPA] Kd: ${kd} DB=${curDate} vs TSV=${newDate}`);
      diffCount++;
    }
  }
  console.log(`Tgl Aktivasi diisi: ${filledCount}, Tgl Aktivasi berbeda (tidak ditimpa): ${diffCount}`);

  // 3. Eksekusi Seed ke store_am_ac_history
  if (dryRun) {
    console.log(`\n[DRY RUN] ${historyToInsert.length} catatan riwayat AM/AC siap di-upsert.`);
  } else {
    const inserted = await upsertStoreAmAcHistory(historyToInsert);
    console.log(`\n[SELESAI] Berhasil meng-upsert ${inserted} catatan ke tabel store_am_ac_history.`);
  }
}

if (require.main === module) {
  const isDryRun = process.argv.includes('--dry-run');
  runSeed(isDryRun)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Error saat seed:', err);
      process.exit(1);
    });
}
