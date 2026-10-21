/**
 * Vendor Read-Only Guard
 * Memastikan bahwa seluruh komunikasi jaringan/HTTP ke vendor (Hypernet & Tachyon)
 * HANYA bersifat BACA (GET / HEAD).
 * Operasi tulis (POST, PUT, PATCH, DELETE, dll) ke vendor DILARANG KERAS,
 * kecuali endpoint otentikasi login yang secara eksplisit masuk whitelist.
 */

const ALLOWED_AUTH_POST_PATTERNS = [
  /\/userAuth\/login$/,
  /\/userAuth\/twoFactor\/setup\/skip$/,
  /\/auth\/login$/,
];

export class VendorReadOnlyViolationError extends Error {
  constructor(method: string, url: string) {
    super(
      `[VENDOR READ-ONLY VIOLATION] Ditolak: Operasi tulis '${method}' ke vendor (${url}) dilarang! Akses vendor bersifat READ-ONLY.`
    );
    this.name = 'VendorReadOnlyViolationError';
  }
}

/**
 * Memeriksa apakah pemanggilan ke endpoint vendor diizinkan.
 * Hanya mengizinkan GET/HEAD, atau POST ke endpoint login otentikasi.
 */
export function assertVendorReadOnlyRequest(url: string, method: string = 'GET'): void {
  const normalizedMethod = method.toUpperCase();

  // GET dan HEAD selalu diizinkan (Read-Only)
  if (normalizedMethod === 'GET' || normalizedMethod === 'HEAD') {
    return;
  }

  // Khusus POST otentikasi sesi yang terdaftar dalam whitelist
  if (normalizedMethod === 'POST') {
    const isWhitelistedAuth = ALLOWED_AUTH_POST_PATTERNS.some((pattern) => pattern.test(url));
    if (isWhitelistedAuth) {
      return;
    }
  }

  // Setiap operasi tulis/modifikasi selain whitelist ditolak keras
  throw new VendorReadOnlyViolationError(normalizedMethod, url);
}

/**
 * Wrapper fetch aman yang menerapkan Vendor Read-Only Guard
 */
export async function safeVendorFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url = typeof input === 'string' ? input : input.toString();
  const method = init?.method || 'GET';

  assertVendorReadOnlyRequest(url, method);

  return fetch(input, init);
}
