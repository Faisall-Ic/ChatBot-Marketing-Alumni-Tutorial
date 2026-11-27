import { Router } from 'express';
import { dashboardAuth } from '../middlewares/apiKeyAuth.js';
import { safeEqualStrings, signJwt } from '../utils/jwt.js';

const TOKEN_TTL_SECONDS = 86400; // 24 jam
const router = Router();

router.post('/login', (req, res) => {
  const configuredUser = process.env.ADMIN_USERNAME?.trim();
  const configuredPass = process.env.ADMIN_PASSWORD?.trim();
  const jwtSecret = process.env.JWT_SECRET?.trim();

  if (!configuredUser || !configuredPass || !jwtSecret) {
    return res.status(503).json({
      success: false,
      error:
        'Autentikasi admin belum dikonfigurasi di .env (ADMIN_USERNAME, ADMIN_PASSWORD, JWT_SECRET)',
    });
  }

  const username =
    typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password =
    typeof req.body?.password === 'string' ? req.body.password : '';

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      error: 'Username dan password wajib diisi',
    });
  }

  const isUserMatch = safeEqualStrings(username, configuredUser);
  const isPassMatch = safeEqualStrings(password, configuredPass);

  if (!isUserMatch || !isPassMatch) {
    return res.status(401).json({
      success: false,
      error: 'Username atau password salah',
    });
  }

  const token = signJwt(
    { sub: configuredUser, role: 'admin' },
    jwtSecret,
    TOKEN_TTL_SECONDS
  );

  return res.json({
    success: true,
    data: {
      token,
      tokenType: 'Bearer',
      expiresIn: TOKEN_TTL_SECONDS,
      admin: {
        username: configuredUser,
        role: 'admin',
      },
    },
  });
});

router.get('/me', dashboardAuth, (req, res) => {
  res.json({
    success: true,
    data: {
      username: req.admin?.sub || process.env.ADMIN_USERNAME?.trim() || 'admin',
      role: req.admin?.role || 'admin',
    },
  });
});

export default router;
