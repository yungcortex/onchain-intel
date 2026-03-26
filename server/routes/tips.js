import { Router } from 'express';
import db from '../db.js';

const router = Router();

// POST /api/tips
router.post('/', (req, res) => {
  const { tokenMint, wallet, message, contact } = req.body;

  if (!message || message.trim().length < 10) {
    return res.status(400).json({ error: 'Message must be at least 10 characters' });
  }

  const result = db.prepare(`
    INSERT INTO tips (token_mint, wallet, message, contact)
    VALUES (?, ?, ?, ?)
  `).run(tokenMint || null, wallet || null, message.trim(), contact || null);

  res.json({ id: result.lastInsertRowid, status: 'submitted' });
});

// GET /api/tips (admin only in future)
router.get('/', (req, res) => {
  const tips = db.prepare('SELECT * FROM tips ORDER BY created_at DESC LIMIT 50').all();
  res.json({ tips });
});

export default router;
