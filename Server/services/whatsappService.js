import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.resolve(__dirname, '../auth_info_baileys');
const RECONNECT_DELAY_MS = 3000;
const TYPING_MIN_MS = 1200;
const TYPING_MAX_MS = 1800;

const WRAPPER_KEYS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
];

const MEDIA_MESSAGE_KEYS = [
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'stickerMessage',
  'documentMessage',
  'documentWithCaptionMessage',
  'contactMessage',
  'contactsArrayMessage',
  'locationMessage',
  'liveLocationMessage',
  'ptvMessage',
];

let activeSock = null;
let incomingMessageHandler = null;
let reconnectTimer = null;

/** @type {{ status: 'disconnected' | 'connecting' | 'qr' | 'connected', qr: string | null, botNumber: string | null }} */
let waState = {
  status: 'disconnected',
  qr: null,
  botNumber: null,
};

/**
 * Cache sementara mapping identifier `@lid` -> JID `@lid` asli ketika nomor HP asli
 * belum tersedia, agar balasan tetap dapat dikirim ke JID `@lid` tujuan.
 */
const lidJidMap = new Map();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Menormalisasi nomor telepon atau JID WhatsApp menjadi digit murni berawalan 62 (jika diawali 08).
 * @param {string} rawPhone
 * @returns {string}
 */
export function normalizePhone(rawPhone) {
  if (!rawPhone) return '';
  const withoutJid = String(rawPhone).split('@')[0].split(':')[0];
  const digits = withoutJid.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('08')) {
    return `62${digits.slice(1)}`;
  }
  return digits;
}

/**
 * Mengembalikan salinan status koneksi WhatsApp terkini untuk monitoring & QR Dashboard.
 */
export function getWaStatus() {
  return { ...waState };
}

/**
 * Mengubah target (nomor HP, key mapping `@lid`, atau JID lengkap) menjadi JID WhatsApp valid.
 */
function resolveTargetJid(target) {
  const raw = String(target ?? '').trim();
  if (!raw) {
    throw new Error('Target penerima WhatsApp tidak boleh kosong.');
  }

  if (raw.includes('@')) {
    return raw;
  }

  if (lidJidMap.has(raw)) {
    return lidJidMap.get(raw);
  }

  const normalized = normalizePhone(raw);
  if (!normalized) {
    throw new Error(`Nomor tujuan WhatsApp tidak valid: "${raw}"`);
  }

  if (lidJidMap.has(normalized)) {
    return lidJidMap.get(normalized);
  }

  return `${normalized}@s.whatsapp.net`;
}

/**
 * Mengirim pesan teks WhatsApp dengan simulasi pengetikan alami (composing -> jeda -> paused -> send).
 * @param {string} target Nomor HP, key LID, atau JID WhatsApp tujuan
 * @param {string} text Isi pesan teks
 */
export async function sendWhatsAppMessage(target, text) {
  if (waState.status !== 'connected' || !activeSock) {
    throw new Error('WhatsApp belum terhubung. Pastikan sesi WhatsApp sudah tersambung.');
  }

  const jid = resolveTargetJid(target);
  const typingMs =
    TYPING_MIN_MS + Math.floor(Math.random() * (TYPING_MAX_MS - TYPING_MIN_MS + 1));

  await activeSock.sendPresenceUpdate('composing', jid);
  await delay(typingMs);
  await activeSock.sendPresenceUpdate('paused', jid);
  await activeSock.sendMessage(jid, { text });
}

/**
 * Membuka wrapper pesan WhatsApp (ephemeral / viewOnce) untuk mendapatkan konten utama.
 */
function unwrapMessageContent(message) {
  let current = message;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const wrapperKey = WRAPPER_KEYS.find((key) => current[key]?.message);
    if (!wrapperKey) break;
    current = current[wrapperKey].message;
  }
  return current;
}

/**
 * Mengekstrak konten pesan menjadi teks murni atau penanda media non-teks (caption diabaikan).
 * Mengembalikan null untuk event sistem yang harus diabaikan.
 */
function extractMessagePayload(rawMessage) {
  const content = unwrapMessageContent(rawMessage);
  if (!content) return null;

  const isMedia = MEDIA_MESSAGE_KEYS.some((key) => Boolean(content[key]));
  if (isMedia) {
    return { text: '', isMedia: true };
  }

  const text = content.conversation || content.extendedTextMessage?.text || '';
  if (text.trim()) {
    return { text, isMedia: false };
  }

  return null;
}

/**
 * Menyelesaikan nomor pengirim yang ternormalisasi (atau key LID jika PN tidak tersedia).
 */
async function resolveSenderPhone(sock, msg, remoteJid) {
  if (remoteJid.endsWith('@s.whatsapp.net')) {
    return normalizePhone(remoteJid);
  }

  const altJid = msg.key?.remoteJidAlt;
  if (altJid && altJid.endsWith('@s.whatsapp.net')) {
    const normalizedAlt = normalizePhone(altJid);
    if (normalizedAlt) return normalizedAlt;
  }

  try {
    const mappedPn = await sock.signalRepository?.lidMapping?.getPNForLID(remoteJid);
    if (mappedPn) {
      const normalizedPn = normalizePhone(mappedPn);
      if (normalizedPn) return normalizedPn;
    }
  } catch (err) {
    console.warn('[WhatsApp] Gagal membaca lidMapping untuk', remoteJid, ':', err.message);
  }

  // Fallback jika nomor HP asli belum tersedia: simpan mapping JID @lid agar tetap bisa dibalas.
  const rawLidId = remoteJid.split('@')[0].split(':')[0];
  const lidKey = `lid:${rawLidId}`;
  lidJidMap.set(lidKey, remoteJid);
  lidJidMap.set(rawLidId, remoteJid);
  return lidKey;
}

