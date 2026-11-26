import ChatLog from '../models/ChatLog.js';
import Session from '../models/Session.js';
import { isNumericPhone, normalizePhone } from '../utils/phone.js';
import { generateMarketingReply } from './aiService.js';

const MEDIA_FALLBACK_MESSAGE =
  'Halo Kak/Bapak/Ibu, mohon maaf saat ini asisten otomatis Alumni Tutorial hanya dapat memproses pesan berupa teks saja (belum dapat membaca gambar, stiker, audio, atau dokumen).\n\nSilakan ketik pertanyaan seputar program, biaya, jadwal, atau cara pendaftaran dalam bentuk teks agar bisa langsung dibantu ya!';

const AI_ERROR_FALLBACK_MESSAGE =
  'Mohon maaf Kak/Bapak/Ibu, sistem asisten otomatis sedang mengalami gangguan sementara. Silakan coba kirim ulang pesan beberapa saat lagi ya.';

async function handleAdminCommand({ senderPhone, text }) {
  const adminPhone = normalizePhone(process.env.ADMIN_PHONE || '');
  if (!adminPhone || senderPhone !== adminPhone) {
    return { handled: false };
  }

  const trimmed = (text || '').trim();
  if (!/^!aktif\b/i.test(trimmed)) {
    return { handled: false };
  }

  const rawTarget = trimmed.replace(/^!aktif\b/i, '').trim();
  if (!rawTarget) {
    return {
      handled: true,
      result: {
        replyText:
          'Format perintah belum lengkap.\nGunakan: *!aktif <nomor_user>*\nContoh: !aktif 081234567890',
        notifyAdminText: null,
      },
    };
  }

  const targetPhone = normalizePhone(rawTarget);
  const session = await Session.findOne({ phone: targetPhone });

  if (!session) {
    return {
      handled: true,
      result: {
        replyText: `Sesi untuk nomor *${targetPhone}* tidak ditemukan di database.`,
        notifyAdminText: null,
      },
    };
  }

  session.status = 'active';
  session.lastInteractionAt = new Date();
  await session.save();

  return {
    handled: true,
    result: {
      replyText: `Bot berhasil diaktifkan kembali (*active*) untuk nomor *${targetPhone}*.`,
      notifyAdminText: null,
    },
  };
}

function buildAdminEscalationNotification({
  phone,
  pushName,
  userMessage,
  reason,
}) {
  const displayName = pushName ? `${pushName} (${phone})` : phone;
  const waLink = isNumericPhone(phone)
    ? `https://wa.me/${phone}`
    : '(Akun WA @lid — balas melalui WA Web/Dashboard)';

  return [
    '*[ESKALASI CHATBOT ALTO]*',
    `Pengguna: ${displayName}`,
    `Link WA: ${waLink}`,
    `Alasan: ${reason || 'Memerlukan penanganan admin'}`,
    `Pesan terakhir: "${userMessage}"`,
    '',
    `Jika sudah selesai ditangani, balas ke bot: *!aktif ${phone}*`,
  ].join('\n');
}

/**
 * Orkestrator utama pesan WhatsApp masuk dari whatsappService.
 * Mengembalikan { replyText, notifyAdminText } atau null jika bot harus diam.
 */
export async function handleIncomingMessage({
  phone,
  text = '',
  isMedia = false,
  pushName = '',
}) {
  const senderPhone = normalizePhone(phone);
  if (!senderPhone) return null;

  if (!isMedia) {
    const adminCheck = await handleAdminCommand({ senderPhone, text });
    if (adminCheck.handled) {
      return adminCheck.result;
    }
  }

  const now = new Date();
  const session = await Session.findOneAndUpdate(
    { phone: senderPhone },
    {
      $set: { lastInteractionAt: now },
      $setOnInsert: { phone: senderPhone, status: 'active' },
    },
    { upsert: true, new: true }
  );

  if (session.status === 'escalated') {
    const incomingLog = isMedia ? '[Media non-teks]' : text.trim();
    if (incomingLog) {
      await ChatLog.create({
        phone: senderPhone,
        role: 'user',
        message: incomingLog,
      });
    }
    return null;
  }

  if (isMedia) {
    return {
      replyText: MEDIA_FALLBACK_MESSAGE,
      notifyAdminText: null,
    };
  }

  const cleanText = text.trim();
  if (!cleanText) return null;

  let aiResult;
  try {
    aiResult = await generateMarketingReply({
      phone: senderPhone,
      userMessage: cleanText,
      pushName,
    });
  } catch (error) {
    console.error('Gagal memproses pesan dengan Gemini API:', error.message);
    return {
      replyText: AI_ERROR_FALLBACK_MESSAGE,
      notifyAdminText: null,
    };
  }

  await ChatLog.insertMany([
    { phone: senderPhone, role: 'user', message: cleanText },
    { phone: senderPhone, role: 'model', message: aiResult.reply },
  ]);

  if (aiResult.intent === 'escalate') {
    session.status = 'escalated';
    session.lastInteractionAt = new Date();
    await session.save();

    return {
      replyText: aiResult.reply,
      notifyAdminText: buildAdminEscalationNotification({
        phone: senderPhone,
        pushName,
        userMessage: cleanText,
        reason: aiResult.escalationReason,
      }),
    };
  }

  return {
    replyText: aiResult.reply,
    notifyAdminText: null,
  };
}
