import { api } from '../lib/api.js';
import { renderWalletGraph } from '../components/WalletGraph.js';

function addr(a, n = 8) {
  if (!a) return 'unknown';
  return `${a.slice(0, n)}...${a.slice(-6)}`;
}

function riskBadge(level) {
  const colors = {
    blacklisted: { bg: 'rgba(255,59,59,0.15)', border: 'rgba(255,59,59,0.4)', color: '#ff3b3b' },
    flagged: { bg: 'rgba(255,166,87,0.15)', border: 'rgba(255,166,87,0.4)', color: '#ffa657' },
    suspicious: { bg: 'rgba(255,217,61,0.15)', border: 'rgba(255,217,61,0.4)', color: '#ffd93d' },
    unknown: { bg: 'rgba(138,138,154,0.15)', border: 'rgba(138,138,154,0.4)', color: '#8a8a9a' },
    clean: { bg: 'rgba(0,210,106,0.15)', border: 'rgba(0,210,106,0.4)', color: '#00d26a' },
  };
  const c = colors[level] || colors.unknown;
  return `<span style="font-family:'Orbitron',sans-serif;font-size:9px;font-weight:700;padding:3px 10px;border-radius:4px;letter-spacing:0.1em;background:${c.bg};border:1px solid ${c.border};color:${c.color};">${(level || 'UNKNOWN').toUpperCase()}</span>`;
}

export async function renderWalletPage(container, address) {
  try {
    const data = await api.getWallet(address);
    const { wallet, tokenLinks, connections, connectedWallets } = data;

    const html = `
      <div style="max-width:1100px;margin:0 auto;padding:20px 40px 80px;">
        <div style="font-family:'Orbitron',sans-serif;font-size:10px;color:var(--chrome-dark);letter-spacing:0.2em;margin-bottom:6px;">WALLET PROFILE</div>
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:8px;">
          <h1 style="font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:600;color:var(--chrome-bright);word-break:break-all;">${address}</h1>
          ${riskBadge(wallet.risk_level)}
        </div>
        ${wallet.label ? `<div style="font-size:12px;color:var(--chrome-mid);margin-bottom:4px;">Label: ${wallet.label}</div>` : ''}
        <div style="font-size:11px;color:var(--chrome-dark);margin-bottom:24px;">
          First seen: ${wallet.first_seen} | Last seen: ${wallet.last_seen}
          <a href="https://solscan.io/account/${address}" target="_blank" rel="noopener" style="color:var(--low);margin-left:12px;">View on Solscan</a>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">

          <!-- Tokens involved -->
          <div class="glass-panel" style="padding:24px;">
            <div class="scanlines"></div>
            <div style="font-family:'Orbitron',sans-serif;font-size:10px;font-weight:700;color:var(--chrome-dark);letter-spacing:0.2em;margin-bottom:16px;">TOKENS INVOLVED (${tokenLinks.length})</div>
            ${tokenLinks.map(t => `
              <a href="#/token/${t.mint}" style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.04);">
                <div>
                  <span style="color:var(--chrome-bright);font-size:12px;font-weight:600;">${t.name || addr(t.mint)}</span>
                  <span style="font-size:10px;color:var(--chrome-dark);margin-left:8px;">as ${t.role}</span>
                </div>
                <span style="font-family:'Orbitron',sans-serif;font-size:10px;font-weight:700;color:${t.risk_score >= 70 ? 'var(--critical)' : 'var(--chrome-mid)'};">${t.risk_score}/100</span>
              </a>
            `).join('') || '<div style="color:var(--chrome-dark);font-size:12px;">No token associations found</div>'}
          </div>

          <!-- Connected Wallets -->
          <div class="glass-panel" style="padding:24px;">
            <div class="scanlines"></div>
            <div style="font-family:'Orbitron',sans-serif;font-size:10px;font-weight:700;color:var(--chrome-dark);letter-spacing:0.2em;margin-bottom:16px;">CONNECTED WALLETS (${connectedWallets.length})</div>
            <div style="max-height:400px;overflow-y:auto;">
              ${connectedWallets.slice(0, 30).map(w => `
                <a href="#/wallet/${w.address}" style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.03);">
                  <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--chrome-light);">${addr(w.address, 12)}</span>
                  ${riskBadge(w.risk_level)}
                </a>
              `).join('') || '<div style="color:var(--chrome-dark);font-size:12px;">No connections found</div>'}
            </div>
          </div>

          ${connections.length > 0 ? `
          <!-- Connection Graph -->
          <div class="glass-panel" style="padding:24px;grid-column:span 2;">
            <div class="scanlines"></div>
            <div style="font-family:'Orbitron',sans-serif;font-size:10px;font-weight:700;color:var(--chrome-dark);letter-spacing:0.2em;margin-bottom:12px;">CONNECTION GRAPH</div>
            <div id="wallet-mini-graph" style="width:100%;min-height:350px;"></div>
          </div>
          ` : ''}

        </div>
      </div>
    `;

    container.innerHTML = html;

    // Render connection graph if we have data
    const graphEl = container.querySelector('#wallet-mini-graph');
    if (graphEl && connections.length > 0) {
      // Build wallet links for the graph from connections
      const fakeLinks = connectedWallets.map(w => ({
        wallet_address: w.address,
        role: w.risk_level === 'flagged' ? 'sybil' : 'connected',
        risk_level: w.risk_level,
        label: w.label,
      }));
      renderWalletGraph(graphEl, { walletLinks: fakeLinks, connections, creator: address });
    }
  } catch (err) {
    container.innerHTML = `
      <div style="max-width:800px;margin:0 auto;padding:40px;text-align:center;">
        <h2 style="font-family:'Orbitron',sans-serif;font-size:20px;color:var(--chrome-bright);">Wallet Not Found</h2>
        <p style="color:var(--chrome-mid);margin-top:8px;font-family:'JetBrains Mono',monospace;font-size:11px;word-break:break-all;">${address}</p>
        <a href="https://solscan.io/account/${address}" target="_blank" rel="noopener" style="color:var(--low);font-size:12px;margin-top:12px;display:inline-block;">View on Solscan</a>
      </div>
    `;
  }
}
