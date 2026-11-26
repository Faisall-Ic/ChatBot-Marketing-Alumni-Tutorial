import { Router } from 'express';
import mongoose from 'mongoose';
import KnowledgeBase from '../models/KnowledgeBase.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const filter = {};
    if (typeof req.query.category === 'string' && req.query.category.trim()) {
      filter.category = req.query.category.trim();
    }

    if (typeof req.query.q === 'string' && req.query.q.trim()) {
      const escaped = req.query.q
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$or = [{ title: regex }, { content: regex }, { category: regex }];
    }

    const items = await KnowledgeBase.find(filter)
      .sort({ category: 1, updatedAt: -1 })
      .lean();

    res.json({ success: true, data: items });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const category =
      typeof req.body?.category === 'string' ? req.body.category.trim() : '';
    const title =
      typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const content =
      typeof req.body?.content === 'string' ? req.body.content.trim() : '';

    if (!category || !title || !content) {
      return res.status(400).json({
        success: false,
        error: 'Field category, title, dan content wajib diisi',
      });
    }

    const created = await KnowledgeBase.create({
      category,
      title,
      content,
      updatedAt: new Date(),
    });

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        error: 'ID knowledge base tidak valid',
      });
    }

    const updates = {};
    for (const field of ['category', 'title', 'content']) {
      if (typeof req.body?.[field] === 'string') {
        const trimmed = req.body[field].trim();
        if (!trimmed) {
          return res.status(400).json({
            success: false,
            error: `Field ${field} tidak boleh kosong`,
          });
        }
        updates[field] = trimmed;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Minimal satu field (category, title, content) harus diisi',
      });
    }

    updates.updatedAt = new Date();

    const updated = await KnowledgeBase.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({
        success: false,
        error: 'Data knowledge base tidak ditemukan',
      });
    }

    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        error: 'ID knowledge base tidak valid',
      });
    }

    const deleted = await KnowledgeBase.findByIdAndDelete(id).lean();
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Data knowledge base tidak ditemukan',
      });
    }

    res.json({ success: true, data: deleted });
  } catch (error) {
    next(error);
  }
});

export default router;
