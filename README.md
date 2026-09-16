# Sunday Cleaning — website

A complete, responsive marketing and booking-request website for **Sunday
Cleaning**, a residential home cleaning business serving Toronto. Built as
a dependency-free static site: plain HTML, CSS and JavaScript, no build
step required.

## Run it locally

No dependencies, no package manager, no lockfile needed. Any static file
server works:

```bash
# Option 1 — Python (usually preinstalled)
python3 -m http.server 8080

# Option 2 — Node, if you have it
npx serve .
```

Then open `http://localhost:8080`.

You can also just double-click `index.html` to open it directly in a
browser; everything except the booking form's `fetch()` path (unused in
demo mode) works from the `file://` protocol too.

There is no build/compile step and nothing to install — the site is
`index.html` + `styles.css` + `script.js` + `assets/`.

## What's implemented and live right now

- Full responsive layout: header/nav (with mobile menu), hero, 8 content
  sections, and footer.
- A real, interactive monthly **booking calendar** in the hero — built
  from `Date` objects, so month lengths and leap years are handled
  correctly by the platform, not hard-coded. Supports mouse, touch and
  full keyboard navigation (arrow keys, Home/End, Page Up/Down,
  Enter/Space), disables past dates, and shows today/selected states.
- Service selection that stays in sync across the hero calendar, the
  "What needs attention?" service rows, and the full booking form.
- A complete booking-request form: service, home size, date, time
  window, contact details, postal code, notes, and an optional
  client-side photo picker with previews and per-file validation
  (type/size/count).
- Full client-side validation with inline error messages, a loading
  state, a truthful completion state, and preserved field values on
  error.
- Accessible FAQ accordions (native `<details>`/`<summary>`), a postal
  code "quick check" for the Toronto service area, reduced-motion
  support, visible focus states, and alt text throughout.

## What is NOT live: booking is a demo

**No booking backend is connected.** Submitting the form does not send
any request anywhere. The completion screen says this explicitly:

> "Your appointment is confirmed once we review your request. No request
> was actually sent — this page isn't connected to a booking backend
> yet."

Selected dates are **preferences**, never claimed as reserved
appointments, and no confirmation emails are sent (none could be, without
a backend).

### To make booking live

1. Stand up a form backend (a simple serverless function, a service like
   Formspree, or your own API) that accepts a `multipart/form-data` POST
   with the booking fields and any attached photos.
