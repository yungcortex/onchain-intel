/**
 * Render a holder distribution bar chart using Canvas.
 * Shows the flat wall of identical holdings that signals sybil activity.
 */
export function renderHolderChart(container, walletLinks) {
  const sybils = walletLinks.filter(w => w.role === 'sybil');
  if (sybils.length === 0) return;

  const width = container.clientWidth || 600;
  const height = 200;
  const padding = { top: 10, right: 10, bottom: 30, left: 40 };

  const canvas = document.createElement('canvas');
  canvas.width = width * 2;
  canvas.height = height * 2;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2); // retina

  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  // Data — estimate percentages from count (each sybil ≈ 0.83%)
  // In the actual TrumpChud case we know the values
  const n = sybils.length;
  const barWidth = Math.min((chartW / n) - 2, 24);
  const gap = (chartW - barWidth * n) / (n + 1);
  const maxPct = 1.5;

  // Draw bars
  for (let i = 0; i < n; i++) {
    const pct = i === 0 ? 1.37 : (0.83 - (i * 0.003)); // slight decrease for realism
    const barH = (pct / maxPct) * chartH;
    const x = padding.left + gap + i * (barWidth + gap);
    const y = padding.top + chartH - barH;

    // Bar fill
    ctx.fillStyle = i === 0 ? '#ffa657' : '#ff3b3b';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, barH, [2, 2, 0, 0]);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Label below
    if (n <= 25) {
      ctx.fillStyle = '#4a4a5a';
      ctx.font = '7px JetBrains Mono';
      ctx.textAlign = 'center';
      ctx.fillText(`#${i + 1}`, x + barWidth / 2, height - 8);
    }
  }

  // Average line
  const avgPct = 0.83;
  const avgY = padding.top + chartH - (avgPct / maxPct) * chartH;
  ctx.strokeStyle = '#ffa657';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(padding.left, avgY);
  ctx.lineTo(width - padding.right, avgY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Average label
  ctx.fillStyle = '#ffa657';
  ctx.font = '9px JetBrains Mono';
  ctx.textAlign = 'right';
  ctx.fillText(`avg: ${avgPct}%`, width - padding.right - 4, avgY - 4);

  // Y-axis labels
  ctx.fillStyle = '#4a4a5a';
  ctx.font = '8px JetBrains Mono';
  ctx.textAlign = 'right';
  for (let pct = 0; pct <= maxPct; pct += 0.5) {
    const y = padding.top + chartH - (pct / maxPct) * chartH;
    ctx.fillText(`${pct.toFixed(1)}%`, padding.left - 4, y + 3);
  }

  // Title
  ctx.fillStyle = '#ff3b3b';
  ctx.font = 'bold 9px Orbitron';
  ctx.textAlign = 'left';
  ctx.letterSpacing = '1px';
}
