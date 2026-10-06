# Visual checks: extra (Playwright MCP)

Sections §5–§10 of the visual pass, continued from `visual-checks.md` (read that file first: tool
usage, snippet conventions and the per-route sequence are defined there). Load this file when the
sequence reaches contrast, keyboard focus, an interaction or dialog, layout shift or dark mode.

## 5. Contrast (approximate, solid backgrounds)

Converts any CSS color (incl. `oklch()` from Tailwind v4) via canvas, composites translucent
backgrounds, and skips text on images/gradients (check those on the screenshot).

```js
() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top, bottom) => [0, 1, 2].map((k) => top[k] * top[3] + bottom[k] * (1 - top[3])).concat(1);
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== 'none') return null; // image/gradient: verify visually
      const c = rgba(cs.backgroundColor);
      if (c[3] > 0) { layers.push(c); if (c[3] === 1) break; }
    }
    let base = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  };
  const fails = []; let checked = 0;
  for (const el of document.body.querySelectorAll('*')) {
    if (checked > 400) break;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (el.closest(':disabled, [aria-disabled="true"], [aria-hidden="true"]')) continue;
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (cs.visibility === 'hidden' || cs.display === 'none' || r.width <= 1 || r.height <= 1) continue;
    checked++;
    const bg = bgOf(el); if (!bg) continue;
    const fg = over(rgba(cs.color), bg);
    const L1 = lum(fg), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    if (ratio < need) fails.push({ text: el.textContent.trim().slice(0, 40), ratio: +ratio.toFixed(2), need,
      color: cs.color, size: cs.fontSize });
  }
  return { checked, fails: fails.slice(0, 25) };
}
```

Limits: ignores ancestor `opacity`, text shadows and images. Confirm borderline results (within
0.3 of the threshold) on the screenshot. Body text below 4.5:1 is Major.

## 6. Keyboard focus

Static order (DOM order vs visual order, positive `tabindex`):

```js
() => {
  const q = 'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
  const els = [...document.querySelectorAll(q)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('[inert], [aria-hidden="true"]'); });
  const positive = els.filter((e) => e.tabIndex > 0).map((e) => e.outerHTML.slice(0, 80));
  const pos = els.map((e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), left: Math.round(r.left) }; });
  const inversions = [];
  for (let i = 1; i < pos.length; i++) {
    if (pos[i].top < pos[i - 1].top - 40) inversions.push({ from: els[i - 1].outerHTML.slice(0, 60), to: els[i].outerHTML.slice(0, 60) });
  }
  return { count: els.length, positiveTabindex: positive, inversions: inversions.slice(0, 10) };
}
```

Live walk: press `Tab` with the MCP key-press tool, then run this after each press (up to ~15
stops through the changed area):

```js
() => {
  const el = document.activeElement;
  if (!el || el === document.body) return { focused: 'body' };
  const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return {
    tag: el.tagName.toLowerCase(), role: el.getAttribute('role'),
    name: (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.getAttribute('placeholder') || '').trim().slice(0, 40),
    focusVisible: el.matches(':focus-visible'),
    indicator: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none',
    inViewport: r.top >= 0 && r.bottom <= innerHeight,
    obscured: !!top && top !== el && !el.contains(top),
  };
}
```

Flag: `indicator: false` (confirm on an element screenshot; some designs use border/background
change) → Major; `obscured: true` (sticky header/footer covers focus, WCAG 2.4.11) → Major; focus
returning to `body` mid-page, or never leaving a widget → Blocker (trap).

## 7. Interaction (one per changed component)

