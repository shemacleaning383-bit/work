// Deterministic site assembly. Copy is built only from confirmed facts plus
// neutral descriptions of service *types*; nothing here claims insurance,
// certifications, years in business, prices, guarantees or reviews.
import type { FactKey } from '../../shared/types.ts';
import { formatPhone } from '../../shared/validate.ts';

export type Variant = 'a' | 'b';

export interface SiteContent {
  variant: Variant;
  business: {
    name: string;
    phone: string | null;
    email: string | null;
    city: string;
    areas: string[];
    services: string[];
    description: string | null;
    differentiator: string | null;
    hours: string | null;
    pricing: string | null;
    bookingUrl: string | null;
    mainAction: 'quote' | 'contact';
    preferredContact: 'phone' | 'email' | 'form';
    logoUrl: string | null;
    photos: { url: string; alt: string; width?: number; height?: number }[];
  };
  design: { accent: string };
  sections: { photos: boolean; areas: boolean; hours: boolean; pricing: boolean; about: boolean };
  copy: { heroTitle: string; heroSub: string; aboutText: string };
  /** Owner/team text overrides; kept separate so regenerated copy never overwrites them. */
  overrides: Partial<Record<'heroTitle' | 'heroSub' | 'aboutText', string>>;
  ownerText: string[];
}

export const VARIANTS: Record<Variant, { name: string; summary: string }> = {
  a: { name: 'Bright', summary: 'Big friendly hero, service cards, and a call/quote bar that stays at the bottom of the phone screen.' },
  b: { name: 'Editorial', summary: 'Calm, magazine-style layout with a serif headline, numbered services and a quote form near the top.' },
};

const SERVICE_BLURBS: Record<string, string> = {
  'Recurring cleaning': 'Regular visits on a schedule you agree on, so your home stays on top of things.',
  'Deep cleaning': 'A more detailed clean for when your home needs extra attention. Ask what’s included.',
  'Move-in / move-out cleaning': 'Cleaning for moving day: before you move in or after you move out.',
  'Apartment & condo cleaning': 'Cleaning for apartments and condos.',
  'Post-renovation cleaning': 'Clearing dust and debris after renovation work.',
  'Office cleaning': 'Cleaning for offices and workspaces.',
  'Airbnb turnover cleaning': 'Turnover cleaning between guest stays.',
  'Window cleaning': 'Window cleaning. Ask what’s included.',
};

export function serviceBlurb(s: string): string {
  return SERVICE_BLURBS[s] ?? `Ask about ${s.toLowerCase()}.`;
}

const DEFAULT_ACCENT = '#1f6feb';

