# Visual checks (Playwright MCP)

Exact procedure and `evaluate` snippets for the visual pass. Use the Playwright MCP resolved from
`profile.json → mcpRoles.playwright`; use its tools for resize, navigate, wait, screenshot,
evaluate, console messages, network requests, accessibility snapshot, click and key press. Tool
names differ by server version; pick by purpose.

Each snippet is a self-contained function: pass it as the `function` argument of the evaluate tool.
Snippets never modify the page except where noted (scrolling, focus). If you need to keep a snippet
or a scratch script in a file, put it in the session scratchpad or `$TMPDIR`, never in the repo.

This file holds the core checks (§1–§4). Contrast, keyboard focus, interactions, dialogs, layout
shift and dark mode (§5–§10) are in `visual-checks-extra.md`.

## 1. Viewports

- Source: `config.json → ui.breakpoints` (`[{ name, width, height }]`). Default when missing:
  `mobile 375×812`, `tablet 768×1024`, `desktop 1440×900`.
- Order: smallest first (most breakage shows there).
- Resizing sets the viewport only: no touch events, device pixel ratio or mobile user agent. Hover-only
  UI and `@media (hover: hover)` behavior must be judged statically (see `responsive-patterns.md`).
- Tailwind: 768 hits `md:` exactly (min-width is inclusive); 1440 is inside `xl:` (1280) and below `2xl:` (1536). Check the boundary widths when the change uses those prefixes.
- Screenshot naming: `[<ticket>-]ui-<route-slug>-<breakpoint>[-<state>].png`, e.g.
  `vtx-123-ui-settings-billing-mobile-delete-dialog.png`. The ticket prefix is added when the caller
  gives a ticket, as the lowercase key (the same key form `browser.md` uses for its own
  `<ticket>-<step>-<before|after>.png` pattern). The Playwright MCP writes into `.playwright-mcp/`
  (its output dir). Full-page screenshots for layout; element screenshots for detail.
- Touch-target minimum: 24 px (WCAG 2.5.8). If `.claude/rules/zeross/ui.md` sets a larger minimum for the smallest
  breakpoint (the default template says 44×44), edit `MIN_TARGET` in §4 for that breakpoint.

## 2. Per route × viewport sequence

1. Resize to the breakpoint, navigate to `<dev.url><route>`, wait for a key selector or network idle.
2. Run **§3 Lazy-load scroll** (loads lazy images and below-the-fold content).
3. Take the full-page screenshot and look at it.
4. Run **§4 Layout audit**. Investigate every non-empty array: confirm on the screenshot, then find the source (file:line) of the offending element.
5. Read console messages (errors and warnings since navigation) and failed network requests (4xx/5xx on app/API calls). Ignore dev-only noise (HMR, React DevTools banner, source-map 404s); report hydration mismatches, unhandled rejections, key warnings, failed API calls.
6. Once per route (at the smallest breakpoint): **§5 Contrast**.
7. Once per route (one breakpoint): **§6 Keyboard focus**.
8. Once per changed component: **§7 Interaction** (+ **§8 Dialog check** for dialogs, **§9 Layout shift**).
9. If `ui.darkMode`: **§10 Dark mode** at the smallest and largest breakpoints.

§5–§10 live in `visual-checks-extra.md`; load it when the sequence reaches step 6.

## 3. Lazy-load scroll (async, scrolls the page)

```js
async () => {
  const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
  for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 120));
  }
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 300));
  return { scrollHeight: document.documentElement.scrollHeight };
}
```

## 4. Layout audit (overflow, clipping, overlap, targets, images)

One call returns everything. Results are capped; fix the first offenders and re-run.