/**
 * Memproses satu pesan masuk dan mengeksekusi instruksi balasan / notifikasi admin secara terpisah.
 */
async function handleSingleMessage(sock, msg) {
  if (!msg?.message) return;
  if (msg.key?.fromMe === true) return;

  const remoteJid = msg.key?.remoteJid || '';
  const isAllowedChat =
    remoteJid.endsWith('@s.whatsapp.net') || remoteJid.endsWith('@lid');
  if (!isAllowedChat) return;

  const extracted = extractMessagePayload(msg.message);
  if (!extracted) return;

  const phone = await resolveSenderPhone(sock, msg, remoteJid);
  if (!phone) return;

  if (typeof incomingMessageHandler !== 'function') return;

  const response = await incomingMessageHandler({
    phone,
    text: extracted.text,
    isMedia: extracted.isMedia,
    pushName: msg.pushName || '',
  });

  if (!response) return;

  if (typeof response.replyText === 'string' && response.replyText.trim()) {
    try {
      await sendWhatsAppMessage(phone, response.replyText);
    } catch (err) {
      console.error('[WhatsApp] Gagal mengirim balasan ke user:', err.message);
    }
  }

  if (typeof response.notifyAdminText === 'string' && response.notifyAdminText.trim()) {
    const adminPhone = normalizePhone(process.env.ADMIN_PHONE);
    if (!adminPhone) {
      console.warn('[WhatsApp] ADMIN_PHONE kosong/belum diisi; notifikasi admin dilewati.');
    } else {
      try {
        await sendWhatsAppMessage(adminPhone, response.notifyAdminText);
      } catch (err) {
        console.error('[WhatsApp] Gagal mengirim notifikasi ke admin:', err.message);
      }
    }
  }
}

/**
 * Menjadwalkan reconnect tunggal setelah jeda untuk mencegah spam loop saat koneksi terputus.
 */
function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectSocket().catch((err) => {
      console.error('[WhatsApp] Gagal melakukan reconnect:', err.message);
      scheduleReconnect();
    });
  }, RECONNECT_DELAY_MS);
}

async function connectSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    ...(version ? { version } : {}),
  });

  activeSock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n[WhatsApp] Scan QR Code di bawah ini untuk menghubungkan bot:');
      qrcode.generate(qr, { small: true });
      waState = { status: 'qr', qr, botNumber: null };
    }

    if (connection === 'connecting') {
      waState = { status: 'connecting', qr: null, botNumber: null };
    }

    if (connection === 'open') {
      const botNumber = normalizePhone(sock.user?.id || '');
      waState = {
        status: 'connected',
        qr: null,
        botNumber: botNumber || null,
      };
      console.log(`[WhatsApp] Terhubung sebagai ${waState.botNumber || 'unknown'}`);
    }

    if (connection === 'close') {
      if (activeSock === sock) {
        activeSock = null;
      }
      waState = { status: 'disconnected', qr: null, botNumber: null };

      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        try {
          if (fs.existsSync(AUTH_DIR)) {
            for (const entry of fs.readdirSync(AUTH_DIR)) {
              fs.rmSync(path.join(AUTH_DIR, entry), {
                recursive: true,
                force: true,
              });
            }
          }
        } catch (err) {
          console.error('[WhatsApp] Gagal membersihkan sesi lama:', err.message);
        }

        console.warn(
          `[WhatsApp] Sesi WhatsApp telah logout. Sesi lama dibersihkan otomatis, menyiapkan QR baru dalam ${RECONNECT_DELAY_MS / 1000} detik...`
        );
        scheduleReconnect();
        return;
      }

      console.warn(
        `[WhatsApp] Koneksi terputus (kode: ${statusCode ?? 'unknown'}). Mencoba sambung ulang dalam ${RECONNECT_DELAY_MS / 1000} detik...`
      );
      scheduleReconnect();
    }
  });

  sock.ev.on('messages.upsert', async (upsert) => {
    if (upsert.type !== 'notify') return;

    for (const msg of upsert.messages || []) {
      try {
        await handleSingleMessage(sock, msg);
      } catch (err) {
        console.error('[WhatsApp] Error saat memproses pesan masuk:', err);
      }
    }
  });
}

/**
 * Menginisialisasi koneksi gateway WhatsApp dan mendaftarkan callback pemroses pesan masuk.
 * @param {(payload: { phone: string, text: string, isMedia: boolean, pushName: string }) => Promise<{ replyText?: string, notifyAdminText?: string } | null | undefined>} onIncomingMessage
 */
export async function startWhatsApp(onIncomingMessage) {
  incomingMessageHandler = onIncomingMessage;
  await connectSocket();
}
