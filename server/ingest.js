import db from './db.js';

/**
 * Ingest a raw audit JSON report into the database.
 * Creates/updates tokens, findings, pools, wallets, and connections.
 */
export function ingestAuditReport(report) {
  const mint = report.token;
  const name = report.name || 'Unknown';
  const creator = report.creator || '';
  const riskScore = report.risk_score || 0;
  const sevCounts = report.severity_counts || {};
  const rawJson = JSON.stringify(report);

  // ── Upsert token ──
  db.prepare(`
    INSERT INTO tokens (mint, name, creator, risk_score, critical_count, high_count, medium_count, low_count, holder_count, top_holder_pct, status, raw_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'complete', ?, datetime('now'))
    ON CONFLICT(mint) DO UPDATE SET
      name = excluded.name,
      creator = excluded.creator,
      risk_score = excluded.risk_score,
      critical_count = excluded.critical_count,
      high_count = excluded.high_count,
      medium_count = excluded.medium_count,
      low_count = excluded.low_count,
      holder_count = excluded.holder_count,
      top_holder_pct = excluded.top_holder_pct,
      status = 'complete',
      raw_json = excluded.raw_json,
      updated_at = datetime('now')
  `).run(
    mint, name, creator, riskScore,
    sevCounts.CRITICAL || 0, sevCounts.HIGH || 0, sevCounts.MEDIUM || 0, sevCounts.LOW || 0,
    report.holder_count || 0, report.top_holder_concentration || 0,
    rawJson
  );

  // ── Findings ──
  db.prepare('DELETE FROM findings WHERE token_mint = ?').run(mint);
  const insertFinding = db.prepare('INSERT INTO findings (token_mint, severity, description) VALUES (?, ?, ?)');
  for (const f of (report.findings || [])) {
    insertFinding.run(mint, f.severity, f.description);
  }

  // ── Pools ──
  db.prepare('DELETE FROM pools WHERE token_mint = ?').run(mint);
  const insertPool = db.prepare(`
    INSERT INTO pools (token_mint, dex, address, price, mcap, liquidity, volume_24h, buys_24h, sells_24h, liq_ratio, pool_created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const p of (report.pools || [])) {
    insertPool.run(
      mint, p.dex, p.pool, p.price || 0, p.mcap || 0, p.liquidity || 0,
      p.volume || 0, p.buys_24h || 0, p.sells_24h || 0, p.liq_ratio || 0,
      p.created || null
    );
  }

  // ── Creator wallet ──
  if (creator) {
    upsertWallet(creator, 'token creator', riskScore >= 70 ? 'flagged' : 'suspicious');
    upsertTokenWalletLink(mint, creator, 'creator');

    // Check if this creator has other tokens — repeat offender
    const creatorTokens = db.prepare('SELECT COUNT(*) as count FROM tokens WHERE creator = ?').get(creator).count;
    if (creatorTokens > 1) {
      db.prepare("UPDATE wallets SET risk_level = 'blacklisted', total_rugs = ? WHERE address = ?")
        .run(creatorTokens, creator);
    }
  }

  // ── Suspicious funders → wallets + connections ──
  const funders = report.suspicious_funders || {};
  const allSybilAddresses = [];

  for (const [funder, fundedList] of Object.entries(funders)) {
    upsertWallet(funder, 'suspicious funder', 'flagged');
    upsertTokenWalletLink(mint, funder, 'funder');

    // Connect creator → funder
    if (creator && creator !== funder) {
      upsertConnection(creator, funder, 'created_token');
    }

    for (const funded of fundedList) {
      upsertWallet(funded, 'sybil wallet', 'flagged');
      upsertTokenWalletLink(mint, funded, 'sybil');
      upsertConnection(funder, funded, 'funded');
      allSybilAddresses.push(funded);

      // Connect creator → each sybil wallet
      if (creator && creator !== funded) {
        upsertConnection(creator, funded, 'connected');
      }
    }
  }

  // ── Wallet clusters → connections ──
  const clusters = report.wallet_clusters || {};
  for (const [hub, members] of Object.entries(clusters)) {
    for (const member of members) {
      upsertWallet(member, 'cluster member', 'flagged');
      upsertTokenWalletLink(mint, member, 'sybil');
      if (member !== hub) {
        upsertConnection(hub, member, 'same_cluster');
      }
    }
  }

  // ── Creator data → connected wallets ──
  const creatorData = report.creator_data || {};
  if (creatorData.connected_wallets) {
    for (const cw of creatorData.connected_wallets) {
      upsertWallet(cw, null, 'suspicious');
      upsertConnection(creator, cw, 'connected');
    }
  }

  // ── Update wallet stats ──
  const walletCounts = db.prepare(`
    SELECT wallet_address, COUNT(*) as cnt FROM token_wallet_links
    WHERE role = 'sybil' GROUP BY wallet_address HAVING cnt >= 2
  `).all();
  for (const w of walletCounts) {
    db.prepare("UPDATE wallets SET risk_level = 'blacklisted' WHERE address = ?").run(w.wallet_address);
  }

  return { mint, name, riskScore, status: 'complete' };
}

function upsertWallet(address, label, riskLevel) {
  if (!address) return;
  db.prepare(`
    INSERT INTO wallets (address, label, risk_level, last_seen)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(address) DO UPDATE SET
      label = COALESCE(excluded.label, wallets.label),
      risk_level = CASE
        WHEN wallets.risk_level = 'blacklisted' THEN 'blacklisted'
        WHEN excluded.risk_level = 'blacklisted' THEN 'blacklisted'
        WHEN wallets.risk_level = 'flagged' THEN 'flagged'
        WHEN excluded.risk_level = 'flagged' THEN 'flagged'
        ELSE excluded.risk_level
      END,
      last_seen = datetime('now')
  `).run(address, label, riskLevel);
}

function upsertTokenWalletLink(mint, wallet, role, amount = null) {
  if (!mint || !wallet) return;
  db.prepare(`
    INSERT OR IGNORE INTO token_wallet_links (token_mint, wallet_address, role, amount)
    VALUES (?, ?, ?, ?)
  `).run(mint, wallet, role, amount);
}

function upsertConnection(from, to, type, txSig = null, amount = null) {
  if (!from || !to || from === to) return;
  db.prepare(`
    INSERT OR IGNORE INTO wallet_connections (from_address, to_address, type, tx_signature, amount)
    VALUES (?, ?, ?, ?, ?)
  `).run(from, to, type, txSig, amount);
}
