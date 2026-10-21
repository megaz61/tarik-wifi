import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@libsql/client';
import path from 'node:path';
import fs from 'node:fs';

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
  console.error('ERROR: TURSO_DATABASE_URL tidak ditemukan di environment variable.');
  process.exit(1);
}

const localDbPath = path.resolve('data/wifi_rekap.db');
if (!fs.existsSync(localDbPath)) {
  console.error(`ERROR: File database lokal ${localDbPath} tidak ditemukan.`);
  process.exit(1);
}

console.log('----------------------------------------------------');
console.log('MIGRASI DATABASE SQLITE LOKAL KE TURSO (libSQL CLOUD)');
console.log(`Sumber Lokal: ${localDbPath}`);
console.log(`Target Turso: ${url}`);
console.log('----------------------------------------------------\n');

const localDb = new DatabaseSync(localDbPath, { readOnly: true });
const turso = createClient({ url, authToken });

async function migrate() {
  const startTime = Date.now();

  // 1. Ambil daftar tabel dari SQLite lokal (kecuali tabel internal sqlite_*)
  const tables = localDb
    .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();

  console.log(`Ditemukan ${tables.length} tabel untuk dimigrasikan:`);
  for (const t of tables) {
    console.log(`  - ${t.name}`);
  }
  console.log('');

  // 2. Ambil daftar index dari SQLite lokal
  const indexes = localDb
    .prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY tbl_name, name")
    .all();

  // 3. Migrasikan tiap tabel
  for (const t of tables) {
    const tableName = t.name;
    console.log(`>>> Memproses tabel: [${tableName}]`);

    // Drop jika sudah ada (idempoten)
    await turso.execute(`DROP TABLE IF EXISTS "${tableName}";`);

    // Buat tabel di Turso
    await turso.execute(t.sql);
    console.log(`    Tabel "${tableName}" berhasil dibuat ulang di Turso.`);

    // Ambil data dari lokal
    const rows = localDb.prepare(`SELECT * FROM "${tableName}"`).all();
    console.log(`    Membaca ${rows.length} baris dari database lokal...`);

    if (rows.length > 0) {
      const columns = Object.keys(rows[0]);
      const colList = columns.map((c) => `"${c}"`).join(', ');
      const placeholders = columns.map(() => '?').join(', ');
      const insertSql = `INSERT INTO "${tableName}" (${colList}) VALUES (${placeholders});`;

      const BATCH_SIZE = 200;
      let inserted = 0;

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const chunk = rows.slice(i, i + BATCH_SIZE);
        const stmts = chunk.map((row) => ({
          sql: insertSql,
          args: columns.map((col) => row[col]),
        }));

        await turso.batch(stmts, 'write');
        inserted += chunk.length;
        process.stdout.write(`    Tersalin: ${inserted}/${rows.length} baris\r`);
      }
      console.log(`\n    Selesai menyalin ${inserted} baris ke Turso.`);
    } else {
      console.log(`    (Tabel kosong di lokal, 0 baris disalin)`);
    }
    console.log('');
  }

  // 4. Buat ulang index
  console.log('>>> Membuat indeks...');
  for (const idx of indexes) {
    try {
      await turso.execute(idx.sql);
      console.log(`    Indeks "${idx.name}" pada tabel "${idx.tbl_name}" berhasil dibuat.`);
    } catch (err) {
      console.warn(`    Peringatan membuat indeks "${idx.name}":`, err.message);
    }
  }
  console.log('');

  // 5. Verifikasi jumlah baris
  console.log('====================================================');
  console.log('HASIL VERIFIKASI JUMLAH BARIS (LOKAL vs TURSO):');
  console.log('====================================================');
  console.log(
    '| ' +
    'Nama Tabel'.padEnd(25) +
    ' | ' +
    'Lokal'.padStart(10) +
    ' | ' +
    'Turso'.padStart(10) +
    ' | ' +
    'Status'.padEnd(12) +
    ' |'
  );
  console.log('|-' + '-'.repeat(25) + '-|-' + '-'.repeat(10) + '-|-' + '-'.repeat(10) + '-|-' + '-'.repeat(12) + '-|');

  let hasMismatch = false;

  for (const t of tables) {
    const tableName = t.name;
    const localCnt = localDb.prepare(`SELECT count(*) as cnt FROM "${tableName}"`).get().cnt;
    const tursoRes = await turso.execute(`SELECT count(*) as cnt FROM "${tableName}";`);
    const tursoCnt = Number(tursoRes.rows[0].cnt);

    const isMatch = localCnt === tursoCnt;
    if (!isMatch) hasMismatch = true;

    console.log(
      '| ' +
      tableName.padEnd(25) +
      ' | ' +
      String(localCnt).padStart(10) +
      ' | ' +
      String(tursoCnt).padStart(10) +
      ' | ' +
      (isMatch ? 'SESUAI (OK)' : 'BERBEDA!').padEnd(12) +
      ' |'
    );
  }
  console.log('====================================================');

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  if (hasMismatch) {
    console.error(`\nPERINGATAN: Terdapat perbedaan jumlah baris! Migrasi gagal verifikasi (${durationSec}s).`);
    process.exit(1);
  } else {
    console.log(`\nSEMUA TABEL BERHASIL DIMIGRASIKAN DAN TERVERIFIKASI IDENTIK! Waktu: ${durationSec}s\n`);
  }
}

migrate().catch((err) => {
  console.error('\nERROR MIGRASI:', err);
  process.exit(1);
});
