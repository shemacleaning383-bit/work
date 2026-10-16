import { api, html, sheet, busy, toast, uid, ApiError, fieldError } from '../lib.ts';
import type { AppConfig } from '../main.ts';

export function openHelp(cfg: AppConfig, projectId: string | null) {
  const key = uid();
  sheet('Help', html`
<p style="margin-top:0">Everything works without a call. If you’re stuck, send us a note and we’ll reply in your dashboard${projectId ? '' : ' or by email'}.</p>
<details class="section"><summary>Is the preview really free?</summary><div class="body"><p class="small">Yes. No card is needed to see your preview. Billing starts only when you subscribe and the payment is confirmed: ${(cfg.offer.monthlyPriceCents / 100).toFixed(0)} ${cfg.offer.currency}/month plus tax, no setup fee.</p></div></details>
<details class="section"><summary>Can I leave and come back?</summary><div class="body"><p class="small">Yes. Builds keep running when you close the page. Save an email or phone on the progress screen to get a link and sign in from any device.</p></div></details>
<details class="section"><summary>What if a detail is wrong?</summary><div class="body"><p class="small">Edit it anytime. Your corrections always override what we found online.</p></div></details>
${projectId ? html`<form id="help-form" novalidate><div class="field"><label for="h-body">Message us</label><textarea class="input" id="h-body" name="body" rows="3" maxlength="4000" placeholder="What can we help with?"></textarea></div>
<button class="btn btn-dark btn-block" type="submit">Send</button></form>` : html`<p class="small muted">Start or open a preview to message us from here.</p>`}`, (el, close) => {
    const form = el.querySelector('#help-form') as HTMLFormElement | null;
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = (form.querySelector('textarea') as HTMLTextAreaElement).value;
      try {
        await busy(form.querySelector('button'), 'Sending…', () => api('POST', `/api/projects/${projectId}/tickets`, { subject: 'Help request', body, idempotencyKey: key }), false);
        close();
        toast('Sent. We’ll reply in your dashboard.');
      } catch (err) {
        if (err instanceof ApiError && !fieldError(form, err.field ?? 'body', err.message)) toast(err.message, 'error');
      }
    });
  });
}
