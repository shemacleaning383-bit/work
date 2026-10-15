// Shared Blue Park brand tokens for server-rendered pages.
export const BRAND_CSS = `
:root{--navy:#0b1b33;--navy-2:#13294d;--paper:#f7f5f0;--card:#ffffff;--blue:#1652f0;--blue-ink:#0f3fc2;--blue-soft:#e8eefe;
--green:#0f7a55;--green-soft:#e3f4ec;--amber:#8a5a00;--amber-soft:#fff4d6;--red:#b42318;--red-soft:#fdecea;
--ink:#0b1b33;--muted:#4b5a70;--line:#e2ddd3;--line-2:#cfc8bb;--radius:16px;--shadow:0 1px 2px rgba(11,27,51,.06),0 8px 24px rgba(11,27,51,.06);
--font:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font:17px/1.55 var(--font);color:var(--ink);background:var(--paper)}
a{color:var(--blue-ink)}
img{max-width:100%;height:auto}
:focus-visible{outline:3px solid var(--blue);outline-offset:2px;border-radius:6px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:52px;padding:14px 24px;border-radius:14px;
  font:700 17px/1.2 var(--font);text-decoration:none;border:2px solid transparent;cursor:pointer;touch-action:manipulation}
.btn-primary{background:var(--blue);color:#fff}.btn-primary:hover{background:var(--blue-ink)}
.btn-dark{background:var(--navy);color:#fff}
.btn-quiet{background:transparent;color:var(--ink);border-color:var(--line-2)}
.wrap{max-width:1120px;margin:0 auto;padding:0 16px}
.demo-bar{background:var(--amber-soft);color:#4a3200;font-size:14px;text-align:center;padding:8px 16px;border-bottom:1px solid #f0d77a}
.logo{display:inline-flex;align-items:center;gap:10px;font-weight:800;font-size:19px;color:var(--ink);text-decoration:none;letter-spacing:-.01em}
.logo svg{width:30px;height:30px}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

export const LOGO_SVG = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#0b1b33"/><path d="M8 22V10h7.2c2.6 0 4.2 1.3 4.2 3.3 0 1.4-.8 2.4-2 2.8 1.6.3 2.6 1.5 2.6 3.1 0 2.3-1.8 3.8-4.6 3.8H8z" fill="#fff"/><circle cx="24" cy="10" r="3" fill="#1652f0"/></svg>`;
