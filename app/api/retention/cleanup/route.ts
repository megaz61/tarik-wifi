import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { runAutoRetentionCleanup, getAutoCleanLogs, getLastSuccessfulAutoClean } from '@/lib/db';

export async function GET() {
  const authed = await isAuthenticated();
  if (!authed) {
    return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });
  }

  try {
    const [lastSuccess, recentLogs] = await Promise.all([
      getLastSuccessfulAutoClean(),
      getAutoCleanLogs(10),
    ]);

    return NextResponse.json({
      success: true,
      lastSuccess,
      recentLogs,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Gagal membaca status scheduler retensi.' },
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
    const body = await request.json().catch(() => ({}));
    const { force, ignoreCutoff } = body;

    const result = await runAutoRetentionCleanup({ force: Boolean(force), ignoreCutoff: Boolean(ignoreCutoff) });
    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Gagal menjalankan pembersihan data retensi.' },
      { status: 500 }
    );
  }
}
