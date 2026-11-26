import { Router } from 'express';
import ChatLog from '../models/ChatLog.js';
import Session from '../models/Session.js';
import { sendSafeWhatsAppMessage } from '../services/waBridge.js';
import { normalizePhone } from '../utils/phone.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status && ['active', 'escalated'].includes(req.query.status)) {
      filter.status = req.query.status;
    }

    const sessions = await Session.find(filter)
      .sort({ lastInteractionAt: -1 })
      .lean();

    const phones = sessions.map((s) => s.phone);
    const latestLogs = phones.length
      ? await ChatLog.aggregate([
          { $match: { phone: { $in: phones } } },
          { $sort: { createdAt: -1 } },
          {
            $group: {
              _id: '$phone',
              lastMessage: { $first: '$message' },
              lastRole: { $first: '$role' },
              lastMessageAt: { $first: '$createdAt' },
            },
          },
        ])
      : [];

    const latestByPhone = new Map(latestLogs.map((log) => [log._id, log]));

    const data = sessions.map((session) => {
      const latest = latestByPhone.get(session.phone);
      return {
        ...session,
        lastMessage: latest?.lastMessage || null,
        lastRole: latest?.lastRole || null,
        lastMessageAt: latest?.lastMessageAt || session.lastInteractionAt,
      };
    });

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

router.get('/:phone/logs', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.params.phone);
    if (!phone) {
      return res.status(400).json({
        success: false,
        error: 'Nomor telepon tidak valid',
      });
    }

    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 200)
        : 50;

    const [session, logsDesc] = await Promise.all([
      Session.findOne({ phone }).lean(),
      ChatLog.find({ phone }).sort({ createdAt: -1 }).limit(limit).lean(),
    ]);

    if (!session && logsDesc.length === 0) {
      return res.status(404).json({
        success: false,
        error: `Sesi untuk nomor ${phone} tidak ditemukan`,
      });
    }

    res.json({
      success: true,
      data: {
        session: session || { phone, status: 'active' },
        logs: logsDesc.reverse(),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/:phone/status', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const { status } = req.body || {};

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: 'Nomor telepon tidak valid',
      });
    }

    if (!['active', 'escalated'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Status harus bernilai "active" atau "escalated"',
      });
    }

    const updated = await Session.findOneAndUpdate(
      { phone },
      { $set: { status, lastInteractionAt: new Date() } },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({
        success: false,
        error: `Sesi untuk nomor ${phone} tidak ditemukan`,
      });
    }

    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

router.post('/:phone/reply', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const message =
      typeof req.body?.message === 'string' ? req.body.message.trim() : '';

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: 'Nomor telepon tidak valid',
      });
    }

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'Isi pesan (message) wajib diisi',
      });
    }

    await sendSafeWhatsAppMessage(phone, message);

    const now = new Date();
    const [session, log] = await Promise.all([
      Session.findOneAndUpdate(
        { phone },
        {
          $set: { lastInteractionAt: now },
          $setOnInsert: { phone, status: 'active' },
        },
        { upsert: true, new: true }
      ).lean(),
      ChatLog.create({ phone, role: 'model', message }),
    ]);

    res.status(201).json({
      success: true,
      data: { session, log },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
