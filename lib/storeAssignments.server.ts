import 'server-only';

import {
  getAllStoreAmAcHistory,
  upsertSingleStoreAmAcHistory,
} from './db';
import { getJakartaToday } from './constants';
import {
  computeEffectiveAmAcMap,
  StoreEffectiveAmAc,
} from './storeAssignments';

/**
 * Mengambil mapping AM & AC efektif untuk seluruh toko pada bulan referensi M (YYYY-MM).
 * Aturan D2:
 * - Ambil catatan dengan bulan terbaru <= M.
 * - Jika M < 2026-07, gunakan catatan 2026-07 (snapshot Juli).
 * - Jika tidak ada catatan, kembalikan am: null, ac: null.
 */
export async function getEffectiveAmAcMapForMonth(
  targetMonth: string
): Promise<Map<string, StoreEffectiveAmAc>> {
  const history = await getAllStoreAmAcHistory();
  return computeEffectiveAmAcMap(history, targetMonth);
}

/**
 * Simpan / Upsert AM & AC ke tabel riwayat pada BULAN BERJALAN Asia/Jakarta (Target D3)
 */
export async function saveStoreAmAcForCurrentMonth(
  kdStore: string,
  am: string | null,
  ac: string | null,
  overrideMonth?: string
): Promise<void> {
  const month = overrideMonth || getJakartaToday().slice(0, 7);
  await upsertSingleStoreAmAcHistory(kdStore, month, am, ac);
}
