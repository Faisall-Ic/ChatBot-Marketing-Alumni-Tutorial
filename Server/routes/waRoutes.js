import { Router } from 'express';
import { getSafeWaStatus } from '../services/waBridge.js';

const router = Router();

router.get('/status', (req, res) => {
  res.json({
    success: true,
    data: getSafeWaStatus(),
  });
});

export default router;
