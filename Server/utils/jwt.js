import crypto from 'node:crypto';

function toBase64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromBase64Url(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLength), 'base64').toString('utf8');
}

/**
 * Membandingkan dua string secara aman terhadap timing attack.
 */
export function safeEqualStrings(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Membuat JWT HS256 menggunakan modul bawaan node:crypto.
 */
export function signJwt(payload, secret, expiresInSeconds = 86400) {
  if (!secret) {
    throw new Error('JWT_SECRET belum dikonfigurasi');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, iat: now, exp: now + expiresInSeconds };

  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedBody = toBase64Url(JSON.stringify(body));
  const data = `${encodedHeader}.${encodedBody}`;

  const signature = toBase64Url(
    crypto.createHmac('sha256', secret).update(data).digest()
  );

  return `${data}.${signature}`;
}

/**
 * Memverifikasi JWT HS256 dan mengembalikan payload jika valid serta belum kedaluwarsa.
 */
export function verifyJwt(token, secret) {
  if (!token || !secret || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedBody, providedSignature] = parts;
  const data = `${encodedHeader}.${encodedBody}`;
  const expectedSignature = toBase64Url(
    crypto.createHmac('sha256', secret).update(data).digest()
  );

  if (!safeEqualStrings(providedSignature, expectedSignature)) {
    return null;
  }

  try {
    const header = JSON.parse(fromBase64Url(encodedHeader));
    if (header?.alg !== 'HS256') return null;

    const payload = JSON.parse(fromBase64Url(encodedBody));
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload?.exp === 'number' && payload.exp <= now) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
