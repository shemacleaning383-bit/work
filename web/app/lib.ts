// Tiny UI toolkit: escaped HTML templates, API client, routing, sheets, toasts,
// safe local storage and image compression. No framework, small initial load.
import type { ProjectView } from '../../shared/types.ts';

export class Safe {
  s: string;
  constructor(s: string) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}
export const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const part = (v: unknown): string => (v instanceof Safe ? v.s : Array.isArray(v) ? v.map(part).join('') : v === false || v == null ? '' : esc(v));
export function html(strings: TemplateStringsArray, ...vals: unknown[]): Safe {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Safe(out);
}
export const raw = (s: string) => new Safe(s);

// ---------- API ----------
export class ApiError extends Error {
  code: string;
  status: number;
  field?: string;
  constructor(message: string, code: string, status: number, field?: string) {
    super(message);
    this.code = code;
    this.status = status;
    this.field = field;
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown, opts: { raw?: Blob; signal?: AbortSignal } = {}): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ApiError('You’re offline. We’ll keep what you entered. Try again when you’re connected.', 'offline', 0);
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      signal: opts.signal,
      headers: { ...(method !== 'GET' ? { 'x-bp': '1' } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: opts.raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError('We couldn’t reach Blue Park. Check your connection and try again.', 'network', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? 'Something went wrong. Please try again.', data.code ?? 'error', res.status, data.field);
  return data as T;
}

// ---------- routing ----------
type RouteFn = () => void;
let onRoute: RouteFn = () => {};
export function setRouter(fn: RouteFn) {
  onRoute = fn;
  window.addEventListener('popstate', () => onRoute());
  document.addEventListener('click', (e) => {
    const a = (e.target as Element).closest?.('a[data-link]') as HTMLAnchorElement | null;
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
    e.preventDefault();
    navigate(a.getAttribute('href')!);
  });
}
export function navigate(path: string, replace = false) {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  window.scrollTo(0, 0);
  onRoute();
}

// ---------- storage (never required; may be unavailable) ----------
export const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(`bp:${k}`);
      return v == null ? d : (JSON.parse(v) as T);
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(`bp:${k}`, JSON.stringify(v));
    } catch {
      /* private mode etc. */
    }
  },
  del(k: string) {
    try {
      localStorage.removeItem(`bp:${k}`);
    } catch {
      /* ignore */
    }
  },
};

// ---------- toasts & sheets ----------
let toastTimer: number | undefined;
export function toast(message: string, kind: 'info' | 'error' = 'info') {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = message;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.remove(), 4200);
}

export function sheet(title: string, body: Safe, onMount?: (el: HTMLElement, close: () => void) => void): () => void {
  const d = document.createElement('dialog');
  d.className = 'sheet';
  d.setAttribute('aria-label', title);
  d.innerHTML = `<div class="sheet-in"><div class="grab" aria-hidden="true"></div><header><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">✕</button></header><div class="sheet-body">${body.s}</div></div>`;
  document.body.appendChild(d);
  const close = () => {
    d.close();
    d.remove();
  };
  d.addEventListener('click', (e) => {
    if (e.target === d || (e.target as Element).closest('[data-close]')) close();
  });
  d.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  d.showModal();
  onMount?.(d.querySelector('.sheet-body') as HTMLElement, close);
  return close;
}

export function confirmSheet(title: string, message: Safe, confirmLabel: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const close = sheet(title, html`<div class="stack">${message}<div class="stack"><button class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-block" data-yes>${confirmLabel}</button><button class="btn btn-quiet btn-block" data-no>Not now</button></div></div>`, (el, c) => {
      el.querySelector('[data-yes]')!.addEventListener('click', () => {
        done = true;
        c();
        resolve(true);
      });
      el.querySelector('[data-no]')!.addEventListener('click', () => {
        c();
      });
    });
    const obs = new MutationObserver(() => {
      if (!document.body.contains(document.querySelector('dialog.sheet'))) {
        obs.disconnect();
        if (!done) resolve(false);
      }
    });
    obs.observe(document.body, { childList: true });
    void close;
  });
}

