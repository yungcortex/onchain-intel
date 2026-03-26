/**
 * Live Activity Feed — shows recent transactions from watched wallets.
 * Labels wallets by role, shows amounts, appends new items instead of replacing.
 */

// Wallet labels map — populated when feed is initialized
let walletLabels = {};

export function renderLiveFeed(container, walletAddresses = [], walletLinks = []) {
  // Build label map from wallet links
  walletLabels = {};
  let sybilCount = 0;
  for (const wl of walletLinks) {
    if (wl.role === 'creator') {
      walletLabels[wl.wallet_address] = { label: 'CREATOR', color: '#ff3b3b' };
    } else if (wl.role === 'funder') {
      walletLabels[wl.wallet_address] = { label: 'FUNDER', color: '#ffa657' };
    } else if (wl.role === 'sybil') {
      sybilCount++;
      walletLabels[wl.wallet_address] = { label: `SYBIL #${sybilCount}`, color: '#ff6b6b' };
    }
  }

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="width:8px;height:8px;border-radius:50%;background:#ff3b3b;animation:livePulse 2s infinite;"></div>
        <span style="font-family:'Orbitron',sans-serif;font-size:10px;font-weight:700;color:var(--chrome-dark);letter-spacing:0.2em;">LIVE WALLET ACTIVITY</span>
      </div>
      <span id="feed-status" style="font-size:9px;color:var(--chrome-dark);font-family:'JetBrains Mono',monospace;">Watching ${walletAddresses.length} wallets</span>
    </div>
    <div id="feed-counter" style="display:flex;gap:12px;margin-bottom:12px;font-size:9px;font-family:'JetBrains Mono',monospace;">
      <span style="color:var(--clean);">BUYS: <span id="count-buys">0</span></span>
      <span style="color:var(--critical);">SELLS: <span id="count-sells">0</span></span>
      <span style="color:var(--high);">SWAPS: <span id="count-swaps">0</span></span>
      <span style="color:var(--low);">TRANSFERS: <span id="count-transfers">0</span></span>
    </div>
    <div id="live-feed-list" style="max-height:600px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;">
      <div style="text-align:center;padding:24px;color:var(--chrome-dark);font-size:11px;">
        <div style="width:8px;height:8px;border-radius:50%;background:#58a6ff;margin:0 auto 8px;animation:livePulse 1.5s infinite;"></div>
        Loading activity from Helius...
      </div>
    </div>
  `;

  // Add CSS
  if (!document.getElementById('live-feed-styles')) {
    const style = document.createElement('style');
    style.id = 'live-feed-styles';
    style.textContent = `
      @keyframes livePulse {
        0%, 100% { opacity: 1; box-shadow: 0 0 4px rgba(255,59,59,0.6); }
        50% { opacity: 0.3; box-shadow: 0 0 8px rgba(255,59,59,0.2); }
      }
      @keyframes feedSlideIn {
        from { opacity: 0; transform: translateX(-10px); max-height: 0; }
        to { opacity: 1; transform: translateX(0); max-height: 100px; }
      }
      .feed-item-new { animation: feedSlideIn 0.4s ease-out; }
      #live-feed-list::-webkit-scrollbar { width: 4px; }
      #live-feed-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
    `;
    document.head.appendChild(style);
  }

  const list = container.querySelector('#live-feed-list');
  const statusEl = container.querySelector('#feed-status');
  let allItems = [];
  let knownSigs = new Set();
  let counts = { BUY: 0, SELL: 0, SWAP: 0, TRANSFER: 0 };

  // Initial fetch
  fetchActivity(walletAddresses).then(items => {
    allItems = items;
    items.forEach(i => knownSigs.add(i.signature));
    updateCounts(items, counts);
    renderItems(list, allItems);
    updateCountDisplay(container, counts);
    if (statusEl) statusEl.textContent = `${items.length} events | Watching ${walletAddresses.length} wallets`;
  });

  // Poll every 25 seconds — APPEND new items
  const interval = setInterval(async () => {
    const items = await fetchActivity(walletAddresses);
    const fresh = items.filter(i => !knownSigs.has(i.signature));

    if (fresh.length > 0) {
      fresh.forEach(i => knownSigs.add(i.signature));
      updateCounts(fresh, counts);

      // Prepend new items to the top
      allItems = [...fresh, ...allItems].slice(0, 100);

      // Instead of re-rendering everything, prepend new items
      for (const item of fresh.reverse()) {
        const el = createItemElement(item);
        el.classList.add('feed-item-new');
        list.insertBefore(el, list.firstChild);
      }

      // Remove the "loading" placeholder if still there
      const placeholder = list.querySelector('[data-placeholder]');
      if (placeholder) placeholder.remove();

      // Trim excess
      while (list.children.length > 100) {
        list.removeChild(list.lastChild);
      }

      updateCountDisplay(container, counts);
      if (statusEl) statusEl.textContent = `${allItems.length} events | +${fresh.length} new | Watching ${walletAddresses.length} wallets`;
    }
  }, 25000);

  return () => clearInterval(interval);
}

function updateCounts(items, counts) {
  for (const item of items) {
    if (counts[item.type] !== undefined) counts[item.type]++;
  }
}

function updateCountDisplay(container, counts) {
  const el = (id) => container.querySelector(`#${id}`);
  const b = el('count-buys'); if (b) b.textContent = counts.BUY;
  const s = el('count-sells'); if (s) s.textContent = counts.SELL;
  const sw = el('count-swaps'); if (sw) sw.textContent = counts.SWAP;
  const t = el('count-transfers'); if (t) t.textContent = counts.TRANSFER;
}

