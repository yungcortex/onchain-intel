import './style/main.css';
import { NetworkBackground } from './gl/NetworkBackground.js';
import { initRouter } from './router.js';
import { api } from './lib/api.js';
import { animateCounter } from './lib/animate.js';

// ── Init ───────────────────────────────────────────────────────────────────
let bg;
let scrollY = 0;
let docHeight = 1;

function init() {
  // WebGL Background
  const canvas = document.getElementById('bg-canvas');
  if (canvas) {
    bg = new NetworkBackground(canvas);
  }

  // Smooth scroll tracking
  window.addEventListener('scroll', () => {
    scrollY = window.scrollY;
    docHeight = document.documentElement.scrollHeight - window.innerHeight;
  }, { passive: true });

  // Entrance animations (Intersection Observer)
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, { threshold: 0.15 });

  document.querySelectorAll('.anim-enter').forEach(el => observer.observe(el));

  // Search bar
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');

  if (searchInput && searchBtn) {
    const doSearch = () => {
      const query = searchInput.value.trim();
      if (query) {
        window.location.hash = `#/token/${query}`;
      }
    };

    searchBtn.addEventListener('click', doSearch);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSearch();
    });
  }

  // Nav link clicks
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => {
      window.location.hash = el.dataset.nav;
      // Close mobile menu
      const mobileMenu = document.getElementById('mobile-menu');
      if (mobileMenu) mobileMenu.style.display = 'none';
    });
  });

  // Mobile hamburger
  const mobileToggle = document.getElementById('mobile-nav-toggle');
  const mobileMenu = document.getElementById('mobile-menu');
  if (mobileToggle && mobileMenu) {
    mobileToggle.addEventListener('click', () => {
      const isOpen = mobileMenu.style.display === 'flex';
      mobileMenu.style.display = isOpen ? 'none' : 'flex';
    });
  }

  // Init router
  initRouter();

  // Load live stats from API
  api.getStats().then(stats => {
    const auditsEl = document.getElementById('stat-audits');
    const walletsEl = document.getElementById('stat-wallets');
    const rugsEl = document.getElementById('stat-rugs');
    if (auditsEl) animateCounter(auditsEl, stats.audits);
    if (walletsEl) animateCounter(walletsEl, stats.wallets);
    if (rugsEl) animateCounter(rugsEl, stats.rugs);
  }).catch(() => {});

  // Populate recent flagged wallets on home page
  api.getBlacklist(1).then(data => {
    const list = document.getElementById('recent-wallets-list');
    if (!list || !data.wallets) return;
    list.innerHTML = data.wallets.slice(0, 8).map(w => `
      <a href="#/wallet/${w.address}" style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;border-radius:4px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);transition:border-color 0.2s;font-size:10px;"
         onmouseenter="this.style.borderColor='rgba(255,166,87,0.3)'" onmouseleave="this.style.borderColor='rgba(255,255,255,0.04)'">
        <span style="font-family:'JetBrains Mono',monospace;color:var(--chrome-light);">${w.address.slice(0,10)}...${w.address.slice(-6)}</span>
        <span style="font-family:'Orbitron',sans-serif;font-size:8px;font-weight:700;color:#ffa657;letter-spacing:0.05em;">${(w.risk_level || '').toUpperCase()}</span>
      </a>
    `).join('');
  }).catch(() => {});

  // Loading screen
  setTimeout(() => {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) loadingScreen.classList.add('hidden');
  }, 2000);

  // Render loop
  function animate(time) {
    const t = time * 0.001;
    const scroll = docHeight > 0 ? scrollY / docHeight : 0;
    if (bg) bg.update(t, scroll);
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

// Start
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
