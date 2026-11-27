import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';
import { connectDB } from './config/db.js';
import { dashboardAuth } from './middlewares/apiKeyAuth.js';
import authRoutes from './routes/authRoutes.js';
import knowledgeRoutes from './routes/knowledgeRoutes.js';
import sessionRoutes from './routes/sessionRoutes.js';
import waRoutes from './routes/waRoutes.js';
import { handleIncomingMessage } from './services/orchestratorService.js';
import { getSafeWaStatus, initWhatsAppBridge } from './services/waBridge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

function buildCorsOptions() {
  const rawOrigins = process.env.CLIENT_URL?.trim();
  if (!rawOrigins) {
    return { origin: true };
  }

  const allowedOrigins = rawOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      const corsError = new Error(`Origin ${origin} tidak diizinkan oleh CORS`);
      corsError.statusCode = 403;
      return callback(corsError);
    },
  };
}

export function createApp() {
  const app = express();

  app.use(cors(buildCorsOptions()));
  app.use(express.json());

  app.get('/api/health', (req, res) => {
    const dbConnected = mongoose.connection.readyState === 1;
    res.json({
      success: true,
      data: {
        server: 'ok',
        database: dbConnected ? 'connected' : 'disconnected',
        whatsapp: getSafeWaStatus().status,
      },
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/wa', dashboardAuth, waRoutes);
  app.use('/api/sessions', dashboardAuth, sessionRoutes);
  app.use('/api/knowledge', dashboardAuth, knowledgeRoutes);

  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: `Endpoint ${req.method} ${req.originalUrl} tidak ditemukan`,
    });
  });

  app.use((err, req, res, next) => {
    const statusCode = err?.statusCode || 500;
    console.error(`[API Error ${statusCode}]`, err?.message || err);
    res.status(statusCode).json({
      success: false,
      error: err?.message || 'Terjadi kesalahan internal server',
    });
  });

  return app;
}

async function startServer() {
  try {
    await connectDB();
  } catch (error) {
    console.error('Gagal terhubung ke MongoDB:', error.message);
    process.exit(1);
  }

  const app = createApp();
  const port = Number(process.env.PORT) || 3000;

  // Tidak bind ke localhost/127.0.0.1 agar port 3000 bisa diakses dari luar container Docker.
  app.listen(port, () => {
    console.log(`Server berjalan di port ${port}`);
  });

  await initWhatsAppBridge(handleIncomingMessage);
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  startServer();
}
