import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import db from './db.js';
import auditRoutes from './routes/audit.js';
import searchRoutes from './routes/search.js';
import walletRoutes from './routes/wallet.js';
import blacklistRoutes from './routes/blacklist.js';
import tipRoutes from './routes/tips.js';
import articleRoutes from './routes/articles.js';
import activityRoutes from './routes/activity.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// API routes
app.use('/api/audit', auditRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/blacklist', blacklistRoutes);
app.use('/api/tips', tipRoutes);
app.use('/api/articles', articleRoutes);
app.use('/api/activity', activityRoutes);

// Health check
app.get('/api/health', (req, res) => {
  const stats = {
    tokens: db.prepare('SELECT COUNT(*) as count FROM tokens').get().count,
    wallets: db.prepare('SELECT COUNT(*) as count FROM wallets').get().count,
    findings: db.prepare('SELECT COUNT(*) as count FROM findings').get().count,
    rugs: db.prepare('SELECT COUNT(*) as count FROM tokens WHERE risk_score >= 70').get().count,
  };
  res.json({ status: 'ok', stats });
});

// Stats endpoint for frontend
app.get('/api/stats', (req, res) => {
  const audits = db.prepare('SELECT COUNT(*) as count FROM tokens').get().count;
  const wallets = db.prepare("SELECT COUNT(*) as count FROM wallets WHERE risk_level IN ('flagged','blacklisted','suspicious')").get().count;
  const rugs = db.prepare('SELECT COUNT(*) as count FROM tokens WHERE risk_score >= 70').get().count;
  res.json({ audits, wallets, rugs });
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(join(__dirname, '..', 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(join(__dirname, '..', 'dist', 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`OnChain Intel API running on http://localhost:${PORT}`);
});
