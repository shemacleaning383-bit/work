// Ready-notification + saved-access flow: choose channel → enter destination →
// verify one-time code. Only the chosen channel is asked for. Marketing is separate and off.
import { api, html, sheet, busy, fieldError, ApiError, toast } from '../lib.ts';
import type { ProjectView } from '../../../shared/types.ts';

export const CONSENT = 'We’ll use this to send your preview link and updates about this build.';

export function openNotifySheet(projectId: string, channel: 'sms' | 'email', onDone: (v: ProjectView) => void, opts: { purpose?: 'notify' | 'save' } = {}) {
  const isSms = channel === 'sms';
  sheet(isSms ? 'Text me when it’s ready' : 'Email me when it’s ready', html`
<form id="dest-form" novalidate>
<div class="field"><label for="dest">${isSms ? 'Mobile number' : 'Email address'}</label>
${isSms
    ? html`<input class="input" id="dest" name="destination" type="tel" inputmode="tel" autocomplete="tel" maxlength="40" required>`
    : html`<input class="input" id="dest" name="destination" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" maxlength="254" required>`}
<p class="help">${CONSENT} This is private and never shown on your website.${isSms ? ' Message and data rates may apply. Reply STOP to opt out.' : ''}</p></div>
<label class="check"><input type="checkbox" name="marketing"> <span class="small">Also send me occasional Blue Park tips and offers (optional)</span></label>
<button class="btn btn-primary btn-block" type="submit" style="margin-top:12px">Send me a code</button>
</form>
<form id="code-form" novalidate hidden>
<p id="code-msg" class="notice info"></p>
<div class="field"><label for="code">6-digit code</label>
<input class="input otp" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" required></div>
<button class="btn btn-primary btn-block" type="submit">Verify</button>
<button class="btn-link" type="button" id="change-dest">Use a different ${isSms ? 'number' : 'email'}</button>
</form>`, (el, close) => {
    const destForm = el.querySelector('#dest-form') as HTMLFormElement;
    const codeForm = el.querySelector('#code-form') as HTMLFormElement;
    let destination = '';
    (el.querySelector('#dest') as HTMLInputElement).focus();
    destForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      destination = (destForm.querySelector('#dest') as HTMLInputElement).value;
      try {
        const r = await busy(destForm.querySelector('[type=submit]'), 'Sending…', () => api('POST', `/api/projects/${projectId}/notify-pref`, { channel, destination }), false);
        if (!r) return;
        destForm.hidden = true;
        codeForm.hidden = false;
        const msg = el.querySelector('#code-msg')!;
        msg.innerHTML = r.demoCode
          ? html`<strong>Demo:</strong> nothing was sent to ${r.codeSentTo}. Your code is <strong class="code">${r.demoCode}</strong>.`.s
          : html`We sent a code to <strong>${r.codeSentTo}</strong>. It expires in 10 minutes.`.s;
        (codeForm.querySelector('#code') as HTMLInputElement).focus();
      } catch (err) {
        if (err instanceof ApiError) fieldError(destForm, err.field ?? 'destination', err.message);
      }
    });
    el.querySelector('#change-dest')!.addEventListener('click', () => {
      codeForm.hidden = true;
      destForm.hidden = false;
    });
    codeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = (codeForm.querySelector('#code') as HTMLInputElement).value;
      const marketing = (destForm.querySelector('[name=marketing]') as HTMLInputElement).checked;
      try {
        const v = await busy(codeForm.querySelector('[type=submit]'), 'Verifying…', () =>
          api<ProjectView>('POST', `/api/projects/${projectId}/verify`, { channel, destination, code, marketingOptIn: marketing, notify: opts.purpose !== 'save' }), false);
        if (!v) return;
        close();
        toast(opts.purpose === 'save' ? 'Saved. You can return from any device.' : 'Done. We’ll message you when it’s ready.');
        onDone(v);
      } catch (err) {
        if (err instanceof ApiError) fieldError(codeForm, 'code', err.message);
      }
    });
  });
}
