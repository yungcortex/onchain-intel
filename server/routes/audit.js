import { Router } from 'express';
import db from '../db.js';
import { runForensicAudit, loadCachedAudit } from '../audit-runner.js';
import { ingestAuditReport } from '../ingest.js';

const router = Router();

// GET /api/audit/:mint — Get audit results for a token
router.get('/:mint', (req, res) => {
  const { mint } = req.params;

  const token = db.prepare('SELECT * FROM tokens WHERE mint = ?').get(mint);
  if (!token) {
    return res.status(404).json({ error: 'Token not audited yet', mint });
  }

  // If still running, return status so frontend can poll
  if (token.status === 'running') {
    return res.json({ token: { mint, status: 'running', name: token.name }, findings: [], pools: [], walletLinks: [], connections: [], links: {}, bundleData: {}, creatorData: {} });
  }

  // If failed, return 404 so frontend shows the "Run Audit" button
  if (token.status === 'failed') {
    // Clean up the failed record so user can retry
    db.prepare('DELETE FROM tokens WHERE mint = ? AND status = ?').run(mint, 'failed');
    return res.status(404).json({ error: 'Previous audit failed. Try again.', mint });
  }

  const findings = db.prepare("SELECT * FROM findings WHERE token_mint = ? ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END").all(mint);
  const pools = db.prepare('SELECT * FROM pools WHERE token_mint = ?').all(mint);
  const walletLinks = db.prepare(`
    SELECT twl.*, w.label, w.risk_level
    FROM token_wallet_links twl
    JOIN wallets w ON w.address = twl.wallet_address
    WHERE twl.token_mint = ?
    ORDER BY twl.role, twl.wallet_address
  `).all(mint);

  // Get ALL connections involving wallets linked to this token
  const linkedWallets = walletLinks.map(w => w.wallet_address);
  let connections = [];
  if (linkedWallets.length > 0) {
    const placeholders = linkedWallets.map(() => '?').join(',');
    connections = db.prepare(`
      SELECT * FROM wallet_connections
      WHERE from_address IN (${placeholders}) OR to_address IN (${placeholders})
      LIMIT 200
    `).all(...linkedWallets, ...linkedWallets);
  }

  // Parse raw JSON for extra data
  let rawData = {};
  try {
    rawData = token.raw_json ? JSON.parse(token.raw_json) : {};
  } catch (e) {}

  res.json({
    token: {
      mint: token.mint,
      name: token.name,
      symbol: token.symbol,
      creator: token.creator,
      riskScore: token.risk_score,
      severityCounts: {
        critical: token.critical_count,
        high: token.high_count,
        medium: token.medium_count,
        low: token.low_count,
      },
      holderCount: token.holder_count,
      topHolderPct: token.top_holder_pct,
      status: token.status,
      createdAt: token.created_at,
    },
    findings,
    pools,
    walletLinks,
    connections,
    links: rawData.links || {},
    bundleData: rawData.bundle_data || {},
    creatorData: rawData.creator_data || {},
  });
});

// POST /api/audit — Trigger a new audit
router.post('/', async (req, res) => {
  const { mint } = req.body;
  if (!mint || mint.length < 20) {
    return res.status(400).json({ error: 'Invalid mint address' });
  }

  // Check if already audited
  const existing = db.prepare('SELECT mint, status, risk_score, updated_at FROM tokens WHERE mint = ?').get(mint);
  if (existing && existing.status === 'complete') {
    return res.json({ status: 'cached', mint: existing.mint, riskScore: existing.risk_score });
  }

  // Check for cached report file
  const cached = await loadCachedAudit(mint);
  if (cached) {
    const result = ingestAuditReport(cached);
    return res.json({ status: 'complete', ...result });
  }

  // Mark as running
  db.prepare(`
    INSERT INTO tokens (mint, name, status) VALUES (?, 'Auditing...', 'running')
    ON CONFLICT(mint) DO UPDATE SET status = 'running', updated_at = datetime('now')
  `).run(mint);

  // Run audit async
  res.json({ status: 'running', mint });

  try {
    const report = await runForensicAudit(mint);
    ingestAuditReport(report);
  } catch (err) {
    console.error(`Audit failed for ${mint}:`, err.message);
    db.prepare("UPDATE tokens SET status = 'failed' WHERE mint = ?").run(mint);
  }
});

// GET /api/audit — List recent audits
router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const tokens = db.prepare(`
    SELECT mint, name, symbol, creator, risk_score, critical_count, high_count, medium_count, status, created_at
    FROM tokens
    WHERE status = 'complete'
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit);

  res.json({ tokens });
});

export default router;
