import { api, html, navigate, busy, fieldError, ApiError } from '../lib.ts';
import { chrome, root, type AppConfig } from '../main.ts';

export function renderSignin(cfg: AppConfig) {
  let channel: 'email' | 'sms' = 'email';
  let destination = '';
  const paint = (stage: 'dest' | 'code', demoCode?: string | null, sentTo?: string) => {
    root().innerHTML = chrome(cfg, html`
<h1>Sign in</h1>
<p class="lede">Use the email or mobile number you saved with your preview. We’ll send a one-time code. No password needed.</p>
${stage === 'dest' ? html`
<div class="tabs" role="tablist" aria-label="Sign-in method"><button role="tab" aria-selected="${channel === 'email'}" data-c="email">Email</button><button role="tab" aria-selected="${channel === 'sms'}" data-c="sms">Text message</button></div>
<form id="f" novalidate><div class="field"><label for="d">${channel === 'email' ? 'Email address' : 'Mobile number'}</label>
${channel === 'email' ? html`<input class="input" id="d" name="destination" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" value="${destination}">`
    : html`<input class="input" id="d" name="destination" type="tel" inputmode="tel" autocomplete="tel" value="${destination}">`}</div>
<div class="actionbar"><button class="btn btn-primary btn-block" type="submit">Send me a code</button><a class="btn-link" href="/start" data-link style="text-align:center">New here? Find your business</a></div></form>`
    : html`<form id="f" novalidate>
<p class="notice info">${demoCode ? html`<strong>Demo:</strong> nothing was sent to ${sentTo}. Your code is <strong class="code">${demoCode}</strong>.` : html`We sent a code to <strong>${sentTo}</strong>.`}</p>
<div class="field"><label for="code">6-digit code</label><input class="input otp" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></div>
<div class="actionbar"><button class="btn btn-primary btn-block" type="submit">Sign in</button><button class="btn-link" type="button" id="back">Use a different ${channel === 'email' ? 'email' : 'number'}</button></div></form>`}`).s;
    root().querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) => b.addEventListener('click', () => { channel = b.dataset.c as 'email' | 'sms'; paint('dest'); }));
    document.getElementById('back')?.addEventListener('click', () => paint('dest'));
    const form = document.getElementById('f') as HTMLFormElement;
    (form.querySelector('input') as HTMLInputElement).focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        if (stage === 'dest') {
          destination = (form.querySelector('#d') as HTMLInputElement).value;
          const r = await busy(form.querySelector('[type=submit]'), 'Sending…', () => api('POST', '/api/auth/start', { channel, destination }), false);
          if (r) paint('code', r.demoCode, r.codeSentTo);
        } else {
          const code = (form.querySelector('#code') as HTMLInputElement).value;
          const me = await busy(form.querySelector('[type=submit]'), 'Signing in…', () => api('POST', '/api/auth/verify', { channel, destination, code }), false);
          if (!me) return;
          navigate(me.projects.length ? `/app?p=${me.projects[0].id}` : '/app');
        }
      } catch (err) {
        if (err instanceof ApiError) fieldError(form, stage === 'dest' ? 'destination' : 'code', err.message);
      }
    });
  };
  paint('dest');
}
