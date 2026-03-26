import { api } from '../lib/api.js';

function riskColor(score) {
  if (score >= 70) return 'var(--critical)';
  if (score >= 40) return 'var(--high)';
  return 'var(--chrome-mid)';
}

export async function renderInvestigationsPage(container) {
  try {
    const { articles } = await api.getArticles();

    container.innerHTML = `
      <div style="max-width:1100px;margin:0 auto;padding:20px 40px 80px;">
        <div style="font-family:'Orbitron',sans-serif;font-size:10px;color:var(--chrome-dark);letter-spacing:0.2em;margin-bottom:6px;">ON-CHAIN FORENSICS</div>
        <h1 style="font-family:'Orbitron',sans-serif;font-size:clamp(24px,3vw,36px);font-weight:800;color:var(--chrome-bright);margin-bottom:4px;">Investigations</h1>
        <p style="font-size:12px;color:var(--chrome-mid);margin-bottom:40px;">Deep dives into suspicious tokens, sybil attacks, and rug pulls. All evidence verifiable on-chain.</p>

        <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(340px, 1fr));gap:20px;">
          ${articles.length > 0 ? articles.map(a => `
            <div class="glass-panel" style="padding:24px;cursor:pointer;transition:all 0.3s var(--spring);"
                 onclick="window.location.hash='#/investigations/${a.slug}'"
                 onmouseenter="this.style.borderColor='rgba(200,200,216,0.25)';this.style.transform='translateY(-2px)'"
                 onmouseleave="this.style.borderColor='';this.style.transform=''">
              <div class="scanlines"></div>

              ${a.tokenRisk ? `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                  <span style="font-family:'Orbitron',sans-serif;font-size:9px;font-weight:700;color:var(--chrome-dark);letter-spacing:0.15em;">INVESTIGATION</span>
                  <span style="font-family:'Orbitron',sans-serif;font-size:10px;font-weight:800;color:${riskColor(a.tokenRisk)};">${a.tokenRisk}/100</span>
                </div>
              ` : ''}

              <h3 style="font-family:'Orbitron',sans-serif;font-size:16px;font-weight:700;color:var(--chrome-bright);margin-bottom:8px;line-height:1.3;">${a.title}</h3>
              <p style="font-size:12px;color:var(--chrome-mid);line-height:1.5;margin-bottom:16px;">${a.summary}</p>

              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:10px;color:var(--chrome-dark);">${a.created_at ? a.created_at.split('T')[0] : ''}</span>
                ${a.tokenName ? `<span style="font-size:10px;color:var(--low);">${a.tokenName}</span>` : ''}
              </div>
            </div>
          `).join('') : `
            <div style="grid-column:span 2;text-align:center;padding:60px;color:var(--chrome-mid);">
              <p>No investigations published yet.</p>
            </div>
          `}
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div style="text-align:center;padding:80px;color:var(--chrome-mid);">Failed to load investigations</div>`;
  }
}

// Simple markdown to HTML (handles headers, bold, code, links, lists, tables)
function mdToHTML(md) {
  let html = md
    // Code blocks
    .replace(/```([\s\S]*?)```/g, '<pre style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:16px;overflow-x:auto;font-size:12px;margin:16px 0;">$1</pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.06);padding:2px 6px;border-radius:3px;font-size:11px;color:var(--low);">$1</code>')
    // Headers
    .replace(/^### (.+)$/gm, '<h3 style="font-family:Orbitron,sans-serif;font-size:14px;font-weight:700;color:var(--chrome-bright);margin:24px 0 12px;letter-spacing:0.05em;">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="font-family:Orbitron,sans-serif;font-size:18px;font-weight:700;color:var(--chrome-bright);margin:32px 0 16px;letter-spacing:0.05em;">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="font-family:Orbitron,sans-serif;font-size:24px;font-weight:800;color:var(--chrome-bright);margin:0 0 20px;letter-spacing:0.05em;">$1</h1>')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:var(--chrome-bright);">$1</strong>')
    // Tables (basic)
    .replace(/\|(.+)\|\n\|[-| ]+\|\n((?:\|.+\|\n?)+)/g, (match, header, body) => {
      const headers = header.split('|').filter(h => h.trim()).map(h => `<th style="padding:8px 12px;text-align:left;color:var(--chrome-dark);font-size:10px;letter-spacing:0.1em;font-family:Orbitron,sans-serif;">${h.trim()}</th>`).join('');
      const rows = body.trim().split('\n').map(row => {
        const cells = row.split('|').filter(c => c.trim()).map(c => `<td style="padding:8px 12px;border-top:1px solid rgba(255,255,255,0.04);font-size:12px;">${c.trim()}</td>`).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      return `<table style="width:100%;border-collapse:collapse;margin:16px 0;"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
    })
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li style="margin:4px 0;padding-left:8px;font-size:13px;">$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li style="margin:4px 0;padding-left:8px;font-size:13px;">$1</li>')
    // Paragraphs (lines that aren't already HTML)
    .replace(/^(?!<[hultpd]|<li|<pre|<code|<table|<strong)(.+)$/gm, '<p style="font-size:14px;line-height:1.7;color:var(--chrome-light);margin:12px 0;">$1</p>')
    // Wrap consecutive <li> in <ul>
    .replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, '<ul style="margin:12px 0;padding-left:20px;">$1</ul>');

  return html;
}

export async function renderArticlePage(container, slug) {
  try {
    const { article, token } = await api.getArticle(slug);

    const contentHTML = mdToHTML(article.content);

    container.innerHTML = `
      <div style="max-width:800px;margin:0 auto;padding:20px 40px 80px;">
        <div style="margin-bottom:32px;">
          <a href="#/investigations" style="font-size:11px;color:var(--chrome-dark);letter-spacing:0.1em;font-family:Orbitron,sans-serif;">&larr; ALL INVESTIGATIONS</a>
        </div>

        ${token ? `
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
            <span style="font-family:'Orbitron',sans-serif;font-size:9px;font-weight:700;padding:3px 10px;border-radius:4px;letter-spacing:0.1em;background:rgba(255,59,59,0.15);border:1px solid rgba(255,59,59,0.4);color:var(--critical);">RISK ${token.risk_score}/100</span>
            <a href="#/token/${token.mint}" style="font-size:11px;color:var(--low);font-family:'JetBrains Mono',monospace;">View full audit &rarr;</a>
          </div>
        ` : ''}

        <article style="color:var(--chrome-light);">
          ${contentHTML}
        </article>

        <div style="margin-top:48px;padding-top:24px;border-top:1px solid rgba(255,255,255,0.06);">
          <div style="font-size:10px;color:var(--chrome-dark);margin-bottom:8px;">Published: ${article.created_at ? article.created_at.split('T')[0] : 'Unknown'}</div>
          ${token ? `
            <a href="#/token/${token.mint}" class="glass-panel" style="display:inline-flex;align-items:center;gap:12px;padding:12px 20px;cursor:pointer;transition:all 0.3s;">
              <span style="font-size:12px;color:var(--chrome-bright);">View ${token.name} Audit</span>
              <span style="font-family:'Orbitron',sans-serif;font-size:11px;font-weight:800;color:var(--critical);">${token.risk_score}/100</span>
            </a>
          ` : ''}
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `
      <div style="max-width:800px;margin:0 auto;padding:40px;text-align:center;">
        <h2 style="font-family:'Orbitron',sans-serif;font-size:20px;color:var(--chrome-bright);">Article Not Found</h2>
        <a href="#/investigations" style="color:var(--low);font-size:12px;margin-top:12px;display:inline-block;">&larr; Back to investigations</a>
      </div>
    `;
  }
}
