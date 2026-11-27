import { safeEqualStrings, verifyJwt } from '../utils/jwt.js';

/**
 * Middleware autentikasi Dashboard:
 * - Mendukung `Authorization: Bearer <jwt>` (login admin berbasis .env).
 * - Mendukung `x-api-key` opsional jika DASHBOARD_API_KEY diisi di .env.
 * - Jika belum ada JWT maupun API Key yang dikonfigurasi, akses diizinkan untuk dev awal.
 */
export function dashboardAuth(req, res, next) {
  const jwtSecret = process.env.JWT_SECRET?.trim();
  const hasAdminLogin = Boolean(
    process.env.ADMIN_USERNAME?.trim() &&
      process.env.ADMIN_PASSWORD?.trim() &&
      jwtSecret
  );
  const configuredApiKey = process.env.DASHBOARD_API_KEY?.trim();

  const authHeader = req.get('authorization')?.trim() || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    const payload = verifyJwt(token, jwtSecret);
    if (!payload) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: token tidak valid atau sudah kedaluwarsa',
      });
    }
    req.admin = payload;
    return next();
  }

  const providedApiKey = req.get('x-api-key')?.trim();
  if (configuredApiKey && providedApiKey) {
    if (safeEqualStrings(providedApiKey, configuredApiKey)) {
      return next();
    }
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: header x-api-key tidak valid',
    });
  }

  if (!hasAdminLogin && !configuredApiKey) {
    return next();
  }

  return res.status(401).json({
    success: false,
    error: 'Unauthorized: silakan login terlebih dahulu',
  });
}

export const apiKeyAuth = dashboardAuth;
