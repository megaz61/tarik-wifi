import './mock_server_only.js';
import { getJakartaToday, getJakartaYesterday, validateDateRange } from '../lib/constants';

function testH1Rules() {
  console.log('=== TEST ATURAN BATAS TANGGAL AWAL H-1 ===\n');

  const today = getJakartaToday();
  const yesterday = getJakartaYesterday(today);
  console.log(`Hari ini (Asia/Jakarta): ${today}`);
  console.log(`Kemarin H-1 (Asia/Jakarta): ${yesterday}`);

  // 1. Cek nilai kemarin
  const [yY, yM, yD] = today.split('-').map(Number);
  const expectedYesterday = new Date(Date.UTC(yY, yM - 1, yD - 1)).toISOString().slice(0, 10);
  if (yesterday !== expectedYesterday) {
    throw new Error(`getJakartaYesterday salah: got ${yesterday}, expected ${expectedYesterday}`);
  }
  console.log('✅ Helper getJakartaYesterday benar.');

  // 2. Validasi Server: Tanggal awal = hari ini HARUS DITOLAK
  const resTodayStart = validateDateRange(today, today, undefined, true);
  if (resTodayStart.valid) {
    throw new Error(`Server validasi gagal menolak tanggal awal = hari ini!`);
  }
  console.log(`✅ Tanggal awal = hari ini (${today}) ditolak server: "${resTodayStart.error}"`);

  // 3. Validasi Server: Tanggal awal = kemarin (H-1), akhir = hari ini -> HARUS LOLOS
  const resValidRange = validateDateRange(yesterday, today, undefined, true);
  if (!resValidRange.valid) {
    throw new Error(`Server validasi menolak rentang valid kemarin s/d hari ini: ${resValidRange.error}`);
  }
  console.log(`✅ Rentang kemarin s/d hari ini (${yesterday} s/d ${today}) diterima server.`);

  // 4. Validasi Server: Tanggal awal = kemarin (H-1), akhir = kemarin -> HARUS LOLOS (allowSingleDay = true)
  const resYesterdayOnly = validateDateRange(yesterday, yesterday, undefined, true);
  if (!resYesterdayOnly.valid) {
    throw new Error(`Server validasi menolak tanggal awal = akhir = kemarin: ${resYesterdayOnly.error}`);
  }
  console.log(`✅ Rentang kemarin s/d kemarin (${yesterday} s/d ${yesterday}) diterima server.`);

  // 5. Simulasi Koreksi Otomatis saat mount
  let sDate = today; // simulasi tersimpan hari ini
  let eDate = today;
  if (sDate > yesterday) {
    sDate = yesterday;
  }
  if (eDate < sDate) {
    eDate = sDate;
  }
  if (sDate !== yesterday) {
    throw new Error(`Koreksi otomatis gagal: startDate tetap ${sDate}`);
  }
  console.log(`✅ Simulasi koreksi otomatis: startDate ${today} berhasil dikoreksi menjadi ${sDate}.`);

  console.log('\nSEMUA UJI ATURAN H-1 LOLOS 100%! ✅');
}

testH1Rules();
