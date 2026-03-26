/**
 * Initialize entrance animations via IntersectionObserver.
 * Call this after injecting new HTML into the page.
 */
export function initAnimations(root = document) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry, index) => {
      if (entry.isIntersecting) {
        // Stagger delay based on element position
        const delay = index * 60;
        setTimeout(() => entry.target.classList.add('visible'), delay);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  root.querySelectorAll('.anim-enter:not(.visible)').forEach(el => observer.observe(el));
}

/**
 * Animate a number counting up.
 */
export function animateCounter(el, target, duration = 1200) {
  const start = performance.now();
  const from = 0;

  function update(now) {
    const progress = Math.min((now - start) / duration, 1);
    // Ease out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(from + (target - from) * eased);
    if (progress < 1) requestAnimationFrame(update);
  }

  requestAnimationFrame(update);
}

/**
 * Copy text to clipboard with visual feedback.
 */
export function copyToClipboard(text, feedbackEl) {
  navigator.clipboard.writeText(text).then(() => {
    if (feedbackEl) {
      const original = feedbackEl.textContent;
      feedbackEl.textContent = 'Copied!';
      feedbackEl.style.color = 'var(--clean)';
      setTimeout(() => {
        feedbackEl.textContent = original;
        feedbackEl.style.color = '';
      }, 1500);
    }
  });
}
