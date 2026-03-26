import { Router } from 'express';
import db from '../db.js';

const router = Router();

// GET /api/search?q=query
router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ tokens: [], wallets: [] });

  const pattern = `%${q}%`;

  const tokens = db.prepare(`
    SELECT mint, name, symbol, creator, risk_score, critical_count, high_count, status
    FROM tokens
    WHERE mint LIKE ? OR name LIKE ? OR symbol LIKE ?
    ORDER BY risk_score DESC
    LIMIT 20
  `).all(pattern, pattern, pattern);

  const wallets = db.prepare(`
    SELECT address, label, risk_level, tokens_created, total_rugs
    FROM wallets
    WHERE address LIKE ? OR label LIKE ?
    ORDER BY CASE risk_level WHEN 'blacklisted' THEN 0 WHEN 'flagged' THEN 1 ELSE 2 END
    LIMIT 20
  `).all(pattern, pattern);

  res.json({ tokens, wallets });
});

export default router;