/** Wrap an async action on a button: disables it, shows progress, prevents double taps. */
export async function busy<T>(btn: HTMLButtonElement | null, label: string, fn: () => Promise<T>, toastErrors = true): Promise<T | undefined> {
  if (btn?.dataset.busy === '1') return;
  const original = btn?.innerHTML;
  if (btn) {
    btn.dataset.busy = '1';
    btn.setAttribute('aria-disabled', 'true');
    btn.innerHTML = `<span class="spin" aria-hidden="true"></span>${esc(label)}`;
  }
  try {
    return await fn();
  } catch (e) {
    if (toastErrors) {
      if (e instanceof ApiError) toast(e.message, 'error');
      else if ((e as Error).name !== 'AbortError') toast('Something went wrong. Please try again.', 'error');
    }
    throw e;
  } finally {
    if (btn && btn.isConnected) {
      btn.dataset.busy = '';
      btn.removeAttribute('aria-disabled');
      btn.innerHTML = original ?? '';
    }
  }
}

export function fieldError(form: ParentNode, field: string | undefined, message: string) {
  form.querySelectorAll('[aria-invalid=true]').forEach((el) => el.removeAttribute('aria-invalid'));
  form.querySelectorAll('.err-text').forEach((el) => el.remove());
  if (!field) return false;
  const input = form.querySelector(`[name="${field}"]`) as HTMLElement | null;
  if (!input) return false;
  input.setAttribute('aria-invalid', 'true');
  const p = document.createElement('p');
  p.className = 'err-text';
  p.id = `err-${field}`;
  p.textContent = message;
  input.setAttribute('aria-describedby', p.id);
  input.insertAdjacentElement('afterend', p);
  input.focus();
  return true;
}

// ---------- images: compress on device before upload ----------
export async function compressImage(file: File, maxDim = 1600, quality = 0.82): Promise<Blob> {
  if (!/^image\//.test(file.type)) throw new Error('Not an image');
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as any);
  } catch {
    return file; // let the server decide (it sniffs real types)
  }
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c2d = canvas.getContext('2d')!;
  const keepAlpha = file.type === 'image/png' && maxDim <= 600;
  if (!keepAlpha) {
    c2d.fillStyle = '#fff';
    c2d.fillRect(0, 0, w, h);
  }
  c2d.drawImage(bmp, 0, 0, w, h);
  return await new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), keepAlpha ? 'image/png' : 'image/jpeg', quality));
}

export function uploadWithProgress(url: string, blob: Blob, onProgress: (pct: number) => void): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('x-bp', '1');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let data: any = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(data.error ?? 'Upload failed.', data.code ?? 'upload', xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('Upload failed. Check your connection and retry.', 'network', 0));
    xhr.send(blob);
  });
}

// ---------- misc ----------
export function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}
export const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
export const dateLong = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
export const uid = () => (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const LOGO = raw(`<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#0b1b33"/><path d="M8 22V10h7.2c2.6 0 4.2 1.3 4.2 3.3 0 1.4-.8 2.4-2 2.8 1.6.3 2.6 1.5 2.6 3.1 0 2.3-1.8 3.8-4.6 3.8H8z" fill="#fff"/><circle cx="24" cy="10" r="3" fill="#1652f0"/></svg>`);

export type View = ProjectView;

export function fact(v: ProjectView, key: string): any {
  return v.facts.find((f) => f.key === key)?.value ?? null;
}

/** Track on-screen keyboard so sticky bars don't cover inputs. */
export function watchKeyboard() {
  const vv = (window as any).visualViewport as VisualViewport | undefined;
  if (!vv) return;
  const update = () => document.body.classList.toggle('kbd-open', window.innerHeight - vv.height > 150);
  vv.addEventListener('resize', update);
}

export function watchOnline() {
  const update = () => {
    let bar = document.querySelector('.offline');
    if (navigator.onLine) bar?.remove();
    else if (!bar) {
      bar = document.createElement('div');
      bar.className = 'offline';
      bar.setAttribute('role', 'status');
      bar.textContent = 'You’re offline. Your entries are saved on this device.';
      document.body.appendChild(bar);
    }
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}