```js
() => {
  const MIN_TARGET = 24; // px; set to the .claude/rules/zeross/ui.md minimum (e.g. 44) at the smallest breakpoint
  const de = document.documentElement;
  const vw = de.clientWidth;
  const sel = (el) => {
    if (!el || el.nodeType !== 1) return null;
    if (el.id) return `#${el.id}`;
    const tid = el.getAttribute('data-testid');
    if (tid) return `[data-testid="${tid}"]`;
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.body && parts.length < 4; n = n.parentElement) {
      const cls = [...n.classList].filter((c) => !c.includes(':')).slice(0, 2).join('.');
      parts.unshift(n.tagName.toLowerCase() + (cls ? '.' + cls : ''));
    }
    return parts.join(' > ');
  };
  const shown = (el) => {
    if (el.closest('[aria-hidden="true"], [inert]')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1; // skips sr-only (1px) elements
  };
  const ancestorClipsX = (el) => {
    for (let a = el.parentElement; a && a !== document.body && a !== de; a = a.parentElement) {
      if (getComputedStyle(a).overflowX !== 'visible') return true;
    }
    return false;
  };
  const all = [...document.body.querySelectorAll('*')].filter(shown);

  // 4a. Elements extending past the viewport horizontally (outermost offender only)
  const offends = (el) => {
    const r = el.getBoundingClientRect();
    return (r.right > vw + 1 || r.left < -1) && !ancestorClipsX(el);
  };
  const overflowing = [];
  for (const el of all) {
    if (!offends(el)) continue;
    if (el.parentElement && el.parentElement !== document.body && offends(el.parentElement)) continue;
    const r = el.getBoundingClientRect();
    overflowing.push({ el: sel(el), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
      position: getComputedStyle(el).position });
  }

  // 4b. Clipped / truncated / spilling text (elements with their own text)
  const textIssues = [];
  for (const el of all) {
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!ownText) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'inline') continue;
    const overX = el.scrollWidth > el.clientWidth + 1;
    const overY = el.scrollHeight > el.clientHeight + 1;
    if (!overX && !overY) continue;
    if (/(auto|scroll)/.test(cs.overflowX + ' ' + cs.overflowY)) continue; // user can scroll
    const clipsX = cs.overflowX !== 'visible';
    const clipsY = cs.overflowY !== 'visible';
    const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
    let kind = null;
    if ((overX && clipsX) || (overY && clipsY)) kind = cs.textOverflow === 'ellipsis' || clamp ? 'truncated' : 'clipped';
    else if (overX && el.scrollWidth - el.clientWidth > 4) kind = 'spills';
    if (!kind) continue;
    textIssues.push({ el: sel(el), kind, text: el.textContent.trim().slice(0, 60),
      fullTextAvailable: !!(el.getAttribute('title') || el.getAttribute('aria-label') || el.closest('[title]')) });
  }

  // 4c. Interactive elements: covered, overlapping, too small
  const interactiveSel = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';
  const ctrls = [...document.querySelectorAll(interactiveSel)].filter(shown).slice(0, 300);
  const covered = [];
  const small = [];
  for (const el of ctrls) {
    const r = el.getBoundingClientRect();
    if (r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= vw) {
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (top && top !== el && !el.contains(top) && !top.contains(el)) covered.push({ el: sel(el), coveredBy: sel(top) });
    }
    const inlineLink = el.tagName === 'A' && getComputedStyle(el).display === 'inline';
    if (!inlineLink && (r.width < MIN_TARGET || r.height < MIN_TARGET)) small.push({ el: sel(el), w: Math.round(r.width), h: Math.round(r.height) });
  }
  const overlaps = [];
  for (let i = 0; i < ctrls.length && overlaps.length < 20; i++) {
    const a = ctrls[i].getBoundingClientRect();
    for (let j = i + 1; j < ctrls.length; j++) {
      if (ctrls[i].contains(ctrls[j]) || ctrls[j].contains(ctrls[i])) continue;
      const b = ctrls[j].getBoundingClientRect();
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 2 && h > 2) overlaps.push({ a: sel(ctrls[i]), b: sel(ctrls[j]), w: Math.round(w), h: Math.round(h) });
    }
  }

  // 4d. Images
  const imgs = [...document.images];
  const brokenImages = imgs.filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute('src'))
    .map((i) => ({ el: sel(i), src: i.currentSrc || i.src }));
  const pendingImages = imgs.filter((i) => !i.complete).map((i) => i.currentSrc || i.src).slice(0, 10);
  const missingAlt = imgs.filter((i) => !i.hasAttribute('alt')).map((i) => sel(i)).slice(0, 20);
  const distorted = imgs.filter((i) => i.naturalWidth && shown(i)).filter((i) => {
    const r = i.getBoundingClientRect();
    const fit = getComputedStyle(i).objectFit;
    const ratio = (r.width / r.height) / (i.naturalWidth / i.naturalHeight);
    return (fit === 'fill' || fit === '') && (ratio < 0.9 || ratio > 1.1);
  }).map((i) => sel(i)).slice(0, 10);

  return {
    viewport: { width: vw, height: window.innerHeight },
    pageOverflowX: de.scrollWidth > vw, scrollWidth: de.scrollWidth,
    overflowing: overflowing.slice(0, 20),
    textIssues: textIssues.slice(0, 30),
    covered: covered.slice(0, 20), overlaps, smallTargets: small.slice(0, 20),
    brokenImages, pendingImages, missingAlt, distorted,
  };
}
```

Reading the result:

| Field | Meaning | Typical severity |
|---|---|---|
| `pageOverflowX: true` | Page scrolls horizontally at this width | Major (Blocker if controls end up off-screen) |
| `overflowing[]` | Outermost elements past the viewport edge; `position: fixed` off-canvas drawers are usually intentional, confirm on screenshot | Major |
| `textIssues` `clipped` | Text cut off with no ellipsis or scroll | Major |
| `textIssues` `truncated` | Deliberate ellipsis/line-clamp; fine if `fullTextAvailable` or the full text is shown elsewhere; else Minor | Minor |
| `textIssues` `spills` | Text overflows its box visibly (likely overlapping neighbors) | Major |
| `covered[]` | A control's center is covered by another element (sticky header, toast, overlay) | Major (Blocker if primary action) |
| `overlaps[]` | Two controls intersect | Major |
| `smallTargets[]` | Below `MIN_TARGET` (24 px WCAG 2.5.8; `.claude/rules/zeross/ui.md` may require 44 px on mobile), unless spacing around it compensates | Minor (Major for primary actions) |
| `brokenImages[]` | Failed to load | Blocker if essential content, else Major |
| `missingAlt[]` | `<img>` without `alt` (decorative needs `alt=""`) | Major |
| `distorted[]` | Aspect ratio stretched (`object-fit: fill`) | Minor |
