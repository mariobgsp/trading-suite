# Research: Design of the "Apps" (Tools) Section — klinikpenyesalan.com/#apps

## Summary

The `#apps` section ("TOOLS & DATA — Built for the desk.") is a statically server-rendered block inside a single self-contained HTML page: all CSS is inlined in one `<style>` and the section's HTML is baked in, so every layout, color, typography, and motion detail is directly observable from the page source with no JS dependency. It presents **4 app cards in a 2-column grid**, each card pairing a decorative animated "data visualization" header (196px) with a text body (number + title + tagline + URL + "OPEN →" CTA). The design language is a dark, terminal-flavored "data desk" aesthetic: Space Grotesk for display/body, JetBrains Mono for labels, a single teal accent (#3bbcb4) on near-black surfaces, with light-mode equivalents via CSS variables. Card visualizations use CSS-only looping animations (equalizer bars, meter shimmer, striping) — they are mock/decorative, not live data.

Source: raw HTML of `https://www.klinikpenyesalan.com/` (the `#apps` fragment is the same document — no separate resource needed), fetched as exact HTML via fetch_content raw mode. All CSS is inline; there is no external stylesheet. Confidence in every claim below is **High** except where noted.

## Findings

### Layout

1. **Section chrome** — `#apps` is `<section class="section" id="apps">` with `border-top: 1px solid var(--line)`. Inner wrapper `.section-inner` pads `92px 32px 100px`; on ≤620px it shrinks to `64px 68px`. [Source](https://www.klinikpenyesalan.com/)
2. **Section header** — `.apps-head` is a flex row (`justify-content:space-between; align-items:flex-end; gap:40px; margin-bottom:52px`) with three parts: a `.eyebrow` label ("TOOLS & DATA", JetBrains Mono 11px, letter-spacing .16em, with a 7px teal square `::before` marker), an `<h2>` ("Built for the desk.", `clamp(34px,3.8vw,50px)`, weight 500, `-0.02em` tracking), and a right-aligned `.intro` paragraph (16px, weight 300, `--dim` color, `max-width:30em`). [Source](https://www.klinikpenyesalan.com/)
3. **Grid** — `.apps-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;}` — exactly **4 cards** (numbered 01–04 in the source comments). Two columns on desktop, collapsing to one column at ≤900px. [Source](https://www.klinikpenyesalan.com/)
4. **Card size** — Cards are equal-width columns; height is content-driven. Each card splits into a fixed-height `.tool-viz` header (**196px**, `background:var(--bg)`, `padding:24px`, `border-bottom`) and a flexible `.tool-body` (`padding:26px`). Total card height ≈ 196px + body (~200px with 24px title + 2-line tagline + footer row). [Source](https://www.klinikpenyesalan.com/)
5. **Page context** — The section sits under a sticky translucent header (70px, `backdrop-filter:blur(14px)`) and a scrolling ticker; a terminal card in the hero (`.app-row` links to the same 4 tools) provides a secondary entry point. `html{scroll-padding-top:90px}` offsets anchor jumps so `#apps` lands below the sticky header. [Source](https://www.klinikpenyesalan.com/)

### Card anatomy

6. **Card shell** — `.tool-card` is an `<a>` (whole card is a link): `display:flex;flex-direction:column;border:1px solid var(--line);background:var(--surface);box-shadow:var(--elev) (0 18px 46px -26px rgba(0,0,0,.62))`. No border-radius anywhere in the CSS — cards are sharp-cornered (consistent with the terminal aesthetic). [Source](https://www.klinikpenyesalan.com/)
2. **Viz header row** — `.tool-viz .viz-head` is a mono label bar: 10px JetBrains Mono, letter-spacing .12em, `--mute` color; right slot holds a teal-accent badge = the app's subdomain or a status chip. Per-card examples: "arthara.id" (01), "▲ 12 ACTIVE" (02, IPO), no badge (03), "FREE FLOAT / BBRI" is the label itself (04). [Source](https://www.klinikpenyesalan.com/)
3. **Per-card visualization** — four distinct decorative data mockups, all inline-baked values animated purely in CSS:
   - 01 Broker Flow: 11 equalizer bars (7px wide, heights 34–90%, teal vs `--logo-light` alternating) with staggered `kp-eq` scaleY animation + a BUY/SELL/NET mono legend.
   - 02 IPO: 6 flat bars (one teal = "100%", others `--line-2`) + two 5px meter rows (CDIA 82%, RATU 54%) with shimmer sweep (`kp-flow`).
   - 03 1% Shareholders: four 9px meter rows (PT SARANA 5.12%, RG NOMINEE 3.41%, CITI NOM 2.18%, PUBLIC 1.07%); lower rows use `--accent-dim` fill.
   - 04 Free Float: big stat **"73.4%"** (54px display, `-0.02em`) + a 13px segmented bar (teal "tradable" fill with shimmer + `repeating-linear-gradient` striped "locked 26.6%" segment, `kp-stripe .9s linear infinite`). [Source](https://www.klinikpenyesalan.com/)
4. **Text body** — `.tool-body` stacks with `gap:13px`. Row 1: a `.num` index (`01`–`04`, mono 12px, teal) baseline-aligned with an `<h3>` (24px, weight 500, `-0.01em`). Then a tagline `<p>` (15px, `line-height:1.56`, weight 300, `--dim`). [Source](https://www.klinikpenyesalan.com/)
5. **Footer row / CTA** — `.tool-body .foot` is a `border-top:1px solid var(--line)` mono row (11px): left = app URL in `--mute` ("arthara.id", "ipo.klinikpenyesalan.com", "1pct.klinikpenyesalan.com", "ff.klinikpenyesalan.com"), right = **"OPEN →"** in teal, weight 600. This is the only CTA per card (whole card is also one link). [Source](https://www.klinikpenyesalan.com/)
6. **Hover/active/focus states** — `.tool-card:hover{transform:translateY(-4px);border-color:var(--line-2);box-shadow:var(--elev-hi) (0 28px 64px -28px rgba(0,0,0,.72));}` — the card lifts 4px, border lightens, shadow deepens (0.25s transform via the global transition rule). No color change of text on hover; `.tool-card:focus-visible` gets the global accent outline but with `outline-offset:-2px` (inset). There is no `:active` state for cards (only `.btn:active` scales to `.985`). [Source](https://www.klinikpenyesalan.com/)

### Typography
 1. **Fonts** — Two self-hosted variable fonts, both `preload`ed woff2 and declared with `@font-face` (no external font service):
    - **Space Grotesk** (300–700) = `--sans`, used for h1/h2/h3, card titles, big stats, body copy. Body is `-webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility`.
    - **JetBrains Mono** (400–700) = `--mono`, used for eyebrows, nav, viz-head labels, `.num`, footer row, URLs, ticker.
    [Source](https://www.klinikpenyesalan.com/)
 2. **Type scale & rhythm** — Section h2 `clamp(34px,3.8vw,50px)`/500/`-0.02em`; h3 24px/500/`-0.01em`; tagline 15px/1.56/300; mono labels 10–12px with letter-spacing .04–.16em (all caps). Vertical rhythm: 52px under section header, 13px internal body gap, 14px padded footer row, 196px viz block — a consistent ~4px-modulo spacing grid (22px grid gap, 26px body padding, 24px viz padding). [Source](https://www.klinikpenyesalan.com/)

### Color
 1. **Palette (dark = default)** — CSS variables on `[data-kp-root]` (default `data-theme="dark"`): `--bg:#13171b`, `--surface:#181d23`, `--surface-2:#1e242b`, `--line:rgba(232,237,240,.10)`, `--line-2:rgba(232,237,240,.20)`, `--text:#e9ecef`, `--dim:#9aa3ab`, `--mute:#7e8893`, **`--accent:#3bbcb4` (teal)**, `--accent-dim:#1f7d77`, `--on-accent:#06130f`, `--logo-light:#d8d8d8`, `--logo-teal:#33b2ab`, `--fear:#d2565b`, `--glow:rgba(59,188,180,.16)`. [Source](https://www.klinikpenyesalan.com/)
 2. **Light mode** — Fully supported via `[data-kp-root][data-theme="light"]` overrides (`--bg:#eeece6`, `--surface:#f8f6f2`, `--surface-2:#fff`, `--text:#171b1f`, `--accent:#0e7d76`, `--on-accent:#fff`, etc.). Theme is chosen by localStorage (`kp-theme`) with an inline head script, toggled by a sun/moon button; the accent adapts in both directions. The page also sets dual `theme-color` meta tags per `prefers-color-scheme`. [Source](https://www.klinikpenyesalan.com/)
 3. **Accent use per app** — There is **no per-app accent color**: all four cards share the single teal accent for badges, numbers, "OPEN →", and viz highlights. The only color differentiation inside cards is accent-teal vs `--logo-light` (light-gray) bars in card 01 and `--accent-dim` fills on lower rows of card 03. Semantic up/down colors (teal/`--fear` red) appear in viz legends but both are baked statically. [Source](https://www.klinikpenyesalan.com/)

### Motion
 1. **Global transition** — `[data-kp-root] *{transition:background-color .3s ease,color .3s ease,border-color .3s ease,box-shadow .3s ease,transform .25s ease;}` — every element inherits a uniform 0.3s color/bg/border/shadow + 0.25s transform transition (this powers the card hover lift). [Source](https://www.klinikpenyesalan.com/)
 2. **Scroll behavior** — `html{scroll-behavior:smooth}` + `scroll-padding-top:90px` for smooth in-page anchor navigation to `#apps`; the header is sticky. There is **no scroll-triggered animation**: `.reveal` (hero-only) is a first-load `kp-rise` keyframe (opacity 0→1, translateY 14px→0, 0.7s `cubic-bezier(.16,1,.3,1)` with `backwards` fill + inline `animation-delay` staggering) that plays once on page load; a source scan found no `IntersectionObserver`. The apps section itself has no reveal animation. [Source](https://www.klinikpenyesalan.com/)
 3. **In-card ambient motion** — Continuous CSS keyframe loops in every viz:
    - `kp-eq` / `kp-eq2` — scaleY equalizer pulse (1.2–3s durations, negative delays for staggering, 11 bars card 01 / 6 bars card 02).
    - `kp-flow` — a translucent white sweep `linear-gradient(90deg,transparent,rgba(255,255,255,.26),transparent)` translating across meters/ff-fill (2.8–3s ease-in-out infinite, staggered via negative delays).
    - `kp-stripe` — diagonal striping animation on the "locked" float segment (.9s linear infinite).
    - `kp-blink` — steps(1) blinking dots/caret (ticker, LIVE indicators, terminal caret).
    [Source](https://www.klinikpenyesalan.com/)
 4. **Reduced motion** — `@media (prefers-reduced-motion:reduce)` disables all looping animations (ticker, blinks, reveals, bars, meters, stripes) and sets `transition:none` globally — the ambient motion and hover transitions are fully suppressed. [Source](https://www.klinikpenyesalan.com/)

### Responsive + accessibility
 1. **Breakpoints** — ≤900px: `.apps-grid` → single column (also hero, floor, fg-grid collapse); ≤760px: main nav links hidden (hamburger absent — theme toggle + Discord CTA remain); ≤620px: wrap padding 20px, `.apps-head` stacks to column with `align-items:flex-start` (`margin-bottom:36px;gap:16px`), section padding 64/68px; ≤520px: brand wordmark hidden. No mobile-specific card changes beyond the column collapse. [Source](https://www.klinikpenyesalan.com/)
 2. **Accessibility** — `:focus-visible{outline:2px solid var(--accent);outline-offset:3px}` globally, with `outline-offset:-2px` on tool cards; whole-card `<a>` links carry real `href`s with `target="_blank" rel="noopener"`; theme toggle uses `aria-pressed` + `aria-label`; SVGs use `role="img"`/`aria-label` or `aria-hidden`; `::selection` styled teal; `color-scheme:dark/light` set so form controls/scrollbars follow the theme. The baked-in viz values (e.g., "73.4%") are real text nodes, not canvas — readable by AT/screen readers. [Source](https://www.klinikpenyesalan.com/)
 3. **JS independence** — The page's four inline scripts only: (a) theme toggle + localStorage, (b) live Fear & Greed fetch to `/api/fear-greed` that repaints baked gauges/charts, (c) IDX movers (1D/5D tables), (d) heatmap treemap + capture kit. **None of them touch `.apps-grid`, `.tool-card`, or `.reveal`.** The apps section renders and animates identically with JavaScript disabled. [Source](https://www.klinikpenyesalan.com/)

## Sources

- Kept: Klinik Penyesalan homepage raw HTML (`https://www.klinikpenyesalan.com/`) — the authoritative, complete source: it contains the entire `#apps` markup, the full inlined stylesheet (layout/typography/color/motion/responsive/a11y), and every inline script, so all design claims trace to one primary document. The `#apps` fragment is part of this same document.
- Kept: Font preloads + `@font-face` declarations within the same document — evidence for the two self-hosted variable fonts (Space Grotesk, JetBrains Mono) at `assets/fonts/*.woff2`.
- Dropped: External font CDN links (FontAwesome icons only — `fontawesome.min.css` / `solid.min.css` from jsdelivr) — irrelevant to the apps section design; the only FA usage in-apps-adjacent is the theme-toggle icon in the header.
- Dropped: `og-image.png`, favicons — brand assets, no design-relevant signal for the apps grid.

## Gaps

- **No rendered-DOM verification**: Analysis is from raw HTML/CSS source, which is complete and unambiguous for this section (static, no JS dependency), but pixel-level rendering (actual font metrics, sub-pixel card heights, shadow appearance, backdrop-blur on the sticky header, smooth-scroll feel) was not verified in a real browser viewport — expect ±small visual deltas.
- **Live-data vs mock**: Card viz values (12,400 buy / 82% IPO subscription / 73.4% free float) are baked-in mock numbers, not fetched live data — confirmed by the script audit (only sentiment/movers/heatmap fetch data). Whether they were intended to be live is unknowable from source.
- **Not measured**: card min/max heights, exact text-wrapping line counts for taglines at intermediate widths, and how the 2-column grid behaves between 620px and 900px were derived from CSS math, not screenshots.
- **Suggested next step**: capture screenshots at ~1440px, ~800px, and ~375px viewports (e.g., via a headless browser) to confirm rendered heights, hover lift, and the 1-column collapse; and check the four app subdomains for a shared design system.

## Supervisor coordination

None needed — task completed from a single authoritative source fetch; no blocking decisions or scope ambiguity arose.