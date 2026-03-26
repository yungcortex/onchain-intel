/**
 * Render an attack timeline into a container.
 * Shows chronological events from the audit data.
 */
export function renderTimeline(container, data) {
  const { token, findings, walletLinks, bundleData, creatorData, pools } = data;

  // Build timeline events from the data
  const events = [];

  // Token creation — use earliest pool date, NOT the audit timestamp
  const poolDates = pools.filter(p => p.pool_created_at).map(p => new Date(p.pool_created_at)).sort((a, b) => a - b);
  const tokenBirthDate = poolDates.length > 0 ? poolDates[0].toISOString() : null;

  if (tokenBirthDate) {
    events.push({
      time: tokenBirthDate,
      title: 'Token First Seen',
      desc: `${token.name} — earliest known pool created`,
      type: 'critical',
      icon: '●',
    });
  }

  // Vesting escrow (from creator data)
  if (creatorData && creatorData.tx_types && creatorData.tx_types.CREATE_VESTING_ESCROW) {
    events.push({
      time: token.createdAt, // Same time roughly
      title: 'Vesting Escrow Created',
      desc: 'Fake legitimacy signal — makes scanners think tokens are locked',
      type: 'warning',
      icon: '◆',
    });
  }

  // Pool creation
  for (const p of pools) {
    if (p.pool_created_at) {
      events.push({
        time: p.pool_created_at,
        title: `${p.dex.toUpperCase()} Pool Created`,
        desc: `Price: $${p.price < 0.001 ? p.price.toFixed(6) : p.price.toFixed(4)} | Liquidity: $${p.liquidity > 1000 ? (p.liquidity/1e3).toFixed(0)+'K' : p.liquidity.toFixed(2)}`,
        type: p.dex === 'pumpswap' ? 'info' : p.liquidity < 100 ? 'warning' : 'info',
        icon: '◇',
        link: p.address ? `https://solscan.io/account/${p.address}` : null,
      });
    }
  }

  // Sybil buying waves
  const sybils = walletLinks.filter(w => w.role === 'sybil');
  if (sybils.length > 0) {
    events.push({
      time: null,
      title: `${sybils.length} Sybil Wallets Load Up`,
      desc: `Each wallet buys ~0.83% of supply. Combined: ${(sybils.length * 0.83).toFixed(1)}% controlled by one entity. All wallets created today.`,
      type: 'critical',
      icon: '▲',
    });
  }

  // Bundle detection
  if (bundleData && bundleData.bundle_slots > 0) {
    events.push({
      time: null,
      title: `Bundled Transactions Detected`,
      desc: `${bundleData.bundle_slots} block slots with multi-transaction bundles — coordinated bot activity`,
      type: 'critical',
      icon: '⚡',
    });
  }

  // Early buyers
  if (bundleData && bundleData.early_buyers > 0) {
    events.push({
      time: null,
      title: `${bundleData.early_buyers} Rapid Early Buys`,
      desc: 'Burst of buying in the first minutes — volume inflation bots',
      type: 'warning',
      icon: '↑',
    });
  }

  // Creator SOL extraction
  if (creatorData && creatorData.sol_flows) {
    const netSOL = creatorData.sol_flows.in - creatorData.sol_flows.out;
    events.push({
      time: null,
      title: `Creator Wallet Activity`,
      desc: `Received ${creatorData.sol_flows.in.toFixed(4)} SOL, sent out ${creatorData.sol_flows.out.toFixed(4)} SOL. Balance: ${(creatorData.balance || 0).toFixed(4)} SOL. Total transactions: ${creatorData.tx_count || 0}`,
      type: 'info',
      icon: '◎',
    });
  }

  const typeColors = {
    critical: { dot: '#ff3b3b', bg: 'rgba(255,59,59,0.06)', border: 'rgba(255,59,59,0.2)', glow: 'rgba(255,59,59,0.4)' },
    warning: { dot: '#ffa657', bg: 'rgba(255,166,87,0.06)', border: 'rgba(255,166,87,0.2)', glow: 'rgba(255,166,87,0.3)' },
    info: { dot: '#58a6ff', bg: 'rgba(88,166,255,0.06)', border: 'rgba(88,166,255,0.2)', glow: 'rgba(88,166,255,0.3)' },
  };

  container.innerHTML = `
    <div style="position:relative;padding-left:40px;">
      <!-- Timeline line -->
      <div style="position:absolute;left:15px;top:0;bottom:0;width:2px;background:linear-gradient(180deg, rgba(200,200,216,0.15), rgba(200,200,216,0.05));border-radius:1px;"></div>

      ${events.map((ev, i) => {
        const c = typeColors[ev.type] || typeColors.info;
        return `
          <div style="position:relative;margin-bottom:24px;padding:16px 20px;background:${c.bg};border:1px solid ${c.border};border-radius:10px;transition:border-color 0.3s;"
               onmouseenter="this.style.borderColor='${c.glow}'" onmouseleave="this.style.borderColor='${c.border}'">
            <!-- Dot on timeline -->
            <div style="position:absolute;left:-33px;top:18px;width:12px;height:12px;border-radius:50%;background:${c.dot};box-shadow:0 0 8px ${c.glow};border:2px solid ${c.bg};"></div>

            <!-- Time -->
            ${ev.time ? `<div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--chrome-dark);margin-bottom:4px;">${formatTime(ev.time)}</div>` : ''}

            <!-- Title -->
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <span style="font-size:12px;">${ev.icon}</span>
              <span style="font-family:'Orbitron',sans-serif;font-size:12px;font-weight:700;color:${c.dot};">${ev.title}</span>
            </div>

            <!-- Description -->
            <div style="font-size:11px;color:var(--chrome-mid);line-height:1.5;">${ev.desc}</div>

            ${ev.link ? `<a href="${ev.link}" target="_blank" rel="noopener" style="font-size:9px;color:var(--low);margin-top:6px;display:inline-block;">View on Solscan →</a>` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function formatTime(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return ts;
  }
}
