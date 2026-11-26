import { GoogleGenAI, Type } from '@google/genai';
import ChatLog from '../models/ChatLog.js';
import KnowledgeBase from '../models/KnowledgeBase.js';

const CHAT_HISTORY_LIMIT = 8;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    intent: {
      type: Type.STRING,
      enum: ['marketing', 'register', 'escalate', 'out_of_knowledge'],
      description:
        'marketing: pertanyaan program/biaya/jadwal/faq; register: ingin daftar atau tanya cara/link daftar; escalate: komplain, nego diskon/harga khusus, atau di luar topik bimbel; out_of_knowledge: pertanyaan bimbel yang datanya tidak ada di knowledge base.',
    },
    reply: {
      type: Type.STRING,
      description:
        'Balasan sopan dan ringkas untuk WhatsApp sesuai persona Alumni Tutorial.',
    },
    escalationReason: {
      type: Type.STRING,
      description:
        'Alasan singkat jika intent adalah escalate, selain itu isi string kosong.',
    },
  },
  required: ['intent', 'reply', 'escalationReason'],
};

let cachedClient = null;
let cachedKey = null;

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY belum diisi di file .env');
  }

  if (!cachedClient || cachedKey !== apiKey) {
    cachedClient = new GoogleGenAI({ apiKey });
    cachedKey = apiKey;
  }

  return cachedClient;
}

function formatKnowledgeContext(items, googleFormUrl) {
  const sections = items.map(
    (item, index) =>
      `${index + 1}. [${item.category}] ${item.title}\n${item.content}`
  );

  const kbText =
    sections.length > 0
      ? sections.join('\n\n')
      : '(Data knowledge_base saat ini masih kosong di database.)';

  return `${kbText}\n\nLink Google Form Pendaftaran Resmi:\n${googleFormUrl}`;
}

function buildSystemInstruction(knowledgeContext, pushName) {
  const userNameHint = pushName ? `Nama tampilan WA pengguna: "${pushName}".` : '';

  return `Kamu adalah Asisten Marketing Resmi Alumni Tutorial (ALTO), sebuah bimbingan belajar untuk siswa SMA/SMK/Gap Year dan orang tua siswa.

${userNameHint}

ATURAN WAJIB:
1. GAYA BAHASA & SAPAAN:
   - Gunakan bahasa Indonesia yang semi-formal, ramah, sopan, komunikatif, dan ringkas.
   - Sapa dengan "Kak" (untuk calon siswa) atau "Bapak/Ibu" (jika konteks menunjukkan orang tua).
   - Format pesan agar nyaman dibaca di WhatsApp: gunakan baris baru atau bullet points singkat, hindari paragraf terlalu panjang.

2. BEBAS HALUSINASI (STRICT GROUNDING):
   - Jawab HANYA berdasarkan DATA RESMI ALUMNI TUTORIAL di bawah ini.
   - DILARANG KERAS mengarang harga, promo, jadwal, program, atau fasilitas yang tidak tertulis di data.
   - Jika data yang ditanyakan tidak ditemukan di knowledge base, set intent = "out_of_knowledge", sampaikan dengan sopan bahwa informasi tersebut belum tersedia di sistem, dan arahkan untuk menunggu/menghubungi admin resmi Alumni Tutorial.

3. PENDAFTARAN (GOOGLE FORM):
   - Jika pengguna menyatakan ingin mendaftar, tertarik bergabung, atau menanyakan cara pendaftaran, set intent = "register" dan WAJIB sertakan link Google Form pendaftaran resmi yang ada di data.

4. WAJIB HUMAN HANDOFF (ESKALASI):
   - Set intent = "escalate" dan tulis escalationReason apabila pengguna:
     a. Menyampaikan keluhan/komplain terkait layanan, pengajar, atau fasilitas.
     b. Meminta negosiasi harga, potongan biaya, cicilan khusus, atau diskon di luar informasi resmi.
     c. Membahas atau menanyakan hal di luar operasional bimbingan belajar Alumni Tutorial.
   - Untuk intent = "escalate", isi reply dengan pesan pengalihan yang sopan bahwa percakapan akan diteruskan ke Admin Alumni Tutorial untuk dibantu lebih lanjut.

=== DATA RESMI ALUMNI TUTORIAL (KNOWLEDGE BASE) ===
${knowledgeContext}`;
}

function buildConversationContents(historyRows, latestUserMessage) {
  const contents = [];

  for (const row of historyRows) {
    if (!row?.message) continue;
    contents.push({
      role: row.role === 'model' ? 'model' : 'user',
      parts: [{ text: row.message }],
    });
  }

  contents.push({
    role: 'user',
    parts: [{ text: latestUserMessage }],
  });

  return contents;
}

/**
 * Menghasilkan balasan terstruktur dari Gemini API berdasarkan Knowledge Base
 * dan riwayat percakapan terakhir di MongoDB.
 */
export async function generateMarketingReply({ phone, userMessage, pushName = '' }) {
  const ai = getGeminiClient();
  const primaryModel = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const fallbackModel =
    process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite';
  const candidateModels = [...new Set([primaryModel, fallbackModel].filter(Boolean))];
  const googleFormUrl =
    process.env.GOOGLE_FORM_URL || 'https://forms.gle/PLACEHOLDER_GANTI_LINK_ASLI';

  const [knowledgeItems, recentLogsDesc] = await Promise.all([
    KnowledgeBase.find({}).sort({ category: 1, title: 1 }).lean(),
    ChatLog.find({ phone })
      .sort({ createdAt: -1 })
      .limit(CHAT_HISTORY_LIMIT)
      .lean(),
  ]);

  const historyChronological = recentLogsDesc.reverse();
  const knowledgeContext = formatKnowledgeContext(knowledgeItems, googleFormUrl);
  const systemInstruction = buildSystemInstruction(knowledgeContext, pushName);
  const contents = buildConversationContents(historyChronological, userMessage);

  let response;
  let lastError;
  for (const model of candidateModels) {
    try {
      response = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction,
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      });
      break;
    } catch (error) {
      lastError = error;
      const isRecoverable = [404, 429, 503].includes(error?.status);
      if (!isRecoverable) {
        throw error;
      }
      console.warn(
        `Model ${model} gagal (${error?.status}), mencoba model fallback...`
      );
    }
  }

  if (!response) {
    throw lastError;
  }

  const rawText = response.text || '';
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`Respon Gemini bukan JSON valid: ${rawText.slice(0, 200)}`);
  }

  const intent = ['marketing', 'register', 'escalate', 'out_of_knowledge'].includes(
    parsed?.intent
  )
    ? parsed.intent
    : 'marketing';

  let reply = typeof parsed?.reply === 'string' ? parsed.reply.trim() : '';
  if (!reply) {
    reply =
      'Mohon maaf Kak, pesan Kakak sedang kami teruskan ke Admin Alumni Tutorial untuk dibantu lebih lanjut ya.';
  }

  if (intent === 'register' && googleFormUrl && !reply.includes(googleFormUrl)) {
    reply = `${reply}\n\nSilakan isi formulir pendaftaran resmi melalui tautan berikut:\n${googleFormUrl}`;
  }

  return {
    intent,
    reply,
    escalationReason:
      typeof parsed?.escalationReason === 'string'
        ? parsed.escalationReason.trim()
        : '',
  };
}
