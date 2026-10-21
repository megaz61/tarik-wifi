import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import {
  getStores,
  updateStore,
  upsertStoreAssignment,
  copyAssignmentsFromPreviousMonth,
  seedReferenceStores,
  getAllStoreAmAcHistory,
  upsertSingleStoreAmAcHistory,
} from '@/lib/db';
import { getJakartaToday } from '@/lib/constants';
import { computeEffectiveAmAcMap } from '@/lib/storeAssignments';

export async function GET(request: Request) {
  const authed = await isAuthenticated();
  if (!authed) {
    return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month') || getJakartaToday().slice(0, 7);
    const onlyVisible = searchParams.get('onlyVisible') === 'true';

    const [stores, history] = await Promise.all([
      getStores(onlyVisible),
      getAllStoreAmAcHistory(),
    ]);

    // Hitung AM/AC efektif sesuai aturan Target D2 (terbaru <= month, fallback Juli 2026)
    const effectiveMap = computeEffectiveAmAcMap(history, month);
    const assignments: Record<string, any> = {};
    for (const store of stores) {
      const kd = store.kd_store ? store.kd_store.trim().toUpperCase() : null;
      if (kd && effectiveMap.has(kd)) {
        const item = effectiveMap.get(kd)!;
        assignments[store.id] = {
          store_id: store.id,
          month,
          am: item.am,
          ac: item.ac,
        };
      }
    }

    return NextResponse.json({
      success: true,
      month,
      stores,
      assignments,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Gagal memuat master toko.' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const authed = await isAuthenticated();
  if (!authed) {
    return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, fields } = body;

    if (!id || !fields) {
      return NextResponse.json(
        { error: 'Parameter id dan fields wajib disertakan.' },
        { status: 400 }
      );
    }

    await updateStore(id, fields);

    return NextResponse.json({ success: true, id });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Gagal memperbarui data toko.' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const authed = await isAuthenticated();
  if (!authed) {
    return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'assign') {
      const { store_id, month, am, ac } = body;
      if (!store_id) {
        return NextResponse.json(
          { error: 'Parameter store_id wajib disertakan.' },
          { status: 400 }
        );
      }

      // Target D3: Gunakan bulan yang dipilih atau bulan berjalan Asia/Jakarta
      const targetMonth = month || getJakartaToday().slice(0, 7);

      // Cari kd_store dari database
      const allStores = await getStores(false);
      const store = allStores.find((s) => s.id === store_id);
      if (store && store.kd_store) {
        await upsertSingleStoreAmAcHistory(
          store.kd_store,
          targetMonth,
          am ? am.trim() : null,
          ac ? ac.trim() : null
        );
      }

      await upsertStoreAssignment(store_id, targetMonth, am ?? null, ac ?? null);
      return NextResponse.json({ success: true, store_id, month: targetMonth });
    }

    if (action === 'copy_prev') {
      const { targetMonth, sourceMonth } = body;
      if (!targetMonth || !sourceMonth) {
        return NextResponse.json(
          { error: 'Parameter targetMonth dan sourceMonth wajib disertakan.' },
          { status: 400 }
        );
      }

      const copiedCount = await copyAssignmentsFromPreviousMonth(targetMonth, sourceMonth);
      return NextResponse.json({
        success: true,
        copiedCount,
        message: `Berhasil menyalin ${copiedCount} penugasan dari bulan ${sourceMonth} ke ${targetMonth}.`,
      });
    }

    if (action === 'seed_ref27') {
      const { month } = body;
      const res = await seedReferenceStores(month ? [month] : undefined);
      return NextResponse.json({
        success: true,
        ...res,
        message: `Berhasil mencocokkan ${res.matchedCount} toko acuan dan menyembunyikan ${res.hiddenCount} toko lainnya.`,
      });
    }

    if (action === 'set_all_visibility') {
      const { is_visible } = body;
      const allStores = await getStores(false);
      for (const st of allStores) {
        await updateStore(st.id, { is_visible: is_visible ? 1 : 0 });
      }
      return NextResponse.json({
        success: true,
        message: is_visible ? 'Semua toko ditandai ditampilkan.' : 'Semua toko ditandai disembunyikan.',
      });
    }

    return NextResponse.json({ error: `Aksi '${action}' tidak dikenal.` }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Gagal memproses penugasan AM/AC.' },
      { status: 500 }
    );
  }
}
