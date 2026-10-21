import { NextResponse } from 'next/server';
import { verifyAccessCode } from '@/lib/auth';
import { ACCESS_COOKIE_NAME } from '@/lib/constants';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { accessCode } = body;

    if (!verifyAccessCode(accessCode)) {
      return NextResponse.json(
        { success: false, error: 'Kode akses salah. Silakan coba lagi.' },
        { status: 401 }
      );
    }

    const response = NextResponse.json({ success: true });
    // Simpan cookie httpOnly selama 30 hari (30 * 86400 detik)
    response.cookies.set({
      name: ACCESS_COOKIE_NAME,
      value: accessCode.trim(),
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    });

    return response;
  } catch (err) {
    console.error('Login error:', err);
    return NextResponse.json(
      { success: false, error: 'Terjadi kesalahan sistem saat memproses login.' },
      { status: 500 }
    );
  }
}
