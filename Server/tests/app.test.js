import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createApp } from '../index.js';
import ChatLog from '../models/ChatLog.js';
import Session from '../models/Session.js';
import { handleIncomingMessage } from '../services/orchestratorService.js';
import { isNumericPhone, normalizePhone } from '../utils/phone.js';

describe('utils/phone', () => {
  it('menormalkan format 08xxx dan JID WhatsApp menjadi 628xxx', () => {
    assert.equal(normalizePhone('085794974290'), '6285794974290');
    assert.equal(normalizePhone('6285794974290@s.whatsapp.net'), '6285794974290');
    assert.equal(normalizePhone('628123456:12@s.whatsapp.net'), '628123456');
    assert.equal(normalizePhone('1234567890@lid'), '1234567890@lid');
    assert.equal(normalizePhone('lid:1234567890'), 'lid:1234567890');
  });

  it('membedakan nomor numerik valid dari JID @lid', () => {
    assert.equal(isNumericPhone('6285794974290'), true);
    assert.equal(isNumericPhone('1234567890@lid'), false);
    assert.equal(isNumericPhone('lid:1234567890'), false);
  });
});

describe('Express REST API & middleware', () => {
  let server;
  let baseUrl;
  const originalKey = process.env.DASHBOARD_API_KEY;
  const originalClientUrl = process.env.CLIENT_URL;

  beforeEach(async () => {
    delete process.env.DASHBOARD_API_KEY;
    process.env.CLIENT_URL = 'http://localhost:5173';
    const app = createApp();
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const { port } = server.address();
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (originalKey === undefined) delete process.env.DASHBOARD_API_KEY;
    else process.env.DASHBOARD_API_KEY = originalKey;

    if (originalClientUrl === undefined) delete process.env.CLIENT_URL;
    else process.env.CLIENT_URL = originalClientUrl;

    await new Promise((resolve) => server.close(resolve));
  });

  it('GET /api/health dan /api/wa/status mengembalikan struktur JSON standar', async () => {
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthBody = await healthRes.json();
    assert.equal(healthBody.success, true);
    assert.equal(healthBody.data.server, 'ok');
    assert.equal(healthBody.data.whatsapp, 'disconnected');

    const waRes = await fetch(`${baseUrl}/api/wa/status`);
    assert.equal(waRes.status, 200);
    const waBody = await waRes.json();
    assert.deepEqual(waBody, {
      success: true,
      data: { status: 'disconnected', qr: null, botNumber: null },
    });
  });

  it('mengaktifkan proteksi x-api-key ketika DASHBOARD_API_KEY diisi', async () => {
    process.env.DASHBOARD_API_KEY = 'rahasia-tim-alto';

    const unauthRes = await fetch(`${baseUrl}/api/wa/status`);
    assert.equal(unauthRes.status, 401);

    const authRes = await fetch(`${baseUrl}/api/wa/status`, {
      headers: { 'x-api-key': 'rahasia-tim-alto' },
    });
    assert.equal(authRes.status, 200);
  });

  it('memvalidasi input buruk pada /api/knowledge dan /api/sessions', async () => {
    const badKbPost = await fetch(`${baseUrl}/api/knowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'biaya', title: '' }),
    });
    assert.equal(badKbPost.status, 400);

    const badKbPut = await fetch(`${baseUrl}/api/knowledge/bukan-objectid`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Update' }),
    });
    assert.equal(badKbPut.status, 400);

    const badStatus = await fetch(`${baseUrl}/api/sessions/08123456789/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paused' }),
    });
    assert.equal(badStatus.status, 400);
  });
});

describe('orchestratorService', () => {
  const originalAdmin = process.env.ADMIN_PHONE;

  afterEach(() => {
    if (originalAdmin === undefined) delete process.env.ADMIN_PHONE;
    else process.env.ADMIN_PHONE = originalAdmin;
  });

  it('memproses perintah !aktif dari ADMIN_PHONE dan mengaktifkan sesi target', async (t) => {
    process.env.ADMIN_PHONE = '085794974290';
    let saved = false;
    const fakeSession = {
      phone: '6281234567890',
      status: 'escalated',
      lastInteractionAt: new Date(0),
      async save() {
        saved = true;
      },
    };

    t.mock.method(Session, 'findOne', async ({ phone }) =>
      phone === '6281234567890' ? fakeSession : null
    );

    const res = await handleIncomingMessage({
      phone: '6285794974290',
      text: '!aktif 081234567890',
      isMedia: false,
    });

    assert.equal(saved, true);
    assert.equal(fakeSession.status, 'active');
    assert.match(res.replyText, /6281234567890/);
    assert.equal(res.notifyAdminText, null);
  });

  it('mengabaikan pesan ketika sesi user berstatus escalated dan tetap mencatat log', async (t) => {
    process.env.ADMIN_PHONE = '6285794974290';
    const logged = [];

    t.mock.method(Session, 'findOneAndUpdate', async () => ({
      phone: '628111222333',
      status: 'escalated',
    }));
    t.mock.method(ChatLog, 'create', async (doc) => {
      logged.push(doc);
      return doc;
    });

    const res = await handleIncomingMessage({
      phone: '08111222333',
      text: 'halo admin masih nunggu nih',
      isMedia: false,
    });

    assert.equal(res, null);
    assert.equal(logged.length, 1);
    assert.equal(logged[0].role, 'user');
  });

  it('mengembalikan balasan standar untuk media non-teks pada sesi active', async (t) => {
    t.mock.method(Session, 'findOneAndUpdate', async () => ({
      phone: '628111222444',
      status: 'active',
    }));

    const res = await handleIncomingMessage({
      phone: '08111222444',
      text: '',
      isMedia: true,
    });

    assert.match(res.replyText, /pesan berupa teks saja/i);
    assert.equal(res.notifyAdminText, null);
  });
});