2. Open `script.js` and set `CONFIG.bookingEndpoint` (near the top of the
   file) to that URL. `.env.example` documents this as
   `BOOKING_ENDPOINT` for reference — because this is a static site with
   no server process, the value itself is set directly in `script.js`
   (or injected there by your static host's build step), not read from a
   real `.env` file at runtime.
3. Once `bookingEndpoint` is set, `script.js` automatically switches from
   demo mode to a real `fetch()` POST, with real success and failure
   handling already wired up (see `submitToBackend()` in `script.js`).
4. Keep any API keys or credentials on your backend, never in this
   frontend code.

## Customizing

Almost everything you'd want to change lives in a few predictable
places:

| To change... | Edit... |
|---|---|
| Business name, service area, integration URL, photo limits | `CONFIG` object at the top of `script.js` |
| Services (labels used across hero/select/form) | `SERVICE_LABELS` in `script.js`, **and** keep the matching `data-service` / `value` attributes and copy in `index.html` (hero `<select>`, Section 3 service rows, Section 8 radio buttons) in sync |
| Home size options | `HOME_SIZE_LABELS` in `script.js` and the `<select id="homeSize">` options in `index.html` |
| Headlines, body copy, FAQ content | Directly in `index.html` — it's all plain, live HTML text (nothing is baked into images) |
| Colors, type, spacing, layout | Design tokens at the top of `styles.css` (`:root`), plus section-specific rules further down |
| Contact details / footer | The `footer-col` blocks near the bottom of `index.html` |
| Hero photo and supporting imagery | See **Imagery**, below |

## Imagery

**Important — read this before shipping.** The two images referenced in
the design brief (the hero photograph and the visual-direction reference)
were shown in our conversation but were not available to this build
environment as files on disk — there was no way to save or bundle the
actual photographs. Every image currently in `assets/images/` is a
tasteful, brand-toned **placeholder illustration** (SVG, duotone,
generated to match the ivory/olive palette), not a real photograph. They
are real, valid, loading assets — nothing is broken or blank — but they
are stand-ins, not photography, and should not be presented as customer
photos.

To finish the site, replace these files with real photographs (same
filenames, similar aspect ratios, so no HTML/CSS changes are required):

| File | Used for | Suggested aspect ratio |
|---|---|---|
| `assets/images/hero.svg` | Hero image | 4:5 (portrait) |
| `assets/images/living-room.svg` | Spaces gallery | 3:4 |
| `assets/images/kitchen.svg` | Spaces gallery | 3:4 |
| `assets/images/bathroom.svg` | Spaces gallery | 3:4 |
| `assets/images/approach-large.svg` | Our Approach, main image | 4:3 |
| `assets/images/approach-detail-1.svg` | Our Approach, detail image | 5:4 |
| `assets/images/approach-detail-2.svg` | Our Approach, detail image | 5:4 |
| `assets/images/service-standard.svg` | Service row thumbnail | 4:3 |
| `assets/images/service-deep.svg` | Service row thumbnail | 4:3 |
| `assets/images/service-move.svg` | Service row thumbnail | 4:3 |
| `assets/images/service-recurring.svg` | Service row thumbnail | 4:3 |

If you switch these to `.jpg`/`.webp`, update the `src` attributes in
`index.html` accordingly, and export a couple of sizes for responsive
`srcset` if you want to optimize further. The hero image loads eagerly
(`loading="eager"`); every other image is `loading="lazy"`.

## Fonts

Loaded from Google Fonts via `<link>` tags in `index.html` (`Fraunces`
for headlines, `Inter` for body/UI text). This requires an internet
connection when the page loads; if you need a fully offline-capable
build, self-host the two font families and swap the `<link>` tags for
local `@font-face` rules.

## Missing business details (by design — nothing was invented)

The brief and our conversation did not supply a phone number, street
address, business email, years in business, insurance/certification
claims, customer counts, pricing, or guaranteed turnaround times, so none
of these appear anywhere on the site — the footer says "Contact details
coming soon" rather than a placeholder. Add real values directly in the
footer markup in `index.html` once you have them.

## Accessibility notes

- The calendar grid uses `role="grid"` / `role="row"` / `role="gridcell"`
  with a roving `tabindex`, `aria-label`, `aria-current="date"` and
  `aria-selected`, and full keyboard support.
- FAQ items use native `<details>`/`<summary>`, which is keyboard- and
  screen-reader-accessible without any extra ARIA.
- All interactive controls have visible `:focus-visible` states.
- `@media (prefers-reduced-motion: reduce)` disables transitions and
  switches scroll-to-section behavior from smooth to instant.

## Verification performed

Checked in this environment via a local static server at three
viewport widths (mobile ~390px, tablet ~820px, desktop ~1280px+):

- Calendar renders the current month correctly, previous/next navigation
  works, past dates are visibly disabled and unselectable, and month
  transitions (including into a new year) compute correctly from native
  `Date` math.
- Selecting a service/date in the hero and clicking **Continue Booking**
  scrolls to the booking form with the same service and date prefilled.
- Choosing a service from the "What needs attention?" rows updates the
  hero selector.
- Form validation fires on empty/invalid required fields with inline
  messages; a valid submission shows a loading state, then the clearly
  labeled demo completion screen; going back with "Edit my details"
  preserves everything typed.
- Photo picker enforces the file count/type/size limits and lets you
  remove a selected photo.
- Mobile nav opens/closes, traps focus sensibly, and closes on Escape or
  link click; no horizontal scrolling was observed at any of the three
  widths.

**Not verified:** a live screen-reader pass (NVDA/VoiceOver) and
cross-browser testing beyond the Chromium engine available in this
environment — worth doing before launch.

## Image credits

All imagery in `assets/` was generated for this project as simple SVG
illustrations (no external stock or photo sources used). See
**Imagery**, above, for what needs to be replaced with real photography.
