import * as d3 from 'd3';

/**
 * Render a force-directed wallet connection graph.
 * Fills the full container, spreads nodes out, with glow effects.
 */
export function renderWalletGraph(container, data) {
  const { walletLinks, connections, creator } = data;

  // Wait for container to have dimensions
  const width = container.clientWidth || 900;
  const height = container.clientHeight || 550;

  // Build nodes
  const nodeMap = new Map();

  if (creator) {
    nodeMap.set(creator, { id: creator, type: 'creator', label: 'CREATOR', short: creator.slice(0, 6) });
  }

  for (const wl of walletLinks) {
    if (!nodeMap.has(wl.wallet_address)) {
      nodeMap.set(wl.wallet_address, {
        id: wl.wallet_address,
        type: wl.role,
        label: wl.label || wl.role,
        riskLevel: wl.risk_level,
        short: wl.wallet_address.slice(0, 6),
      });
    }
  }

  for (const c of connections) {
    for (const addr of [c.from_address, c.to_address]) {
      if (!nodeMap.has(addr)) {
        nodeMap.set(addr, { id: addr, type: 'connected', label: '', short: addr.slice(0, 6) });
      }
    }
  }

  let nodes = Array.from(nodeMap.values());

  // Build links
  const linkSet = new Set();
  const links = [];
  for (const c of connections) {
    const key = [c.from_address, c.to_address].sort().join('|');
    if (!linkSet.has(key) && nodeMap.has(c.from_address) && nodeMap.has(c.to_address)) {
      linkSet.add(key);
      links.push({ source: c.from_address, target: c.to_address, type: c.type });
    }
  }

  // Cap at 50 nodes for performance
  if (nodes.length > 50) {
    const keep = new Set();
    // Always keep creator and funder types
    nodes.forEach(n => { if (n.type === 'creator' || n.type === 'funder') keep.add(n.id); });
    // Keep sybils
    nodes.forEach(n => { if (n.type === 'sybil' && keep.size < 50) keep.add(n.id); });
    // Fill rest
    nodes.forEach(n => { if (keep.size < 50) keep.add(n.id); });
    nodes = nodes.filter(n => keep.has(n.id));
  }
  const nodeIds = new Set(nodes.map(n => n.id));
  const filteredLinks = links.filter(l => nodeIds.has(l.source) && nodeIds.has(l.target));

  // Clear
  container.innerHTML = '';

  // SVG
  const svg = d3.select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .style('display', 'block');

  // Defs for glow effects
  const defs = svg.append('defs');

  // Red glow
  const glowRed = defs.append('filter').attr('id', 'glow-red');
  glowRed.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'blur');
  glowRed.append('feMerge').selectAll('feMergeNode').data(['blur', 'SourceGraphic']).join('feMergeNode').attr('in', d => d);

  // Orange glow
  const glowOrange = defs.append('filter').attr('id', 'glow-orange');
  glowOrange.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur');
  glowOrange.append('feMerge').selectAll('feMergeNode').data(['blur', 'SourceGraphic']).join('feMergeNode').attr('in', d => d);

  // Blue glow
  const glowBlue = defs.append('filter').attr('id', 'glow-blue');
  glowBlue.append('feGaussianBlur').attr('stdDeviation', '2').attr('result', 'blur');
  glowBlue.append('feMerge').selectAll('feMergeNode').data(['blur', 'SourceGraphic']).join('feMergeNode').attr('in', d => d);

  // Simulation — much stronger forces to spread out
  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(filteredLinks).id(d => d.id).distance(100).strength(0.15))
    .force('charge', d3.forceManyBody().strength(-400).distanceMax(width * 0.6))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(d => d.type === 'creator' ? 40 : d.type === 'funder' ? 30 : 20))
    .force('x', d3.forceX(width / 2).strength(0.03))
    .force('y', d3.forceY(height / 2).strength(0.03));

  // Links
  const link = svg.append('g')
    .selectAll('line')
    .data(filteredLinks)
    .join('line')
    .attr('stroke', d => {
      if (d.type === 'funded') return 'rgba(255, 59, 59, 0.3)';
      if (d.type === 'same_cluster') return 'rgba(255, 166, 87, 0.2)';
      return 'rgba(88, 166, 255, 0.12)';
    })
    .attr('stroke-width', d => d.type === 'funded' ? 1.5 : 1);

  // Nodes group
  const node = svg.append('g')
    .selectAll('g')
    .data(nodes)
    .join('g')
    .style('cursor', 'pointer')
    .call(d3.drag()
      .on('start', (event, d) => { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on('end', (event, d) => { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
    );

  // Outer glow circle (behind main circle)
  node.append('circle')
    .attr('r', d => {
      if (d.type === 'creator') return 18;
      if (d.type === 'funder') return 14;
      return 8;
    })
    .attr('fill', d => {
      if (d.type === 'creator') return 'rgba(255, 59, 59, 0.15)';
      if (d.type === 'funder') return 'rgba(255, 166, 87, 0.12)';
      if (d.type === 'sybil') return 'rgba(255, 59, 59, 0.08)';
      return 'rgba(88, 166, 255, 0.08)';
    })
    .attr('stroke', 'none');

  // Main circle
  node.append('circle')
    .attr('r', d => {
      if (d.type === 'creator') return 10;
      if (d.type === 'funder') return 8;
      return 5;
    })
    .attr('fill', d => {
      if (d.type === 'creator') return '#ff3b3b';
      if (d.type === 'funder') return '#ffa657';
      if (d.type === 'sybil') return '#ff6b6b';
      return '#58a6ff';
    })
    .attr('stroke', d => {
      if (d.type === 'creator') return 'rgba(255,59,59,0.6)';
      if (d.type === 'funder') return 'rgba(255,166,87,0.5)';
      if (d.type === 'sybil') return 'rgba(255,59,59,0.3)';
      return 'rgba(88,166,255,0.3)';
    })
    .attr('stroke-width', 1.5)
    .attr('filter', d => {
      if (d.type === 'creator') return 'url(#glow-red)';
      if (d.type === 'funder') return 'url(#glow-orange)';
      return null;
    });

  // Labels
  node.append('text')
    .text(d => {
      if (d.type === 'creator') return 'CREATOR';
      if (d.type === 'funder') return 'FUNDER';
      return d.short + '...';
    })
    .attr('x', d => (d.type === 'creator' || d.type === 'funder') ? 16 : 10)
    .attr('y', 3)
    .attr('font-size', d => (d.type === 'creator' || d.type === 'funder') ? '10px' : '7px')
    .attr('font-family', d => (d.type === 'creator' || d.type === 'funder') ? 'Orbitron, sans-serif' : 'JetBrains Mono, monospace')
    .attr('font-weight', d => (d.type === 'creator' || d.type === 'funder') ? '700' : '400')
    .attr('fill', d => {
      if (d.type === 'creator') return '#ff3b3b';
      if (d.type === 'funder') return '#ffa657';
      if (d.type === 'sybil') return 'rgba(255,107,107,0.7)';
      return 'rgba(88,166,255,0.6)';
    });

  // Click to view wallet
  node.on('click', (event, d) => {
    window.location.hash = `#/wallet/${d.id}`;
  });

  // Tooltip
  node.append('title')
    .text(d => `${d.id}\nRole: ${d.type}${d.riskLevel ? '\nRisk: ' + d.riskLevel : ''}`);

  // Tick — clamp to viewport
  const pad = 30;
  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    node.attr('transform', d => {
      d.x = Math.max(pad, Math.min(width - pad, d.x));
      d.y = Math.max(pad, Math.min(height - pad, d.y));
      return `translate(${d.x},${d.y})`;
    });
  });

  // Run simulation longer for better layout
  simulation.alpha(1).restart();
}
