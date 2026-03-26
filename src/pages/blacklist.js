import { api } from '../lib/api.js';

function addr(a, n = 10) {
  if (!a) return 'unknown';
  return `${a.slice(0, n)}...${a.slice(-6)}`;
}

function riskColor(level) {
  const map = { blacklisted: '#ff3b3b', flagged: '#ffa657', suspicious: '#ffd93d' };
  return map[level] || '#8a8a9a';
}

export async function renderBlacklistPage(container) {
  try {
    const data = await api.getBlacklist(1);
    const { wallets, total, page, pages } = data;

    container.innerHTML = `
      <div style="max-width:1100px;margin:0 auto;padding:20px 40px 80px;">
        <div style="font-family:'Orbitron',sans-serif;font-size:10px;color:var(--chrome-dark);letter-spacing:0.2em;margin-bottom:6px;">WALLET BLACKLIST</div>
        <h1 style="font-family:'Orbitron',sans-serif;font-size:clamp(24px,3vw,36px);font-weight:800;color:var(--chrome-bright);margin-bottom:4px;">Known Bad Actors</h1>
        <p style="font-size:12px;color:var(--chrome-mid);margin-bottom:32px;">${total} wallets flagged across all investigations</p>

        <div class="glass-panel" style="padding:24px;overflow-x:auto;">
          <div class="scanlines"></div>
          <table style="width:100%;font-size:11px;border-collapse:collapse;min-width:700px;">
            <thead>
              <tr style="color:var(--chrome-dark);text-align:left;font-family:'Orbitron',sans-serif;font-size:9px;letter-spacing:0.1em;">
                <th style="padding:10px 8px;">ADDRESS</th>
                <th style="padding:10px 8px;">LABEL</th>
                <th style="padding:10px 8px;">RISK</th>
                <th style="padding:10px 8px;">TOKENS</th>
                <th style="padding:10px 8px;">LAST SEEN</th>
              </tr>
            </thead>
            <tbody>
              ${wallets.map(w => `
                <tr style="border-top:1px solid rgba(255,255,255,0.04);cursor:pointer;" onclick="window.location.hash='#/wallet/${w.address}'">
                  <td style="padding:10px 8px;">
                    <span style="font-family:'JetBrains Mono',monospace;color:var(--chrome-light);">${addr(w.address, 14)}</span>
                  </td>
                  <td style="padding:10px 8px;color:var(--chrome-mid);">${w.label || '-'}</td>
                  <td style="padding:10px 8px;">
                    <span style="font-family:'Orbitron',sans-serif;font-size:9px;font-weight:700;color:${riskColor(w.risk_level)};letter-spacing:0.05em;">${(w.risk_level || '').toUpperCase()}</span>
                  </td>
                  <td style="padding:10px 8px;color:var(--chrome-light);font-family:'JetBrains Mono',monospace;">${w.tokens_involved || 0}</td>
                  <td style="padding:10px 8px;color:var(--chrome-dark);font-size:10px;">${w.last_seen ? w.last_seen.split('T')[0] : '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        ${pages > 1 ? `<div style="text-align:center;margin-top:20px;color:var(--chrome-dark);font-size:11px;">Page ${page} of ${pages}</div>` : ''}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div style="text-align:center;padding:80px;color:var(--chrome-mid);">Failed to load blacklist</div>`;
  }
}
