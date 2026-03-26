import { Router } from 'express';
import db from '../db.js';

const router = Router();

// GET /api/wallet/:address
router.get('/:address', (req, res) => {
  const { address } = req.params;

  const wallet = db.prepare('SELECT * FROM wallets WHERE address = ?').get(address);
  if (!wallet) {
    return res.status(404).json({ error: 'Wallet not found', address });
  }

  // Tokens this wallet is linked to
  const tokenLinks = db.prepare(`
    SELECT twl.role, twl.amount, t.mint, t.name, t.risk_score, t.critical_count
    FROM token_wallet_links twl
    JOIN tokens t ON t.mint = twl.token_mint
    WHERE twl.wallet_address = ?
    ORDER BY t.risk_score DESC
  `).all(address);

  // Direct connections (1 hop)
  const connections = db.prepare(`
    SELECT * FROM wallet_connections
    WHERE from_address = ? OR to_address = ?
    LIMIT 200
  `).all(address, address);

  // Connected wallets with their risk info
  const connectedAddresses = new Set();
  for (const c of connections) {
    if (c.from_address !== address) connectedAddresses.add(c.from_address);
    if (c.to_address !== address) connectedAddresses.add(c.to_address);
  }

  const connectedWallets = [];
  for (const addr of connectedAddresses) {
    const w = db.prepare('SELECT address, label, risk_level FROM wallets WHERE address = ?').get(addr);
    if (w) connectedWallets.push(w);
  }

  res.json({
    wallet,
    tokenLinks,
    connections,
    connectedWallets,
  });
});

export default router;
