// Photo/logo uploader: camera or library, on-device compression, progress, retry.
import { html, esc, compressImage, uploadWithProgress, toast, api, ApiError } from '../lib.ts';
import type { AssetView, ProjectView } from '../../../shared/types.ts';

interface Pending { key: string; file: File; url: string; pct: number; failed: boolean; error?: string }

export function mountUploader(el: HTMLElement, projectId: string, kind: 'photo' | 'logo' | 'attachment', initial: AssetView[], opts: { max: number; label: string; onChange?: (v: ProjectView | null, assetId?: string) => void }) {
  let assets = initial.filter((a) => a.kind === kind);
  const pending: Pending[] = [];

  const paint = () => {
    el.innerHTML = html`
<div class="uploads" aria-live="polite">
${assets.map((a) => html`<div class="thumb"><img src="${a.url}" alt="${a.label ?? 'Uploaded image'}" loading="lazy" width="200" height="200"><button class="rm" type="button" data-rm="${a.id}" aria-label="Remove image">✕</button></div>`)}
${pending.map((p) => html`<div class="thumb ${p.failed ? 'failed' : ''}"><img src="${p.url}" alt="Uploading image" width="200" height="200">
<span class="pct">${p.failed ? html`<button class="btn-link" style="color:#fff;min-height:32px;padding:0" type="button" data-retry="${p.key}">Retry</button>` : `${p.pct}%`}</span></div>`)}
</div>
${assets.length + pending.length < opts.max ? html`<div class="chips">
<label class="chip upload-btn">Choose ${kind === 'logo' ? 'logo' : 'photos'}<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" ${kind === 'photo' ? 'multiple' : ''} aria-label="${opts.label}"></label>
${kind !== 'logo' ? html`<label class="chip upload-btn">Take a photo<input type="file" accept="image/*" capture="environment" aria-label="Take a photo with your camera"></label>` : ''}
</div>` : html`<p class="small muted">You’ve added the maximum for now.</p>`}
${pending.some((p) => p.failed) ? html`<p class="err-text">${pending.find((p) => p.failed)?.error ?? 'An upload failed.'}</p>` : ''}`.s;
    el.querySelectorAll<HTMLInputElement>('input[type=file]').forEach((inp) => inp.addEventListener('change', () => {
      const files = [...(inp.files ?? [])].slice(0, opts.max - assets.length - pending.length);
      for (const f of files) {
        const p: Pending = { key: Math.random().toString(36).slice(2), file: f, url: URL.createObjectURL(f), pct: 0, failed: false };
        pending.push(p);
        void send(p);
      }
      paint();
    }));
    el.querySelectorAll<HTMLButtonElement>('[data-retry]').forEach((b) => b.addEventListener('click', () => {
      const p = pending.find((x) => x.key === b.dataset.retry);
      if (p) {
        p.failed = false;
        p.pct = 0;
        paint();
        void send(p);
      }
    }));
    el.querySelectorAll<HTMLButtonElement>('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const v = await api<ProjectView>('DELETE', `/api/projects/${projectId}/assets/${b.dataset.rm}`);
        assets = v.assets.filter((a) => a.kind === kind);
        paint();
        opts.onChange?.(v);
      } catch (e) {
        if (e instanceof ApiError) toast(e.message, 'error');
      }
    }));
  };

  const send = async (p: Pending) => {
    try {
      const blob = await compressImage(p.file, kind === 'logo' ? 600 : 1600);
      const r = await uploadWithProgress(`/api/projects/${projectId}/assets?kind=${kind}&label=${encodeURIComponent(p.file.name.replace(/\.[^.]+$/, '').slice(0, 80))}`, blob, (pct) => {
        p.pct = pct;
        const span = el.querySelectorAll('.pct')[pending.indexOf(p)];
        if (span && !p.failed) span.textContent = `${pct}%`;
      });
      pending.splice(pending.indexOf(p), 1);
      if (kind !== 'attachment') URL.revokeObjectURL(p.url);
      const v = r.view as ProjectView;
      assets = kind === 'attachment' ? [...assets, { id: r.assetId, url: p.url, kind, source: 'owner' }] : v.assets.filter((a) => a.kind === kind);
      paint();
      opts.onChange?.(v, r.assetId);
    } catch (e) {
      p.failed = true;
      p.error = e instanceof ApiError ? e.message : 'Upload failed. Tap Retry.';
      paint();
    }
  };
  paint();
  return { count: () => assets.length, ids: () => assets.map((a) => a.id) };
}

export { esc };