export function buildContent(facts: Record<FactKey, any>, opts: {
  variant: Variant;
  assets: { id: string; url: string; kind: string; width?: number; height?: number; label?: string }[];
  sections?: Partial<SiteContent['sections']>;
  overrides?: SiteContent['overrides'];
  ownerKeys: Set<string>;
}): SiteContent {
  const services: string[] = (facts.services ?? []).slice(0, 10);
  const areas: string[] = (facts.areas ?? []).slice(0, 16);
  const city = String(facts.city ?? areas[0] ?? '');
  const name = String(facts.displayName ?? '').trim();
  const logo = opts.assets.find((a) => a.id === facts.logoAssetId) ?? opts.assets.find((a) => a.kind === 'logo');
  const photoIds: string[] = facts.photoAssetIds ?? [];
  const photos = opts.assets
    .filter((a) => a.kind === 'photo' && (photoIds.length === 0 || photoIds.includes(a.id)))
    .slice(0, 8)
    .map((a) => ({ url: a.url, alt: a.label || `${name} — photo`, width: a.width, height: a.height }));
  const residential = services.some((s) => !/office/i.test(s));
  const kind = residential ? 'Home cleaning' : 'Cleaning';
  const areaList = areas.slice(0, 3).join(', ');
  const description = facts.description ? String(facts.description) : null;
  const differentiator = facts.differentiator ? String(facts.differentiator) : null;
  const ownerText = [description, differentiator, facts.hours, facts.pricing]
    .filter((v, i) => v && ([opts.ownerKeys.has('description'), opts.ownerKeys.has('differentiator'), true, true][i]))
    .map(String);

  const heroTitle = opts.variant === 'a'
    ? `${kind}${city ? ` in ${city}` : ''}, done carefully.`
    : `${name}`;
  const heroSub = opts.variant === 'a'
    ? `${name} cleans ${residential ? 'homes' : 'spaces'}${areaList ? ` across ${areaList}` : ''}. Tell us about your space to request a quote.`
    : `${kind}${areaList ? ` for ${areaList}` : ''}. ${services.slice(0, 3).join(' · ')}`;
  const aboutText = description ?? `${name} provides ${services.slice(0, 3).map((s) => s.toLowerCase()).join(', ')}${city ? ` in ${city}` : ''}.`;

  return {
    variant: opts.variant,
    business: {
      name,
      phone: facts.publicPhone ?? null,
      email: facts.publicEmail ?? null,
      city,
      areas,
      services,
      description,
      differentiator,
      hours: facts.showHours ? facts.hours ?? null : null,
      pricing: facts.showPricing ? facts.pricing ?? null : null,
      bookingUrl: facts.bookingUrl ?? null,
      mainAction: facts.mainAction === 'contact' ? 'contact' : 'quote',
      preferredContact: facts.preferredContact ?? 'phone',
      logoUrl: logo?.url ?? null,
      photos,
    },
    design: { accent: /^#[0-9a-f]{6}$/i.test(facts.accentColor ?? '') ? facts.accentColor : DEFAULT_ACCENT },
    sections: {
      photos: true,
      areas: areas.length > 0,
      hours: true,
      pricing: true,
      about: true,
      ...(opts.sections ?? {}),
    },
    copy: { heroTitle, heroSub, aboutText },
    overrides: opts.overrides ?? {},
    ownerText,
  };
}

export interface PageDef { slug: string; title: string }

export function sitePages(c: SiteContent): PageDef[] {
  const pages: PageDef[] = [{ slug: '', title: 'Home' }, { slug: 'services', title: 'Services' }];
  // Avoid thin pages: only add About / Areas when there is real content for them.
  if (c.sections.about && (c.business.description || c.business.differentiator)) pages.push({ slug: 'about', title: 'About' });
  if (c.sections.areas && c.business.areas.length >= 2) pages.push({ slug: 'areas', title: 'Service areas' });
  pages.push({ slug: 'contact', title: c.business.mainAction === 'quote' ? 'Request a quote' : 'Contact' });
  return pages.slice(0, 5);
}

// ---------- colour helpers ----------
function hexToRgb(h: string) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lum(h: string) {
  const [r, g, b] = hexToRgb(h).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string) {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
function darken(h: string, f: number) {
  const [r, g, b] = hexToRgb(h).map((v) => Math.round(v * (1 - f)));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
/** Accent usable as text/buttons on light backgrounds (≥4.5:1 against white). */
export function accessibleAccent(accent: string) {
  let a = accent;
  for (let i = 0; i < 12 && contrast(a, '#ffffff') < 4.5; i++) a = darken(a, 0.12);
  return a;
}

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function illustration(accent: string, variant: Variant, label = 'Illustration of a clean, bright home') {
  if (variant === 'a') {
    return `<svg viewBox="0 0 400 260" role="img" aria-label="${esc(label)}" class="illo" width="400" height="260">
<rect width="400" height="260" rx="28" fill="${accent}" opacity=".10"/>
<circle cx="320" cy="62" r="34" fill="${accent}" opacity=".18"/>
<path d="M110 130 L200 62 L290 130 V214 H110 Z" fill="#fff" stroke="${accent}" stroke-width="5" stroke-linejoin="round"/>
<rect x="178" y="158" width="44" height="56" rx="6" fill="${accent}" opacity=".85"/>
<rect x="128" y="142" width="34" height="30" rx="5" fill="${accent}" opacity=".25"/>
<rect x="238" y="142" width="34" height="30" rx="5" fill="${accent}" opacity=".25"/>
<g fill="${accent}"><path d="M70 70 l6 14 14 6 -14 6 -6 14 -6 -14 -14 -6 14 -6z"/><path d="M330 150 l4 9 9 4 -9 4 -4 9 -4 -9 -9 -4 9 -4z" opacity=".7"/><path d="M60 180 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" opacity=".55"/></g>
</svg>`;
  }
  return `<svg viewBox="0 0 400 300" role="img" aria-label="${esc(label)}" class="illo" width="400" height="300">
<rect width="400" height="300" fill="#efe9df"/>
<path d="M120 300 V140 a80 80 0 0 1 160 0 V300 Z" fill="#fff"/>
<path d="M150 300 V150 a50 50 0 0 1 100 0 V300 Z" fill="${accent}" opacity=".16"/>
<line x1="200" y1="100" x2="200" y2="300" stroke="${accent}" stroke-width="3" opacity=".5"/>
<line x1="150" y1="200" x2="250" y2="200" stroke="${accent}" stroke-width="3" opacity=".5"/>
<circle cx="320" cy="70" r="22" fill="${accent}" opacity=".35"/>
<rect x="30" y="240" width="70" height="60" rx="8" fill="${accent}" opacity=".22"/>
</svg>`;
}

const ICONS: Record<string, string> = {
  default: '<path d="M12 3l2.2 5.3L20 9l-4.4 3.8L17 19l-5-3-5 3 1.4-6.2L4 9l5.8-.7z"/>',
};

function css(c: SiteContent) {
  const accent = accessibleAccent(c.design.accent);
  const onAccent = contrast(accent, '#ffffff') >= 4.5 ? '#ffffff' : '#0b1b33';
  const base = `
*,*::before,*::after{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;font:17px/1.6 var(--body);color:var(--ink);background:var(--bg)}
img,svg{max-width:100%;height:auto;display:block}a{color:var(--accent)}
.wrap{max-width:1080px;margin:0 auto;padding:0 20px}
.skip{position:absolute;left:-999px}.skip:focus{left:12px;top:12px;background:#fff;padding:8px 12px;z-index:99;border-radius:8px}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:12px 22px;border-radius:var(--radius);font-weight:700;text-decoration:none;border:2px solid var(--accent);font-size:17px;cursor:pointer;font-family:inherit}
.btn-primary{background:var(--accent);color:var(--on-accent)}.btn-ghost{background:transparent;color:var(--accent)}
header.site{position:sticky;top:0;z-index:20;background:var(--bg);border-bottom:1px solid var(--line)}
header.site .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:64px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;color:var(--ink);text-decoration:none;font-size:18px;line-height:1.2;min-width:0}
.brand span{overflow-wrap:anywhere}
.brand img{width:40px;height:40px;object-fit:contain;border-radius:8px}
nav.menu details{position:relative}nav.menu summary{list-style:none;min-height:44px;min-width:44px;display:flex;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:12px;padding:0 14px;cursor:pointer;font-weight:600}
nav.menu summary::-webkit-details-marker{display:none}
nav.menu ul{list-style:none;margin:0;padding:8px;position:absolute;right:0;top:52px;background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.12);min-width:220px}
nav.menu li a{display:block;padding:12px 14px;border-radius:10px;color:var(--ink);text-decoration:none;font-weight:600}
nav.menu li a[aria-current]{background:var(--tint)}
.hdr-call{display:none}
section{padding:56px 0}
h1,h2,h3{line-height:1.15;margin:0 0 .5em;font-family:var(--display);overflow-wrap:anywhere}
h1{font-size:clamp(34px,8.5vw,58px)}h2{font-size:clamp(26px,6vw,38px)}h3{font-size:20px}
.lede{font-size:19px;color:var(--muted);max-width:40em}
.chips{display:flex;flex-wrap:wrap;gap:8px;padding:0;margin:0;list-style:none}.chips li{padding:8px 14px;border-radius:999px;background:var(--tint);font-weight:600;font-size:15px}
form.quote{display:grid;gap:14px}form.quote label{font-weight:700;font-size:15px;display:grid;gap:6px}
form.quote input,form.quote select,form.quote textarea{font:inherit;font-size:17px;padding:12px 14px;border:1.5px solid var(--line-strong);border-radius:12px;background:#fff;color:var(--ink);min-height:48px;width:100%}
form.quote .hint{font-weight:400;color:var(--muted);font-size:14px}
.preview-note{background:#fff7d6;color:#4a3b00;border:1px solid #f0d77a;border-radius:12px;padding:12px 14px;font-size:15px;display:none}
.preview-note.show{display:block}
footer.site{padding:40px 0 calc(40px + var(--bar-h,0px));background:var(--foot-bg);color:var(--foot-ink);font-size:15px}
footer.site a{color:inherit}footer.site .cols{display:grid;gap:24px}
.photos{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.photos img{border-radius:14px;aspect-ratio:4/3;object-fit:cover;width:100%}
.banner-preview{background:#0b1b33;color:#fff;font:600 13px/1.4 system-ui,sans-serif;padding:8px 16px;text-align:center}
@media (min-width:760px){.hdr-call{display:inline-flex}footer.site .cols{grid-template-columns:2fr 1fr 1fr}.photos{grid-template-columns:repeat(4,1fr)}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important;scroll-behavior:auto!important}}
`;
  if (c.variant === 'a') {
    return `:root{--accent:${accent};--on-accent:${onAccent};--ink:#10213a;--muted:#4a5a70;--bg:#ffffff;--tint:${accent}14;--line:#e3e8ef;--line-strong:#b9c3d0;--radius:14px;--body:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--display:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--foot-bg:#0f1d33;--foot-ink:#dfe7f3;--bar-h:76px}
${base}
.hero{padding:28px 0 40px;text-align:center}.hero .illo{margin:0 auto 22px;width:100%;max-width:440px;border-radius:28px}
.hero .lede{margin:0 auto 22px}.hero .actions{display:grid;gap:10px;max-width:420px;margin:0 auto}
.cards{display:grid;gap:14px;padding:0;list-style:none;margin:0}.cards li{border:1px solid var(--line);border-radius:18px;padding:20px;background:#fff}
.cards .ico{width:40px;height:40px;border-radius:12px;background:var(--tint);display:grid;place-items:center;margin-bottom:10px}.cards .ico svg{width:22px;fill:var(--accent)}
.alt{background:#f5f8fc}
.cta-band{background:var(--accent);color:var(--on-accent);border-radius:24px;padding:32px 22px;text-align:center}.cta-band .btn{background:var(--on-accent);color:var(--accent);border-color:var(--on-accent)}
.mbar{position:fixed;left:0;right:0;bottom:0;z-index:30;display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:rgba(255,255,255,.96);border-top:1px solid var(--line);backdrop-filter:blur(8px)}
@media (min-width:760px){.mbar{display:none}footer.site{padding-bottom:40px}.cards{grid-template-columns:repeat(3,1fr)}.hero{text-align:left;display:grid;grid-template-columns:1.1fr 1fr;gap:40px;align-items:center}.hero .illo{order:2;margin:0}.hero .lede{margin:0 0 22px}.hero .actions{grid-auto-flow:column;max-width:none;justify-content:start}}
`;
  }
  return `:root{--accent:${accent};--on-accent:${onAccent};--ink:#1d1a16;--muted:#5d564c;--bg:#faf7f2;--tint:#efe8dc;--line:#e4dccf;--line-strong:#c9bfae;--radius:6px;--body:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--display:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;--foot-bg:#1d1a16;--foot-ink:#efe8dc}
${base}
.hero{padding:36px 0 24px}.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:13px;font-weight:700;color:var(--accent);margin-bottom:12px}
.hero h1{font-weight:600;letter-spacing:-.01em}
.hero-grid{display:grid;gap:28px}.panel{background:#fff;border:1px solid var(--line);border-radius:10px;padding:22px}
.callrow{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0 0}
ol.num{list-style:none;counter-reset:s;padding:0;margin:0;border-top:1px solid var(--line)}
ol.num li{counter-increment:s;display:grid;grid-template-columns:44px 1fr;gap:8px;padding:18px 0;border-bottom:1px solid var(--line)}
ol.num li::before{content:counter(s,decimal-leading-zero);font-family:var(--display);font-size:22px;color:var(--accent)}
.illo{border-radius:10px;width:100%}
.quiet{background:#f3eee6}
@media (min-width:760px){.hero-grid{grid-template-columns:1.2fr 1fr;align-items:start}}
`;
}

function header(c: SiteContent, pages: PageDef[], current: string, link: (slug: string) => string, mode: 'direction' | 'site') {
  const b = c.business;
  const items = mode === 'site'
    ? pages.map((p) => `<li><a href="${link(p.slug)}"${p.slug === current ? ' aria-current="page"' : ''}>${esc(p.title)}</a></li>`).join('')
    : `<li><a href="#services">Services</a></li>${c.sections.areas && b.areas.length ? '<li><a href="#areas">Areas</a></li>' : ''}<li><a href="#quote">${b.mainAction === 'quote' ? 'Request a quote' : 'Contact'}</a></li>`;
  return `<header class="site"><div class="wrap">
<a class="brand" href="${mode === 'site' ? link('') : '#top'}">${b.logoUrl ? `<img src="${esc(b.logoUrl)}" alt="" width="40" height="40">` : ''}<span>${esc(b.name)}</span></a>
<div style="display:flex;gap:10px;align-items:center">
${b.phone ? `<a class="btn btn-ghost hdr-call" href="tel:${esc(b.phone)}">Call ${esc(formatPhone(b.phone))}</a>` : ''}
<nav class="menu" aria-label="Main"><details><summary aria-label="Menu">Menu</summary><ul>${items}</ul></details></nav>
</div></div></header>`;
}

function quoteForm(c: SiteContent, mode: 'preview' | 'live', action: string) {
  const b = c.business;
  const opts = b.services.map((s) => `<option>${esc(s)}</option>`).join('');
  const areas = b.areas.map((a) => `<option value="${esc(a)}">`).join('');
  return `<form class="quote" method="post" action="${mode === 'live' ? esc(action) : '#'}" ${mode === 'preview' ? 'data-preview="1"' : ''}>
<p class="preview-note" role="status">Preview only. This form isn’t connected yet, so nothing was sent.</p>
<label>Your name<input name="name" autocomplete="name" required maxlength="120"></label>
<label>Phone<input name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="40"></label>
<label>Email<input name="email" type="email" inputmode="email" autocomplete="email" maxlength="254"></label>
<label>Service<select name="service"><option value="">Choose a service</option>${opts}<option>Something else</option></select></label>
<label>Area<input name="area" list="bp-areas" autocomplete="address-level2" maxlength="120"><datalist id="bp-areas">${areas}</datalist></label>
<label>About your home <span class="hint">e.g. 2-bedroom condo, 1 bathroom</span><textarea name="property_details" rows="2" maxlength="600"></textarea></label>
<label>Preferred timing <span class="hint">A request only. ${esc(b.name)} will confirm availability.</span><input name="preferred_timing" maxlength="200"></label>
<label>Anything else?<textarea name="message" rows="3" maxlength="2000"></textarea></label>
<input type="text" name="website_url" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-5000px">
<button class="btn btn-primary" type="submit">${b.mainAction === 'quote' ? 'Request a quote' : 'Send message'}</button>
<p class="hint" style="font-size:14px;color:var(--muted);margin:0">We use your details only to reply to this request.</p>
</form>`;
}

function footer(c: SiteContent) {
  const b = c.business;
  return `<footer class="site"><div class="wrap cols">
<div><strong style="font-size:18px">${esc(b.name)}</strong><p style="margin:.4em 0 0">${esc(b.services.slice(0, 3).join(' · '))}</p></div>
<div>${b.phone ? `<p style="margin:0"><a href="tel:${esc(b.phone)}">${esc(formatPhone(b.phone))}</a></p>` : ''}${b.email ? `<p style="margin:.3em 0 0"><a href="mailto:${esc(b.email)}">${esc(b.email)}</a></p>` : ''}${c.sections.hours && b.hours ? `<p style="margin:.3em 0 0">${esc(b.hours)}</p>` : ''}</div>
<div>${b.areas.length ? `<p style="margin:0">Serving ${esc(b.areas.slice(0, 6).join(', '))}</p>` : ''}<p style="margin:.6em 0 0;opacity:.7;font-size:13px">Website by Blue Park</p></div>
</div></footer>`;
}

function servicesBlock(c: SiteContent, ctaHref: string) {
  const b = c.business;
  if (c.variant === 'a') {
    return `<ul class="cards">${b.services.map((s) => `<li><div class="ico"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.default}</svg></div><h3>${esc(s)}</h3><p style="margin:0;color:var(--muted)">${esc(serviceBlurb(s))}</p></li>`).join('')}</ul>
<p style="margin-top:20px"><a class="btn btn-ghost" href="${ctaHref}">${b.mainAction === 'quote' ? 'Ask for a quote' : 'Get in touch'}</a></p>`;
  }
  return `<ol class="num">${b.services.map((s) => `<li><div><h3 style="margin:0 0 4px">${esc(s)}</h3><p style="margin:0;color:var(--muted)">${esc(serviceBlurb(s))}</p></div></li>`).join('')}</ol>`;
}

function photosBlock(c: SiteContent) {
  if (!c.sections.photos || !c.business.photos.length) return '';
  return `<section aria-labelledby="ph"><div class="wrap"><h2 id="ph">${c.variant === 'a' ? 'Our work' : 'Recent work'}</h2><div class="photos">${c.business.photos.map((p, i) => `<img src="${esc(p.url)}" alt="${esc(p.alt)}" ${p.width ? `width="${p.width}" height="${p.height}"` : 'width="800" height="600"'} loading="${i < 2 ? 'eager' : 'lazy'}" decoding="async">`).join('')}</div></div></section>`;
}

function infoBlock(c: SiteContent) {
  const b = c.business;
  const parts = [];
  if (c.sections.hours && b.hours) parts.push(`<div><h3>Hours</h3><p style="margin:0">${esc(b.hours)}</p></div>`);
  if (c.sections.pricing && b.pricing) parts.push(`<div><h3>Pricing</h3><p style="margin:0">${esc(b.pricing)}</p></div>`);
  if (!parts.length) return '';
  return `<section><div class="wrap" style="display:grid;gap:20px">${parts.join('')}</div></section>`;
}

const t = (c: SiteContent, k: 'heroTitle' | 'heroSub' | 'aboutText') => c.overrides[k] || c.copy[k];

export interface RenderOpts {
  page: string;
  mode: 'preview' | 'live';
  scope: 'direction' | 'site';
  link: (slug: string) => string;
  inquiryAction: string;
  previewBanner?: string;
}

export function renderPage(c: SiteContent, o: RenderOpts): string {
  const b = c.business;
  const pages = sitePages(c);
  const page = o.scope === 'direction' ? '' : (pages.find((p) => p.slug === o.page)?.slug ?? null);
  if (page === null) return '';
  const quoteHref = o.scope === 'site' ? o.link('contact') : '#quote';
  const callBtn = b.phone ? `<a class="btn ${c.variant === 'a' ? 'btn-ghost' : 'btn-ghost'}" href="tel:${esc(b.phone)}">Call ${esc(formatPhone(b.phone))}</a>` : '';
  const quoteBtn = `<a class="btn btn-primary" href="${quoteHref}">${b.mainAction === 'quote' ? 'Request a quote' : 'Contact us'}</a>`;
  const bookingBtn = b.bookingUrl ? `<a class="btn btn-ghost" href="${esc(b.bookingUrl)}" rel="noopener">Book online</a>` : '';
  const illoOrPhoto = b.photos[0]
    ? `<img class="illo" src="${esc(b.photos[0].url)}" alt="${esc(b.photos[0].alt)}" width="${b.photos[0].width ?? 800}" height="${b.photos[0].height ?? 600}" fetchpriority="high" style="object-fit:cover;aspect-ratio:4/3">`
    : illustration(accessibleAccent(c.design.accent), c.variant);
  let main = '';
  const title = pages.find((p) => p.slug === page)?.title ?? 'Home';

  if (page === '') {
    if (c.variant === 'a') {
      main = `<section class="hero"><div class="wrap hero">${illoOrPhoto}<div><h1>${esc(t(c, 'heroTitle'))}</h1><p class="lede">${esc(t(c, 'heroSub'))}</p><div class="actions">${quoteBtn}${callBtn}${bookingBtn}</div></div></div></section>
<section class="alt" id="services" aria-labelledby="sv"><div class="wrap"><h2 id="sv">Services</h2>${servicesBlock(c, quoteHref)}</div></section>
${photosBlock(c)}
${c.sections.areas && b.areas.length ? `<section id="areas" aria-labelledby="ar"><div class="wrap"><h2 id="ar">Areas we serve</h2><ul class="chips">${b.areas.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div></section>` : ''}
${b.differentiator ? `<section class="alt"><div class="wrap"><h2>Why ${esc(b.name)}</h2><p class="lede">${esc(b.differentiator)}</p></div></section>` : ''}
${infoBlock(c)}
<section id="quote" aria-labelledby="qt"><div class="wrap"><div class="cta-band" style="margin-bottom:28px"><h2 id="qt">${b.mainAction === 'quote' ? 'Get a quote' : 'Get in touch'}</h2><p style="margin:0 0 16px">Tell us about your space and what you need.</p>${b.phone ? `<a class="btn" href="tel:${esc(b.phone)}">Call ${esc(formatPhone(b.phone))}</a>` : ''}</div>${o.scope === 'direction' ? quoteForm(c, o.mode, o.inquiryAction) : `<p><a class="btn btn-primary" href="${quoteHref}">Open the quote form</a></p>`}</div></section>`;
    } else {
      main = `<section class="hero"><div class="wrap hero-grid"><div><p class="eyebrow">${esc(b.services.some((s) => !/office/i.test(s)) ? 'Residential cleaning' : 'Cleaning')}${b.city ? ` · ${esc(b.city)}` : ''}</p><h1>${esc(t(c, 'heroTitle'))}</h1><p class="lede">${esc(t(c, 'heroSub'))}</p><div class="callrow">${b.phone ? `<a class="btn btn-primary" href="tel:${esc(b.phone)}">Call ${esc(formatPhone(b.phone))}</a>` : quoteBtn}${bookingBtn}</div></div>
<div class="panel" id="quote"><h2 style="font-size:24px">${b.mainAction === 'quote' ? 'Request a quote' : 'Send a message'}</h2>${o.scope === 'direction' ? quoteForm(c, o.mode, o.inquiryAction) : `<p style="margin-top:0">Tell us about your home and what you need.</p><a class="btn btn-primary" href="${quoteHref}">Start a request</a>`}</div></div></section>
<section id="services" aria-labelledby="sv"><div class="wrap hero-grid"><div><h2 id="sv">What we do</h2><p class="lede">${esc(t(c, 'aboutText'))}</p></div>${servicesBlock(c, quoteHref)}</div></section>
${b.photos.length ? photosBlock(c) : `<section class="quiet"><div class="wrap">${illoOrPhoto}</div></section>`}
${c.sections.areas && b.areas.length ? `<section id="areas" aria-labelledby="ar"><div class="wrap"><h2 id="ar">Where we work</h2><p class="lede">${esc(b.areas.join(' · '))}</p></div></section>` : ''}
${b.differentiator ? `<section class="quiet"><div class="wrap"><blockquote style="margin:0;font-family:var(--display);font-size:clamp(22px,5vw,30px);line-height:1.3">${esc(b.differentiator)}</blockquote></div></section>` : ''}
${infoBlock(c)}`;
    }
  } else if (page === 'services') {
    main = `<section><div class="wrap"><h1>Services</h1><p class="lede">${esc(b.name)} offers the following${b.city ? ` in ${esc(b.city)}` : ''}. Ask about anything you don’t see here.</p></div></section>
<section class="${c.variant === 'a' ? 'alt' : 'quiet'}"><div class="wrap">${servicesBlock(c, quoteHref)}</div></section>${photosBlock(c)}${infoBlock(c)}
<section><div class="wrap"><p>${quoteBtn} ${callBtn}</p></div></section>`;
  } else if (page === 'about') {
    main = `<section><div class="wrap"><h1>About ${esc(b.name)}</h1>${b.description ? `<p class="lede">${esc(b.description)}</p>` : ''}${b.differentiator ? `<p class="lede">${esc(b.differentiator)}</p>` : ''}</div></section>${photosBlock(c)}
<section><div class="wrap"><p>${quoteBtn} ${callBtn}</p></div></section>`;
  } else if (page === 'areas') {
    main = `<section><div class="wrap"><h1>Service areas</h1><p class="lede">${esc(b.name)} cleans ${b.services.some((s) => !/office/i.test(s)) ? 'homes' : 'spaces'} in these areas. Not sure if you’re covered? Ask in your quote request.</p><ul class="chips" style="margin-top:20px">${b.areas.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div></section>
<section><div class="wrap"><p>${quoteBtn} ${callBtn}</p></div></section>`;
  } else if (page === 'contact') {
    main = `<section><div class="wrap" style="max-width:640px"><h1>${b.mainAction === 'quote' ? 'Request a quote' : 'Contact'}</h1><p class="lede">${b.phone ? `Prefer to talk? Call <a href="tel:${esc(b.phone)}">${esc(formatPhone(b.phone))}</a>.` : ''}${b.email ? ` Or email <a href="mailto:${esc(b.email)}">${esc(b.email)}</a>.` : ''}</p>${quoteForm(c, o.mode, o.inquiryAction)}</div></section>`;
  }

  const bar = c.variant === 'a' ? `<div class="mbar">${b.phone ? `<a class="btn btn-ghost" href="tel:${esc(b.phone)}">Call</a>` : `<span></span>`}<a class="btn btn-primary" href="${quoteHref}">${b.mainAction === 'quote' ? 'Get a quote' : 'Contact'}</a></div>` : '';
  const script = o.mode === 'preview'
    ? `<script>document.addEventListener('submit',function(e){var f=e.target;if(f&&f.dataset&&f.dataset.preview){e.preventDefault();var n=f.querySelector('.preview-note');if(n){n.classList.add('show');n.scrollIntoView({block:'center'});}}});</script>`
    : '';
  const docTitle = page === '' ? `${b.name}${b.city ? ` | Cleaning in ${b.city}` : ''}` : `${title} | ${b.name}`;
  const desc = `${b.name}: ${b.services.slice(0, 3).join(', ')}${b.city ? ` in ${b.city}` : ''}.`;
  const ld = {
    '@context': 'https://schema.org', '@type': 'HouseCleaningService' as const, name: b.name,
    ...(b.phone ? { telephone: b.phone } : {}), ...(b.email ? { email: b.email } : {}),
    ...(b.areas.length ? { areaServed: b.areas } : {}),
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(docTitle)}</title><meta name="description" content="${esc(desc)}">${o.mode === 'preview' ? '<meta name="robots" content="noindex">' : ''}
<style>${css(c)}</style>${o.mode === 'live' ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>` : ''}</head>
<body data-bluepark-site="${c.variant}" id="top"><a class="skip" href="#main">Skip to content</a>
${o.previewBanner ? `<div class="banner-preview">${esc(o.previewBanner)}</div>` : ''}
${header(c, pages, page, o.link, o.scope)}<main id="main">${main}</main>${footer(c)}${bar}${script}</body></html>`;
}
