import dns from 'node:dns';
import mongoose from 'mongoose';

/**
 * Menghubungkan server Express ke database MongoDB menggunakan MONGODB_URI.
 * Menyertakan fallback DNS publik jika resolusi SRV lokal menolak querySrv.
 */
export async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error('MONGODB_URI belum diisi di file .env');
  }

  try {
    await mongoose.connect(uri);
  } catch (error) {
    const isSrvLookupFailure =
      uri.startsWith('mongodb+srv://') &&
      /querySrv\s+(ECONNREFUSED|ESERVFAIL|ETIMEOUT)/i.test(error?.message || '');

    if (!isSrvLookupFailure) {
      throw error;
    }

    dns.setServers(['8.8.8.8', '1.1.1.1']);
    await mongoose.connect(uri);
  }

  console.log(`Berhasil terhubung ke MongoDB (db: ${mongoose.connection.name})`);
}
