import path from 'path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { handleIncomingMessage } from '../services/orchestratorService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('Error: MONGODB_URI di file .env masih kosong.');
    process.exit(1);
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error('Error: GEMINI_API_KEY di file .env masih kosong.');
    process.exit(1);
  }

  await connectDB();

  const testUserPhone = '628999000111';
  const adminPhone = process.env.ADMIN_PHONE || '6285794974290';

  console.log('\n=== SIMULATOR CHATBOT ALTO (TANPA WHATSAPP) ===');
  console.log(`Nomor user simulasi : ${testUserPhone}`);
  console.log(`Nomor admin (.env)  : ${adminPhone}`);
  console.log('Perintah khusus simulator:');
  console.log('  /media          -> simulasi kirim gambar/stiker');
  console.log('  /admin <pesan>  -> kirim pesan sebagai admin (contoh: /admin !aktif 628999000111)');
  console.log('  /exit           -> keluar\n');

  const rl = readline.createInterface({ input, output });

  try {
    while (true) {
      const rawInput = (await rl.question('Kamu > ')).trim();
      if (!rawInput) continue;
      if (rawInput === '/exit') break;

      let payload;
      if (rawInput === '/media') {
        payload = { phone: testUserPhone, text: '', isMedia: true, pushName: 'Tester' };
      } else if (rawInput.startsWith('/admin ')) {
        payload = {
          phone: adminPhone,
          text: rawInput.slice('/admin '.length).trim(),
          isMedia: false,
          pushName: 'Admin ALTO',
        };
      } else {
        payload = {
          phone: testUserPhone,
          text: rawInput,
          isMedia: false,
          pushName: 'Tester',
        };
      }

      const result = await handleIncomingMessage(payload);

      if (!result) {
        console.log('Bot  > [DIAM — sesi sedang escalated]\n');
        continue;
      }

      if (result.replyText) {
        console.log(`Bot  > ${result.replyText}\n`);
      }

      if (result.notifyAdminText) {
        console.log(`--- [NOTIFIKASI KE ADMIN ${adminPhone}] ---`);
        console.log(result.notifyAdminText);
        console.log('-------------------------------------------\n');
      }
    }
  } finally {
    rl.close();
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('Simulator error:', err);
  process.exit(1);
});
