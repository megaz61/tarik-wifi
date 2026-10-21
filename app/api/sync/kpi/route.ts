import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { syncKpiForSource } from '@/lib/syncSession';

export async function POST(request: Request) {
  const authed = await isAuthenticated();
  if (!authed) {
    return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { sessionId, source, startDate, endDate } = body;

    if (!sessionId || !source || !startDate || !endDate) {
      return NextResponse.json(
        { error: 'Parameter sessionId, source, startDate, dan endDate wajib disertakan.' },
        { status: 400 }
      );
    }

    const result = await syncKpiForSource(sessionId, source, startDate, endDate);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Gagal sinkronisasi KPI rentang tanggal.' },
      { status: 500 }
    );
  }
}
