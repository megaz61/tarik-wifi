import { cookies } from 'next/headers';
import { ACCESS_COOKIE_NAME, DEFAULT_ACCESS_CODE } from './constants';

export interface CredentialsStatus {
  authenticated: boolean;
  hypernetConfigured: boolean;
  tachyonConfigured: boolean;
  supabaseConfigured: boolean;
}

/**
 * Memeriksa apakah kode akses yang diberikan valid.
 */
export function verifyAccessCode(inputCode: string): boolean {
  const validCode = process.env.ACCESS_CODE || DEFAULT_ACCESS_CODE;
  return Boolean(inputCode && inputCode.trim() === validCode.trim());
}

/**
 * Memeriksa status otentikasi dari cookie request.
 */
export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_COOKIE_NAME)?.value;
  const validCode = process.env.ACCESS_CODE || DEFAULT_ACCESS_CODE;
  return Boolean(token && token === validCode);
}

/**
 * Mengetahui apakah environment variables vendor sudah terisi di server.
 */
export function isHypernetEnvConfigured(): boolean {
  return Boolean(process.env.HYPERNET_USER && process.env.HYPERNET_PASS);
}

export function isTachyonEnvConfigured(): boolean {
  return Boolean(process.env.TACHYON_USER && process.env.TACHYON_PASS);
}

export function isSupabaseEnvConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}

/**
 * Mengambil kredensial vendor secara aman di sisi server:
 * Prioritas 1: Environment variable
 * Prioritas 2: Kredensial manual yang dikirimkan user untuk permintaan itu (in-memory)
 * Jangan pernah me-log atau menyimpan password.
 */
export function resolveHypernetCredentials(manualCreds?: { username?: string; password?: string }) {
  const username = process.env.HYPERNET_USER || manualCreds?.username || '';
  const password = process.env.HYPERNET_PASS || manualCreds?.password || '';
  return {
    isAvailable: Boolean(username && password),
    username,
    password,
    fromEnv: Boolean(process.env.HYPERNET_USER && process.env.HYPERNET_PASS),
  };
}

export function resolveTachyonCredentials(manualCreds?: { username?: string; password?: string }) {
  const username = process.env.TACHYON_USER || manualCreds?.username || '';
  const password = process.env.TACHYON_PASS || manualCreds?.password || '';
  return {
    isAvailable: Boolean(username && password),
    username,
    password,
    fromEnv: Boolean(process.env.TACHYON_USER && process.env.TACHYON_PASS),
  };
}
