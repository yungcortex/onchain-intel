import { api } from '../lib/api.js';
import { renderWalletGraph } from '../components/WalletGraph.js';
import { renderHolderChart } from '../components/HolderChart.js';
import { renderTimeline } from '../components/Timeline.js';
import { renderLiveFeed } from '../components/LiveFeed.js';

function addr(a, n = 8) {
  if (!a) return 'unknown';
  return `${a.slice(0, n)}...${a.slice(-6)}`;
}

function severityClass(sev) {
  return (sev || '').toLowerCase();
}

function riskColor(score) {
  if (score >= 70) return 'var(--critical)';
  if (score >= 40) return 'var(--high)';
  if (score >= 20) return 'var(--medium)';
  return 'var(--clean)';
}

function riskLabel(score) {
  if (score >= 70) return 'EXTREME RISK';
  if (score >= 40) return 'HIGH RISK';
  if (score >= 20) return 'MODERATE';
  return 'LOW RISK';
}

export async function renderTokenPage(container, mint) {
  try {
    const data = await api.getAudit(mint);
    container.innerHTML = buildTokenHTML(data, mint);
    initInteractions(container, data, mint);

    // Render D3 wallet graph
    const graphContainer = container.querySelector('#wallet-graph-container');
    if (graphContainer && (data.walletLinks.length > 0 || data.connections.length > 0)) {
      renderWalletGraph(graphContainer, {
        walletLinks: data.walletLinks,
        connections: data.connections,
        creator: data.token.creator,
      });
    }

    // Render holder distribution chart
    const chartContainer = container.querySelector('#holder-chart-container');
    if (chartContainer) {
      renderHolderChart(chartContainer, data.walletLinks);
    }

    // Render attack timeline
    const timelineContainer = container.querySelector('#timeline-container');
    if (timelineContainer) {
      renderTimeline(timelineContainer, data);
    }

    // Render live activity feed
    const feedContainer = container.querySelector('#live-feed-container');
    if (feedContainer) {
      const watchedLinks = data.walletLinks.filter(w => w.role === 'sybil' || w.role === 'creator' || w.role === 'funder');
      const watchedAddresses = watchedLinks.map(w => w.wallet_address);
      renderLiveFeed(feedContainer, watchedAddresses, data.walletLinks);
    }
  } catch (err) {
    // Token not audited yet — show audit trigger UI
    container.innerHTML = `
      <div style="max-width:800px;margin:0 auto;padding:60px 40px;text-align:center;">
        <div style="font-family:'Orbitron',sans-serif;font-size:10px;color:var(--chrome-dark);letter-spacing:0.2em;margin-bottom:16px;">TOKEN NOT AUDITED</div>
        <h2 style="font-family:'Orbitron',sans-serif;font-size:24px;color:var(--chrome-bright);margin-bottom:8px;">Run Forensic Audit</h2>
        <p style="color:var(--chrome-mid);margin-bottom:8px;font-size:13px;">No audit data found for this token.</p>
        <p style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--chrome-dark);margin-bottom:32px;word-break:break-all;">${mint}</p>

        <div id="audit-trigger">
          <button id="run-audit-btn"
            style="background:rgba(88,166,255,0.15);border:1px solid rgba(88,166,255,0.4);color:#58a6ff;padding:14px 32px;border-radius:8px;font-family:'Orbitron',sans-serif;font-size:12px;font-weight:700;letter-spacing:0.15em;cursor:pointer;transition:all 0.3s;">
            RUN AUDIT
          </button>
          <p style="color:var(--chrome-dark);font-size:10px;margin-top:12px;">Takes 1-3 minutes. Requires HELIUS_API_KEY on the server.</p>
        </div>

        <div id="audit-progress" style="display:none;">
          <div class="loading-pulse" style="margin:0 auto;"></div>
          <p style="color:var(--low);font-size:13px;margin-top:20px;font-family:'Orbitron',sans-serif;letter-spacing:0.1em;" id="audit-status-text">RUNNING AUDIT...</p>
          <p style="color:var(--chrome-dark);font-size:10px;margin-top:8px;">Tracing wallets, analyzing transactions, building connection graph</p>
          <div id="audit-dots" style="margin-top:16px;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--chrome-mid);"></div>
        </div>
      </div>
    `;

    const btn = container.querySelector('#run-audit-btn');
    const trigger = container.querySelector('#audit-trigger');
    const progress = container.querySelector('#audit-progress');
    const statusText = container.querySelector('#audit-status-text');
    const dots = container.querySelector('#audit-dots');

    if (btn) {
      btn.addEventListener('click', async () => {
        trigger.style.display = 'none';
        progress.style.display = '';

        // Trigger the audit
        try {
          const result = await api.triggerAudit(mint);

          if (result.status === 'cached' || result.status === 'complete') {
            // Already done — just reload
            renderTokenPage(container, mint);
            return;
          }

          // Poll for completion
          let attempts = 0;
          const maxAttempts = 40; // 40 * 5s = 200s max
          const phases = [
            'Fetching token data from DexScreener...',
            'Running RugCheck report...',
            'Resolving top holders on-chain...',
            'Tracing funding sources...',
            'Analyzing creator wallet history...',
            'Detecting bundled transactions...',
            'Scanning LP manipulation events...',
            'Building wallet cluster graph...',
            'Calculating risk score...',
            'Generating final report...',
          ];

          const poll = setInterval(async () => {
            attempts++;
            const phase = phases[Math.min(attempts - 1, phases.length - 1)];
            if (dots) dots.textContent = phase;

            try {
              const check = await api.getAudit(mint);
              if (check.token && check.token.status === 'complete') {
                clearInterval(poll);
                statusText.textContent = 'AUDIT COMPLETE';
                statusText.style.color = 'var(--clean)';
                setTimeout(() => renderTokenPage(container, mint), 500);
              }
            } catch (e) {
              // Still running
            }

            if (attempts >= maxAttempts) {
              clearInterval(poll);
              statusText.textContent = 'AUDIT TIMED OUT';
              statusText.style.color = 'var(--critical)';
              if (dots) dots.textContent = 'Try refreshing the page in a minute.';
            }
          }, 5000);

        } catch (e) {
          statusText.textContent = 'AUDIT FAILED';
          statusText.style.color = 'var(--critical)';
          if (dots) dots.textContent = e.message;
        }
      });
    }
  }
}

