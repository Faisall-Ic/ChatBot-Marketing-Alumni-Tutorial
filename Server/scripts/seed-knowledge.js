import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import KnowledgeBase from '../models/KnowledgeBase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SAMPLE_KNOWLEDGE = [
  {
    category: 'program',
    title: 'Program Bimbingan Alumni Tutorial (ALTO)',
    content:
      '[CONTOH DATA TESTING] Alumni Tutorial menyediakan program: (1) Intensif UTBK-SNBT untuk kelas 12 SMA/SMK & Gap Year, (2) Reguler Pendampingan Sekolah kelas 10–12 SMA/SMK, dan (3) Tryout & Klinik Soal Mingguan.',
  },
  {
    category: 'biaya',
    title: 'Rincian Biaya Program (Contoh Testing)',
    content:
      '[CONTOH DATA TESTING] Program Reguler mulai Rp 350.000/bulan. Program Intensif UTBK-SNBT paket semester Rp 2.500.000 (dapat dicicil 2x sesuai ketentuan resmi). Biaya pendaftaran awal Rp 100.000.',
  },
  {
    category: 'jadwal',
    title: 'Jadwal Kelas & Jam Operasional',
    content:
      '[CONTOH DATA TESTING] Kelas dilaksanakan Senin–Jumat pukul 15.30–17.30 WIB atau Sabtu pukul 09.00–12.00 WIB. Kantor admin buka Senin–Sabtu pukul 08.00–17.00 WIB.',
  },
  {
    category: 'faq',
    title: 'Fasilitas & Metode Belajar',
    content:
      '[CONTOH DATA TESTING] Peserta mendapatkan modul cetak & digital, akses bank soal tryout berkala, konsultasi jurusan kuliah, serta laporan perkembangan belajar untuk orang tua.',
  },
  {
    category: 'link_pendaftaran',
    title: 'Alur & Link Pendaftaran Resmi',
    content:
      '[CONTOH DATA TESTING] Pendaftaran dilakukan secara online dengan mengisi Google Form resmi Alumni Tutorial. Setelah mengisi form, admin akan menghubungi untuk konfirmasi jadwal penempatan kelas.',
  },
];

async function seed() {
  await connectDB();

  const force = process.argv.includes('--force');
  const existingCount = await KnowledgeBase.countDocuments();

  if (existingCount > 0 && !force) {
    console.log(
      `Koleksi knowledge_base sudah berisi ${existingCount} data. Lewati seed (gunakan --force untuk menambah ulang).`
    );
    await mongoose.disconnect();
    return;
  }

  if (force && existingCount > 0) {
    await KnowledgeBase.deleteMany({});
  }

  const inserted = await KnowledgeBase.insertMany(SAMPLE_KNOWLEDGE);
  console.log(`Berhasil mengisi ${inserted.length} data contoh ke knowledge_base.`);
  await mongoose.disconnect();
}

seed().catch(async (error) => {
  console.error('Gagal menjalankan seed knowledge_base:', error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
