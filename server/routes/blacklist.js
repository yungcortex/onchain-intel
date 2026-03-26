import { Router } from 'express';
import db from '../db.js';

const router = Router();

// GET /api/blacklist?page=1&limit=50&level=flagged
router.get('/', (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = (page - 1) * limit;
  const level = req.query.level; // optional filter

  let query = `
    SELECT w.*, COUNT(twl.token_mint) as tokens_involved
    FROM wallets w
    LEFT JOIN token_wallet_links twl ON twl.wallet_address = w.address
    WHERE w.risk_level IN ('flagged', 'blacklisted', 'suspicious')
  `;
  let countQuery = "SELECT COUNT(*) as total FROM wallets WHERE risk_level IN ('flagged', 'blacklisted', 'suspicious')";
  const params = [];
  const countParams = [];

  if (level) {
    query += ' AND w.risk_level = ?';
    countQuery += ' AND risk_level = ?';
    params.push(level);
    countParams.push(level);
  }

  query += `
    GROUP BY w.address
    ORDER BY
      CASE w.risk_level WHEN 'blacklisted' THEN 0 WHEN 'flagged' THEN 1 ELSE 2 END,
      w.last_seen DESC
    LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);

  const wallets = db.prepare(query).all(...params);
  const total = db.prepare(countQuery).get(...countParams).total;

  res.json({
    wallets,
    total,
    page,
    pages: Math.ceil(total / limit),
  });
});

export default router;
