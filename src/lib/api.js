const BASE = '/api';

// Static mode detection — if no API server, use bundled data
let staticMode = false;
let staticData = null;

async function loadStaticData() {
  if (staticData) return staticData;
  try {
    // Try both paths — works for both local dev and GH Pages subdirectory
    let res = await fetch(`${import.meta.env.BASE_URL}data/trumpchud.json`);
    if (!res.ok) res = await fetch('/data/trumpchud.json');
    if (res.ok) {
      staticData = await res.json();
      return staticData;
    }
  } catch {}
  return null;
}

export async function fetchJSON(path) {
  try {
    const res = await fetch(`${BASE}${path}`);
    if (res.ok) return res.json();
    // Server responded but with an error (404, 500, etc) — this is NOT static mode
    // The server is running, it just doesn't have this data
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  } catch (e) {
    // If error is from our throw above (server responded), re-throw it
    if (e.message && !e.message.includes('fetch') && !e.message.includes('Failed') && !e.message.includes('NetworkError')) {
      throw e;
    }
    // Network error — server is unreachable, use static fallback
    staticMode = true;
    return staticFallback(path);
  }
}

export async function postJSON(path, body) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
  } catch {}
  return { error: 'API unavailable in static mode' };
}

// Static fallback — serves pre-built data when no API server
async function staticFallback(path) {
  const data = await loadStaticData();
  if (!data) throw new Error('No data available');

  const mint = data.token;

  // /stats
  if (path === '/stats') {
    return { audits: 1, wallets: Object.keys(data.wallet_clusters || {}).reduce((sum, k) => sum + (data.wallet_clusters[k]?.length || 0), 0) + 2, rugs: 1 };
  }

  // /audit/:mint — only return data if it matches our cached token
  const auditMatch = path.match(/^\/audit\/(.+)$/);
  if (auditMatch) {
    const requestedMint = auditMatch[1];
    if (requestedMint === mint) {
      return buildAuditResponse(data);
    }
    // Different token — we don't have data for it in static mode
    throw new Error(`Token not audited. In static mode, only ${data.name} (${mint.slice(0, 12)}...) is available.`);
  }

  // /audit (list)
  if (path === '/audit?limit=10' || path.startsWith('/audit?')) {
    return { tokens: [{ mint, name: data.name, risk_score: data.risk_score, critical_count: data.severity_counts?.CRITICAL || 0, high_count: data.severity_counts?.HIGH || 0, status: 'complete' }] };
  }

  // /blacklist
  if (path.startsWith('/blacklist')) {
    const wallets = [];
    for (const [hub, members] of Object.entries(data.wallet_clusters || {})) {
      for (const m of members) {
        wallets.push({ address: m, label: 'cluster member', risk_level: 'flagged', tokens_involved: 1, last_seen: data.timestamp });
      }
    }
    if (data.creator) {
      wallets.unshift({ address: data.creator, label: 'token creator', risk_level: 'flagged', tokens_involved: 1, last_seen: data.timestamp });
    }
    return { wallets, total: wallets.length, page: 1, pages: 1 };
  }

  // /wallet/:address
  const walletMatch = path.match(/^\/wallet\/(.+)$/);
  if (walletMatch) {
    const addr = walletMatch[1];
    const allSybils = Object.values(data.wallet_clusters || {}).flat();
    const isSybil = allSybils.includes(addr);
    const isCreator = addr === data.creator;
    return {
      wallet: { address: addr, label: isCreator ? 'token creator' : isSybil ? 'cluster member' : 'unknown', risk_level: (isCreator || isSybil) ? 'flagged' : 'unknown', first_seen: data.timestamp, last_seen: data.timestamp },
      tokenLinks: [{ role: isCreator ? 'creator' : 'sybil', mint, name: data.name, risk_score: data.risk_score }],
      connections: allSybils.filter(s => s !== addr).map(s => ({ from_address: addr, to_address: s, type: 'same_cluster' })),
      connectedWallets: allSybils.filter(s => s !== addr).map(s => ({ address: s, label: 'cluster member', risk_level: 'flagged' })),
    };
  }

  // /articles
  if (path === '/articles') {
    return { articles: [{ slug: 'trumpchud-sybil-attack', title: 'TrumpChud — A Coordinated Sybil Attack', summary: 'One entity controls 20 wallets holding 17% of supply.', token_mint: mint, tokenName: data.name, tokenRisk: data.risk_score, created_at: data.timestamp }] };
  }

  // /articles/:slug
  if (path.startsWith('/articles/')) {
    return { article: { slug: 'trumpchud-sybil-attack', title: 'TrumpChud — A Coordinated Sybil Attack', summary: 'Investigation details', content: '# See the full audit page for details', token_mint: mint, published: 1, created_at: data.timestamp }, token: { mint, name: data.name, risk_score: data.risk_score } };
  }

  // /search — only match if query matches our token
  if (path.startsWith('/search')) {
    const qMatch = path.match(/q=([^&]+)/);
    const query = qMatch ? decodeURIComponent(qMatch[1]).toLowerCase() : '';
    const matches = query && (mint.toLowerCase().includes(query) || (data.name || '').toLowerCase().includes(query));
    return {
      tokens: matches ? [{ mint, name: data.name, risk_score: data.risk_score, status: 'complete' }] : [],
      wallets: [],
    };
  }

  throw new Error('Not found');
}