async function fetchActivity(wallets) {
  if (wallets.length === 0) return [];
  try {
    const res = await fetch('/api/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallets: wallets.slice(0, 10) }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.activities || [];
  } catch {
    return [];
  }
}

function createItemElement(item) {
  const div = document.createElement('div');

  const typeConfig = {
    SWAP: { color: '#ffa657', bg: 'rgba(255,166,87,0.05)', border: 'rgba(255,166,87,0.12)', icon: '⇄' },
    TRANSFER: { color: '#58a6ff', bg: 'rgba(88,166,255,0.05)', border: 'rgba(88,166,255,0.12)', icon: '→' },
    SELL: { color: '#ff3b3b', bg: 'rgba(255,59,59,0.05)', border: 'rgba(255,59,59,0.15)', icon: '↓' },
    BUY: { color: '#00d26a', bg: 'rgba(0,210,106,0.05)', border: 'rgba(0,210,106,0.12)', icon: '↑' },
    UNKNOWN: { color: '#8b949e', bg: 'rgba(138,138,154,0.05)', border: 'rgba(138,138,154,0.1)', icon: '•' },
  };
  const t = typeConfig[item.type] || typeConfig.UNKNOWN;

  const time = item.timestamp
    ? new Date(item.timestamp * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : '';

  // Get wallet label
  const wLabel = walletLabels[item.wallet];
  const labelText = wLabel ? wLabel.label : 'UNKNOWN';
  const labelColor = wLabel ? wLabel.color : '#8b949e';

  const walletShort = item.wallet ? `${item.wallet.slice(0, 10)}...${item.wallet.slice(-6)}` : '';

  const hasTx = item.signature && !item.signature.startsWith('mock_');

  div.style.cssText = `padding:10px 14px;background:${t.bg};border:1px solid ${t.border};border-left:3px solid ${t.color};border-radius:6px;`;

  div.innerHTML = `
    <!-- Row 1: Type + Label + Time -->
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <span style="font-family:'Orbitron',sans-serif;font-size:9px;font-weight:700;color:${t.color};padding:2px 8px;background:rgba(0,0,0,0.25);border-radius:3px;min-width:65px;text-align:center;">${t.icon} ${item.type}</span>
      <span style="font-family:'Orbitron',sans-serif;font-size:8px;font-weight:700;color:${labelColor};padding:2px 8px;background:${labelColor}15;border:1px solid ${labelColor}30;border-radius:3px;">${labelText}</span>
      <span style="margin-left:auto;font-family:'JetBrains Mono',monospace;color:var(--chrome-dark);font-size:9px;">${time}</span>
    </div>
    <!-- Row 2: Description -->
    <div style="font-size:12px;color:var(--chrome-light);margin-bottom:${hasTx ? '6' : '0'}px;line-height:1.4;">${item.description || 'Transaction executed'}</div>
    <!-- Row 3: Wallet + TX link -->
    ${hasTx ? `
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <a href="#/wallet/${item.wallet}" style="font-family:'JetBrains Mono',monospace;color:var(--chrome-dark);font-size:9px;">${walletShort}</a>
      <a href="https://solscan.io/tx/${item.signature}" target="_blank" rel="noopener" style="font-size:9px;color:var(--low);padding:2px 8px;background:rgba(88,166,255,0.08);border-radius:3px;">View TX →</a>
    </div>
    ` : `
    <div><a href="#/wallet/${item.wallet}" style="font-family:'JetBrains Mono',monospace;color:var(--chrome-dark);font-size:9px;">${walletShort}</a></div>
    `}
  `;

  return div;
}

function renderItems(list, items) {
  if (items.length === 0) {
    list.innerHTML = `<div style="text-align:center;padding:24px;color:var(--chrome-dark);font-size:11px;">No recent activity from watched wallets</div>`;
    return;
  }
  list.innerHTML = '';
  for (const item of items) {
    list.appendChild(createItemElement(item));
  }
}
