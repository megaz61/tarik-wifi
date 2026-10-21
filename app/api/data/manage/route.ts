import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { getDatabaseMetrics, deleteDailyStatsAndKpi, getLastSuccessfulAutoClean, runAutoRetentionCleanup } from '@/lib/db';

export async function GET() {
  const authed = await isAuthenticated();
  if (!authed) {
    return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });
  }

  try {
    // Jalankan scheduler secara background (aman dan idempoten)
    runAutoRetentionCleanup().catch((e) => console.warn('Background retention check:', e.message));

    const [metrics, lastRetentionClean] = await Promise.all([
      getDatabaseMetrics(),
      getLastSuccessfulAutoClean(),
    ]);
    return NextResponse.json({ success: true, ...metrics, lastRetentionClean });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Gagal membaca metrik database.' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const authed = await isAuthenticated();
  if (!authed) {
    return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { startDate, endDate, confirmed } = body;

    if (!startDate || !endDate || !confirmed) {
      return NextResponse.json(
        { error: 'Rentang tanggal dan konfirmasi penghapusan wajib disertakan.' },
        { status: 400 }
      );
    }

    const res = await deleteDailyStatsAndKpi(startDate, endDate);
    return NextResponse.json({
      success: true,
      message: `Berhasil menghapus ${res.deletedStats} baris ringkasan harian dan ${res.deletedKpi} baris cache KPI.`,
      ...res,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Gagal menghapus data tarikan.' },
      { status: 500 }
    );
  }
}
