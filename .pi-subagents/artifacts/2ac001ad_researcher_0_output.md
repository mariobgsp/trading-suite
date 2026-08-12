# Research: Porting an "apps grid" landing-page design language onto a dark, data-dense trading dashboard

## Summary

The reference site (klinikpenyesalan.com) is itself a dark, Indonesian retail-trader site that already solves this exact problem: a marketing hero and an `#apps` launchpad grid built on the *same* token system as its dense data tables (movers, heatmap, Fear & Greed) — so it is a directly citable precedent, not just inspiration. The transferable playbook: keep one shared dark token set, give the apps grid its own generous card anatomy (viz header + body + footer, mono data numerals, `translateY(-4px)` hover with elevation lift), and gate all decorative motion behind `prefers-reduced-motion`. The main risks are real but mitigable: density mismatch (fixed with density tiers + width caps), hierarchy dilution (conditional emphasis), and token drift (solved with Tailwind v4 `@theme inline` mapping semantic vars).

---

## Findings

### Q1 — What works for an apps-grid/launcher section in a dashboard

1. **Reference site anatomy (primary precedent).** `#apps` on klinikpenyesalan.com ships: `.apps-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:22px; }` with `.tool-card { display:flex; flex-direction:column; border:1px solid var(--line); background:var(--surface); box-shadow:var(--elev); }` and hover = `transform:translateY(-4px); border-color:var(--line-2); box-shadow:var(--elev-hi)`. Card body is a 4-part anatomy: mono `viz-head` (10px label row) → `.tool-viz` 196px data visualization region → `.tool-body` (mono accent number + 24px title + 15px dim description, `flex:1`) → `.foot` row (mono URL + accent "open" affordance) separated by a `border-top`. Groups are separated by section headings with a mono "eyebrow" (11px, `.16em` letter-spacing, 7px accent square glyph). [Source: klinikpenyesalan.com stylesheet — fetched raw HTML](https://www.klinikpenyesalan.com/)

2. **Generic card anatomy converges on container / media / content / action regions**, with ordering: header (title + context tag + time range + quick actions), body (hero value/chart with density modes), meta (deltas, last-updated), footer (drill-in/compare/export affordances). For a dashboard launcher this means: every card should carry a *data preview* (sparkline/stat), not just an icon, so the grid earns its place on a data-dense page. [Spell UI — UI card design patterns](https://spell.sh/blog/ui-card-design-patterns), [Hexabinar — composable cards for complex dashboards](https://hexabinar.com/insights/composable-dashboard-cards/)

3. **Dense icon-grid precedent for tool discovery:** shadcn's navigation-menu "Feature Grid" (9 dev tools, 3-col grid, Lucide icons + one-line description) and Raycast's AppGrid (grid view + smart category grouping: frequently used / development / productivity / utilities) show the two grouping strategies that work: *category-grouped sections* and *usage-frequency grouping*. Keyboard-first launcher behavior (type-to-filter) is the power-user upgrade the reference site lacks and a dashboard should add. [shadcn feature grid example](https://www.shadcn.io/examples/navigation-menu-feature-grid-layout), [Raycast AppGrid](https://www.raycast.com/Jungwoon/appgrid)

4. **Keep launcher cards data-honest:** Hexabinar's "primary first / data-ink ratio" rule — one hero value per card, supporting data recedes, color roles fixed (teal=links/data, green=CTA) — prevents a launcher from becoming 8 competing colorful tiles. Reference site uses a *single* accent (#3bbcb4) everywhere including per-card sparklines; per-app colors are the risky embellishment (see Q3). [Hexabinar](https://hexabinar.com/insights/composable-dashboard-cards/)

*Confidence: High for the reference-site anatomy (read from shipped CSS); High for generic card anatomy; Medium-High that usage/category grouping applies well to an 8-app trading suite.*

---

### Q2 — Risks of mixing marketing-page aesthetics with dense trading data

1. **Risk: density mismatch.** Trading dashboards are scan/compare/decide tools; marketing pages are glance tools. Concrete numbers: comfortable tables = 48–52px rows (~5–6 rows visible), standard 36–40px (~8–10), compact 28–32px (~14–16) — a marketing "airy" grid wastes 2–3x the vertical space per row. Mitigations: offer a comfortable/compact toggle for data tables (persist per user), cap default visible columns at 6–8, and solve alignment/column-count separately from row height ("compact mode just makes the mess smaller"). [Art of Styleframe — dashboard data density](https://artofstyleframe.com/blog/dashboard-data-density-patterns/), [pixel-show — designing data-dense dashboards](https://pixel-show.com/blog/designing-data-dense-dashboards)

2. **Risk: information-hierarchy dilution ("everything screams").** One vibrant green for every win cell causes attention fragmentation; the fix is two-tier emphasis — hero/summary values full-weight, repeating table cells at ~85% opacity. Same principle applies to the launcher: decorative gradients in 8 app tiles compete with the P&L colors of the data sections around them. Mitigation: keep accent color *roles* fixed, vary only intensity, and give decorative surfaces low-saturation neutral tints. [pixel-show](https://pixel-show.com/blog/designing-data-dense-dashboards)

3. **Risk: typography mismatch.** Marketing can use expressive display type; product/data UI needs a different register. The pragmatic standard (used by the reference site and by data-dense products generally): *two fonts* — a display/sans for labels and headings (Space Grotesk on the reference site) and a monospace (JetBrains Mono) for every number, with numbers slightly heavier so columns scan vertically. A single rounded geometric sans for labels *and* numbers reads "friendly and unfocused" in a data tool. [FontFYI — typography for SaaS products](https://fontfyi.com/blog/typography-saas-products/), [pixel-show](https://pixel-show.com/blog/designing-data-dense-dashboards), [klinikpenyesalan.com](https://www.klinikpenyesalan.com/)

4. **Key mitigation: contain the marketing register spatially.** The reference site demonstrates this precisely: hero uses `clamp(44px,5.2vw,76px)` display type and a radial glow, but every data section is wrapped in "terminal" chrome (border + mono 11px headers with live dot), the movers table is capped at `max-width:1680px` with a comment in the source: *"Capped rather than full-bleed so it still reads as a page, not a dashboard"*, and tables get sticky headers + a max-height scroll region (`max-height:440px`) so rows scroll, not the page. The marketing register lives in the hero and section headings; the data register lives inside bordered panels with mono type. [klinikpenyesalan.com stylesheet](https://www.klinikpenyesalan.com/)

5. **Risk: brand/promise mismatch (lessons from SaaS).** Landing-page marketing sets expectations of "seamless efficiency"; a cluttered product UI undercuts the promise and drives churn. Also: consumer-app rules (generous whitespace, ≤5 elements, one font, 3 colors) are *actively wrong* for data-dense dashboards — don't import the whitespace defaults, only the card/viz language. [Creative Riz — cohesive standard](https://creativeriz.com/the-cohesive-standard-bridging-marketing-and-software-ui-ux/), [pixel-show](https://pixel-show.com/blog/designing-data-dense-dashboards)

*Confidence: High — multiple independent sources agree, and the reference site is a working counterexample/proof of the hybrid approach.*

---

### Q3 — Tailwind v4 token structure for per-app accents + shared dark tokens

 1. **`@theme` vs `@theme inline` rule (the load-bearing detail).** In Tailwind v4, `@theme` tokens generate utilities *and* emit CSS variables; use `@theme inline` when the token value is `var(--something)` defined elsewhere, because the emitted utility resolves to the *referenced variable* rather than a snapshot value. This is exactly the pattern needed for a runtime-switchable dark theme and per-app accents that change with theme. Maintainer guidance (tailwindlabs/tailwindcss discussion #17826): "Only use `@theme inline` when CSS variables are referenced." [Tailwind v4 theme docs](https://tailwindcss.com/docs/theme), [Discussion #17826](https://github.com/tailwindlabs/tailwindcss/discussions/17826)

 2. **Recommended structure** (dark-first, selector-driven, matching the reference site's `data-theme` approach):

```css
@import "tailwindcss";
/* selector-driven dark mode (site already toggles a class/attr) */
@custom-variant dark (&:where(.dark, .dark *));

/* raw semantic vars — one source of truth, overridable at runtime */
:root, .dark {
  --bg:#13171b; --panel:#181d23; --panel-2:#1e242b;
  --border:rgba(232,237,240,.10); --border-2:rgba(232,237,240,.20);
  --text:#e9ecef; --dim:#9aa3ab; --mute:#7e8893;
  --accent:#3bbcb4; --accent-dim:#1f7d77; --on-accent:#06130f;
  /* per-app accents (same names in light mode, different values) */
  --app-overview:#3bbcb4; --app-markets:#d2565b; --app-portfolio:#e0b84c;
  /* ... one per app: overview, markets, portfolio, backtest, screener,
       validator, sentiment, regime */
}

@theme inline {
  --color-bg: var(--bg);      --color-panel: var(--panel);
  --color-border: var(--border); --color-border-2: var(--border-2);
  --color-text: var(--text);  --color-dim: var(--dim); --color-mute: var(--mute);
  --color-accent: var(--accent); --color-accent-dim: var(--accent-dim);
  --color-on-accent: var(--on-accent);
  --color-app-overview: var(--app-overview); /* → bg-app-overview, text-app-overview, etc. */
  --font-sans: "Space Grotesk", …; --font-mono: "JetBrains Mono", …;
}
```

Benefits: utilities like `bg-panel`, `text-dim`, `bg-app-markets` are generated; light mode only overrides the `:root`/`.light` vars; accent swaps are one line per app without touching component classes. [Tailwind v4 theme docs](https://tailwindcss.com/docs/theme), [Dark mode docs](https://tailwindcss.com/docs/dark-mode), [reference-site tokens](https://www.klinikpenyesalan.com/)

 1. **Semantic-color discipline from trading precedent:** define *two scales per semantic role* (dark + light) — same hex reads differently on white vs near-black, e.g. dark `--green:#22c55e` vs light `--green:#16a34a` — and build a **4-step elevation** ramp in dark mode (`--bg-void` → `--bg-primary` → `--bg-secondary` → `--bg-surface`, ~6–7 hex points apart) because "the darker your base, the more elevation steps you need." The reference site's ramp is `#13171b / #181d23 / #1e242b` with `rgba(232,237,240,.10–.20)` borders — mirror that. [pixel-show](https://pixel-show.com/blog/designing-data-dense-dashboards), [klinikpenyesalan.com](https://www.klinikpenyesalan.com/)

 2. **Per-app accent caution:** 8 saturated hues can visually collide with P&L semantics (green/red already carry meaning in tables — `--accent` teal and `--fear` red on the reference site). If per-app accents are kept, constrain them to the launcher tile *icons/glyphs and small markers only*, never large fills, and keep them from bleeding into data sections where green/red are already loaded. Prefer a shared hue family (e.g. teal-based variants) over a rainbow. [Hexabinar color roles](https://hexabinar.com/insights/composable-dashboard-cards/), [klinikpenyesalan.com](https://www.klinikpenyesalan.com/)

*Confidence: High on the `@theme inline` mechanics (official docs + maintainer discussion); Medium-High on accent-confinement guidance (design judgment grounded in the two sources).*

---

### Q4 — Accessibility + performance

 1. **Motion preference is a first-class requirement, not a nice-to-have.** WCAG 2.2 SC 2.3.3 (Animation from Interactions) and technique C39 require honoring `prefers-reduced-motion`; the reference site ships exactly this pattern — a `@media (prefers-reduced-motion:reduce)` block that kills the ticker, blinking dots, reveal animations, equalizer bars, shimmer overlays, and sets `transition:none` globally. In Tailwind v4 this maps to built-in `motion-safe:` / `motion-reduce:` variants (e.g. `motion-reduce:transition-none`). [klinikpenyesalan.com stylesheet](https://www.klinikpenyesalan.com/), [W3C C39](https://www.w3.org/WAI/WCAG22/Techniques/css/C39), [MDN prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion), [Tailwind animation docs](https://tailwindcss.com/docs/animation)

 2. **Contrast on dark backgrounds.** WCAG 2.2 AA: 4.5:1 body text, 3:1 large text (≥24px / ≥18.66px bold) and UI components/focus indicators. Dark themes fail most often via washed-out text and invisible focus states — map focus with `:focus-visible{outline:2px solid var(--accent)}` (reference site does exactly this, with negative-offset outlines inside cards). Spot-check of the reference site's shipped tokens (computed via WCAG relative luminance): accent `#3bbcb4` on surface `#181d23` ≈ **7.3:1** (passes AA for normal text); mute `#7e8893` on `#181d23` ≈ **4.7:1** (passes 4.5:1). Its dim/mute tiers stay above AA, which is why the palette works. Verify your equivalents with a checker before shipping; low-contrast text is the most common web failure (83.9% of home pages per WebAIM). [WCAG 1.4.3 Understanding](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum), [A11yFlow contrast guide](https://www.a11yflow.dev/blog/color-contrast-wcag-developer-guide), [ByJTT accessible dark themes](https://www.byjtt.com/blog/accessible-dark-themes), [klinikpenyesalan.com](https://www.klinikpenyesalan.com/)

 3. **Animation cost.** Data-dense dashboards should keep motion to confirmation-level: a 3-duration system (120ms press / 200ms drawer / 350ms route change, one easing `cubic-bezier(0.16,1,0.3,1)`), no springs inside the product UI, no staggered table animations ("if a motion takes longer than the user needs to dismiss it, it's too long"). Performance mechanics: animate only `transform`/`opacity` (compositor/GPU-friendly); `box-shadow` and `border-color` animations are paint-heavy — the reference site animates `translateY` + box-shadow on hover, which is acceptable for ~8 cards but should not be copied into tables/charts. Respect a ~14ms frame budget for any JS-driven motion and skip non-critical work when a frame overruns. [pixel-show](https://pixel-show.com/blog/designing-data-dense-dashboards), [IDV guide — GPU acceleration & frame budget](https://www.interactive-data-visualization.com/high-performance-animation-gpu-acceleration/), [web.dev — animation & motion](https://web.dev/learn/accessibility/motion)

*Confidence: High on WCAG numbers and the C39/reduced-motion pattern; Medium-High on the token contrast ratios (hand-computed, verify with a tool).*

---

### Q5 — Cheapest validation path (ascending cost)

 1. **Tier 0 — static checks (free, minutes):** `next build` + lint (typecheck catches broken token references/classes), plus `tsc --noEmit` if not already part of build. Catches config errors but not visual issues.

 2. **Tier 1 — automated a11y scan (cheap, high value):** axe-core in a Playwright test (`@axe-core/playwright`) with `color-contrast` rule enabled — automatically flags the dark-palette contrast failures from Q4 across all 8 pages. This is cheaper than eyeballing and catches the most common dark-mode failure.

 3. **Tier 2 — Playwright `toHaveScreenshot()` page-level (the pragmatic default):** one baseline screenshot per page (8 total) at fixed viewport + fixed theme, then CI comparison. Caveats that matter: baselines are environment-sensitive (OS, fonts, GPU, headless mode) — run in a pinned container/image (Docker) or accept periodic baseline refreshes; diff thresholds need tuning to avoid false positives. This is the cheapest *visual* signal and the standard 2025/2026 answer. [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots), [TestQuality — Playwright visual regression guide](https://testquality.com/playwright-visual-regression-guide/)

 4. **Tier 3 — component-level checks (only if Tiers 1–2 get noisy):** per-component screenshots via Playwright component testing or Storybook + Chromatic (hosted diffs, interactive snapshots). Useful for the new `AppCard`/launcher components specifically, since they're new surface area; not needed to validate the whole redesign. [Chromatic Playwright integration](https://www.chromatic.com/blog/how-to-visual-test-ui-using-playwright/)

**Recommended minimum for this task:** `next build` + axe contrast scan + one `toHaveScreenshot` per page (Overview + one dense page like Markets) before merging the launcher; expand to all 8 pages in CI only after diff thresholds are tuned.

*Confidence: High — this matches current Playwright/CI guidance and keeps the first validation under an hour of setup.*

---

## Sources

**Kept:**

- klinikpenyesalan.com (raw HTML/CSS fetched) — the actual requested reference; its `#apps` grid, token ramp, reduced-motion block, and marketing/data hybrid are the primary precedent. (<https://www.klinikpenyesalan.com/>)
- Tailwind CSS v4 — Theme variables / Dark mode / Transitions & Animation docs — authoritative on `@theme`, `@theme inline`, `@custom-variant dark`, `motion-reduce:`. (<https://tailwindcss.com/docs/theme>)
- tailwindlabs/tailwindcss Discussion #17826 — maintainer guidance on `@theme inline` vs `@theme`. (<https://github.com/tailwindlabs/tailwindcss/discussions/17826>)
- pixel-show — "Designing Data-Dense Dashboards: 8 Lessons from a Trading Journal" — density, two color scales, 4-step elevation, two-font rule, 3-duration motion system. (<https://pixel-show.com/blog/designing-data-dense-dashboards>)
- Art of Styleframe — dashboard density patterns — row-height tiers (28–52px), column caps, density toggle guidance. (<https://artofstyleframe.com/blog/dashboard-data-density-patterns/>)
- Hexabinar — composable cards — card anatomy (header/body/meta/footer), data-ink hierarchy, states, a11y. (<https://hexabinar.com/insights/composable-dashboard-cards/>)
- W3C WCAG 2.2 — Understanding 1.4.3 + Technique C39 — AA contrast numbers and `prefers-reduced-motion` technique. (<https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum>)
- Playwright — Visual comparisons — `toHaveScreenshot` mechanics and environment-consistency caveats. (<https://playwright.dev/docs/test-snapshots>)
- A11yFlow + ByJTT — dark-mode contrast failure modes and fixes. (<https://www.a11yflow.dev/blog/color-contrast-wcag-developer-guide>, <https://www.byjtt.com/blog/accessible-dark-themes>)
- FontFYI — SaaS typography (marketing vs product type). (<https://fontfyi.com/blog/typography-saas-products/>)
- shadcn feature-grid + Raycast AppGrid — dense icon-grid launcher precedents. (<https://www.shadcn.io/examples/navigation-menu-feature-grid-layout>, <https://www.raycast.com/Jungwoon/appgrid>)
- IDV Guide — GPU animation and frame budget. (<https://www.interactive-data-visualization.com/high-performance-animation-gpu-acceleration/>)

**Dropped:**

- TestDino / Delta-QA / ScrollTest Playwright tutorials — redundant with Playwright's own docs + TestQuality guide.
- PatternFly dashboard guidelines — enterprise generic, no trading-specific density insight.
- Lollypop / KlindrOS / LogixTrader design pieces — promotional, insights already covered by pixel-show.
- Various contrast "guide" roundups (testparty, allaccessible) — superseded by W3C + A11yFlow + ByJTT.

## Gaps

- **Per-app accent color psychology**: no authoritative source on 8 simultaneous app-hues in a trading context; final hue selection for 8 apps needs a designer review (or user testing). Recommend hue-constrained family (teal-based) as default.
- **Icon set choice**: no recommendation on icon library (lucide-react vs FontAwesome, as the reference site uses FA 7); low-risk, but worth deciding before tokens are locked.
- **Interaction model for the launcher** (type-to-filter / keyboard-first vs pure grid): Raycast precedent exists, but no data on whether Indonesian retail users expect it — cheap A/B or analytics decision, not a design one.
- **Light mode**: reference site and pixel-show both ship dark-first with a light override; trading-suite's existing light-mode tokens should be re-verified against the new accent set (two-scales-per-role rule from finding 12).
- **Contrast numbers in finding 15 are hand-computed** from the reference site's shipped tokens — verify with axe/contrast tool before relying on them for trading-suite's own palette.

## Supervisor coordination

No coordination needed. Research complete; this brief is the deliverable. No files other than the required output artifact were created or modified.