1. Take an accessibility snapshot to get element refs; act through refs (click, type, select, key press).
2. Pick the interaction the change is about: open the modal/drawer/menu, submit the form empty and with invalid input, expand/collapse, paginate, toggle, or a destructive control under the rule in step 5.
3. Screenshot the resulting state (`-<state>` suffix) and re-run `visual-checks.md` §4 if layout changed.
4. Check the expected feedback exists: pending state on submit (button disabled/spinner, no double submit), inline errors associated with fields, success/error toast announced (`role="status"`/`aria-live`), empty state when filtering to nothing.
5. Leave data as you found it. **Destructive controls:** trigger one **only if** the static pass found a
   confirmation dialog on it **and** it acts on dummy data logged per
   `.claude/zeross/workflow/data-safety.md`. Then open the confirmation, inspect it (§8), and cancel
   with **Esc**. Never confirm it unless it is that logged dummy data and the check needs it. With no
   confirmation in the code, do not click it at all: report the missing confirmation statically.

## 8. Dialog check

Run while a dialog is open; run again after pressing Esc (expect `open: false` and focus back on the trigger).

```js
() => {
  const d = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]')]
    .find((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  if (!d) return { open: false, focused: document.activeElement && document.activeElement.outerHTML.slice(0, 80) };
  const lb = d.getAttribute('aria-labelledby');
  const title = (lb && document.getElementById(lb)?.textContent.trim()) || d.getAttribute('aria-label') || d.querySelector('h1, h2, h3')?.textContent.trim() || null;
  const buttons = [...d.querySelectorAll('button, [role="button"]')].map((b) => ({
    text: b.innerText.trim(), focused: b === document.activeElement,
    looksDestructive: /destruct|danger|delete|remove|red/i.test(b.className + ' ' + (b.getAttribute('data-variant') || '')),
  }));
  return { open: true, role: d.getAttribute('role') || 'dialog', ariaModal: d.getAttribute('aria-modal') || (d.tagName === 'DIALOG' ? 'native' : null),
    title, hasDescription: !!d.getAttribute('aria-describedby'), buttons, focusInside: d.contains(document.activeElement) };
}
```

For destructive confirmations require: `title` naming the consequence (not "Are you sure?"), a
description line, two buttons with explicit labels (never "OK"/"Cancel"), the destructive one
styled destructive, focus on the safe one (or the dialog), Esc closes without acting.

## 9. Layout shift

Page load (async, ~1.5 s):

```js
async () => {
  let cls = 0; const shifts = [];
  const po = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (e.hadRecentInput) continue;
      cls += e.value;
      shifts.push({ value: +e.value.toFixed(4), sources: (e.sources || []).map((s) => s.node && s.node.nodeType === 1
        ? (s.node.id ? '#' + s.node.id : s.node.tagName.toLowerCase() + '.' + [...s.node.classList].slice(0, 2).join('.')) : null).filter(Boolean) });
    }
  });
  po.observe({ type: 'layout-shift', buffered: true });
  await new Promise((r) => setTimeout(r, 1500));
  po.disconnect();
  return { cls: +cls.toFixed(3), shifts: shifts.slice(0, 10) };
}
```

CLS > 0.1 → Minor, > 0.25 → Major. Common sources: images without dimensions, late-loading
fonts, content inserted above existing content, skeletons with different size than content.

Around an interaction: install before, read after.

```js
() => { window.__zrShifts = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__zrShifts.push({ v: +e.value.toFixed(4), afterInput: e.hadRecentInput }); }).observe({ type: 'layout-shift' }); return 'installed'; }
```

```js
() => window.__zrShifts || []
```

Shifts with `afterInput: false` after the interaction (e.g. a spinner swapping in with a different
size, an error banner pushing content) are unexpected → Minor/Major by size.

## 10. Dark mode

Prefer the Playwright MCP's media-emulation capability (`prefers-color-scheme: dark`). If the app
uses a class or attribute strategy instead, set what it uses (find it in the theme provider or
Tailwind `darkMode` config), e.g.:

```js
() => { document.documentElement.classList.add('dark'); document.documentElement.setAttribute('data-theme', 'dark'); return document.documentElement.className; }
```

Then screenshot (`-dark` state suffix), run `visual-checks.md` §4 and §5 above. Look for: unreadable text, white boxes from
hard-coded `bg-white`, invisible borders/icons, logos without dark variants.
