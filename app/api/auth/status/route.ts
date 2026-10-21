import { NextResponse } from 'next/server';
import {
  isAuthenticated,
  isHypernetEnvConfigured,
  isTachyonEnvConfigured,
  isSupabaseEnvConfigured,
} from '@/lib/auth';
import { getDbMode } from '@/lib/db';

export async function GET() {
  const authed = await isAuthenticated();
  return NextResponse.json({
    authenticated: authed,
    hypernetConfigured: isHypernetEnvConfigured(),
    tachyonConfigured: isTachyonEnvConfigured(),
    supabaseConfigured: isSupabaseEnvConfigured(),
    dbMode: getDbMode(),
  });
}
