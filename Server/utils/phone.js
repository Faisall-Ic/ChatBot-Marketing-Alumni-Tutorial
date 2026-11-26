/**
 * Menormalkan nomor telepon ke format digit standar Indonesia (628xxx),
 * sambil mempertahankan identifier non-standar seperti JID `@lid`.
 */
export function normalizePhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') return '';

  const trimmed = rawPhone.trim();
  if (trimmed.endsWith('@lid') || trimmed.startsWith('lid:')) {
    return trimmed;
  }

  const withoutDomain = trimmed.split('@')[0].split(':')[0];
  const digits = withoutDomain.replace(/\D/g, '');

  if (digits.startsWith('08')) {
    return `62${digits.slice(1)}`;
  }

  return digits;
}

/**
 * Mengecek apakah identifier adalah nomor telepon digit (bukan `@lid`).
 */
export function isNumericPhone(phone) {
  return /^\d{8,15}$/.test(phone);
}
