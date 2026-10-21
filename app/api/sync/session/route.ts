import { NextResponse } from 'next/server';
import { isAuthenticated, resolveHypernetCredentials, resolveTachyonCredentials } from '@/lib/auth';
import { startSyncSession } from '@/lib/syncSession';

export async function POST(request: Request) {
  const authed = await isAuthenticated();
  if (!authed) {
    return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { hypernetCreds, tachyonCreds, sourcesToSync } = body;

    const hypernet = resolveHypernetCredentials(hypernetCreds);
    const tachyon = resolveTachyonCredentials(tachyonCreds);

    const allowHypernet = !sourcesToSync || sourcesToSync.includes('hypernet');
    const allowTachyon = !sourcesToSync || sourcesToSync.includes('tachyon');

    const sessionRes = await startSyncSession({
      hypernetCreds:
        allowHypernet && hypernet.isAvailable
          ? { username: hypernet.username, password: hypernet.password }
          : undefined,
      tachyonCreds:
        allowTachyon && tachyon.isAvailable
          ? { username: tachyon.username, password: tachyon.password }
          : undefined,
    });

    return NextResponse.json({
      success: true,
      sessionId: sessionRes.sessionId,
      hypernetReady: sessionRes.hypernetReady,
      tachyonReady: sessionRes.tachyonReady,
      errors: sessionRes.errors,
      sourcesConfigured: {
        hypernet: hypernet.isAvailable,
        tachyon: tachyon.isAvailable,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Gagal memulai sesi sinkronisasi.' },
      { status: 500 }
    );
  }
}
