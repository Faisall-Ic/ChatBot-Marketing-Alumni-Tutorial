/**
 * Middleware proteksi ringan berbasis header `x-api-key`.
 * Jika DASHBOARD_API_KEY belum diisi di .env, akses diizinkan untuk kemudahan dev lokal.
 */
export function apiKeyAuth(req, res, next) {
  const configuredKey = process.env.DASHBOARD_API_KEY?.trim();
  if (!configuredKey) {
    return next();
  }

  const providedKey = req.get('x-api-key')?.trim();
  if (!providedKey || providedKey !== configuredKey) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: header x-api-key tidak valid atau tidak ditemukan',
    });
  }

  return next();
}
