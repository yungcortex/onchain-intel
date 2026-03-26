import { Router } from 'express';
import db from '../db.js';

const router = Router();

// GET /api/articles — list published articles
router.get('/', (req, res) => {
  const articles = db.prepare(`
    SELECT slug, title, summary, token_mint, cover_image, created_at
    FROM articles
    WHERE published = 1
    ORDER BY created_at DESC
    LIMIT 50
  `).all();

  // Attach token risk scores
  for (const a of articles) {
    if (a.token_mint) {
      const token = db.prepare('SELECT name, risk_score FROM tokens WHERE mint = ?').get(a.token_mint);
      if (token) {
        a.tokenName = token.name;
        a.tokenRisk = token.risk_score;
      }
    }
  }

  res.json({ articles });
});

// GET /api/articles/:slug — single article
router.get('/:slug', (req, res) => {
  const article = db.prepare('SELECT * FROM articles WHERE slug = ?').get(req.params.slug);
  if (!article) {
    return res.status(404).json({ error: 'Article not found' });
  }

  // Get linked token info
  let token = null;
  if (article.token_mint) {
    token = db.prepare('SELECT mint, name, risk_score, critical_count, high_count FROM tokens WHERE mint = ?').get(article.token_mint);
  }

  res.json({ article, token });
});

export default router;
