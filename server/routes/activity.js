import { Router } from 'express';

const router = Router();

const HELIUS_KEY = process.env.HELIUS_API_KEY || '';
const HELIUS_API = `https://api.helius.xyz/v0`;

// Cache to avoid hammering Helius
let cache = { data: [], timestamp: 0 };
const CACHE_TTL = 20000; // 20 seconds

// POST /api/activity — Get recent transactions for watched wallets
router.post('/', async (req, res) => {
  const { wallets } = req.body;
  if (!wallets || !Array.isArray(wallets) || wallets.length === 0) {
    return res.json({ activities: [] });
  }

  // Check cache
  const now = Date.now();
  if (cache.data.length > 0 && (now - cache.timestamp) < CACHE_TTL) {
    return res.json({ activities: cache.data });
  }

  if (!HELIUS_KEY) {
    // Return mock data if no API key
    return res.json({ activities: generateMockActivity(wallets) });
  }

  try {
    const activities = [];

    // Fetch recent transactions for first 5 wallets (rate limit friendly)
    for (const wallet of wallets.slice(0, 5)) {
      const url = `${HELIUS_API}/addresses/${wallet}/transactions?api-key=${HELIUS_KEY}&limit=5`;
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });

      if (!response.ok) continue;
      const txs = await response.json();

      for (const tx of txs) {
        const type = categorizeTransaction(tx, wallet);
        activities.push({
          wallet,
          signature: tx.signature,
          type: type.type,
          description: type.description,
          timestamp: tx.timestamp,
          fee: tx.fee,
        });
      }
    }

    // Sort by timestamp descending
    activities.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    // Cache
    cache = { data: activities.slice(0, 30), timestamp: now };

    res.json({ activities: activities.slice(0, 30) });
  } catch (err) {
    console.error('Activity fetch error:', err.message);
    res.json({ activities: generateMockActivity(wallets) });
  }
});

function categorizeTransaction(tx, wallet) {
  const txType = tx.type || 'UNKNOWN';
  const desc = tx.description || '';

  // Gather all token and SOL movements for this wallet
  const tokenTransfers = tx.tokenTransfers || [];
  const nativeTransfers = tx.nativeTransfers || [];

  // Calculate total SOL moved
  let solIn = 0, solOut = 0;
  for (const nt of nativeTransfers) {
    const amount = (nt.amount || 0) / 1e9;
    if (nt.toUserAccount === wallet) solIn += amount;
    if (nt.fromUserAccount === wallet) solOut += amount;
  }

  // Calculate token movements
  let tokensBought = 0, tokensSold = 0, tokenMint = '';
  for (const tt of tokenTransfers) {
    if (tt.toUserAccount === wallet && tt.tokenAmount > 0) {
      tokensBought += tt.tokenAmount;
      tokenMint = tt.mint || '';
    }
    if (tt.fromUserAccount === wallet && tt.tokenAmount > 0) {
      tokensSold += tt.tokenAmount;
      tokenMint = tt.mint || '';
    }
  }

  const mintShort = tokenMint ? tokenMint.slice(0, 6) + '...' : '';

  // Categorize
  if (txType === 'SWAP' || desc.toLowerCase().includes('swap') || (tokensBought > 0 && solOut > 0) || (tokensSold > 0 && solIn > 0)) {
    if (tokensSold > 0 && tokensBought === 0) {
      return {
        type: 'SELL',
        description: `Sold ${formatAmount(tokensSold)} tokens${solIn > 0.001 ? ` for ${solIn.toFixed(4)} SOL` : ''}`,
      };
    }
    if (tokensBought > 0 && tokensSold === 0) {
      return {
        type: 'BUY',
        description: `Bought ${formatAmount(tokensBought)} tokens${solOut > 0.001 ? ` for ${solOut.toFixed(4)} SOL` : ''}`,
      };
    }
    return {
      type: 'SWAP',
      description: `Swapped${solOut > 0.001 ? ' ' + solOut.toFixed(4) + ' SOL' : ''}${tokensBought > 0 ? ' → ' + formatAmount(tokensBought) + ' tokens' : ''}`,
    };
  }

  if (txType === 'TRANSFER' || solIn > 0 || solOut > 0) {
    if (solOut > 0.0001) {
      const dest = nativeTransfers.find(t => t.fromUserAccount === wallet);
      return {
        type: 'TRANSFER',
        description: `Sent ${solOut.toFixed(4)} SOL${dest?.toUserAccount ? ' to ' + dest.toUserAccount.slice(0, 8) + '...' : ''}`,
      };
    }
    if (solIn > 0.0001) {
      const src = nativeTransfers.find(t => t.toUserAccount === wallet);
      return {
        type: 'TRANSFER',
        description: `Received ${solIn.toFixed(4)} SOL${src?.fromUserAccount ? ' from ' + src.fromUserAccount.slice(0, 8) + '...' : ''}`,
      };
    }
    if (tokensBought > 0) {
      return { type: 'TRANSFER', description: `Received ${formatAmount(tokensBought)} tokens (${mintShort})` };
    }
    if (tokensSold > 0) {
      return { type: 'TRANSFER', description: `Sent ${formatAmount(tokensSold)} tokens (${mintShort})` };
    }
    return { type: 'TRANSFER', description: desc.slice(0, 100) || 'Transfer' };
  }

  // Fallback
  return { type: txType === 'UNKNOWN' ? 'UNKNOWN' : txType, description: desc.slice(0, 100) || txType };
}

function formatAmount(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toLocaleString();
}

function generateMockActivity(wallets) {
  const events = [
    { type: 'SWAP', desc: 'Swapped 0.15 SOL → 1,205 tokens via PumpSwap' },
    { type: 'TRANSFER', desc: 'Received 0.0823 SOL from 4DitNB2f...' },
    { type: 'BUY', desc: 'Bought 8.2M tokens for 0.95 SOL' },
    { type: 'SELL', desc: 'Sold 500K tokens for 0.062 SOL' },
    { type: 'TRANSFER', desc: 'Sent 0.003 SOL to 88pCgNn9...' },
    { type: 'SWAP', desc: 'Swapped 0.05 SOL → 412 tokens' },
    { type: 'BUY', desc: 'Bought 2,461 tokens for 0.003 SOL' },
    { type: 'TRANSFER', desc: 'Received 0.1 SOL from 29HJpXiR...' },
  ];

  const now = Math.floor(Date.now() / 1000);
  return wallets.slice(0, 8).map((wallet, i) => ({
    wallet,
    signature: `mock_${wallet.slice(0, 8)}_${i}_${now}`,
    type: events[i % events.length].type,
    description: events[i % events.length].desc,
    timestamp: now - (i * 180),
    fee: 5000,
  }));
}

export default router;
