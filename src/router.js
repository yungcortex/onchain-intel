import { renderTokenPage } from './pages/token.js';
import { renderWalletPage } from './pages/wallet.js';
import { renderBlacklistPage } from './pages/blacklist.js';
import { renderSubmitPage } from './pages/submit.js';
import { renderInvestigationsPage, renderArticlePage } from './pages/investigations.js';

const appEl = () => document.getElementById('app');

/**
 * Simple hash-based router.
 * #/ → home (already in index.html)
 * #/token/:mint → token audit page
 * #/wallet/:address → wallet profile
 * #/blacklist → blacklist table
 * #/submit → tip submission
 */
export function initRouter() {
  window.addEventListener('hashchange', handleRoute);
  // Don't run on initial load if hash is empty — home page is static HTML
  if (window.location.hash && window.location.hash !== '#/') {
    handleRoute();
  }
}

function handleRoute() {
  const hash = window.location.hash || '#/';
  const app = appEl();

  // Parse route
  if (hash === '#/' || hash === '') {
    // Home — just show the static content, hide any dynamic page
    showHome();
    return;
  }

  const tokenMatch = hash.match(/^#\/token\/(.+)$/);
  if (tokenMatch) {
    const mint = tokenMatch[1];
    showDynamicPage();
    renderTokenPage(getDynamicContainer(), mint);
    return;
  }

  const walletMatch = hash.match(/^#\/wallet\/(.+)$/);
  if (walletMatch) {
    const address = walletMatch[1];
    showDynamicPage();
    renderWalletPage(getDynamicContainer(), address);
    return;
  }

  if (hash === '#/investigations') {
    showDynamicPage();
    renderInvestigationsPage(getDynamicContainer());
    return;
  }

  const articleMatch = hash.match(/^#\/investigations\/(.+)$/);
  if (articleMatch) {
    showDynamicPage();
    renderArticlePage(getDynamicContainer(), articleMatch[1]);
    return;
  }

  if (hash === '#/blacklist') {
    showDynamicPage();
    renderBlacklistPage(getDynamicContainer());
    return;
  }

  if (hash === '#/submit') {
    showDynamicPage();
    renderSubmitPage(getDynamicContainer());
    return;
  }

  // Unknown route → home
  showHome();
}

function showHome() {
  const staticSections = document.querySelectorAll('.hero, .content-section, footer');
  staticSections.forEach(el => el.style.display = '');
  const dynamic = document.getElementById('dynamic-page');
  if (dynamic) dynamic.style.display = 'none';
}

function showDynamicPage() {
  // Hide static home content
  const staticSections = document.querySelectorAll('.hero, .content-section, footer');
  staticSections.forEach(el => el.style.display = 'none');

  // Show/create dynamic container
  let dynamic = document.getElementById('dynamic-page');
  if (!dynamic) {
    dynamic = document.createElement('div');
    dynamic.id = 'dynamic-page';
    dynamic.style.cssText = 'position: relative; z-index: 2; min-height: 100vh; padding-top: 80px;';
    document.getElementById('app').appendChild(dynamic);
  }
  dynamic.style.display = '';
  dynamic.innerHTML = '<div style="text-align:center;padding:100px 20px;"><div class="loading-pulse" style="margin:0 auto;"></div><p style="margin-top:20px;color:var(--chrome-mid);font-size:12px;letter-spacing:0.1em;">LOADING...</p></div>';
}

function getDynamicContainer() {
  return document.getElementById('dynamic-page');
}

// Navigate helper
export function navigate(hash) {
  window.location.hash = hash;
}