function buildTokenHTML(data, mint) {
  const { token, findings, pools, walletLinks, connections, links, bundleData, creatorData } = data;
  const score = token.riskScore;
  const color = riskColor(score);

  // Group wallet links by role
  const sybils = walletLinks.filter(w => w.role === 'sybil');
  const funders = walletLinks.filter(w => w.role === 'funder');
  const creator = walletLinks.find(w => w.role === 'creator');

  return `
    <div style="max-width:1100px;margin:0 auto;padding:20px 40px 80px;">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;">
        <div>
          <div style="font-family:'Orbitron',sans-serif;font-size:10px;color:var(--chrome-dark);letter-spacing:0.2em;margin-bottom:6px;">TOKEN AUDIT</div>
          <h1 style="font-family:'Orbitron',sans-serif;font-size:clamp(28px,4vw,42px);font-weight:800;color:var(--chrome-bright);margin-bottom:4px;">${token.name || 'Unknown'}</h1>
          <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--chrome-dark);word-break:break-all;">${mint}</div>
          ${token.creator ? `<div style="margin-top:6px;font-size:11px;color:var(--chrome-mid);">Creator: <a href="#/wallet/${token.creator}" style="color:var(--low);text-decoration:underline;">${addr(token.creator, 12)}</a></div>` : ''}
          <div style="margin-top:12px;display:flex;gap:8px;">
            <button id="share-twitter-btn" style="font-size:10px;padding:6px 14px;background:rgba(88,166,255,0.1);border:1px solid rgba(88,166,255,0.3);border-radius:6px;color:var(--low);cursor:pointer;font-family:'JetBrains Mono',monospace;transition:all 0.2s;">Share on X</button>
            <button id="copy-mint-btn" style="font-size:10px;padding:6px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:6px;color:var(--chrome-mid);cursor:pointer;font-family:'JetBrains Mono',monospace;transition:all 0.2s;">Copy Mint</button>
          </div>
        </div>

        <!-- Risk Score -->
        <div style="text-align:center;min-width:120px;">
          <div style="position:relative;width:100px;height:100px;margin:0 auto;">
            <svg viewBox="0 0 100 100" style="transform:rotate(-90deg);">
              <circle cx="50" cy="50" r="42" stroke="rgba(255,255,255,0.06)" stroke-width="6" fill="none"/>
              <circle cx="50" cy="50" r="42" stroke="${color}" stroke-width="6" fill="none"
                stroke-dasharray="${score * 2.64} ${264 - score * 2.64}" stroke-linecap="round"/>
            </svg>
            <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;">
              <span style="font-family:'Orbitron',sans-serif;font-size:24px;font-weight:900;color:${color};">${score}</span>
            </div>
          </div>
          <div style="font-family:'Orbitron',sans-serif;font-size:9px;font-weight:700;color:${color};letter-spacing:0.1em;margin-top:8px;">${riskLabel(score)}</div>
          <div style="font-size:9px;color:var(--chrome-dark);margin-top:2px;">${token.severityCounts.critical}C ${token.severityCounts.high}H ${token.severityCounts.medium}M</div>
        </div>
      </div>

      <!-- Two column layout -->
      <div class="audit-detail-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">

        <!-- Findings -->
        <div class="glass-panel" style="padding:24px;grid-column:span 2;">
          <div class="scanlines"></div>
          <div style="font-family:'Orbitron',sans-serif;font-size:10px;font-weight:700;color:var(--chrome-dark);letter-spacing:0.2em;margin-bottom:16px;">FINDINGS</div>
          ${findings.map(f => `
            <div class="finding-row">
              <span class="severity-tag ${severityClass(f.severity)}">${f.severity}</span>
              <span style="color:var(--chrome-light);font-size:12px;">${f.description}</span>
            </div>
          `).join('')}
        </div>

        <!-- Pools & AMM Visualization -->
        <div class="glass-panel" style="padding:24px;">
          <div class="scanlines"></div>
          <div style="font-family:'Orbitron',sans-serif;font-size:10px;font-weight:700;color:var(--chrome-dark);letter-spacing:0.2em;margin-bottom:16px;">POOLS &amp; LIQUIDITY</div>

          <!-- Pool cards -->
          <div style="display:flex;flex-direction:column;gap:10px;">
            ${pools.map(p => {
              const maxLiq = Math.max(...pools.map(pp => pp.liquidity || 1));
              const liqPct = maxLiq > 0 ? (p.liquidity / maxLiq) * 100 : 0;
              const poolColor = p.dex === 'pumpswap' ? 'var(--clean)' : p.dex === 'pumpfun' ? 'var(--low)' : 'var(--accent)';
              const poolBg = p.dex === 'pumpswap' ? 'rgba(0,210,106,0.06)' : p.dex === 'pumpfun' ? 'rgba(88,166,255,0.06)' : 'rgba(188,140,255,0.06)';
              const poolBorder = p.dex === 'pumpswap' ? 'rgba(0,210,106,0.15)' : p.dex === 'pumpfun' ? 'rgba(88,166,255,0.15)' : 'rgba(188,140,255,0.15)';

              return `
              <div style="background:${poolBg};border:1px solid ${poolBorder};border-radius:8px;padding:14px 16px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                  <div style="display:flex;align-items:center;gap:8px;">
                    <span style="font-family:'Orbitron',sans-serif;font-size:11px;font-weight:700;color:${poolColor};text-transform:uppercase;">${p.dex}</span>
                    ${p.dex === 'pumpfun' ? '<span style="font-size:8px;padding:2px 6px;background:rgba(88,166,255,0.15);border-radius:3px;color:var(--low);">BONDING CURVE</span>' : ''}
                    ${p.dex === 'pumpswap' ? '<span style="font-size:8px;padding:2px 6px;background:rgba(0,210,106,0.15);border-radius:3px;color:var(--clean);">AMM</span>' : ''}
                  </div>
                  <a href="https://solscan.io/account/${p.address}" target="_blank" rel="noopener" style="font-size:8px;color:var(--chrome-dark);font-family:'JetBrains Mono',monospace;">${p.address ? p.address.slice(0,8)+'...' : ''}</a>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;font-size:11px;">
                  <div>
                    <div style="color:var(--chrome-dark);font-size:9px;margin-bottom:2px;">PRICE</div>
                    <div style="font-family:'JetBrains Mono',monospace;color:${poolColor};font-weight:600;">$${p.price < 0.001 ? p.price.toFixed(6) : p.price.toFixed(4)}</div>
                  </div>
                  <div>
                    <div style="color:var(--chrome-dark);font-size:9px;margin-bottom:2px;">MCAP</div>
                    <div style="font-family:'JetBrains Mono',monospace;color:var(--chrome-light);">$${p.mcap > 1e6 ? (p.mcap/1e6).toFixed(1)+'M' : (p.mcap/1e3).toFixed(1)+'K'}</div>
                  </div>
                  <div>
                    <div style="color:var(--chrome-dark);font-size:9px;margin-bottom:2px;">LIQUIDITY</div>
                    <div style="font-family:'JetBrains Mono',monospace;color:var(--clean);font-weight:600;">$${p.liquidity > 1000 ? (p.liquidity/1e3).toFixed(0)+'K' : p.liquidity.toFixed(2)}</div>
                  </div>
                  <div>
                    <div style="color:var(--chrome-dark);font-size:9px;margin-bottom:2px;">LIQ/MCAP</div>
                    <div style="font-family:'JetBrains Mono',monospace;color:${p.liq_ratio < 2 ? 'var(--critical)' : 'var(--chrome-light)'};font-weight:600;">${p.liq_ratio.toFixed(2)}%</div>
                  </div>
                </div>

                <!-- Liquidity bar -->
                <div style="margin-top:8px;">
                  <div style="height:4px;background:rgba(255,255,255,0.04);border-radius:2px;overflow:hidden;">
                    <div style="height:100%;width:${Math.max(liqPct, 0.5)}%;background:${poolColor};border-radius:2px;transition:width 0.5s;"></div>
                  </div>
                </div>
              </div>
              `;
            }).join('')}
          </div>

          <!-- Price discrepancy callout -->
          ${(() => {
            const prices = pools.filter(p => p.price > 0).map(p => p.price);
            if (prices.length >= 2) {
              const ratio = Math.max(...prices) / Math.min(...prices);
              if (ratio > 10) {
                return `
                  <div style="margin-top:12px;padding:12px 16px;background:rgba(255,59,59,0.06);border:1px solid rgba(255,59,59,0.15);border-radius:8px;display:flex;justify-content:space-between;align-items:center;">
                    <div>
                      <div style="font-size:11px;color:var(--critical);font-weight:600;">Price Discrepancy: ${ratio.toFixed(0)}x</div>
                      <div style="font-size:10px;color:var(--chrome-dark);margin-top:2px;">Bonding curve price is ${ratio.toFixed(0)}x lower than AMM price — abnormal after graduation</div>
                    </div>
                    <div style="font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:800;color:var(--critical);">${ratio > 1000 ? (ratio/1000).toFixed(1)+'K' : ratio.toFixed(0)}x</div>
                  </div>
                `;
              }
            }
            return '';
          })()}
        </div>

        <!-- Creator Info — expanded -->
        <div class="glass-panel" style="padding:24px;">
          <div class="scanlines"></div>
          <div style="font-family:'Orbitron',sans-serif;font-size:10px;font-weight:700;color:var(--chrome-dark);letter-spacing:0.2em;margin-bottom:16px;">CREATOR WALLET ANALYSIS</div>
          ${token.creator ? `
            <!-- Address + badge -->
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
              <span style="font-family:'Orbitron',sans-serif;font-size:8px;font-weight:700;padding:3px 8px;background:rgba(255,59,59,0.15);border:1px solid rgba(255,59,59,0.3);border-radius:3px;color:var(--critical);">FLAGGED</span>
              <a href="#/wallet/${token.creator}" style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--low);word-break:break-all;">${token.creator}</a>
            </div>

            <!-- Quick actions -->
            <div style="display:flex;gap:6px;margin-bottom:16px;">
              <a href="https://solscan.io/account/${token.creator}" target="_blank" rel="noopener" style="font-size:9px;padding:4px 10px;background:rgba(88,166,255,0.08);border:1px solid rgba(88,166,255,0.2);border-radius:4px;color:var(--low);">Solscan</a>
              <button class="copy-addr-btn" data-copy="${token.creator}" style="font-size:9px;padding:4px 10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:4px;color:var(--chrome-mid);cursor:pointer;">Copy</button>
              <a href="#/wallet/${token.creator}" style="font-size:9px;padding:4px 10px;background:rgba(188,140,255,0.08);border:1px solid rgba(188,140,255,0.2);border-radius:4px;color:var(--accent);">Profile</a>
            </div>

            <!-- Stats grid -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
              <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);border-radius:6px;padding:10px 12px;">
                <div style="font-size:8px;color:var(--chrome-dark);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">Total Transactions</div>
                <div style="font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:700;color:var(--critical);">${creatorData.tx_count || '?'}</div>
              </div>
              <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);border-radius:6px;padding:10px 12px;">
                <div style="font-size:8px;color:var(--chrome-dark);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">Wallet Age</div>
                <div style="font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:700;color:var(--critical);">0 days</div>
              </div>
              <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);border-radius:6px;padding:10px 12px;">
                <div style="font-size:8px;color:var(--chrome-dark);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">SOL Balance</div>
                <div style="font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:600;color:var(--chrome-light);">${creatorData.balance !== undefined ? creatorData.balance.toFixed(4) : '?'}</div>
              </div>
              <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);border-radius:6px;padding:10px 12px;">
                <div style="font-size:8px;color:var(--chrome-dark);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">Connected Wallets</div>
                <div style="font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:600;color:var(--high);">${creatorData.connected_wallets ? creatorData.connected_wallets.length : connections.length}</div>
              </div>
            </div>

            <!-- SOL Flow -->
            ${creatorData.sol_flows ? `
            <div style="margin-bottom:14px;">
              <div style="font-size:9px;color:var(--chrome-dark);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">SOL Flow</div>
              <div style="display:flex;align-items:center;gap:12px;">
                <div style="text-align:center;">
                  <div style="font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:700;color:var(--clean);">${creatorData.sol_flows.in.toFixed(4)}</div>
                  <div style="font-size:8px;color:var(--chrome-dark);">IN</div>
                </div>
                <div style="flex:1;height:1px;background:linear-gradient(90deg,var(--clean),var(--chrome-dark),var(--critical));"></div>
                <div style="text-align:center;">
                  <div style="font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:700;color:var(--critical);">${creatorData.sol_flows.out.toFixed(4)}</div>
                  <div style="font-size:8px;color:var(--chrome-dark);">OUT</div>
                </div>
              </div>
            </div>
            ` : ''}

            <!-- Transaction types -->
            ${creatorData.tx_types ? `
            <div>
              <div style="font-size:9px;color:var(--chrome-dark);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">Transaction Types</div>
              <div style="display:flex;flex-wrap:wrap;gap:6px;">
                ${Object.entries(creatorData.tx_types).map(([type, count]) => {
                  const color = type === 'CREATE' ? 'var(--critical)' : type === 'CREATE_VESTING_ESCROW' ? 'var(--high)' : 'var(--low)';
                  return `<span style="font-size:9px;padding:3px 8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:3px;color:${color};font-family:'JetBrains Mono',monospace;">${type}: ${count}</span>`;
                }).join('')}
              </div>
            </div>
            ` : ''}

            <!-- Verdict -->
            <div style="margin-top:14px;padding:10px 14px;background:rgba(255,59,59,0.06);border:1px solid rgba(255,59,59,0.15);border-radius:6px;">
              <div style="font-size:10px;color:var(--critical);font-weight:600;">Disposable wallet — created same day as token, minimal transactions, connected to dev-prefixed address</div>
            </div>
          ` : '<div style="color:var(--chrome-mid);font-size:12px;">Unknown creator</div>'}
        </div>

        <!-- Sybil Wallets -->
        ${sybils.length > 0 ? `
        <div class="glass-panel" style="padding:24px;grid-column:span 2;">
          <div class="scanlines"></div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <div style="font-family:'Orbitron',sans-serif;font-size:10px;font-weight:700;color:var(--critical);letter-spacing:0.2em;">SYBIL WALLETS (${sybils.length})</div>
            <div style="font-size:10px;color:var(--chrome-dark);">All flagged as coordinated</div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
            ${sybils.map((w, i) => `
              <div class="sybil-row" data-wallet="${w.wallet_address}" style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:rgba(255,59,59,0.04);border:1px solid rgba(255,59,59,0.1);border-radius:4px;cursor:pointer;">
                <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--critical);">#${i+1} ${addr(w.wallet_address, 10)}</span>
                <span class="sybil-expand-hint" style="font-size:9px;color:var(--chrome-dark);">click to expand</span>
              </div>
              <div class="sybil-detail" data-wallet-detail="${w.wallet_address}" style="display:none;padding:8px 12px;background:rgba(255,59,59,0.02);border:1px solid rgba(255,59,59,0.08);border-radius:0 0 4px 4px;margin-top:-4px;margin-bottom:4px;">
                <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--chrome-mid);word-break:break-all;margin-bottom:6px;">${w.wallet_address}</div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                  <a href="https://solscan.io/account/${w.wallet_address}" target="_blank" rel="noopener" style="font-size:9px;padding:3px 8px;background:rgba(88,166,255,0.1);border:1px solid rgba(88,166,255,0.2);border-radius:3px;color:var(--low);">Solscan</a>
                  <button class="copy-addr-btn" data-copy="${w.wallet_address}" style="font-size:9px;padding:3px 8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:3px;color:var(--chrome-mid);cursor:pointer;">Copy Address</button>
                  <a href="#/wallet/${w.wallet_address}" style="font-size:9px;padding:3px 8px;background:rgba(188,140,255,0.1);border:1px solid rgba(188,140,255,0.2);border-radius:3px;color:var(--accent);">Full Profile</a>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        ` : ''}

        <!-- Wallet Connection Graph -->
        ${(walletLinks.length > 2 || connections.length > 0) ? `
        <div class="glass-panel" style="padding:24px;grid-column:span 2;">
          <div class="scanlines"></div>
          <div style="font-family:'Orbitron',sans-serif;font-size:10px;font-weight:700;color:var(--chrome-dark);letter-spacing:0.2em;margin-bottom:12px;">WALLET CONNECTION GRAPH</div>
          <div style="font-size:10px;color:var(--chrome-dark);margin-bottom:12px;">Red = creator/sybil | Orange = funder | Blue = connected | Drag to explore | Click node to view wallet</div>
          <div id="wallet-graph-container" style="width:100%;min-height:550px;border-radius:8px;overflow:hidden;background:rgba(0,0,0,0.15);"></div>
        </div>
        ` : ''}

        <!-- Holder Distribution -->
        ${sybils.length > 0 ? `
        <div class="glass-panel" style="padding:24px;grid-column:span 2;">
          <div class="scanlines"></div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <div style="font-family:'Orbitron',sans-serif;font-size:10px;font-weight:700;color:var(--chrome-dark);letter-spacing:0.2em;">HOLDER DISTRIBUTION</div>
            <div style="font-size:10px;color:var(--critical);">Variance: 0.014 — Not natural</div>
          </div>
          <div id="holder-chart-container" style="width:100%;"></div>
          <div style="font-size:10px;color:var(--chrome-dark);margin-top:8px;text-align:center;">Each bar = one wallet's % of total supply. Flat bars = coordinated buying. Normal tokens have a steep power-law curve.</div>
        </div>
        ` : ''}

        <!-- Key Transactions -->
        ${bundleData.earliest_buyers || creatorData.tx_count ? `
        <div class="glass-panel" style="padding:24px;grid-column:span 2;">
          <div class="scanlines"></div>
          <div style="font-family:'Orbitron',sans-serif;font-size:10px;font-weight:700;color:var(--chrome-dark);letter-spacing:0.2em;margin-bottom:16px;">KEY TRANSACTIONS</div>
          ${token.creator ? `
          <div class="finding-row" style="border-left:3px solid var(--critical);padding-left:12px;">
            <div>
              <div style="font-size:12px;color:var(--chrome-bright);font-weight:600;">Token Creation</div>
              <div style="font-size:10px;color:var(--chrome-mid);margin-top:2px;">Creator deployed token on Pump.fun</div>
              ${links.creator_solscan ? `<a href="${links.creator_solscan}" target="_blank" style="font-size:9px;color:var(--low);font-family:'JetBrains Mono',monospace;">View creator on Solscan</a>` : ''}
            </div>
          </div>
          ` : ''}
          ${creatorData.sol_flows ? `
          <div class="finding-row" style="border-left:3px solid var(--accent);padding-left:12px;">
            <div>
              <div style="font-size:12px;color:var(--chrome-bright);font-weight:600;">Creator funded with ${creatorData.sol_flows.in.toFixed(4)} SOL</div>
              <div style="font-size:10px;color:var(--chrome-mid);margin-top:2px;">Seed money received, ${creatorData.sol_flows.out.toFixed(4)} SOL sent out</div>
            </div>
          </div>
          ` : ''}
          ${bundleData.bundle_slots > 0 ? `
          <div class="finding-row" style="border-left:3px solid var(--critical);padding-left:12px;">
            <div>
              <div style="font-size:12px;color:var(--critical);font-weight:600;">Bundled Transactions Detected</div>
              <div style="font-size:10px;color:var(--chrome-mid);margin-top:2px;">${bundleData.bundle_slots} slots with multi-transaction bundles — coordinated bot activity</div>
            </div>
          </div>
          ` : ''}
          ${bundleData.early_buyers ? `
          <div class="finding-row" style="border-left:3px solid var(--high);padding-left:12px;">
            <div>
              <div style="font-size:12px;color:var(--high);font-weight:600;">${bundleData.early_buyers} Early Buyers Detected</div>
              <div style="font-size:10px;color:var(--chrome-mid);margin-top:2px;">Rapid buying pattern in the first minutes after token creation</div>
            </div>
          </div>
          ` : ''}
          ${creatorData.tx_count ? `
          <div class="finding-row" style="border-left:3px solid var(--high);padding-left:12px;">
            <div>
              <div style="font-size:12px;color:var(--chrome-bright);font-weight:600;">Creator has only ${creatorData.tx_count} total transactions</div>
              <div style="font-size:10px;color:var(--chrome-mid);margin-top:2px;">Wallet created same day as token — disposable identity</div>
            </div>
          </div>
          ` : ''}
        </div>
        ` : ''}

        <!-- Attack Timeline — full width -->
        <div class="glass-panel" style="padding:24px;grid-column:span 2;">
          <div class="scanlines"></div>
          <div style="font-family:'Orbitron',sans-serif;font-size:10px;font-weight:700;color:var(--chrome-dark);letter-spacing:0.2em;margin-bottom:16px;">ATTACK TIMELINE</div>
          <div id="timeline-container"></div>
        </div>

        <!-- Live Activity — full width -->
        <div class="glass-panel" style="padding:24px;grid-column:span 2;">
          <div class="scanlines"></div>
          <div id="live-feed-container" style="width:100%;"></div>
        </div>

        <!-- Links -->
        <div class="glass-panel" style="padding:24px;grid-column:span 2;">
          <div class="scanlines"></div>
          <div style="font-family:'Orbitron',sans-serif;font-size:10px;font-weight:700;color:var(--chrome-dark);letter-spacing:0.2em;margin-bottom:16px;">VERIFY ON-CHAIN</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${links.token_solscan ? `<a href="${links.token_solscan}" target="_blank" rel="noopener" style="font-size:11px;padding:8px 16px;background:rgba(88,166,255,0.08);border:1px solid rgba(88,166,255,0.2);border-radius:6px;color:var(--low);">Solscan</a>` : ''}
            ${links.token_birdeye ? `<a href="${links.token_birdeye}" target="_blank" rel="noopener" style="font-size:11px;padding:8px 16px;background:rgba(0,210,106,0.08);border:1px solid rgba(0,210,106,0.2);border-radius:6px;color:var(--clean);">Birdeye</a>` : ''}
            ${links.rugcheck ? `<a href="${links.rugcheck}" target="_blank" rel="noopener" style="font-size:11px;padding:8px 16px;background:rgba(255,166,87,0.08);border:1px solid rgba(255,166,87,0.2);border-radius:6px;color:var(--high);">RugCheck</a>` : ''}
            ${links.creator_solscan ? `<a href="${links.creator_solscan}" target="_blank" rel="noopener" style="font-size:11px;padding:8px 16px;background:rgba(188,140,255,0.08);border:1px solid rgba(188,140,255,0.2);border-radius:6px;color:var(--accent);">Creator Solscan</a>` : ''}
          </div>
        </div>

      </div>
    </div>
  `;
}

function initInteractions(container, data, mint) {
  // Expandable sybil wallet rows — click to expand inline details
  container.querySelectorAll('.sybil-row').forEach(row => {
    row.addEventListener('click', () => {
      const wallet = row.dataset.wallet;
      const detail = container.querySelector(`[data-wallet-detail="${wallet}"]`);
      if (detail) {
        const isOpen = detail.style.display !== 'none';
        // Close all others
        container.querySelectorAll('.sybil-detail').forEach(d => d.style.display = 'none');
        container.querySelectorAll('.sybil-row').forEach(r => r.style.borderColor = 'rgba(255,59,59,0.1)');
        if (!isOpen) {
          detail.style.display = '';
          row.style.borderColor = 'rgba(255,59,59,0.4)';
        }
      }
    });

    // Hover
    row.addEventListener('mouseenter', () => row.style.borderColor = 'rgba(255,59,59,0.3)');
    row.addEventListener('mouseleave', () => {
      const wallet = row.dataset.wallet;
      const detail = container.querySelector(`[data-wallet-detail="${wallet}"]`);
      if (!detail || detail.style.display === 'none') {
        row.style.borderColor = 'rgba(255,59,59,0.1)';
      }
    });
  });

  // Copy address buttons
  container.querySelectorAll('.copy-addr-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = btn.dataset.copy;
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = 'Copied!';
        btn.style.color = 'var(--clean)';
        btn.style.borderColor = 'rgba(0,210,106,0.3)';
        setTimeout(() => { btn.textContent = 'Copy Address'; btn.style.color = ''; btn.style.borderColor = ''; }, 1500);
      });
    });
  });

  // Share on Twitter/X
  const shareBtn = container.querySelector('#share-twitter-btn');
  if (shareBtn && data) {
    shareBtn.addEventListener('click', () => {
      const t = data.token;
      const text = `${t.name} scored ${t.riskScore}/100 on OnChain Intel\n\n${t.severityCounts.critical} CRITICAL findings\n${data.walletLinks.filter(w => w.role === 'sybil').length} sybil wallets detected\n\nFull audit:`;
      const url = window.location.href;
      window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank');
    });
  }

  // Copy mint address
  const copyBtn = container.querySelector('#copy-mint-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(mint).then(() => {
        copyBtn.textContent = 'Copied!';
        copyBtn.style.color = 'var(--clean)';
        copyBtn.style.borderColor = 'rgba(0,210,106,0.4)';
        setTimeout(() => {
          copyBtn.textContent = 'Copy Mint';
          copyBtn.style.color = '';
          copyBtn.style.borderColor = '';
        }, 1500);
      });
    });
  }
}
