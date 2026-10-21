import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { syncDayForSource } from '@/lib/syncSession';

export async function POST(request: Request) {
  const authed = await isAuthenticated();
  if (!authed) {
    return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { sessionId, source, date } = body;

    if (!sessionId || !source || !date) {
      return NextResponse.json(
        { error: 'Parameter sessionId, source, dan date wajib disertakan.' },
        { status: 400 }
      );
    }

    const result = await syncDayForSource(sessionId, source, date);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Gagal sinkronisasi data harian.' },
      { status: 500 }
    );
  }
}
