import { NextResponse } from 'next/server';
import { ACCESS_COOKIE_NAME } from '@/lib/constants';

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete(ACCESS_COOKIE_NAME);
  return response;
}
