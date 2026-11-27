import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createApp } from '../index.js';
import ChatLog from '../models/ChatLog.js';
import Session from '../models/Session.js';
import { buildChatLogFilter } from '../services/aiService.js';
import { handleIncomingMessage } from '../services/orchestratorService.js';
import {
  getEscalationTimeoutMs,
  isEscalationExpired,
} from '../utils/escalation.js';
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
  const savedEnv = {};
  const trackedKeys = [
    'DASHBOARD_API_KEY',
    'CLIENT_URL',
    'ADMIN_USERNAME',
    'ADMIN_PASSWORD',
    'JWT_SECRET',
  ];

  beforeEach(async () => {
    for (const key of trackedKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
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
    for (const key of trackedKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }

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

  it('memproses login admin (.env) dan melindungi endpoint dengan JWT Bearer token', async () => {
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'password-test-alto';
    process.env.JWT_SECRET = 'jwt-secret-test-alto-32-chars-min';

    const noTokenRes = await fetch(`${baseUrl}/api/wa/status`);
    assert.equal(noTokenRes.status, 401);

    const badPassRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'salah' }),
    });
    assert.equal(badPassRes.status, 401);

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: 'password-test-alto',
      }),
    });
    assert.equal(loginRes.status, 200);
    const loginBody = await loginRes.json();
    assert.equal(loginBody.success, true);
    assert.equal(loginBody.data.tokenType, 'Bearer');
    assert.ok(loginBody.data.token);

    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${loginBody.data.token}` },
    });
    assert.equal(meRes.status, 200);
    const meBody = await meRes.json();
    assert.deepEqual(meBody.data, { username: 'admin', role: 'admin' });

    const invalidTokenRes = await fetch(`${baseUrl}/api/wa/status`, {
      headers: { Authorization: `Bearer ${loginBody.data.token}x` },
    });
    assert.equal(invalidTokenRes.status, 401);
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
    assert.ok(fakeSession.contextResetAt instanceof Date);
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

  it('membatasi riwayat chat AI hanya setelah contextResetAt saat sesi direset', () => {
    const resetAt = new Date('2026-11-27T07:36:00.000Z');
    assert.deepEqual(buildChatLogFilter('6285794974290', null), {
      phone: '6285794974290',
    });
    assert.deepEqual(buildChatLogFilter('6285794974290', resetAt), {
      phone: '6285794974290',
      createdAt: { $gt: resetAt },
    });
  });

  it('PATCH /api/sessions/:phone/status mengatur contextResetAt saat diubah ke active', async (t) => {
    let capturedUpdate = null;
    t.mock.method(Session, 'findOneAndUpdate', (_filter, update) => {
      capturedUpdate = update;
      return {
        lean: async () => ({
          phone: '6285794974290',
          status: 'active',
          contextResetAt: update.$set.contextResetAt,
        }),
      };
    });

    const app = createApp();
    const srv = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const savedEnv = {
      ADMIN_USERNAME: process.env.ADMIN_USERNAME,
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
      JWT_SECRET: process.env.JWT_SECRET,
      DASHBOARD_API_KEY: process.env.DASHBOARD_API_KEY,
    };

    try {
      delete process.env.ADMIN_USERNAME;
      delete process.env.ADMIN_PASSWORD;
      delete process.env.JWT_SECRET;
      delete process.env.DASHBOARD_API_KEY;

      const res = await fetch(
        `http://127.0.0.1:${srv.address().port}/api/sessions/085794974290/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'active' }),
        }
      );
      assert.equal(res.status, 200);
      assert.equal(capturedUpdate.$set.status, 'active');
      assert.equal(capturedUpdate.$set.escalatedAt, null);
      assert.ok(capturedUpdate.$set.contextResetAt instanceof Date);
    } finally {
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await new Promise((resolve) => srv.close(resolve));
    }
  });

  it('mengaktifkan kembali sesi escalated secara otomatis setelah melewati batas waktu 12 jam', async (t) => {
    const savedTimeout = process.env.ESCALATION_TIMEOUT_HOURS;
    process.env.ESCALATION_TIMEOUT_HOURS = '12';

    try {
      assert.equal(getEscalationTimeoutMs(), 12 * 60 * 60 * 1000);

      const elevenHoursAgo = new Date(Date.now() - 11 * 60 * 60 * 1000);
      const thirteenHoursAgo = new Date(Date.now() - 13 * 60 * 60 * 1000);

      assert.equal(
        isEscalationExpired({ status: 'escalated', escalatedAt: elevenHoursAgo }),
        false
      );
      assert.equal(
        isEscalationExpired({ status: 'escalated', escalatedAt: thirteenHoursAgo }),
        true
      );

      let saved = false;
      const expiredSession = {
        phone: '628111222555',
        status: 'escalated',
        escalatedAt: thirteenHoursAgo,
        contextResetAt: null,
        async save() {
          saved = true;
        },
      };

      t.mock.method(Session, 'findOneAndUpdate', async () => expiredSession);

      const res = await handleIncomingMessage({
        phone: '08111222555',
        text: '',
        isMedia: true,
      });

      assert.equal(saved, true);
      assert.equal(expiredSession.status, 'active');
      assert.equal(expiredSession.escalatedAt, null);
      assert.ok(expiredSession.contextResetAt instanceof Date);
      assert.match(res.replyText, /pesan berupa teks saja/i);
    } finally {
      if (savedTimeout === undefined) delete process.env.ESCALATION_TIMEOUT_HOURS;
      else process.env.ESCALATION_TIMEOUT_HOURS = savedTimeout;
    }
  });
});
