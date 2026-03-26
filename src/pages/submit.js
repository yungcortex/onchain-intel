import { api } from '../lib/api.js';

export async function renderSubmitPage(container) {
  container.innerHTML = `
    <div style="max-width:600px;margin:0 auto;padding:20px 40px 80px;">
      <div style="font-family:'Orbitron',sans-serif;font-size:10px;color:var(--chrome-dark);letter-spacing:0.2em;margin-bottom:6px;">COMMUNITY</div>
      <h1 style="font-family:'Orbitron',sans-serif;font-size:clamp(24px,3vw,32px);font-weight:800;color:var(--chrome-bright);margin-bottom:8px;">Submit a Tip</h1>
      <p style="font-size:12px;color:var(--chrome-mid);margin-bottom:32px;">Found a suspicious token or wallet? Let us know. Anonymous tips welcome.</p>

      <form id="tip-form" class="glass-panel" style="padding:32px;">
        <div class="scanlines"></div>

        <div style="margin-bottom:20px;">
          <label style="display:block;font-size:10px;color:var(--chrome-dark);letter-spacing:0.1em;margin-bottom:6px;font-family:'Orbitron',sans-serif;">TOKEN MINT (optional)</label>
          <input type="text" name="tokenMint" placeholder="Solana token address..."
            style="width:100%;padding:10px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:var(--chrome-light);font-family:'JetBrains Mono',monospace;font-size:12px;outline:none;" />
        </div>

        <div style="margin-bottom:20px;">
          <label style="display:block;font-size:10px;color:var(--chrome-dark);letter-spacing:0.1em;margin-bottom:6px;font-family:'Orbitron',sans-serif;">WALLET ADDRESS (optional)</label>
          <input type="text" name="wallet" placeholder="Suspicious wallet address..."
            style="width:100%;padding:10px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:var(--chrome-light);font-family:'JetBrains Mono',monospace;font-size:12px;outline:none;" />
        </div>

        <div style="margin-bottom:20px;">
          <label style="display:block;font-size:10px;color:var(--chrome-dark);letter-spacing:0.1em;margin-bottom:6px;font-family:'Orbitron',sans-serif;">WHAT DID YOU FIND? *</label>
          <textarea name="message" rows="5" placeholder="Describe what's suspicious..."
            style="width:100%;padding:10px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:var(--chrome-light);font-family:'JetBrains Mono',monospace;font-size:12px;outline:none;resize:vertical;"></textarea>
        </div>

        <div style="margin-bottom:24px;">
          <label style="display:block;font-size:10px;color:var(--chrome-dark);letter-spacing:0.1em;margin-bottom:6px;font-family:'Orbitron',sans-serif;">YOUR TWITTER/CONTACT (optional)</label>
          <input type="text" name="contact" placeholder="@yourhandle or email..."
            style="width:100%;padding:10px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:var(--chrome-light);font-family:'JetBrains Mono',monospace;font-size:12px;outline:none;" />
        </div>

        <button type="submit" style="width:100%;padding:14px;background:rgba(88,166,255,0.15);border:1px solid rgba(88,166,255,0.4);border-radius:8px;color:#58a6ff;font-family:'Orbitron',sans-serif;font-size:11px;font-weight:700;letter-spacing:0.15em;cursor:pointer;transition:all 0.3s;">
          SUBMIT TIP
        </button>
        <div id="tip-status" style="text-align:center;margin-top:12px;font-size:11px;min-height:20px;"></div>
      </form>
    </div>
  `;

  // Form handler
  const form = container.querySelector('#tip-form');
  const status = container.querySelector('#tip-status');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const data = {
      tokenMint: formData.get('tokenMint'),
      wallet: formData.get('wallet'),
      message: formData.get('message'),
      contact: formData.get('contact'),
    };

    if (!data.message || data.message.trim().length < 10) {
      status.innerHTML = '<span style="color:var(--critical);">Message must be at least 10 characters</span>';
      return;
    }

    status.innerHTML = '<span style="color:var(--chrome-mid);">Submitting...</span>';

    try {
      await api.submitTip(data);
      status.innerHTML = '<span style="color:var(--clean);">Tip submitted. We\'ll look into it.</span>';
      form.reset();
    } catch (err) {
      status.innerHTML = `<span style="color:var(--critical);">Failed: ${err.message}</span>`;
    }
  });
}