function buildAuditResponse(data) {
  const sybils = Object.values(data.wallet_clusters || {}).flat();
  const walletLinks = [];

  if (data.creator) {
    walletLinks.push({ wallet_address: data.creator, role: 'creator', risk_level: 'flagged', label: 'token creator' });
  }
  for (const [funder, funded] of Object.entries(data.suspicious_funders || {})) {
    walletLinks.push({ wallet_address: funder, role: 'funder', risk_level: 'flagged', label: 'suspicious funder' });
    for (const f of funded) {
      if (!walletLinks.find(w => w.wallet_address === f)) {
        walletLinks.push({ wallet_address: f, role: 'sybil', risk_level: 'flagged', label: 'sybil wallet' });
      }
    }
  }

  // Build connections
  const connections = [];
  // Creator → sybils
  if (data.creator) {
    for (const s of sybils) {
      connections.push({ from_address: data.creator, to_address: s, type: 'connected' });
    }
  }
  // Cluster connections
  for (const [hub, members] of Object.entries(data.wallet_clusters || {})) {
    for (const m of members) {
      if (m !== hub) connections.push({ from_address: hub, to_address: m, type: 'same_cluster' });
    }
  }
  // Funder connections
  for (const [funder, funded] of Object.entries(data.suspicious_funders || {})) {
    if (data.creator) connections.push({ from_address: data.creator, to_address: funder, type: 'created_token' });
    for (const f of funded) connections.push({ from_address: funder, to_address: f, type: 'funded' });
  }

  return {
    token: {
      mint: data.token,
      name: data.name,
      creator: data.creator,
      riskScore: data.risk_score,
      severityCounts: { critical: data.severity_counts?.CRITICAL || 0, high: data.severity_counts?.HIGH || 0, medium: data.severity_counts?.MEDIUM || 0, low: data.severity_counts?.LOW || 0 },
      holderCount: data.holder_count || 0,
      topHolderPct: data.top_holder_concentration || 0,
      status: 'complete',
      createdAt: data.timestamp,
    },
    findings: (data.findings || []).map(f => ({ severity: f.severity, description: f.description })),
    pools: (data.pools || []).map(p => ({ dex: p.dex, address: p.pool, price: p.price, mcap: p.mcap, liquidity: p.liquidity, volume_24h: p.volume, buys_24h: p.buys_24h, sells_24h: p.sells_24h, liq_ratio: p.liq_ratio, pool_created_at: p.created })),
    walletLinks,
    connections,
    links: data.links || {},
    bundleData: data.bundle_data || {},
    creatorData: data.creator_data || {},
  };
}

export const api = {
  getStats: () => fetchJSON('/stats'),
  getAudit: (mint) => fetchJSON(`/audit/${mint}`),
  getRecentAudits: () => fetchJSON('/audit?limit=10'),
  triggerAudit: (mint) => postJSON('/audit', { mint }),
  search: (q) => fetchJSON(`/search?q=${encodeURIComponent(q)}`),
  getWallet: (addr) => fetchJSON(`/wallet/${addr}`),
  getBlacklist: (page = 1, limit = 50) => fetchJSON(`/blacklist?page=${page}&limit=${limit}`),
  submitTip: (data) => postJSON('/tips', data),
  getArticles: () => fetchJSON('/articles'),
  getArticle: (slug) => fetchJSON(`/articles/${slug}`),
};
