import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { determineDatesToSync } from '@/lib/syncSession';
import { validateDateRange } from '@/lib/constants';

export async function POST(request: Request) {
  const authed = await isAuthenticated();
  if (!authed) {
    return NextResponse.json({ error: 'Akses ditolak. Silakan login terlebih dahulu.' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { startDate, endDate } = body;

    const val = validateDateRange(startDate, endDate, undefined, false, true);
    if (!val.valid) {
      return NextResponse.json({ error: val.error }, { status: 400 });
    }

    const [hypernetPrep, tachyonPrep] = await Promise.all([
      determineDatesToSync('hypernet', startDate, endDate),
      determineDatesToSync('tachyon', startDate, endDate),
    ]);

    return NextResponse.json({
      success: true,
      startDate,
      endDate,
      hypernet: hypernetPrep,
      tachyon: tachyonPrep,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Gagal menyiapkan daftar tanggal sinkronisasi.' },
      { status: 500 }
    );
  }
}
