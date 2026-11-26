import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error('MONGODB_URI belum diisi di file .env');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log('Berhasil terhubung ke MongoDB');
  } catch (error) {
    console.error('Gagal terhubung ke MongoDB:', error.message);
    process.exit(1);
  }
}

connectDB();
